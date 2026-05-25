using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class SyncOrdersFunction
{
    private readonly ILogger<SyncOrdersFunction> _logger;
    private readonly ShopifyService _shopify;
    private readonly TableStorageService _tableStorage;
    private readonly AuthHelper _authHelper;
    private readonly string[] _allowedOrigins;

    public SyncOrdersFunction(ILogger<SyncOrdersFunction> logger, ShopifyService shopify,
        TableStorageService tableStorage, AuthHelper authHelper, string[] allowedOrigins)
    {
        _logger = logger;
        _shopify = shopify;
        _tableStorage = tableStorage;
        _authHelper = authHelper;
        _allowedOrigins = allowedOrigins;
    }

    [Function("SyncOrders")]
    public async Task<HttpResponseData> Sync(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "sync/orders")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            _logger.LogInformation("Starting unfulfilled order sync");

            // Full replace — delete existing and re-sync for accurate current state
            await _tableStorage.DeleteAllUnfulfilledOrdersAsync();

            var entities = await _shopify.FetchUnfulfilledOrdersAsync();
            if (entities.Count > 0)
                await _tableStorage.BulkUpsertUnfulfilledOrdersAsync(entities);

            _logger.LogInformation("Order sync complete. Upserted {Count} orders", entities.Count);

            return await ResponseHelper.WriteSuccess(req, new { ok = true, synced = entities.Count }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Order sync failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }
}
