using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Models;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class ShipOrdersFunction
{
    private readonly ILogger<ShipOrdersFunction> _logger;
    private readonly TableStorageService _tableStorage;
    private readonly AuthHelper _authHelper;
    private readonly string[] _allowedOrigins;

    public ShipOrdersFunction(ILogger<ShipOrdersFunction> logger, TableStorageService tableStorage,
        AuthHelper authHelper, string[] allowedOrigins)
    {
        _logger = logger; _tableStorage = tableStorage;
        _authHelper = authHelper; _allowedOrigins = allowedOrigins;
    }

    [Function("ShipOrders")]
    public async Task<HttpResponseData> List(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "ship-orders")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var entities = await _tableStorage.GetPendingShipmentFulfillmentsAsync();
            var fulfillments = entities
                .OrderByDescending(e => e.FulfillmentCreatedAt)
                .Select(SerializeFulfillment)
                .ToList();
            return await ResponseHelper.WriteSuccess(req, new { fulfillments, total = fulfillments.Count }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load ship orders");
            return await ResponseHelper.WriteError(req, "Failed to load orders", HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    public static object SerializeFulfillment(FulfillmentShipmentEntity e)
    {
        var lineItems      = JsonConvert.DeserializeObject<List<ShipmentLineItemCache>>(e.LineItemsJson) ?? new List<ShipmentLineItemCache>();
        var tags           = JsonConvert.DeserializeObject<List<string>>(e.OrderTags) ?? new List<string>();
        object? address    = string.IsNullOrEmpty(e.ShippingAddressJson) ? null : JsonConvert.DeserializeObject(e.ShippingAddressJson);
        return new {
            fulfillmentId            = e.FulfillmentId,
            trackingNumber           = e.TrackingNumber,
            trackingCarrier          = e.TrackingCarrier,
            trackingUrl              = e.TrackingUrl,
            orderName                = e.OrderName,
            orderId                  = e.OrderId,
            orderTags                = tags,
            orderCreatedAt           = e.OrderCreatedAt,
            customerName             = e.CustomerName,
            customerEmail            = e.CustomerEmail,
            shippingAddress          = address,
            shopifyFulfillmentStatus = e.ShopifyFulfillmentStatus,
            status                   = e.Status,
            fulfillmentCreatedAt     = e.FulfillmentCreatedAt.ToString("o"),
            lineItems,
            shippedAt                = e.ShippedAt?.ToString("o"),
            completedBy              = e.CompletedBy,
            isManualComplete         = e.IsManualComplete,
            manualReason             = e.ManualReason,
        };
    }
}
