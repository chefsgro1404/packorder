using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Models;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class FulfillFunction
{
    private readonly ILogger<FulfillFunction> _logger;
    private readonly ShopifyService _shopify;
    private readonly TableStorageService _tableStorage;
    private readonly AuthHelper _authHelper;
    private readonly string[] _allowedOrigins;

    public FulfillFunction(ILogger<FulfillFunction> logger, ShopifyService shopify,
        TableStorageService tableStorage, AuthHelper authHelper, string[] allowedOrigins)
    {
        _logger = logger;
        _shopify = shopify;
        _tableStorage = tableStorage;
        _authHelper = authHelper;
        _allowedOrigins = allowedOrigins;
    }

    [Function("Fulfill")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "fulfill")]
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
            var request = JsonConvert.DeserializeObject<FulfillRequest>(body);

            if (string.IsNullOrWhiteSpace(request?.OrderId))
                return await ResponseHelper.WriteError(req, "orderId is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var order = await _shopify.GetOrderByRefAsync(request.OrderId);
            if (order == null)
                return await ResponseHelper.WriteError(req, "Order not found", HttpStatusCode.NotFound, _allowedOrigins);

            if (order.DisplayFulfillmentStatus == "FULFILLED")
                return await ResponseHelper.WriteError(req, "Order is already fulfilled", HttpStatusCode.Conflict, _allowedOrigins);

            var trackingNumber = order.TrackingNumber?.Value;
            if (string.IsNullOrEmpty(trackingNumber))
                return await ResponseHelper.WriteError(req,
                    "No tracking number found. Create a label in XPS first.",
                    HttpStatusCode.UnprocessableEntity, _allowedOrigins);

            var openFulfillmentOrder = order.FulfillmentOrders.Edges
                .Select(e => e.Node)
                .FirstOrDefault(fo => fo.Status == "OPEN" || fo.Status == "IN_PROGRESS");

            if (openFulfillmentOrder == null)
                return await ResponseHelper.WriteError(req, "No open fulfillment order found",
                    HttpStatusCode.UnprocessableEntity, _allowedOrigins);

            var lineItems = openFulfillmentOrder.LineItems.Edges
                .Select(e => e.Node)
                .Where(li => li.RemainingQuantity > 0)
                .ToList();

            var trackingCarrier = order.TrackingCarrier?.Value ?? "Other";
            var trackingUrl = order.TrackingUrl?.Value ?? "";

            var fulfillment = await _shopify.FulfillOrderAsync(
                openFulfillmentOrder.Id,
                lineItems,
                trackingNumber,
                trackingUrl,
                trackingCarrier);

            await _tableStorage.LogScanAsync("ship", request.OrderId, "fulfilled");

            // Log scan history if this fulfillment came from a barcode scan
            if (!string.IsNullOrEmpty(request.ScannedBarcode))
            {
                _ = _tableStorage.LogScanHistoryAsync(new ScanHistoryEntity
                {
                    Barcode          = request.ScannedBarcode,
                    WeightGrams      = request.WeightGrams,
                    IsVariableWeight = request.WeightGrams.HasValue,
                    OrderId          = request.OrderId,
                    OrderName        = order.Name
                });
            }

            return await ResponseHelper.WriteSuccess(req, new { ok = true, fulfillment }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Fulfillment error");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }
}
