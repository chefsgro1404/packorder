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

        // Return 202 immediately — sync can take minutes on large stores and will
        // exceed the SWA gateway timeout if we await the full result synchronously.
        var accepted = await ResponseHelper.WriteSuccess(req, new { ok = true, synced = -1 }, _allowedOrigins);

        _ = Task.Run(async () =>
        {
            try
            {
                var entities = await _shopify.FetchFulfilledOrdersWithTrackingAsync();
                await _tableStorage.SyncFulfillmentShipmentsAsync(entities);
                _logger.LogInformation("Ship order sync complete. Processed {Count} fulfillments", entities.Count);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Ship order sync failed");
            }
        });

        return accepted;
    }
}
