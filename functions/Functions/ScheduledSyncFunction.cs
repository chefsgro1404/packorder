using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class ScheduledSyncFunction
{
    private readonly ILogger<ScheduledSyncFunction> _logger;
    private readonly ShopifyService _shopify;
    private readonly TableStorageService _tableStorage;

    public ScheduledSyncFunction(ILogger<ScheduledSyncFunction> logger,
        ShopifyService shopify, TableStorageService tableStorage)
    {
        _logger = logger;
        _shopify = shopify;
        _tableStorage = tableStorage;
    }

    // Runs at 05:00 UTC every day = midnight New York (EST).
    [Function("ScheduledSync")]
    public async Task Run([TimerTrigger("0 0 5 * * *")] TimerInfo timer)
    {
        var config = await _tableStorage.GetAutoSyncConfigAsync();

        if (config == null || !config.AutoSyncEnabled)
        {
            _logger.LogInformation("Scheduled sync skipped — auto-sync is disabled");
            return;
        }

        var vendors = config.Vendors
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(v => v.Trim()).Where(v => v.Length > 0).ToList();
        var tags = config.Tags
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(t => t.Trim()).Where(t => t.Length > 0).ToList();

        var queryParts = new List<string>();
        if (vendors.Count == 1)     queryParts.Add($"vendor:{vendors[0]}");
        else if (vendors.Count > 1) queryParts.Add($"({string.Join(" OR ", vendors.Select(v => $"vendor:{v}"))})");
        if (tags.Count == 1)        queryParts.Add($"tag:{tags[0]}");
        else if (tags.Count > 1)    queryParts.Add($"({string.Join(" OR ", tags.Select(t => $"tag:{t}"))})");
        var shopifyQuery = queryParts.Count > 0 ? string.Join(" ", queryParts) : null;

        // Stage 1: products
        try
        {
            _logger.LogInformation("Scheduled sync — products. Query={Query}", shopifyQuery ?? "(all)");
            await _tableStorage.DeleteAllProductVariantsAsync();
            var entities = await _shopify.FetchAllProductVariantsAsync(shopifyQuery);
            await _tableStorage.BulkUpsertProductVariantsAsync(entities);
            _logger.LogInformation("Scheduled sync — products complete. {Count} variants", entities.Count);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Scheduled sync — products stage failed");
        }

        // Stage 2: purchase orders
        try
        {
            _logger.LogInformation("Scheduled sync — purchase orders");
            var pos    = await _shopify.GetInventoryPurchaseOrdersAsync();
            var synced = await _tableStorage.SyncInventoryPurchaseOrdersAsync(pos);
            _logger.LogInformation("Scheduled sync — POs complete. {Count} POs synced", synced);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Scheduled sync — purchase orders stage failed");
        }

        // Stage 3: barcode backfill
        try
        {
            var backfilled = await _tableStorage.BackfillPrintedLabelPoLinksAsync();
            _logger.LogInformation("Scheduled sync — barcode backfill: {Count} labels updated", backfilled);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Scheduled sync — barcode backfill stage failed");
        }

        await _tableStorage.SetLastSyncAsync(DateTimeOffset.UtcNow,
            string.Join(",", vendors), string.Join(",", tags));
        _logger.LogInformation("Scheduled sync complete");
    }
}
