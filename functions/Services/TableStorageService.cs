using Azure;
using Azure.Data.Tables;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using ShipScan.Functions.Models;

namespace ShipScan.Functions.Services;

public class TableStorageService
{
    private readonly TableClient _auditLog;
    private readonly TableClient _revokedTokens;
    private readonly TableClient _productVariants;
    private readonly TableClient _syncSettings;
    private readonly TableClient _unfulfilledOrders;
    private readonly TableClient _scanHistory;
    private readonly TableClient _fulfillmentShipments;
    private readonly TableClient _shipmentScans;
    private readonly TableClient _productLookup;
    private readonly TableClient _printedLabels;
    private readonly TableClient _scannedLabels;
    private readonly ILogger<TableStorageService> _logger;

    public TableStorageService(TableServiceClient tableServiceClient, ILogger<TableStorageService> logger)
    {
        _logger = logger;
        _auditLog          = tableServiceClient.GetTableClient("auditlog");
        _revokedTokens     = tableServiceClient.GetTableClient("revokedtokens");
        _productVariants   = tableServiceClient.GetTableClient("productvariants");
        _syncSettings      = tableServiceClient.GetTableClient("syncsettings");
        _unfulfilledOrders = tableServiceClient.GetTableClient("unfulfilledorders");
        _scanHistory       = tableServiceClient.GetTableClient("scanhistory");
        _fulfillmentShipments = tableServiceClient.GetTableClient("fulfillmentshipments");
        _shipmentScans        = tableServiceClient.GetTableClient("shipmentscans");
        _productLookup        = tableServiceClient.GetTableClient("productlookup");
        _printedLabels        = tableServiceClient.GetTableClient("printedlabels");
        _scannedLabels        = tableServiceClient.GetTableClient("scannedlabels");
    }

    public async Task EnsureTablesExistAsync()
    {
        await _auditLog.CreateIfNotExistsAsync();
        await _revokedTokens.CreateIfNotExistsAsync();
        await _productVariants.CreateIfNotExistsAsync();
        await _syncSettings.CreateIfNotExistsAsync();
        await _unfulfilledOrders.CreateIfNotExistsAsync();
        await _scanHistory.CreateIfNotExistsAsync();
        await _fulfillmentShipments.CreateIfNotExistsAsync();
        await _shipmentScans.CreateIfNotExistsAsync();
        await _productLookup.CreateIfNotExistsAsync();
        await _printedLabels.CreateIfNotExistsAsync();
        await _scannedLabels.CreateIfNotExistsAsync();
        _logger.LogInformation("Table Storage tables verified");
    }

    // ─── Audit log ───────────────────────────────────────────────────────────

    public async Task LogScanAsync(string mode, string barcode, string result)
    {
        try
        {
            var entity = new AuditLogEntity
            {
                PartitionKey = "audit",
                RowKey = $"{DateTimeOffset.UtcNow.Ticks:D20}-{Guid.NewGuid():N}",
                Mode = mode,
                Barcode = barcode,
                Result = result,
                ScanTime = DateTimeOffset.UtcNow
            };
            await _auditLog.AddEntityAsync(entity);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Failed to write audit log: {Message}", ex.Message);
        }
    }

    // ─── Token revocation ────────────────────────────────────────────────────

    public async Task RevokeTokenAsync(string jti, DateTimeOffset expiresAt)
    {
        try
        {
            var entity = new RevokedTokenEntity
            {
                PartitionKey = "revoked",
                RowKey = jti,
                ExpiresAt = expiresAt
            };
            await _revokedTokens.UpsertEntityAsync(entity, TableUpdateMode.Replace);
        }
        catch (Exception ex)
        {
            _logger.LogError("Failed to revoke token JTI {Jti}: {Message}", jti, ex.Message);
            throw;
        }
    }

    public async Task<bool> IsTokenRevokedAsync(string jti)
    {
        try
        {
            await _revokedTokens.GetEntityAsync<RevokedTokenEntity>("revoked", jti);
            return true;
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError("Failed to check token revocation for JTI {Jti}: {Message}", jti, ex.Message);
            throw;
        }
    }

    // ─── Product variants ────────────────────────────────────────────────────

    public async Task<List<ProductVariantEntity>> GetAllProductVariantsAsync()
    {
        var results = new List<ProductVariantEntity>();
        await foreach (var entity in _productVariants.QueryAsync<ProductVariantEntity>())
            results.Add(entity);
        return results;
    }

    public async Task BulkUpsertProductVariantsAsync(IEnumerable<ProductVariantEntity> entities)
    {
        // Each product is a separate partition key — write all partitions concurrently.
        // Chunks within a partition stay sequential (Table Storage requires same-partition transactions).
        var tasks = entities
            .GroupBy(e => e.PartitionKey)
            .Select(group => Task.Run(async () =>
            {
                foreach (var chunk in group.Chunk(100))
                {
                    var actions = chunk.Select(e =>
                        new TableTransactionAction(TableTransactionActionType.UpsertReplace, e));
                    await _productVariants.SubmitTransactionAsync(actions);
                }
            }));
        await Task.WhenAll(tasks);
    }

    public async Task DeleteProductVariantsByProductIdAsync(string numericProductId)
    {
        var toDelete = new List<ProductVariantEntity>();
        await foreach (var e in _productVariants.QueryAsync<ProductVariantEntity>(
            filter: $"PartitionKey eq '{numericProductId}'"))
            toDelete.Add(e);

        foreach (var chunk in toDelete.Chunk(100))
        {
            var actions = chunk.Select(e =>
                new TableTransactionAction(TableTransactionActionType.Delete, e));
            await _productVariants.SubmitTransactionAsync(actions);
        }
    }

    public async Task DeleteProductVariantsByVendorsAsync(IEnumerable<string> vendors)
    {
        var vendorSet = vendors.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var toDelete = new List<ProductVariantEntity>();
        await foreach (var e in _productVariants.QueryAsync<ProductVariantEntity>())
        {
            if (vendorSet.Contains(e.Vendor))
                toDelete.Add(e);
        }
        await BatchDeleteAsync(toDelete);
    }

    public async Task DeleteAllProductVariantsAsync()
    {
        var toDelete = new List<ProductVariantEntity>();
        await foreach (var e in _productVariants.QueryAsync<ProductVariantEntity>())
            toDelete.Add(e);
        await BatchDeleteAsync(toDelete);
    }

    public async Task UpdateProductVariantBarcodeAsync(string productId, string variantId, string barcode)
    {
        var pk = StripGid(productId);
        var rk = StripGid(variantId);
        try
        {
            var response = await _productVariants.GetEntityAsync<ProductVariantEntity>(pk, rk);
            var entity = response.Value;
            entity.Barcode = barcode;
            await _productVariants.UpdateEntityAsync(entity, entity.ETag, TableUpdateMode.Replace);
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            // Variant not yet in the table (not synced) — ignore
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Failed to update cached barcode for variant {VariantId}: {Message}", variantId, ex.Message);
        }
    }

    // ─── Sync settings ───────────────────────────────────────────────────────

    public async Task<SyncSettingsEntity?> GetLastSyncAsync()
    {
        try
        {
            var response = await _syncSettings.GetEntityAsync<SyncSettingsEntity>("settings", "lastsync");
            return response.Value;
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            return null;
        }
    }

    public async Task SetLastSyncAsync(DateTimeOffset syncedAt, string vendors, string tags)
    {
        var entity = new SyncSettingsEntity
        {
            PartitionKey = "settings",
            RowKey = "lastsync",
            LastSyncedAt = syncedAt,
            Vendors = vendors,
            Tags = tags
        };
        await _syncSettings.UpsertEntityAsync(entity, TableUpdateMode.Replace);
    }

    // ─── Unfulfilled orders ──────────────────────────────────────────────────

    public async Task<List<UnfulfilledOrderEntity>> GetAllUnfulfilledOrdersAsync()
    {
        var results = new List<UnfulfilledOrderEntity>();
        await foreach (var entity in _unfulfilledOrders.QueryAsync<UnfulfilledOrderEntity>())
            results.Add(entity);
        return results;
    }

    public async Task UpsertUnfulfilledOrderAsync(UnfulfilledOrderEntity entity)
    {
        await _unfulfilledOrders.UpsertEntityAsync(entity, TableUpdateMode.Replace);
    }

    public async Task RemoveUnfulfilledOrderAsync(string numericOrderId)
    {
        try
        {
            await _unfulfilledOrders.DeleteEntityAsync("order", numericOrderId);
        }
        catch (RequestFailedException ex) when (ex.Status == 404) { }
        catch (Exception ex)
        {
            _logger.LogWarning("Failed to remove order {OrderId} from cache: {Message}", numericOrderId, ex.Message);
        }
    }

    public async Task BulkUpsertUnfulfilledOrdersAsync(IEnumerable<UnfulfilledOrderEntity> entities)
    {
        foreach (var chunk in entities.Chunk(100))
        {
            var actions = chunk.Select(e =>
                new TableTransactionAction(TableTransactionActionType.UpsertReplace, e));
            await _unfulfilledOrders.SubmitTransactionAsync(actions);
        }
    }

    public async Task DeleteAllUnfulfilledOrdersAsync()
    {
        var toDelete = new List<UnfulfilledOrderEntity>();
        await foreach (var e in _unfulfilledOrders.QueryAsync<UnfulfilledOrderEntity>())
            toDelete.Add(e);
        foreach (var chunk in toDelete.Chunk(100))
        {
            var actions = chunk.Select(e =>
                new TableTransactionAction(TableTransactionActionType.Delete, e));
            await _unfulfilledOrders.SubmitTransactionAsync(actions);
        }
    }

    // ─── Scan history ────────────────────────────────────────────────────────

    public async Task LogScanHistoryAsync(ScanHistoryEntity entity)
    {
        try
        {
            entity.PartitionKey = "scan";
            entity.RowKey = $"{DateTimeOffset.UtcNow.Ticks:D20}-{Guid.NewGuid():N}";
            entity.ScannedAt = DateTimeOffset.UtcNow;
            await _scanHistory.AddEntityAsync(entity);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Failed to write scan history: {Message}", ex.Message);
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private async Task BatchDeleteAsync(List<ProductVariantEntity> entities)
    {
        foreach (var group in entities.GroupBy(e => e.PartitionKey))
        {
            foreach (var chunk in group.Chunk(100))
            {
                var actions = chunk.Select(e =>
                    new TableTransactionAction(TableTransactionActionType.Delete, e));
                await _productVariants.SubmitTransactionAsync(actions);
            }
        }
    }

    public static string StripGid(string gid) => gid.Contains('/') ? gid.Split('/').Last() : gid;

    // ─── Fulfillment shipments (Ship Mode) ───────────────────────────────────

    public async Task<List<FulfillmentShipmentEntity>> GetPendingShipmentFulfillmentsAsync()
    {
        var results = new List<FulfillmentShipmentEntity>();
        await foreach (var e in _fulfillmentShipments.QueryAsync<FulfillmentShipmentEntity>(
            filter: "PartitionKey eq 'ship'"))
        {
            if (e.Status != "shipped") results.Add(e);
        }
        return results;
    }

    public async Task<List<FulfillmentShipmentEntity>> GetShippedShipmentFulfillmentsAsync(
        DateTimeOffset? from, DateTimeOffset? to, string? completedBy, bool? manualOnly)
    {
        var results = new List<FulfillmentShipmentEntity>();
        await foreach (var e in _fulfillmentShipments.QueryAsync<FulfillmentShipmentEntity>(
            filter: "PartitionKey eq 'ship'"))
        {
            if (e.Status != "shipped") continue;
            if (from.HasValue && e.ShippedAt < from) continue;
            if (to.HasValue && e.ShippedAt > to) continue;
            if (!string.IsNullOrEmpty(completedBy) &&
                (e.CompletedBy ?? "").IndexOf(completedBy, StringComparison.OrdinalIgnoreCase) < 0) continue;
            if (manualOnly == true && !e.IsManualComplete) continue;
            results.Add(e);
        }
        return results;
    }

    public async Task<FulfillmentShipmentEntity?> GetFulfillmentShipmentAsync(string numericFulfillmentId)
    {
        try
        {
            var response = await _fulfillmentShipments.GetEntityAsync<FulfillmentShipmentEntity>("ship", numericFulfillmentId);
            return response.Value;
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            return null;
        }
    }

    public async Task UpsertFulfillmentShipmentAsync(FulfillmentShipmentEntity entity)
    {
        await _fulfillmentShipments.UpsertEntityAsync(entity, TableUpdateMode.Replace);
    }

    public async Task SyncFulfillmentShipmentsAsync(IEnumerable<FulfillmentShipmentEntity> incoming)
    {
        foreach (var newEntity in incoming)
        {
            var existing = await GetFulfillmentShipmentAsync(newEntity.RowKey);
            if (existing != null)
            {
                if (existing.Status == "shipped") continue;

                var existingItems = JsonConvert.DeserializeObject<List<ShipmentLineItemCache>>(existing.LineItemsJson)
                    ?? new List<ShipmentLineItemCache>();
                var progressMap = existingItems.ToDictionary(li => li.FulfillmentLineItemId, li => li.QuantityShipped);

                var newItems = JsonConvert.DeserializeObject<List<ShipmentLineItemCache>>(newEntity.LineItemsJson)
                    ?? new List<ShipmentLineItemCache>();
                foreach (var item in newItems)
                {
                    if (progressMap.TryGetValue(item.FulfillmentLineItemId, out var shipped))
                        item.QuantityShipped = Math.Min(shipped, item.QuantityExpected);
                }
                newEntity.LineItemsJson = JsonConvert.SerializeObject(newItems);

                var totalShipped = newItems.Sum(li => li.QuantityShipped);
                newEntity.Status = totalShipped == 0 ? "pending" : "partial";
                newEntity.CompletedBy = existing.CompletedBy;
                newEntity.IsManualComplete = existing.IsManualComplete;
                newEntity.ManualReason = existing.ManualReason;
            }

            await _fulfillmentShipments.UpsertEntityAsync(newEntity, TableUpdateMode.Replace);
        }
    }

    public async Task<(bool Matched, bool AlreadyFull, FulfillmentShipmentEntity? Entity, ShipmentLineItemCache? Item)>
        RecordShipmentScanAsync(RecordShipScanRequest request, string orderName, string orderId, string trackingNumber)
    {
        var numericId = StripGid(request.FulfillmentId);
        var entity = await GetFulfillmentShipmentAsync(numericId);
        if (entity == null) return (false, false, null, null);

        var lineItems = JsonConvert.DeserializeObject<List<ShipmentLineItemCache>>(entity.LineItemsJson)
            ?? new List<ShipmentLineItemCache>();

        ShipmentLineItemCache? matched = null;

        if (!string.IsNullOrEmpty(request.FulfillmentLineItemId))
        {
            matched = lineItems.FirstOrDefault(li =>
                li.FulfillmentLineItemId.Equals(request.FulfillmentLineItemId, StringComparison.OrdinalIgnoreCase));
        }
        else if (!string.IsNullOrEmpty(request.Barcode))
        {
            matched = lineItems.FirstOrDefault(li =>
                (!string.IsNullOrEmpty(li.Barcode) && li.Barcode.Equals(request.Barcode, StringComparison.OrdinalIgnoreCase)) ||
                (!string.IsNullOrEmpty(li.Sku) && li.Sku.Equals(request.Barcode, StringComparison.OrdinalIgnoreCase)));
        }

        if (matched == null) return (false, false, null, null);
        if (matched.QuantityShipped >= matched.QuantityExpected) return (true, true, entity, matched);

        matched.QuantityShipped++;
        var totalShipped = lineItems.Sum(li => li.QuantityShipped);
        entity.Status = totalShipped == 0 ? "pending" : "partial";
        entity.LineItemsJson = JsonConvert.SerializeObject(lineItems);
        await _fulfillmentShipments.UpsertEntityAsync(entity, TableUpdateMode.Replace);

        try
        {
            var scanEntity = new ShipmentScanEntity
            {
                PartitionKey          = numericId,
                RowKey                = $"{DateTimeOffset.UtcNow.Ticks:D20}-{Guid.NewGuid():N}",
                OrderId               = orderId,
                OrderName             = orderName,
                FulfillmentId         = request.FulfillmentId,
                TrackingNumber        = trackingNumber,
                FulfillmentLineItemId = matched.FulfillmentLineItemId,
                LineItemId            = matched.LineItemId,
                VariantId             = matched.VariantId,
                Sku                   = matched.Sku,
                Barcode               = request.Barcode,
                Plu                   = request.Plu ?? (request.IsVariableWeight ? request.Barcode : null),
                ProductTitle          = matched.ProductTitle,
                VariantTitle          = matched.VariantTitle,
                QuantityShipped       = 1,
                WeightGrams           = request.WeightGrams,
                PricePerLb            = request.PricePerLb,
                TotalPriceScanned     = request.TotalPriceScanned,
                IsVariableWeight      = request.IsVariableWeight,
                ScannedBy             = request.ScannedBy,
                ScannedAt             = DateTimeOffset.UtcNow,
                IsManualLineItem      = request.IsManualLineItem,
                Price                 = matched.Price,
                Weight                = matched.Weight,
                WeightUnit            = matched.WeightUnit,
                QrSn                  = request.QrSn,
                PackagedAt            = request.PackagedAt,
            };
            await _shipmentScans.AddEntityAsync(scanEntity);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Failed to log shipment scan: {Message}", ex.Message);
        }

        if (!string.IsNullOrEmpty(request.QrSn))
        {
            try
            {
                await MarkLabelScannedAsync(request.QrSn, request.FulfillmentId);
            }
            catch (Exception ex)
            {
                _logger.LogWarning("Failed to mark label {Sn} as scanned: {Message}", request.QrSn, ex.Message);
            }
        }

        return (true, false, entity, matched);
    }

    public async Task<(FulfillmentShipmentEntity? Entity, ShipmentLineItemCache? Item)> AddExtraItemAsync(
        string fulfillmentId, string barcode, string reason, string scannedBy,
        string orderName, string orderId, string trackingNumber, ProductVariant? shopifyVariant,
        string? plu = null, string? qrSn = null, double? weightGrams = null, string? packagedAt = null)
    {
        var numericId = StripGid(fulfillmentId);
        var entity = await GetFulfillmentShipmentAsync(numericId);
        if (entity == null) return (null, null);

        var lineItems = JsonConvert.DeserializeObject<List<ShipmentLineItemCache>>(entity.LineItemsJson)
            ?? new List<ShipmentLineItemCache>();

        // If this barcode was already added as an extra item, just bump its quantity
        // instead of creating a duplicate line item.
        var existingExtra = lineItems.FirstOrDefault(li =>
            li.IsExtra && !string.IsNullOrEmpty(li.Barcode) &&
            li.Barcode.Equals(barcode, StringComparison.OrdinalIgnoreCase));

        ShipmentLineItemCache item;
        if (existingExtra != null)
        {
            existingExtra.QuantityExpected++;
            existingExtra.QuantityShipped++;
            existingExtra.AddedReason = reason;
            existingExtra.AddedBy = scannedBy;
            item = existingExtra;
        }
        else
        {
            item = new ShipmentLineItemCache
            {
                FulfillmentLineItemId = $"extra-{Guid.NewGuid():N}",
                LineItemId            = "",
                Name                  = shopifyVariant != null ? $"{shopifyVariant.Product.Title} - {shopifyVariant.Title}" : barcode,
                QuantityExpected      = 1,
                QuantityShipped       = 1,
                VariantId             = shopifyVariant?.Id,
                Sku                   = shopifyVariant?.Sku,
                Barcode               = shopifyVariant?.Barcode ?? barcode,
                ProductTitle          = shopifyVariant?.Product.Title ?? $"Unknown item ({barcode})",
                VariantTitle          = shopifyVariant?.Title,
                ImageUrl              = shopifyVariant?.Product.FeaturedImage?.Url,
                Price                 = shopifyVariant?.Price ?? "0.00",
                Weight                = shopifyVariant?.Weight,
                WeightUnit            = shopifyVariant?.WeightUnit,
                IsExtra               = true,
                AddedReason           = reason,
                AddedBy               = scannedBy,
            };
            lineItems.Add(item);
        }

        var totalShipped = lineItems.Sum(li => li.QuantityShipped);
        entity.Status = totalShipped == 0 ? "pending" : "partial";
        entity.LineItemsJson = JsonConvert.SerializeObject(lineItems);
        await _fulfillmentShipments.UpsertEntityAsync(entity, TableUpdateMode.Replace);

        try
        {
            var scanEntity = new ShipmentScanEntity
            {
                PartitionKey          = numericId,
                RowKey                = $"{DateTimeOffset.UtcNow.Ticks:D20}-{Guid.NewGuid():N}",
                OrderId               = orderId,
                OrderName             = orderName,
                FulfillmentId         = fulfillmentId,
                TrackingNumber        = trackingNumber,
                FulfillmentLineItemId = item.FulfillmentLineItemId,
                LineItemId            = item.LineItemId,
                VariantId             = item.VariantId,
                Sku                   = item.Sku,
                Barcode               = barcode,
                ProductTitle          = item.ProductTitle,
                VariantTitle          = item.VariantTitle,
                QuantityShipped       = 1,
                ScannedBy             = scannedBy,
                ScannedAt             = DateTimeOffset.UtcNow,
                IsManualLineItem      = true,
                IsExtra               = true,
                ExtraReason           = reason,
                Price                 = item.Price,
                Weight                = item.Weight,
                WeightUnit            = item.WeightUnit,
                Plu                   = plu,
                QrSn                  = qrSn,
                WeightGrams           = weightGrams,
                PackagedAt            = packagedAt,
                IsVariableWeight      = qrSn != null,
            };
            await _shipmentScans.AddEntityAsync(scanEntity);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Failed to log extra item scan: {Message}", ex.Message);
        }

        if (!string.IsNullOrEmpty(qrSn))
        {
            try
            {
                await MarkLabelScannedAsync(qrSn, fulfillmentId);
            }
            catch (Exception ex)
            {
                _logger.LogWarning("Failed to mark label {Sn} as scanned: {Message}", qrSn, ex.Message);
            }
        }

        return (entity, item);
    }

    public async Task<(FulfillmentShipmentEntity? Entity, ShipmentLineItemCache? Item)> RemoveShipmentScanAsync(
        string fulfillmentId, string fulfillmentLineItemId, string scannedBy,
        string orderName, string orderId, string trackingNumber)
    {
        var numericId = StripGid(fulfillmentId);
        var entity = await GetFulfillmentShipmentAsync(numericId);
        if (entity == null) return (null, null);

        var lineItems = JsonConvert.DeserializeObject<List<ShipmentLineItemCache>>(entity.LineItemsJson)
            ?? new List<ShipmentLineItemCache>();

        var matched = lineItems.FirstOrDefault(li =>
            li.FulfillmentLineItemId.Equals(fulfillmentLineItemId, StringComparison.OrdinalIgnoreCase));
        if (matched == null || matched.QuantityShipped <= 0) return (entity, matched);

        matched.QuantityShipped--;
        var totalShipped = lineItems.Sum(li => li.QuantityShipped);
        entity.Status = totalShipped == 0 ? "pending" : "partial";
        entity.LineItemsJson = JsonConvert.SerializeObject(lineItems);
        await _fulfillmentShipments.UpsertEntityAsync(entity, TableUpdateMode.Replace);

        try
        {
            var scanEntity = new ShipmentScanEntity
            {
                PartitionKey          = numericId,
                RowKey                = $"{DateTimeOffset.UtcNow.Ticks:D20}-{Guid.NewGuid():N}",
                OrderId               = orderId,
                OrderName             = orderName,
                FulfillmentId         = fulfillmentId,
                TrackingNumber        = trackingNumber,
                FulfillmentLineItemId = matched.FulfillmentLineItemId,
                LineItemId            = matched.LineItemId,
                VariantId             = matched.VariantId,
                Sku                   = matched.Sku,
                Barcode               = matched.Barcode,
                ProductTitle          = matched.ProductTitle,
                VariantTitle          = matched.VariantTitle,
                QuantityShipped       = -1,
                ScannedBy             = scannedBy,
                ScannedAt             = DateTimeOffset.UtcNow,
                IsRemoval             = true,
                Price                 = matched.Price,
                Weight                = matched.Weight,
                WeightUnit            = matched.WeightUnit,
            };
            await _shipmentScans.AddEntityAsync(scanEntity);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Failed to log removal scan: {Message}", ex.Message);
        }

        return (entity, matched);
    }

    public async Task<FulfillmentShipmentEntity?> CompleteShipmentAsync(
        string numericFulfillmentId, string scannedBy, string? reason,
        string orderName, string orderId, string trackingNumber)
    {
        var entity = await GetFulfillmentShipmentAsync(numericFulfillmentId);
        if (entity == null) return null;

        var lineItems = JsonConvert.DeserializeObject<List<ShipmentLineItemCache>>(entity.LineItemsJson)
            ?? new List<ShipmentLineItemCache>();
        var totalExpected = lineItems.Sum(li => li.QuantityExpected);
        var totalShipped  = lineItems.Sum(li => li.QuantityShipped);
        var isManual = totalShipped < totalExpected;

        entity.Status = "shipped";
        entity.ShippedAt = DateTimeOffset.UtcNow;
        entity.CompletedBy = scannedBy;
        entity.IsManualComplete = isManual;
        entity.ManualReason = isManual ? reason : null;
        await _fulfillmentShipments.UpsertEntityAsync(entity, TableUpdateMode.Replace);

        if (isManual)
        {
            foreach (var li in lineItems.Where(li => li.QuantityShipped < li.QuantityExpected))
            {
                try
                {
                    var scanEntity = new ShipmentScanEntity
                    {
                        PartitionKey          = numericFulfillmentId,
                        RowKey                = $"{DateTimeOffset.UtcNow.Ticks:D20}-{Guid.NewGuid():N}",
                        OrderId               = orderId,
                        OrderName             = orderName,
                        FulfillmentId         = entity.FulfillmentId,
                        TrackingNumber        = trackingNumber,
                        FulfillmentLineItemId = li.FulfillmentLineItemId,
                        LineItemId            = li.LineItemId,
                        VariantId             = li.VariantId,
                        Sku                   = li.Sku,
                        ProductTitle          = li.ProductTitle,
                        VariantTitle          = li.VariantTitle,
                        QuantityShipped       = 0,
                        ScannedBy             = scannedBy,
                        ScannedAt             = DateTimeOffset.UtcNow,
                        IsManualOverride      = true,
                        OverrideReason        = reason,
                    };
                    await _shipmentScans.AddEntityAsync(scanEntity);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning("Failed to log manual override scan: {Message}", ex.Message);
                }
            }
        }

        return entity;
    }

    public async Task<List<ShipmentScanEntity>> GetShipmentScansAsync(string numericFulfillmentId)
    {
        var results = new List<ShipmentScanEntity>();
        await foreach (var e in _shipmentScans.QueryAsync<ShipmentScanEntity>(
            filter: $"PartitionKey eq '{numericFulfillmentId}'"))
            results.Add(e);
        return results.OrderBy(e => e.ScannedAt).ToList();
    }

    // ─── Scale & Print: product lookup ───────────────────────────────────────

    public async Task<ProductLookupEntity?> GetProductLookupAsync(string itemNumber)
    {
        try
        {
            var response = await _productLookup.GetEntityAsync<ProductLookupEntity>("product", itemNumber);
            return response.Value;
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            return null;
        }
    }

    public async Task<List<ProductLookupEntity>> ListProductLookupsAsync()
    {
        var results = new List<ProductLookupEntity>();
        await foreach (var e in _productLookup.QueryAsync<ProductLookupEntity>(filter: "PartitionKey eq 'product'"))
            results.Add(e);
        return results.OrderBy(e => e.RowKey).ToList();
    }

    public async Task UpsertProductLookupAsync(ProductLookupEntity entity)
    {
        await _productLookup.UpsertEntityAsync(entity, TableUpdateMode.Replace);
    }

    public async Task<bool> DeleteProductLookupAsync(string itemNumber)
    {
        try
        {
            await _productLookup.DeleteEntityAsync("product", itemNumber);
            return true;
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            return false;
        }
    }

    // ─── Scale & Print: printed label audit log ──────────────────────────────

    public async Task LogPrintedLabelAsync(PrintedLabelEntity entity)
    {
        await _printedLabels.AddEntityAsync(entity);
    }

    // from/to are EST date strings (yyyy-MM-dd[ HH:mm:ss]); compared lexicographically against PrintedAtEst,
    // which sorts correctly because the format is fixed-width and zero-padded.
    public async Task<List<PrintedLabelEntity>> ListPrintedLabelsAsync(string? from, string? to, string? plu)
    {
        var results = new List<PrintedLabelEntity>();
        await foreach (var e in _printedLabels.QueryAsync<PrintedLabelEntity>())
        {
            if (!string.IsNullOrEmpty(from) && string.Compare(e.PrintedAtEst, from, StringComparison.Ordinal) < 0) continue;
            if (!string.IsNullOrEmpty(to) && string.Compare(e.PrintedAtEst, to, StringComparison.Ordinal) > 0) continue;
            if (!string.IsNullOrEmpty(plu) && !e.Plu.Equals(plu, StringComparison.OrdinalIgnoreCase)) continue;
            results.Add(e);
        }
        return results.OrderByDescending(e => e.PrintedAtEst, StringComparer.Ordinal).ToList();
    }

    public async Task<PrintedLabelEntity?> GetPrintedLabelBySnAsync(string sn)
    {
        await foreach (var e in _printedLabels.QueryAsync<PrintedLabelEntity>(l => l.Sn == sn))
            return e;
        return null;
    }

    // ─── QR label scan-duplicate detection ───────────────────────────────────

    public async Task<ScannedLabelEntity?> GetScannedLabelAsync(string sn)
    {
        try
        {
            var response = await _scannedLabels.GetEntityAsync<ScannedLabelEntity>("sn", sn);
            return response.Value;
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            return null;
        }
    }

    public async Task MarkLabelScannedAsync(string sn, string fulfillmentId)
    {
        var entity = new ScannedLabelEntity
        {
            PartitionKey = "sn",
            RowKey = sn,
            FulfillmentId = fulfillmentId,
            ScannedAt = DateTimeOffset.UtcNow,
        };
        await _scannedLabels.UpsertEntityAsync(entity, TableUpdateMode.Replace);
    }
}
