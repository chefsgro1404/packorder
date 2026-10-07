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
    // To follow EDT (midnight year-round), set WEBSITE_TIME_ZONE = "Eastern Standard Time"
    // in the Function App's Application Settings and change the cron to "0 0 0 * * *".
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
        if (vendors.Count == 1)        queryParts.Add($"vendor:{vendors[0]}");
        else if (vendors.Count > 1)    queryParts.Add($"({string.Join(" OR ", vendors.Select(v => $"vendor:{v}"))})");
        if (tags.Count == 1)           queryParts.Add($"tag:{tags[0]}");
        else if (tags.Count > 1)       queryParts.Add($"({string.Join(" OR ", tags.Select(t => $"tag:{t}"))})");
        var shopifyQuery = queryParts.Count > 0 ? string.Join(" ", queryParts) : null;

        try
        {
            _logger.LogInformation("Scheduled sync starting. Query={Query}", shopifyQuery ?? "(all)");
            await _tableStorage.DeleteAllProductVariantsAsync();
            var entities = await _shopify.FetchAllProductVariantsAsync(shopifyQuery);
            await _tableStorage.BulkUpsertProductVariantsAsync(entities);
            await _tableStorage.SetLastSyncAsync(DateTimeOffset.UtcNow,
                string.Join(",", vendors), string.Join(",", tags));
            _logger.LogInformation("Scheduled sync complete. Upserted {Count} variants", entities.Count);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Scheduled sync failed");
        }
    }
}
