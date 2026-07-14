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
    private readonly ShopifyService _shopify;
    private readonly TableStorageService _tableStorage;
    private readonly AuthHelper _authHelper;
    private readonly string[] _allowedOrigins;

    public ShipOrdersFunction(ILogger<ShipOrdersFunction> logger, ShopifyService shopify, TableStorageService tableStorage,
        AuthHelper authHelper, string[] allowedOrigins)
    {
        _logger = logger; _shopify = shopify; _tableStorage = tableStorage;
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

    /// <summary>
    /// Looks up a single order by name or tag directly from Shopify (used by the Ship Mode search bar
    /// when the order isn't already in the local table). If the order is fulfilled/partial, non-POS,
    /// and has tracking info, it is upserted into the table so it persists for next time.
    /// </summary>
    [Function("ShipOrderLookup")]
    public async Task<HttpResponseData> Lookup(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "ship-orders/lookup")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        var query = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
        var orderRef = query["ref"];
        if (string.IsNullOrWhiteSpace(orderRef))
            return await ResponseHelper.WriteError(req, "ref is required", HttpStatusCode.BadRequest, _allowedOrigins);

        try
        {
            var (found, orderName, displayStatus, isUnfulfilled, entities) = await _shopify.GetShipOrderByRefAsync(orderRef);
            if (!found)
                return await ResponseHelper.WriteSuccess(req, new { found = false }, _allowedOrigins);

            // Persist to storage so scan progress is tracked (fire-and-forget if it fails — we return the
            // Shopify data directly below, so a storage hiccup never blocks a manual search result).
            if (entities.Count > 0)
            {
                try { await _tableStorage.SyncFulfillmentShipmentsAsync(entities); }
                catch (Exception ex) { _logger.LogWarning(ex, "Ship order lookup: storage sync failed for {OrderName}, returning live data", orderName); }
            }

            // Build the response from storage when available (preserves scan progress), falling back
            // to the freshly-fetched Shopify entity so a manual search always returns something.
            var fulfillments = new List<object>();
            foreach (var entity in entities)
            {
                var stored = await _tableStorage.GetFulfillmentShipmentAsync(entity.RowKey);
                fulfillments.Add(SerializeFulfillment(stored ?? entity));
            }

            // Warning is informational only — the order is always selectable from a manual search.
            string? warning = isUnfulfilled ? "unfulfilled" : fulfillments.Count == 0 ? "no_tracking" : null;

            return await ResponseHelper.WriteSuccess(req, new { found = true, warning, orderName, fulfillments }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Ship order lookup failed for ref {Ref}", orderRef);
            return await ResponseHelper.WriteError(req, "Failed to look up order", HttpStatusCode.InternalServerError, _allowedOrigins);
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
            notes                    = e.Notes,
        };
    }
}
