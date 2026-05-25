using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Models;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class SyncFunction
{
    private readonly ILogger<SyncFunction> _logger;
    private readonly ShopifyService _shopify;
    private readonly TableStorageService _tableStorage;
    private readonly AuthHelper _authHelper;
    private readonly string[] _allowedOrigins;

    public SyncFunction(ILogger<SyncFunction> logger, ShopifyService shopify,
        TableStorageService tableStorage, AuthHelper authHelper, string[] allowedOrigins)
    {
        _logger = logger;
        _shopify = shopify;
        _tableStorage = tableStorage;
        _authHelper = authHelper;
        _allowedOrigins = allowedOrigins;
    }

    [Function("SyncProducts")]
    public async Task<HttpResponseData> Sync(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "sync")]
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
            var request = JsonConvert.DeserializeObject<SyncRequest>(body) ?? new SyncRequest();

            var vendors = request.Vendors?.Where(v => !string.IsNullOrWhiteSpace(v)).ToList() ?? new List<string>();
            var tags    = request.Tags?.Where(t => !string.IsNullOrWhiteSpace(t)).ToList()    ?? new List<string>();

            // ── Build Shopify query string ────────────────────────────────────
            var queryParts = new List<string>();

            if (vendors.Count == 1)
                queryParts.Add($"vendor:{vendors[0]}");
            else if (vendors.Count > 1)
                queryParts.Add($"({string.Join(" OR ", vendors.Select(v => $"vendor:{v}"))})");

            if (tags.Count == 1)
                queryParts.Add($"tag:{tags[0]}");
            else if (tags.Count > 1)
                queryParts.Add($"({string.Join(" OR ", tags.Select(t => $"tag:{t}"))})");

            if (request.Mode == "incremental")
            {
                var lastSync = await _tableStorage.GetLastSyncAsync();
                if (lastSync != null)
                    queryParts.Add($"updated_at:>{lastSync.LastSyncedAt:yyyy-MM-ddTHH:mm:ssZ}");
            }

            var shopifyQuery = queryParts.Count > 0 ? string.Join(" ", queryParts) : null;

            // ── Optionally clear before syncing ───────────────────────────────
            if (request.ClearFirst)
                await _tableStorage.DeleteAllProductVariantsAsync();

            // ── Fetch and upsert ──────────────────────────────────────────────
            _logger.LogInformation("Starting product sync. Mode={Mode} Query={Query}", request.Mode, shopifyQuery ?? "(all)");

            var entities = await _shopify.FetchAllProductVariantsAsync(shopifyQuery);
            await _tableStorage.BulkUpsertProductVariantsAsync(entities);

            await _tableStorage.SetLastSyncAsync(
                DateTimeOffset.UtcNow,
                string.Join(",", vendors),
                string.Join(",", tags));

            _logger.LogInformation("Sync complete. Upserted {Count} variants", entities.Count);

            return await ResponseHelper.WriteSuccess(req, new
            {
                ok     = true,
                synced = entities.Count,
                mode   = request.Mode
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Product sync failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }
}
