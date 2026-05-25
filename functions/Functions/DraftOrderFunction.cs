using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Models;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class DraftOrderFunction
{
    private readonly ILogger<DraftOrderFunction> _logger;
    private readonly ShopifyService _shopify;
    private readonly AuthHelper _authHelper;
    private readonly string[] _allowedOrigins;

    public DraftOrderFunction(ILogger<DraftOrderFunction> logger, ShopifyService shopify,
        AuthHelper authHelper, string[] allowedOrigins)
    {
        _logger = logger;
        _shopify = shopify;
        _authHelper = authHelper;
        _allowedOrigins = allowedOrigins;
    }

    [Function("DraftOrder")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "draft-order")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var body = await req.ReadAsStringAsync() ?? "";
            var request = JsonConvert.DeserializeObject<DraftOrderActionRequest>(body)
                          ?? throw new Exception("Invalid request body");

            return request.Action switch
            {
                "create" => await HandleCreate(req, request),
                "add-item" => await HandleAddItem(req, request),
                "complete" => await HandleComplete(req, request),
                _ => await ResponseHelper.WriteError(req, "Invalid action", HttpStatusCode.BadRequest, _allowedOrigins)
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Draft order error");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    private async Task<HttpResponseData> HandleCreate(HttpRequestData req, DraftOrderActionRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.VariantId))
            return await ResponseHelper.WriteError(req, "variantId is required", HttpStatusCode.BadRequest, _allowedOrigins);

        var draftOrder = await _shopify.CreateDraftOrderAsync(request.VariantId, request.Quantity > 0 ? request.Quantity : 1);
        return await ResponseHelper.WriteSuccess(req, new { ok = true, draftOrder }, _allowedOrigins);
    }

    private async Task<HttpResponseData> HandleAddItem(HttpRequestData req, DraftOrderActionRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.DraftOrderId) || request.LineItems == null)
            return await ResponseHelper.WriteError(req, "draftOrderId and lineItems are required", HttpStatusCode.BadRequest, _allowedOrigins);

        var draftOrder = await _shopify.UpdateDraftOrderAsync(request.DraftOrderId, request.LineItems);
        return await ResponseHelper.WriteSuccess(req, new { ok = true, draftOrder }, _allowedOrigins);
    }

    private async Task<HttpResponseData> HandleComplete(HttpRequestData req, DraftOrderActionRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.DraftOrderId))
            return await ResponseHelper.WriteError(req, "draftOrderId is required", HttpStatusCode.BadRequest, _allowedOrigins);

        var result = await _shopify.CompleteDraftOrderAsync(request.DraftOrderId);
        return await ResponseHelper.WriteSuccess(req, new { ok = true, result }, _allowedOrigins);
    }
}
