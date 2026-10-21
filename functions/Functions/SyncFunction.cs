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

    [Function("SyncSettings")]
    public async Task<HttpResponseData> Settings(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "put", "options", Route = "sync/settings")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            if (req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
            {
                var autoConfig = await _tableStorage.GetAutoSyncConfigAsync();
                var lastSync   = await _tableStorage.GetLastSyncAsync();
                var lastStages = !string.IsNullOrEmpty(lastSync?.LastSyncStages)
                    ? JsonConvert.DeserializeObject<List<FullSyncStageResult>>(lastSync.LastSyncStages)
                    : null;
                var poStatusCounts = await _tableStorage.GetPurchaseOrderStatusCountsAsync();
                return await ResponseHelper.WriteSuccess(req, new
                {
                    autoSyncEnabled  = autoConfig?.AutoSyncEnabled ?? false,
                    autoSyncVendors  = autoConfig?.Vendors ?? "",
                    autoSyncTags     = autoConfig?.Tags ?? "",
                    lastSyncedAt     = lastSync?.LastSyncedAt.ToString("o"),
                    lastSyncVendors  = lastSync?.Vendors ?? "",
                    lastSyncTags     = lastSync?.Tags ?? "",
                    lastSyncStages   = lastStages,
                    poStatusCounts,
                }, _allowedOrigins);
            }

            // PUT — save auto-sync config
            var body = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<AutoSyncConfigRequest>(body) ?? new AutoSyncConfigRequest();
            var vendors = string.Join(",", (request.Vendors ?? new()).Where(v => !string.IsNullOrWhiteSpace(v)));
            var tags    = string.Join(",", (request.Tags    ?? new()).Where(t => !string.IsNullOrWhiteSpace(t)));
            await _tableStorage.SetAutoSyncConfigAsync(request.AutoSyncEnabled, vendors, tags);
            _logger.LogInformation("Auto-sync config saved: enabled={Enabled}, vendors={Vendors}, tags={Tags}",
                request.AutoSyncEnabled, vendors, tags);
            return await ResponseHelper.WriteSuccess(req, new { ok = true }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Sync settings operation failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("SyncFull")]
    public async Task<HttpResponseData> FullSync(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "sync/full")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        var stages   = new List<FullSyncStageResult>();
        var anyError = false;

        // Stage 1: products + variants + metafields
        var s1 = new FullSyncStageResult { Stage = "products" };
        try
        {
            _logger.LogInformation("Full sync — Stage 1: products");
            var config = await _tableStorage.GetAutoSyncConfigAsync();
            string? shopifyQuery = null;
            if (config != null && (!string.IsNullOrWhiteSpace(config.Vendors) || !string.IsNullOrWhiteSpace(config.Tags)))
            {
                var parts = new List<string>();
                var vList = config.Vendors.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(v => v.Trim()).Where(v => v.Length > 0).ToList();
                var tList = config.Tags.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(t => t.Trim()).Where(t => t.Length > 0).ToList();
                if (vList.Count == 1) parts.Add($"vendor:{vList[0]}");
                else if (vList.Count > 1) parts.Add($"({string.Join(" OR ", vList.Select(v => $"vendor:{v}"))})");
                if (tList.Count == 1) parts.Add($"tag:{tList[0]}");
                else if (tList.Count > 1) parts.Add($"({string.Join(" OR ", tList.Select(t => $"tag:{t}"))})");
                shopifyQuery = parts.Count > 0 ? string.Join(" ", parts) : null;
            }
            await _tableStorage.DeleteAllProductVariantsAsync();
            var entities = await _shopify.FetchAllProductVariantsAsync(shopifyQuery);
            await _tableStorage.BulkUpsertProductVariantsAsync(entities);
            s1.Count = entities.Count;
            s1.Ok    = true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Full sync Stage 1 (products) failed");
            s1.Error = ex.Message;
            anyError = true;
        }
        stages.Add(s1);

        // Stage 2: purchase orders + line items
        var s2 = new FullSyncStageResult { Stage = "purchaseOrders" };
        try
        {
            _logger.LogInformation("Full sync — Stage 2: purchase orders");
            var pos    = await _shopify.GetInventoryPurchaseOrdersAsync();
            var synced = await _tableStorage.SyncInventoryPurchaseOrdersAsync(pos);
            s2.Count = synced;
            s2.Ok    = true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Full sync Stage 2 (purchase orders) failed");
            s2.Error = ex.Message;
            anyError = true;
        }
        stages.Add(s2);

        // Stage 3: barcode ↔ PO backfill
        var s3 = new FullSyncStageResult { Stage = "barcodeBackfill" };
        try
        {
            _logger.LogInformation("Full sync — Stage 3: barcode backfill");
            var backfilled = await _tableStorage.BackfillPrintedLabelPoLinksAsync();
            s3.Count = backfilled;
            s3.Ok    = true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Full sync Stage 3 (barcode backfill) failed");
            s3.Error = ex.Message;
            anyError = true;
        }
        stages.Add(s3);

        // Stage 4: SN counter reconciliation
        var s4 = new FullSyncStageResult { Stage = "snCounters" };
        try
        {
            _logger.LogInformation("Full sync — Stage 4: SN counter reconciliation");
            var reconciled = await _tableStorage.ReconcileSnCountersAsync();
            s4.Count = reconciled;
            s4.Ok    = true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Full sync Stage 4 (SN counters) failed");
            s4.Error = ex.Message;
            anyError = true;
        }
        stages.Add(s4);

        await _tableStorage.SetLastSyncAsync(DateTimeOffset.UtcNow, "", "", stages);

        _logger.LogInformation("Full sync complete. Stages: {Summary}",
            string.Join(", ", stages.Select(s => $"{s.Stage}:{(s.Ok ? s.Count.ToString() : "ERR")}")));

        return await ResponseHelper.WriteSuccess(req, new FullSyncResult
        {
            Ok       = !anyError,
            SyncedAt = DateTimeOffset.UtcNow.ToString("o"),
            Stages   = stages,
        }, _allowedOrigins);
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

            var shopifyQuery = queryParts.Count > 0 ? string.Join(" ", queryParts) : null;

            // Always clear the table so the result exactly matches what was synced
            await _tableStorage.DeleteAllProductVariantsAsync();

            // ── Fetch and upsert ──────────────────────────────────────────────
            _logger.LogInformation("Starting product sync. Query={Query}", shopifyQuery ?? "(all)");

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
                synced = entities.Count
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Product sync failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }
}
