using System.Net;
using Azure.Security.KeyVault.Secrets;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Models;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class WebhookRegisterFunction
{
    private readonly ILogger<WebhookRegisterFunction> _logger;
    private readonly AuthHelper _authHelper;
    private readonly ShopifyService _shopify;
    private readonly string[] _allowedOrigins;
    private readonly string _defaultCallbackBaseUrl;
    private readonly SecretClient? _secretClient;

    public WebhookRegisterFunction(
        ILogger<WebhookRegisterFunction> logger,
        AuthHelper authHelper,
        ShopifyService shopify,
        string[] allowedOrigins,
        IConfiguration config,
        SecretClient? secretClient = null)
    {
        _logger = logger;
        _authHelper = authHelper;
        _shopify = shopify;
        _allowedOrigins = allowedOrigins;
        _defaultCallbackBaseUrl = config["WebhookCallbackBaseUrl"] ?? "";
        _secretClient = secretClient;
    }

    [Function("WebhookList")]
    public async Task<HttpResponseData> List(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "webhooks")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        var webhooks = await _shopify.ListWebhooksAsync();
        return await ResponseHelper.WriteSuccess(req, new { webhooks, callbackBaseUrl = _defaultCallbackBaseUrl }, _allowedOrigins);
    }

    [Function("WebhookDelete")]
    public async Task<HttpResponseData> Delete(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", "options", Route = "webhooks/{id}")]
        HttpRequestData req, string id)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        var ok = await _shopify.DeleteWebhookAsync(id);
        if (!ok)
            return await ResponseHelper.WriteError(req, "Failed to delete webhook", HttpStatusCode.InternalServerError, _allowedOrigins);

        return await ResponseHelper.WriteSuccess(req, new { deleted = id }, _allowedOrigins);
    }

    [Function("WebhookRegister")]
    public async Task<HttpResponseData> Register(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "webhooks/register")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var body = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<RegisterWebhooksRequest>(body);

            var callbackBaseUrl = !string.IsNullOrWhiteSpace(request?.CallbackBaseUrl)
                ? request.CallbackBaseUrl
                : _defaultCallbackBaseUrl;

            if (string.IsNullOrWhiteSpace(callbackBaseUrl))
                return await ResponseHelper.WriteError(req,
                    "callbackBaseUrl is required (or set WebhookCallbackBaseUrl in config)",
                    HttpStatusCode.BadRequest, _allowedOrigins);

            var results = await _shopify.RegisterWebhooksAsync(callbackBaseUrl);

            var registered      = results.Count(r => r.Status == "registered");
            var alreadyRegistered = results.Count(r => r.Status == "already_registered");
            var errors          = results.Count(r => r.Status == "error");

            _logger.LogInformation(
                "Webhook registration complete: {Registered} registered, {Already} already registered, {Errors} errors",
                registered, alreadyRegistered, errors);

            return await ResponseHelper.WriteSuccess(req, new { registered, alreadyRegistered, errors, results }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Webhook registration failed");
            return await ResponseHelper.WriteError(req, "Webhook registration failed", HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("WebhookSetSecret")]
    public async Task<HttpResponseData> SetSecret(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "webhooks/secret")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        if (_secretClient == null)
            return await ResponseHelper.WriteError(req,
                "Key Vault not configured — KeyVaultUri missing from app settings",
                HttpStatusCode.ServiceUnavailable, _allowedOrigins);

        try
        {
            var body    = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<SetWebhookSecretRequest>(body);

            if (string.IsNullOrWhiteSpace(request?.Secret))
                return await ResponseHelper.WriteError(req, "secret is required", HttpStatusCode.BadRequest, _allowedOrigins);

            await _secretClient.SetSecretAsync("ShopifyWebhookSecret", request.Secret.Trim());

            _logger.LogInformation("ShopifyWebhookSecret updated in Key Vault");
            return await ResponseHelper.WriteSuccess(req, new { ok = true }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to update ShopifyWebhookSecret in Key Vault");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }
}
