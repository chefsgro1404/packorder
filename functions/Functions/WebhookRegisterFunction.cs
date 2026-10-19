using System.Net;
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

    public WebhookRegisterFunction(
        ILogger<WebhookRegisterFunction> logger,
        AuthHelper authHelper,
        ShopifyService shopify,
        string[] allowedOrigins,
        IConfiguration config)
    {
        _logger = logger;
        _authHelper = authHelper;
        _shopify = shopify;
        _allowedOrigins = allowedOrigins;
        _defaultCallbackBaseUrl = config["WebhookCallbackBaseUrl"] ?? "";
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

            var registered = results.Count(r => r.Status == "registered");
            var alreadyRegistered = results.Count(r => r.Status == "already_registered");
            var errors = results.Count(r => r.Status == "error");

            _logger.LogInformation(
                "Webhook registration complete: {Registered} registered, {AlreadyRegistered} already registered, {Errors} errors",
                registered, alreadyRegistered, errors);

            return await ResponseHelper.WriteSuccess(req, new
            {
                registered,
                alreadyRegistered,
                errors,
                results,
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Webhook registration failed");
            return await ResponseHelper.WriteError(req, "Webhook registration failed", HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }
}
