using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class SyncShipOrdersFunction
{
    private readonly ILogger<SyncShipOrdersFunction> _logger;
    private readonly ShopifyService _shopify;
    private readonly TableStorageService _tableStorage;
    private readonly AuthHelper _authHelper;
    private readonly string[] _allowedOrigins;

    public SyncShipOrdersFunction(ILogger<SyncShipOrdersFunction> logger, ShopifyService shopify,
        TableStorageService tableStorage, AuthHelper authHelper, string[] allowedOrigins)
    {
        _logger = logger; _shopify = shopify; _tableStorage = tableStorage;
        _authHelper = authHelper; _allowedOrigins = allowedOrigins;
    }

    [Function("SyncShipOrders")]
    public async Task<HttpResponseData> Sync(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "sync/ship-orders")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        var (from, to) = ParseDateRange(req);
        _logger.LogInformation("Ship order sync requested. Date range {From:yyyy-MM-dd}..{To:yyyy-MM-dd}", from, to);

        try
        {
            var entities = await _shopify.FetchFulfilledOrdersWithTrackingAsync();

            foreach (var e in entities)
                _logger.LogInformation("Ship order sync: candidate {OrderName} fulfillment {FulfillmentId} createdAt={CreatedAt:yyyy-MM-dd} (status={Status})",
                    e.OrderName, e.FulfillmentId, e.FulfillmentCreatedAt.UtcDateTime, e.ShopifyFulfillmentStatus);

            var inRange = entities
                .Where(e => e.FulfillmentCreatedAt.UtcDateTime.Date >= from && e.FulfillmentCreatedAt.UtcDateTime.Date <= to)
                .ToList();

            _logger.LogInformation("Ship order sync: {InRange} of {Total} candidates fall within {From:yyyy-MM-dd}..{To:yyyy-MM-dd}",
                inRange.Count, entities.Count, from, to);

            await _tableStorage.SyncFulfillmentShipmentsAsync(inRange);
            _logger.LogInformation("Ship order sync complete. Upserted {Synced} fulfillment(s)", inRange.Count);

            return await ResponseHelper.WriteSuccess(req, new { ok = true, synced = inRange.Count }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Ship order sync failed");
            return await ResponseHelper.WriteError(req, "Sync failed", HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    /// <summary>
    /// Reads optional "from"/"to" (yyyy-MM-dd) query params. Defaults both to today (UTC) when absent,
    /// so a plain sync only pulls in fulfillments created today.
    /// </summary>
    private static (DateTime From, DateTime To) ParseDateRange(HttpRequestData req)
    {
        var query = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
        var today = DateTime.UtcNow.Date;

        var from = DateTime.TryParse(query["from"], out var f) ? f.Date : today;
        var to = DateTime.TryParse(query["to"], out var t) ? t.Date : today;

        return (from, to);
    }
}
