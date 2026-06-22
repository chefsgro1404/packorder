using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Models;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class ShipmentFunction
{
    private readonly ILogger<ShipmentFunction> _logger;
    private readonly TableStorageService _tableStorage;
    private readonly ShopifyService _shopify;
    private readonly AuthHelper _authHelper;
    private readonly string[] _allowedOrigins;

    public ShipmentFunction(ILogger<ShipmentFunction> logger, TableStorageService tableStorage,
        ShopifyService shopify, AuthHelper authHelper, string[] allowedOrigins)
    {
        _logger = logger; _tableStorage = tableStorage; _shopify = shopify;
        _authHelper = authHelper; _allowedOrigins = allowedOrigins;
    }

    [Function("ShipmentScan")]
    public async Task<HttpResponseData> Scan(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "shipment/scan")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var body    = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<RecordShipScanRequest>(body);

            if (string.IsNullOrWhiteSpace(request?.FulfillmentId))
                return await ResponseHelper.WriteError(req, "fulfillmentId is required", HttpStatusCode.BadRequest, _allowedOrigins);
            if (string.IsNullOrWhiteSpace(request.ScannedBy))
                return await ResponseHelper.WriteError(req, "scannedBy is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var numericId = TableStorageService.StripGid(request.FulfillmentId);
            var entity    = await _tableStorage.GetFulfillmentShipmentAsync(numericId);
            if (entity == null)
                return await ResponseHelper.WriteError(req, "Fulfillment not found", HttpStatusCode.NotFound, _allowedOrigins);

            if (!string.IsNullOrEmpty(request.QrSn))
            {
                var existingScan = await _tableStorage.GetScannedLabelAsync(request.QrSn);
                if (existingScan != null)
                    return await ResponseHelper.WriteSuccess(req, new
                    {
                        matched = true,
                        duplicate = true,
                        scannedAt = existingScan.ScannedAt.ToString("o"),
                        fulfillmentId = existingScan.FulfillmentId,
                    }, _allowedOrigins);
            }

            var (matched, alreadyFull, updatedEntity, matchedItem) = await _tableStorage.RecordShipmentScanAsync(
                request, entity.OrderName, entity.OrderId, entity.TrackingNumber);

            if (!matched)
                return await ResponseHelper.WriteSuccess(req, new { matched = false, barcode = request.Barcode }, _allowedOrigins);

            if (alreadyFull)
                return await ResponseHelper.WriteSuccess(req, new
                {
                    matched = true, alreadyFull = true,
                    lineItemName = matchedItem?.Name,
                    fulfillmentLineItemId = matchedItem?.FulfillmentLineItemId,
                }, _allowedOrigins);

            return await ResponseHelper.WriteSuccess(req, new
            {
                matched               = true,
                alreadyFull           = false,
                fulfillmentLineItemId = matchedItem!.FulfillmentLineItemId,
                lineItemName          = matchedItem.Name,
                quantityShipped       = matchedItem.QuantityShipped,
                quantityExpected      = matchedItem.QuantityExpected,
                fulfillmentStatus     = updatedEntity!.Status,
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Shipment scan failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("ShipmentScanExtra")]
    public async Task<HttpResponseData> ScanExtra(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "shipment/scan-extra")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var body    = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<AddExtraItemRequest>(body);

            if (string.IsNullOrWhiteSpace(request?.FulfillmentId))
                return await ResponseHelper.WriteError(req, "fulfillmentId is required", HttpStatusCode.BadRequest, _allowedOrigins);
            if (string.IsNullOrWhiteSpace(request.Barcode))
                return await ResponseHelper.WriteError(req, "barcode is required", HttpStatusCode.BadRequest, _allowedOrigins);
            if (string.IsNullOrWhiteSpace(request.Reason))
                return await ResponseHelper.WriteError(req, "reason is required", HttpStatusCode.BadRequest, _allowedOrigins);
            if (string.IsNullOrWhiteSpace(request.ScannedBy))
                return await ResponseHelper.WriteError(req, "scannedBy is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var numericId = TableStorageService.StripGid(request.FulfillmentId);
            var entity    = await _tableStorage.GetFulfillmentShipmentAsync(numericId);
            if (entity == null)
                return await ResponseHelper.WriteError(req, "Fulfillment not found", HttpStatusCode.NotFound, _allowedOrigins);

            if (!string.IsNullOrEmpty(request.QrSn))
            {
                var existingScan = await _tableStorage.GetScannedLabelAsync(request.QrSn);
                if (existingScan != null)
                    return await ResponseHelper.WriteSuccess(req, new
                    {
                        ok = true,
                        duplicate = true,
                        scannedAt = existingScan.ScannedAt.ToString("o"),
                        fulfillmentId = existingScan.FulfillmentId,
                    }, _allowedOrigins);
            }

            var shopifyVariant = await _shopify.GetVariantByBarcodeAsync(request.Barcode);

            var (updatedEntity, item) = await _tableStorage.AddExtraItemAsync(
                request.FulfillmentId, request.Barcode, request.Reason, request.ScannedBy,
                entity.OrderName, entity.OrderId, entity.TrackingNumber, shopifyVariant,
                request.Plu, request.QrSn, request.WeightGrams, request.PackagedAt);

            return await ResponseHelper.WriteSuccess(req, new
            {
                ok = true,
                fulfillmentLineItemId = item!.FulfillmentLineItemId,
                productTitle = item.ProductTitle,
                variantTitle = item.VariantTitle,
                sku = item.Sku,
                barcode = item.Barcode,
                imageUrl = item.ImageUrl,
                price = item.Price,
                weight = item.Weight,
                weightUnit = item.WeightUnit,
                quantityShipped = item.QuantityShipped,
                quantityExpected = item.QuantityExpected,
                fulfillmentStatus = updatedEntity!.Status,
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Add extra item failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("ShipmentRemoveScan")]
    public async Task<HttpResponseData> RemoveScan(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "shipment/remove")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var body    = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<RemoveScanRequest>(body);

            if (string.IsNullOrWhiteSpace(request?.FulfillmentId))
                return await ResponseHelper.WriteError(req, "fulfillmentId is required", HttpStatusCode.BadRequest, _allowedOrigins);
            if (string.IsNullOrWhiteSpace(request.FulfillmentLineItemId))
                return await ResponseHelper.WriteError(req, "fulfillmentLineItemId is required", HttpStatusCode.BadRequest, _allowedOrigins);
            if (string.IsNullOrWhiteSpace(request.ScannedBy))
                return await ResponseHelper.WriteError(req, "scannedBy is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var numericId = TableStorageService.StripGid(request.FulfillmentId);
            var entity    = await _tableStorage.GetFulfillmentShipmentAsync(numericId);
            if (entity == null)
                return await ResponseHelper.WriteError(req, "Fulfillment not found", HttpStatusCode.NotFound, _allowedOrigins);

            var (updatedEntity, item) = await _tableStorage.RemoveShipmentScanAsync(
                request.FulfillmentId, request.FulfillmentLineItemId, request.ScannedBy,
                entity.OrderName, entity.OrderId, entity.TrackingNumber);

            if (item == null)
                return await ResponseHelper.WriteError(req, "Line item not found", HttpStatusCode.NotFound, _allowedOrigins);

            return await ResponseHelper.WriteSuccess(req, new
            {
                ok = true,
                fulfillmentLineItemId = item.FulfillmentLineItemId,
                quantityShipped = item.QuantityShipped,
                quantityExpected = item.QuantityExpected,
                fulfillmentStatus = updatedEntity!.Status,
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Remove shipment scan failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("ShipmentComplete")]
    public async Task<HttpResponseData> Complete(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "shipment/complete")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var body    = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<CompleteShipmentRequest>(body);

            if (string.IsNullOrWhiteSpace(request?.FulfillmentId))
                return await ResponseHelper.WriteError(req, "fulfillmentId is required", HttpStatusCode.BadRequest, _allowedOrigins);
            if (string.IsNullOrWhiteSpace(request.ScannedBy))
                return await ResponseHelper.WriteError(req, "scannedBy is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var numericId = TableStorageService.StripGid(request.FulfillmentId);
            var entity    = await _tableStorage.GetFulfillmentShipmentAsync(numericId);
            if (entity == null)
                return await ResponseHelper.WriteError(req, "Fulfillment not found", HttpStatusCode.NotFound, _allowedOrigins);

            var lineItems     = JsonConvert.DeserializeObject<List<ShipmentLineItemCache>>(entity.LineItemsJson) ?? new List<ShipmentLineItemCache>();
            var totalExpected = lineItems.Sum(li => li.QuantityExpected);
            var totalShipped  = lineItems.Sum(li => li.QuantityShipped);
            var isIncomplete  = totalShipped < totalExpected;

            if (isIncomplete && string.IsNullOrWhiteSpace(request.Reason))
                return await ResponseHelper.WriteError(req, "reason is required when not all items are scanned", HttpStatusCode.BadRequest, _allowedOrigins);

            var updated = await _tableStorage.CompleteShipmentAsync(
                numericId, request.ScannedBy, request.Reason,
                entity.OrderName, entity.OrderId, entity.TrackingNumber);

            return await ResponseHelper.WriteSuccess(req, new
            {
                ok = true,
                isManualComplete = updated!.IsManualComplete,
                shippedAt = updated.ShippedAt?.ToString("o"),
                completedBy = updated.CompletedBy,
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Shipment complete failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("ShipmentNotes")]
    public async Task<HttpResponseData> UpdateNotes(
        [HttpTrigger(AuthorizationLevel.Anonymous, "patch", "options", Route = "shipment/notes")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var body    = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<UpdateFulfillmentNotesRequest>(body);

            if (string.IsNullOrWhiteSpace(request?.FulfillmentId))
                return await ResponseHelper.WriteError(req, "fulfillmentId is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var numericId = TableStorageService.StripGid(request.FulfillmentId);
            var updated   = await _tableStorage.UpdateFulfillmentNotesAsync(numericId, request.Notes?.Trim());
            if (updated == null)
                return await ResponseHelper.WriteError(req, "Fulfillment not found", HttpStatusCode.NotFound, _allowedOrigins);

            return await ResponseHelper.WriteSuccess(req, new { ok = true, notes = updated.Notes }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Update shipment notes failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("ShipmentHistory")]
    public async Task<HttpResponseData> History(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "shipment/history")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var qs = ParseQueryString(req.Url.Query);

            DateTimeOffset? from = qs.TryGetValue("from", out var fromStr) && DateTimeOffset.TryParse(fromStr, out var fd) ? fd : null;
            DateTimeOffset? to   = qs.TryGetValue("to",   out var toStr)   && DateTimeOffset.TryParse(toStr,   out var td) ? td : null;
            var completedBy = qs.TryGetValue("scannedBy", out var cb) ? cb : null;
            var manualOnly  = qs.TryGetValue("type", out var typeVal) && typeVal.Equals("incomplete", StringComparison.OrdinalIgnoreCase)
                ? (bool?)true : null;

            var entities = await _tableStorage.GetShippedShipmentFulfillmentsAsync(from, to, completedBy, manualOnly);

            if (qs.TryGetValue("extras", out var extrasVal) && extrasVal.Equals("true", StringComparison.OrdinalIgnoreCase))
            {
                entities = entities.Where(e =>
                {
                    var items = JsonConvert.DeserializeObject<List<ShipmentLineItemCache>>(e.LineItemsJson) ?? new List<ShipmentLineItemCache>();
                    return items.Any(li => li.IsExtra);
                }).ToList();
            }

            if (qs.TryGetValue("tags", out var tagsParam) && !string.IsNullOrEmpty(tagsParam))
            {
                var filterTags = tagsParam.Split(',').Select(t => t.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);
                entities = entities.Where(e =>
                {
                    var orderTags = JsonConvert.DeserializeObject<List<string>>(e.OrderTags) ?? new List<string>();
                    return orderTags.Any(tag => filterTags.Contains(tag));
                }).ToList();
            }

            var shipments = entities
                .OrderByDescending(e => e.ShippedAt)
                .Select(ShipOrdersFunction.SerializeFulfillment)
                .ToList();

            return await ResponseHelper.WriteSuccess(req, new { shipments, total = shipments.Count }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Shipment history failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("ShipmentScans")]
    public async Task<HttpResponseData> Scans(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "shipment/scans")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var qs = ParseQueryString(req.Url.Query);
            var fulfillmentId = qs.TryGetValue("fulfillmentId", out var fid) ? fid : "";
            if (string.IsNullOrEmpty(fulfillmentId))
                return await ResponseHelper.WriteError(req, "fulfillmentId is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var numericId = TableStorageService.StripGid(fulfillmentId);
            var scans     = await _tableStorage.GetShipmentScansAsync(numericId);

            var result = scans.Select(s => new {
                orderId = s.OrderId, orderName = s.OrderName,
                fulfillmentId = s.FulfillmentId, trackingNumber = s.TrackingNumber,
                fulfillmentLineItemId = s.FulfillmentLineItemId, lineItemId = s.LineItemId,
                variantId = s.VariantId, sku = s.Sku, barcode = s.Barcode, plu = s.Plu,
                productTitle = s.ProductTitle, variantTitle = s.VariantTitle,
                quantityShipped = s.QuantityShipped,
                weightGrams = s.WeightGrams, pricePerLb = s.PricePerLb, totalPriceScanned = s.TotalPriceScanned,
                isVariableWeight = s.IsVariableWeight,
                scannedBy = s.ScannedBy, scannedAt = s.ScannedAt.ToString("o"),
                isManualLineItem = s.IsManualLineItem,
                isManualOverride = s.IsManualOverride, overrideReason = s.OverrideReason,
                isExtra = s.IsExtra, isRemoval = s.IsRemoval, extraReason = s.ExtraReason,
                price = s.Price, weight = s.Weight, weightUnit = s.WeightUnit,
                qrSn = s.QrSn, packagedAt = s.PackagedAt,
            }).ToList();

            return await ResponseHelper.WriteSuccess(req, new { scans = result, total = result.Count }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Shipment scans fetch failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    private static Dictionary<string, string> ParseQueryString(string query)
    {
        return query.TrimStart('?')
            .Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(p => p.Split('=', 2))
            .Where(p => p.Length == 2)
            .ToDictionary(
                p => Uri.UnescapeDataString(p[0]),
                p => Uri.UnescapeDataString(p[1]),
                StringComparer.OrdinalIgnoreCase);
    }
}
