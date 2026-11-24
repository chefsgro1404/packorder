using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Models;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class ScaleFunction
{
    private readonly ILogger<ScaleFunction> _logger;
    private readonly TableStorageService _tableStorage;
    private readonly ShopifyService _shopify;
    private readonly AuthHelper _authHelper;
    private readonly string[] _allowedOrigins;

    public ScaleFunction(ILogger<ScaleFunction> logger, TableStorageService tableStorage,
        ShopifyService shopify, AuthHelper authHelper, string[] allowedOrigins)
    {
        _logger = logger; _tableStorage = tableStorage;
        _shopify = shopify; _authHelper = authHelper; _allowedOrigins = allowedOrigins;
    }

    [Function("ScaleProducts")]
    public async Task<HttpResponseData> Products(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "delete", "options", Route = "scale/products")]
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
                var qsGet = ParseQueryString(req.Url.Query);
                var filterVariantId = qsGet.TryGetValue("variantId", out var vid) ? vid : null;

                var entities = await _tableStorage.ListProductLookupsAsync();
                if (!string.IsNullOrWhiteSpace(filterVariantId))
                    entities = entities.Where(e => e.VariantId == filterVariantId).ToList();

                var products = entities
                    .OrderByDescending(e => e.Pinned)
                    .Select(e => new
                    {
                        itemNumber = e.ItemNumber ?? (e.RowKey.StartsWith("v:") ? null : e.RowKey),
                        plu = e.Plu,
                        productTitle = e.ProductTitle,
                        variantTitle = e.VariantTitle,
                        imageUrl = e.ImageUrl,
                        pricePerLb = e.PricePerLb,
                        productId = e.ProductId,
                        variantId = e.VariantId,
                        pinned = e.Pinned,
                        noWeight = e.NoWeight,
                    }).ToList();
                return await ResponseHelper.WriteSuccess(req, new { products, total = products.Count }, _allowedOrigins);
            }

            // Only legacy slot rows (no variant, keyed by an old scale item number) are deleted here,
            // so they can be cleaned up — scale item numbers no longer select products.
            if (req.Method.Equals("DELETE", StringComparison.OrdinalIgnoreCase))
            {
                var qs = ParseQueryString(req.Url.Query);
                var itemNumber = qs.TryGetValue("itemNumber", out var i) ? i : "";
                if (string.IsNullOrWhiteSpace(itemNumber))
                {
                    _logger.LogWarning("Scale product delete rejected: missing itemNumber");
                    return await ResponseHelper.WriteError(req, "itemNumber is required", HttpStatusCode.BadRequest, _allowedOrigins);
                }

                var deleted = await _tableStorage.DeleteProductLookupAsync(itemNumber);
                if (!deleted)
                {
                    _logger.LogWarning("Scale product delete failed: item {ItemNumber} not found", itemNumber);
                    return await ResponseHelper.WriteError(req, "Product not found", HttpStatusCode.NotFound, _allowedOrigins);
                }

                _logger.LogInformation("Scale product deleted: item {ItemNumber}", itemNumber);
                return await ResponseHelper.WriteSuccess(req, new { ok = true }, _allowedOrigins);
            }

            return await ResponseHelper.WriteError(req, "Method not allowed", HttpStatusCode.MethodNotAllowed, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Scale products operation failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("ScaleProductByVariant")]
    public async Task<HttpResponseData> ProductByVariant(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "put", "delete", "options", Route = "scale/products/by-variant")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (userId, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            if (req.Method.Equals("DELETE", StringComparison.OrdinalIgnoreCase))
            {
                var qsDel = ParseQueryString(req.Url.Query);
                var variantIdDel = qsDel.TryGetValue("variantId", out var vd) ? vd : "";
                if (string.IsNullOrWhiteSpace(variantIdDel))
                    return await ResponseHelper.WriteError(req, "variantId is required", HttpStatusCode.BadRequest, _allowedOrigins);

                var deleted = await _tableStorage.DeleteProductLookupByVariantAsync(variantIdDel);
                return await ResponseHelper.WriteSuccess(req, new { ok = deleted }, _allowedOrigins);
            }

            if (req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
            {
                var qs = ParseQueryString(req.Url.Query);
                var variantId = qs.TryGetValue("variantId", out var v) ? v : "";
                if (string.IsNullOrWhiteSpace(variantId))
                    return await ResponseHelper.WriteError(req, "variantId is required", HttpStatusCode.BadRequest, _allowedOrigins);

                var entity = await _tableStorage.GetProductLookupByVariantAsync(variantId);

                // Check lot-receiving tag from synced product variants (independent of scale-specific lookup)
                var variantEntity = await _tableStorage.GetProductVariantByVariantIdAsync(variantId);
                var isLotReceiving = false;
                List<Models.WeightRangeRule> weightRulesForVariant = new();
                List<object>? weightRangeSources = null;
                if (variantEntity != null)
                {
                    try
                    {
                        var tags = System.Text.Json.JsonSerializer.Deserialize<List<string>>(variantEntity.Tags) ?? new();
                        isLotReceiving = tags.Any(t => t.Equals("lot-receiving", StringComparison.OrdinalIgnoreCase));
                    }
                    catch { }
                    // This variant's own ranges, else its product's — never a sibling variant's
                    weightRulesForVariant = WeightRangeHelper.Effective(variantEntity);

                    // Reverse lookup for a rescanned tier label: tiers are separate variants (often other
                    // products) listed inside a parent's ranges. Collect every parent setup that lists this
                    // variant; when more than one does, return them all so staff choose which one applies.
                    if (weightRulesForVariant.Count == 0)
                    {
                        var strippedQuery = TableStorageService.StripGid(variantId);
                        var all = await _tableStorage.GetAllProductVariantsAsync();
                        var parents = all
                            .Select(c => (Entity: c, Own: WeightRangeHelper.HasOwnRanges(c), Rules: WeightRangeHelper.Effective(c)))
                            .Where(c => c.Rules.Any(r => TableStorageService.StripGid(r.VariantId) == strippedQuery))
                            // Product-level ranges are copied onto every variant: one setup per product, or per variant that has its own
                            .GroupBy(c => c.Own ? $"v:{c.Entity.RowKey}" : $"p:{c.Entity.PartitionKey}")
                            .Select(g => g.First())
                            .ToList();
                        if (parents.Count == 1)
                            weightRulesForVariant = parents[0].Rules;
                        else if (parents.Count > 1)
                            weightRangeSources = parents.Select(c => (object)new
                            {
                                productId = c.Entity.ProductId,
                                productTitle = c.Entity.ProductTitle,
                                variantId = c.Own ? c.Entity.VariantId : null,
                                variantTitle = c.Own ? c.Entity.VariantTitle : null,
                                rules = c.Rules,
                            }).ToList();
                    }
                }

                var hasAdjustments = !string.IsNullOrWhiteSpace(variantEntity?.Adjustments)
                    && variantEntity.Adjustments != "null"
                    && variantEntity.Adjustments != "{}";

                if (entity == null)
                {
                    // Not in PLU table — fall back to productvariants table for title data
                    if (variantEntity != null && !string.IsNullOrWhiteSpace(variantEntity.ProductTitle))
                        return await ResponseHelper.WriteSuccess(req, new
                        {
                            found = true,
                            productId = variantEntity.ProductId,
                            variantId = variantEntity.VariantId,
                            productTitle = variantEntity.ProductTitle,
                            variantTitle = variantEntity.VariantTitle,
                            plu = (string?)null,
                            isLotReceiving,
                            weightRanges = weightRulesForVariant,
                            weightRangeSources,
                            hasAdjustments,
                        }, _allowedOrigins);
                    return await ResponseHelper.WriteSuccess(req, new { found = false, isLotReceiving, weightRanges = weightRulesForVariant, weightRangeSources, hasAdjustments }, _allowedOrigins);
                }

                return await ResponseHelper.WriteSuccess(req, new
                {
                    found = true,
                    productId = entity.ProductId,
                    variantId = entity.VariantId,
                    productTitle = entity.ProductTitle,
                    variantTitle = entity.VariantTitle,
                    imageUrl = entity.ImageUrl,
                    plu = entity.Plu,
                    pricePerLb = entity.PricePerLb,
                    pinned = entity.Pinned,
                    noWeight = entity.NoWeight,
                    isLotReceiving,
                    weightRanges = weightRulesForVariant,
                    weightRangeSources,
                    hasAdjustments,
                }, _allowedOrigins);
            }

            // PUT — upsert keyed by variantId; idempotent (first save creates, later saves edit)
            var body = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<UpsertScaleProductRequest>(body);

            if (string.IsNullOrWhiteSpace(request?.ProductId) || string.IsNullOrWhiteSpace(request.VariantId))
                return await ResponseHelper.WriteError(req, "productId and variantId are required", HttpStatusCode.BadRequest, _allowedOrigins);
            if (string.IsNullOrWhiteSpace(request.ProductTitle))
                return await ResponseHelper.WriteError(req, "productTitle is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var existing = await _tableStorage.GetProductLookupByVariantAsync(request.VariantId);
            var oldBarcode = existing?.Plu;
            var newPlu = request.Plu?.Trim() ?? "";

            if (!string.IsNullOrEmpty(newPlu) && !string.Equals(oldBarcode, newPlu, StringComparison.OrdinalIgnoreCase))
            {
                // PLU edit pushes a real barcode update to Shopify, audited the same way /assign does
                var variant = await _shopify.UpdateVariantBarcodeAsync(request.ProductId, request.VariantId, newPlu);
                _ = _tableStorage.UpdateProductVariantBarcodeAsync(request.ProductId, request.VariantId, newPlu);

                _ = _tableStorage.LogBarcodeAuditAsync(new BarcodeAuditEntity
                {
                    ProductId = request.ProductId,
                    VariantId = request.VariantId,
                    ProductTitle = request.ProductTitle,
                    VariantTitle = request.VariantTitle,
                    OldBarcode = oldBarcode,
                    NewBarcode = newPlu,
                    Action = BarcodeAuditHelper.ComputeAction(oldBarcode, newPlu),
                    AssignedBy = userId,
                });
            }

            var entityToSave = new ProductLookupEntity
            {
                RowKey = TableStorageService.VariantRowKey(request.VariantId),
                ProductId = request.ProductId,
                VariantId = request.VariantId,
                ProductTitle = request.ProductTitle,
                VariantTitle = request.VariantTitle,
                ImageUrl = request.ImageUrl,
                ItemNumber = null, // scale item numbers no longer select products — saving clears any old slot
                Plu = newPlu,
                PricePerLb = request.PricePerLb,
                Pinned = request.Pinned,
                NoWeight = request.NoWeight,
            };

            await _tableStorage.UpsertProductLookupAsync(entityToSave);

            _logger.LogInformation("Scale product (by variant) saved: variant {VariantId} ({ProductTitle})",
                request.VariantId, request.ProductTitle);

            return await ResponseHelper.WriteSuccess(req, new
            {
                productId = entityToSave.ProductId,
                variantId = entityToSave.VariantId,
                productTitle = entityToSave.ProductTitle,
                variantTitle = entityToSave.VariantTitle,
                imageUrl = entityToSave.ImageUrl,
                plu = entityToSave.Plu,
                pricePerLb = entityToSave.PricePerLb,
                pinned = entityToSave.Pinned,
                noWeight = entityToSave.NoWeight,
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Scale product (by variant) operation failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("ScalePrintLog")]
    public async Task<HttpResponseData> PrintLog(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "options", Route = "scale/print-log")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (userId, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            if (req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
            {
                var qs = ParseQueryString(req.Url.Query);
                // from/to are EST date strings (yyyy-MM-dd[ HH:mm:ss]), compared lexicographically against PrintedAtEst
                var from = qs.TryGetValue("from", out var fromStr) ? fromStr : null;
                var to   = qs.TryGetValue("to",   out var toStr)   ? toStr   : null;
                var plu = qs.TryGetValue("plu", out var p) ? p : null;

                var entities = await _tableStorage.ListPrintedLabelsAsync(from, to, plu);
                var labels = entities.Select(e => new
                {
                    id = e.RowKey,
                    itemNumber = e.ItemNumber,
                    plu = e.Plu,
                    productTitle = e.ProductTitle,
                    itemWeight = e.ItemWeight,
                    printedAtEst = e.PrintedAtEst,
                    qrPayload = e.QrPayload,
                    printedBy = e.PrintedBy,
                    sn = e.Sn,
                    variantId = e.VariantId,
                    poId = e.PoId,
                    poLineItemId = e.PoLineItemId,
                    vendorName = e.VendorName,
                    lotNo = e.LotNo,
                    expiryDate = e.ExpiryDate,
                    mfgDate = e.ManufacturingDate,
                }).ToList();
                _logger.LogInformation("Scale print-log query returned {Count} labels (from={From}, to={To}, plu={Plu})",
                    labels.Count, from, to, plu);
                return await ResponseHelper.WriteSuccess(req, new { labels, total = labels.Count }, _allowedOrigins);
            }

            var body = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<LogPrintedLabelRequest>(body);

            if (string.IsNullOrWhiteSpace(request?.ProductTitle))
            {
                _logger.LogWarning("Print log rejected: missing productTitle (item {ItemNumber})", request?.ItemNumber);
                return await ResponseHelper.WriteError(req, "productTitle is required", HttpStatusCode.BadRequest, _allowedOrigins);
            }
            if (string.IsNullOrWhiteSpace(request.QrPayload))
            {
                _logger.LogWarning("Print log rejected: missing qrPayload (item {ItemNumber}, product {ProductTitle})",
                    request.ItemNumber, request.ProductTitle);
                return await ResponseHelper.WriteError(req, "qrPayload is required", HttpStatusCode.BadRequest, _allowedOrigins);
            }
            // "yyyy-MM-dd HH:mm:ss" -> "yyyyMMddHHmmss", an EST-based sort/partition key with no UTC involved
            var estSortKey = new string(request.PrintedAtEst.Where(char.IsDigit).ToArray());
            if (estSortKey.Length != 14)
            {
                _logger.LogWarning("Print log rejected: malformed printedAtEst {PrintedAtEst} (item {ItemNumber}, product {ProductTitle})",
                    request.PrintedAtEst, request.ItemNumber, request.ProductTitle);
                return await ResponseHelper.WriteError(req, "printedAtEst must be 'yyyy-MM-dd HH:mm:ss'", HttpStatusCode.BadRequest, _allowedOrigins);
            }

            var entityToSave = new PrintedLabelEntity
            {
                PartitionKey = estSortKey[..8],
                RowKey = $"{estSortKey}-{Guid.NewGuid():N}",
                ItemNumber = request.ItemNumber,
                Plu = request.Plu,
                ProductTitle = request.ProductTitle,
                ItemWeight = request.ItemWeight,
                PrintedAtEst = request.PrintedAtEst,
                QrPayload = request.QrPayload,
                PrintedBy = request.PrintedBy ?? userId,
                Sn = request.Sn,
                PoId = request.PoId,
                PoLineItemId = request.PoLineItemId,
                VendorName = request.VendorName,
                LotNo = request.LotNo,
                ExpiryDate = request.ExpiryDate,
                ManufacturingDate = request.MfgDate,
                VariantId = request.VariantId,
            };
            await _tableStorage.LogPrintedLabelAsync(entityToSave);

            if (string.IsNullOrEmpty(request.Plu) || request.Plu == "N/A")
            {
                _logger.LogWarning("Label printed without a PLU mapping: item {ItemNumber}, product {ProductTitle}, weight {ItemWeight}, by {PrintedBy}",
                    request.ItemNumber, request.ProductTitle, request.ItemWeight, entityToSave.PrintedBy);
            }
            else
            {
                _logger.LogInformation("Label printed: item {ItemNumber}, PLU {Plu}, product {ProductTitle}, weight {ItemWeight}, by {PrintedBy}",
                    request.ItemNumber, request.Plu, request.ProductTitle, request.ItemWeight, entityToSave.PrintedBy);
            }

            return await ResponseHelper.WriteSuccess(req, new { ok = true, id = entityToSave.RowKey }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Scale print log operation failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("ScaleNextSn")]
    public async Task<HttpResponseData> NextSn(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "scale/next-sn")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var body = await req.ReadAsStringAsync() ?? "";
            var request = JsonConvert.DeserializeObject<NextSnRequest>(body)
                ?? throw new InvalidOperationException("Invalid request body");

            if (string.IsNullOrWhiteSpace(request.Prefix))
                return await ResponseHelper.WriteError(req, "prefix is required", HttpStatusCode.BadRequest, _allowedOrigins);

            // Counter key = prefix so all products that share a prefix share one counter,
            // making SN collisions across products architecturally impossible.
            var counterKey = request.Prefix.Trim();

            var count = await _tableStorage.GetNextSnCountAsync(counterKey);
            var sn = $"{request.Prefix}-{100000 + count}";

            return await ResponseHelper.WriteSuccess(req, new { sn, count }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "NextSn failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("ScaleInventoryAdjust")]
    public async Task<HttpResponseData> InventoryAdjust(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "scale/inventory-adjust")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (userId, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var body = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<InventoryAdjustRequest>(body);

            if (string.IsNullOrWhiteSpace(request?.InventoryItemId))
                return await ResponseHelper.WriteError(req, "inventoryItemId is required", HttpStatusCode.BadRequest, _allowedOrigins);
            if (string.IsNullOrWhiteSpace(request.LocationId))
                return await ResponseHelper.WriteError(req, "locationId is required", HttpStatusCode.BadRequest, _allowedOrigins);
            if (request.Delta == 0)
                return await ResponseHelper.WriteError(req, "delta must be non-zero", HttpStatusCode.BadRequest, _allowedOrigins);

            var quantityAfter = await _shopify.AdjustInventoryAsync(
                request.InventoryItemId, request.LocationId, request.Delta, request.Reason);

            _logger.LogInformation(
                "Inventory adjusted: item={ItemId} location={LocationId} delta={Delta} quantityAfter={After} by={By}",
                request.InventoryItemId, request.LocationId, request.Delta, quantityAfter, userId);

            return await ResponseHelper.WriteSuccess(req, new
            {
                ok            = true,
                delta         = request.Delta,
                quantityAfter,
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Inventory adjustment failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("ScaleInventoryMapping")]
    public async Task<HttpResponseData> InventoryMapping(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "scale/inventory-mapping")]
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
            var variantId = qs.TryGetValue("variantId", out var v) ? v : "";
            if (string.IsNullOrWhiteSpace(variantId))
                return await ResponseHelper.WriteError(req, "variantId is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var adjustments = await _shopify.GetVariantAdjustmentsAsync(variantId);
            if (adjustments == null)
                return await ResponseHelper.WriteSuccess(req, new { found = false }, _allowedOrigins);

            return await ResponseHelper.WriteSuccess(req, new
            {
                found                = true,
                isWeighted           = adjustments["is_weighted"]?.ToObject<bool>() ?? false,
                weightPerUnit        = adjustments["weight_per_unit"]?.ToObject<double>() ?? 0.0,
                parentInventoryId    = adjustments["parent_inventory_id"]?.ToString() ?? "",
                parentProductHandle  = adjustments["parent_product_handle"]?.ToString() ?? "",
                parentProductTitle   = adjustments["parent_product_title"]?.ToString() ?? "",
                parentLocationId     = adjustments["parent_location_id"]?.ToString() ?? "",
                childInventoryItemId = adjustments["child_inventory_item_id"]?.ToString() ?? "",
                parentUnits          = adjustments["parent_units"]?.ToObject<int>() ?? 1,
                childUnits           = adjustments["child_units"]?.ToObject<int>() ?? 1,
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Inventory mapping lookup failed for variant");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    // Looks up a Shopify variant from the synced productVariants table by exact product title.
    // Used as a fallback when a scanned QR has PLU "N/A" (unmapped product) so the
    // transformation-options flow can still get a variantId.
    [Function("ScaleLookupByTitle")]
    public async Task<HttpResponseData> LookupByTitle(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "scale/lookup-by-title")]
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
            var title = qs.TryGetValue("title", out var t) ? t?.Trim() : "";
            if (string.IsNullOrWhiteSpace(title))
                return await ResponseHelper.WriteError(req, "title is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var all = await _tableStorage.GetAllProductVariantsAsync();
            var match = all.FirstOrDefault(v =>
                string.Equals(v.ProductTitle, title, StringComparison.OrdinalIgnoreCase));

            if (match == null)
                return await ResponseHelper.WriteSuccess(req, new { found = false }, _allowedOrigins);

            // Also return weight ranges so the caller can skip a separate by-variant call:
            // this variant's own ranges, else its product's — never a sibling variant's
            var weightRules = WeightRangeHelper.Effective(match);

            return await ResponseHelper.WriteSuccess(req, new
            {
                found         = true,
                variantId     = match.VariantId,
                productTitle  = match.ProductTitle,
                variantTitle  = match.VariantTitle,
                inventoryItemId = match.InventoryItemId,
                productId     = match.ProductId,
                weightRanges  = weightRules,
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "LookupByTitle failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("ScaleLookupBySn")]
    public async Task<HttpResponseData> LookupBySn(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "patch", "options", Route = "scale/lookup-by-sn")]
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
            var sn = qs.TryGetValue("sn", out var s) ? s?.Trim() : "";
            if (string.IsNullOrWhiteSpace(sn))
                return await ResponseHelper.WriteError(req, "sn is required", HttpStatusCode.BadRequest, _allowedOrigins);

            // PATCH — mark this label as processed (non-lot barcodes can only be used once)
            if (req.Method.Equals("PATCH", StringComparison.OrdinalIgnoreCase))
            {
                await _tableStorage.MarkLabelProcessedAsync(sn);
                return await ResponseHelper.WriteSuccess(req, new { ok = true }, _allowedOrigins);
            }

            var label = await _tableStorage.GetPrintedLabelBySnAsync(sn);
            if (label == null)
                return await ResponseHelper.WriteSuccess(req, new { found = false }, _allowedOrigins);

            var variantId = label.VariantId;

            // Fall back to title-based lookup for older rows without a stored variantId
            if (string.IsNullOrEmpty(variantId) && !string.IsNullOrEmpty(label.ProductTitle))
            {
                var all = await _tableStorage.GetAllProductVariantsAsync();
                var match = all.FirstOrDefault(v =>
                    string.Equals(v.ProductTitle, label.ProductTitle, StringComparison.OrdinalIgnoreCase));
                variantId = match?.VariantId;
            }

            return await ResponseHelper.WriteSuccess(req, new
            {
                found        = true,
                sn           = label.Sn,
                qrPayload    = label.QrPayload,
                variantId    = variantId,
                productTitle = label.ProductTitle,
                plu          = label.Plu,
                poId         = label.PoId,
                poLineItemId = label.PoLineItemId,
                vendorName   = label.VendorName,
                lotNo        = label.LotNo,
                itemWeight   = label.ItemWeight,
                processedAt  = label.ProcessedAt?.ToString("o"),
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "LookupBySn failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("ScaleMarkShipped")]
    public async Task<HttpResponseData> MarkShipped(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "scale/mark-shipped")]
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
            var payload = Newtonsoft.Json.JsonConvert.DeserializeObject<MarkShippedRequest>(body);
            if (string.IsNullOrWhiteSpace(payload?.Sn))
                return await ResponseHelper.WriteError(req, "sn is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var stamped = await _tableStorage.StampShippedAtAsync(payload.Sn, payload.OrderId ?? "");
            return await ResponseHelper.WriteSuccess(req, new { ok = true, found = stamped }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "MarkShipped failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("ScaleVariantInventory")]
    public async Task<HttpResponseData> VariantInventory(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "scale/variant-inventory")]
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
            var variantId = qs.TryGetValue("variantId", out var v) ? v : "";
            if (string.IsNullOrWhiteSpace(variantId))
                return await ResponseHelper.WriteError(req, "variantId is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var (inventoryItemId, locationId) = await _shopify.GetVariantInventoryAsync(variantId);
            // Fallback: use Azure productvariants cache when Shopify returns no inventory levels.
            if (string.IsNullOrEmpty(inventoryItemId))
                inventoryItemId = await _tableStorage.GetInventoryItemIdByVariantIdAsync(variantId);
            // Default location when Shopify returns none.
            if (string.IsNullOrEmpty(locationId))
                locationId = "gid://shopify/Location/82125062435";

            return await ResponseHelper.WriteSuccess(req, new
            {
                found           = !string.IsNullOrEmpty(inventoryItemId),
                inventoryItemId = inventoryItemId ?? "",
                locationId      = locationId,
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "VariantInventory lookup failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("ScaleTransformationOptions")]
    public async Task<HttpResponseData> TransformationOptions(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "scale/transformation-options")]
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
            var variantId = qs.TryGetValue("variantId", out var v) ? v : "";
            if (string.IsNullOrWhiteSpace(variantId))
                return await ResponseHelper.WriteError(req, "variantId is required", HttpStatusCode.BadRequest, _allowedOrigins);

            // Primary: query Azure for synced children across ALL products (cross-product support).
            // These are populated during sync and handle both product-level and variant-level metafields.
            var (parentInventoryItemId, _) = await _shopify.GetVariantInventoryAsync(variantId);
            // Fallback: use Azure productvariants cache when Shopify returns no inventory levels
            // (common for products without location-level tracking, e.g. test products).
            if (string.IsNullOrEmpty(parentInventoryItemId))
                parentInventoryItemId = await _tableStorage.GetInventoryItemIdByVariantIdAsync(variantId);
            var azureOptions = new List<TransformationOption>();
            if (!string.IsNullOrEmpty(parentInventoryItemId))
            {
                var azureVariants = await _tableStorage.GetVariantsByParentInventoryIdAsync(parentInventoryItemId);
                foreach (var av in azureVariants)
                {
                    if (string.IsNullOrEmpty(av.Adjustments) || string.IsNullOrEmpty(av.InventoryItemId)) continue;
                    try
                    {
                        var adj = Newtonsoft.Json.Linq.JObject.Parse(av.Adjustments);
                        var displayTitle = string.IsNullOrWhiteSpace(av.VariantTitle) || av.VariantTitle == "Default Title"
                            ? av.ProductTitle : av.VariantTitle;
                        azureOptions.Add(new TransformationOption
                        {
                            VariantId             = av.VariantId,
                            Title                 = displayTitle,
                            ProductTitle          = av.ProductTitle,
                            InventoryItemId       = av.InventoryItemId,
                            ParentInventoryItemId = parentInventoryItemId,
                            LocationId            = adj["parent_location_id"]?.ToString() ?? "",
                            ParentUnits           = adj["parent_units"]?.ToObject<int>() ?? 1,
                            ChildUnits            = adj["child_units"]?.ToObject<int>() ?? 1,
                            IsWeighted            = adj["is_weighted"]?.ToObject<bool>() ?? false,
                            WeightPerUnit         = adj["weight_per_unit"]?.ToObject<double>() ?? 0.0,
                        });
                    }
                    catch { }
                }
            }

            // Supplement: real-time Shopify query for same-product children (catches un-synced variants).
            var shopifyOptions = await _shopify.GetChildTransformationVariantsAsync(variantId);

            // Merge — Shopify real-time data wins for any shared variantId.
            var merged = azureOptions.ToDictionary(o => o.VariantId);
            foreach (var opt in shopifyOptions)
                merged[opt.VariantId] = opt;

            var options = merged.Values.ToList();

            return await ResponseHelper.WriteSuccess(req, new
            {
                found   = options.Count > 0,
                options = options,
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "TransformationOptions lookup failed for variant");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    // ─── Weight category auto-detection ──────────────────────────────────────

    [Function("ScaleWeightCategory")]
    public async Task<HttpResponseData> WeightCategory(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "scale/weight-category")]
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
            var productId = qs.TryGetValue("productId", out var p) ? p : "";
            var variantId = qs.TryGetValue("variantId", out var vq) ? vq : "";
            var weightStr = qs.TryGetValue("weightLbs", out var w) ? w : "";

            if (string.IsNullOrWhiteSpace(productId) && string.IsNullOrWhiteSpace(variantId))
                return await ResponseHelper.WriteError(req, "productId or variantId is required", HttpStatusCode.BadRequest, _allowedOrigins);
            if (!double.TryParse(weightStr, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var weightLbs) || weightLbs <= 0)
                return await ResponseHelper.WriteError(req, "weightLbs must be a positive number", HttpStatusCode.BadRequest, _allowedOrigins);

            // The variant's own ranges, else its product's (local cache); live Shopify fetch for the product as a last resort
            List<Models.WeightRangeRule> rules = new();
            if (!string.IsNullOrWhiteSpace(variantId))
            {
                var variant = await _tableStorage.GetProductVariantByVariantIdAsync(variantId);
                if (variant != null) rules = WeightRangeHelper.Effective(variant);
                if (string.IsNullOrWhiteSpace(productId)) productId = variant?.ProductId ?? "";
            }
            else
            {
                var variants = await _tableStorage.GetProductVariantsByProductIdAsync(productId);
                if (variants.Count > 0) rules = WeightRangeHelper.Parse(variants[0].WeightRanges);
            }
            if (rules.Count == 0 && !string.IsNullOrWhiteSpace(productId))
                rules = WeightRangeHelper.Parse(await _shopify.GetProductWeightRangesRawAsync(productId));

            var matches = WeightRangeHelper.Match(rules, weightLbs);
            if (matches.Count == 0)
                return await ResponseHelper.WriteSuccess(req, new { matched = false, weightLbs }, _allowedOrigins);
            // More than one tier holds this weight (same or overlapping ranges) — the caller must ask
            if (matches.Count > 1)
                return await ResponseHelper.WriteSuccess(req, new { matched = false, ambiguous = true, weightLbs, candidates = matches }, _allowedOrigins);
            var match = matches[0];

            return await ResponseHelper.WriteSuccess(req, new
            {
                matched   = true,
                weightLbs,
                variantId = match.VariantId,
                label     = match.Label,
                minLbs    = match.MinLbs,
                maxLbs    = match.MaxLbs,
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "WeightCategory lookup failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("ScaleWeightRanges")]
    public async Task<HttpResponseData> WeightRangesEndpoint(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "put", "options", Route = "scale/weight-ranges")]
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
                var qs = ParseQueryString(req.Url.Query);
                var productId = qs.TryGetValue("productId", out var p) ? p : "";

                if (string.IsNullOrWhiteSpace(productId))
                {
                    // No productId — every setup with ranges: per product, plus per variant with its own
                    var configured = WeightRangeHelper.ListConfigured(await _tableStorage.GetAllProductVariantsAsync())
                        .Select(x => new { productId = x.ProductId, productTitle = x.ProductTitle, variantId = x.VariantId,
                                           variantTitle = x.VariantTitle, rulesCount = x.RulesCount })
                        .ToList();
                    return await ResponseHelper.WriteSuccess(req, new { products = configured }, _allowedOrigins);
                }

                var variants = await _tableStorage.GetProductVariantsByProductIdAsync(productId);
                var productRules = variants.Count > 0 ? WeightRangeHelper.Parse(variants[0].WeightRanges) : new();
                var variantIdQuery = qs.TryGetValue("variantId", out var vq) ? vq : "";
                var target = string.IsNullOrWhiteSpace(variantIdQuery) ? null
                    : variants.FirstOrDefault(v => TableStorageService.StripGid(v.VariantId) == TableStorageService.StripGid(variantIdQuery));
                var variantRules = target != null ? WeightRangeHelper.Parse(target.VariantWeightRanges) : new();

                // A variant with its own ranges uses them; otherwise the product's apply
                var rules = variantRules.Count > 0 ? variantRules : productRules;
                var source = variantRules.Count > 0 ? "variant" : productRules.Count > 0 ? "product" : "none";

                // All variants of this product, for the tier dropdown and the "which variant" choice
                var variantOptions = variants.Select(v => new
                {
                    variantId = v.VariantId,
                    variantTitle = v.VariantTitle,
                    hasOwnRanges = WeightRangeHelper.HasOwnRanges(v),
                }).ToList();

                return await ResponseHelper.WriteSuccess(req, new { rules, source, productRules, variantRules, variantOptions }, _allowedOrigins);
            }

            // PUT — save weight ranges to Shopify and update local cache
            var body = await req.ReadAsStringAsync() ?? "{}";
            var request = Newtonsoft.Json.JsonConvert.DeserializeObject<SaveWeightRangesRequest>(body);

            if (string.IsNullOrWhiteSpace(request?.ProductId))
                return await ResponseHelper.WriteError(req, "productId is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var rulesJson = Newtonsoft.Json.JsonConvert.SerializeObject(request.Rules ?? new List<Models.WeightRangeRule>());

            if (!string.IsNullOrWhiteSpace(request.VariantId))
            {
                // This variant only ("[]" clears its own ranges, so it uses the product's again)
                await _shopify.SetVariantWeightRangesAsync(request.VariantId, rulesJson);
                await _tableStorage.UpdateVariantOwnWeightRangesAsync(request.VariantId, rulesJson);
                _logger.LogInformation("Saved weight ranges for variant {VariantId}: {Count} rules", request.VariantId, request.Rules?.Count ?? 0);
                return await ResponseHelper.WriteSuccess(req, new { ok = true, rules = request.Rules ?? new List<Models.WeightRangeRule>() }, _allowedOrigins);
            }

            // Save to Shopify
            await _shopify.SetProductWeightRangesAsync(request.ProductId, rulesJson);

            // Update local variant cache
            await _tableStorage.UpdateProductVariantWeightRangesAsync(request.ProductId, rulesJson);

            _logger.LogInformation("Saved weight ranges for product {ProductId}: {Count} rules", request.ProductId, request.Rules?.Count ?? 0);
            return await ResponseHelper.WriteSuccess(req, new { ok = true, rules = request.Rules ?? new List<Models.WeightRangeRule>() }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "WeightRanges endpoint failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    // ─── Processing Sessions (CRH-219) ───────────────────────────────────────

    [Function("ScaleProcessingSession")]
    public async Task<HttpResponseData> ProcessingSession(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "options", Route = "scale/processing-session")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (userId, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            if (req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
            {
                var qs = ParseQueryString(req.Url.Query);
                var poLineItemId = qs.TryGetValue("poLineItemId", out var p) ? p : "";
                if (string.IsNullOrWhiteSpace(poLineItemId))
                    return await ResponseHelper.WriteError(req, "poLineItemId is required", HttpStatusCode.BadRequest, _allowedOrigins);

                var sessions = await _tableStorage.GetProcessingSessionsByLineItemAsync(poLineItemId);

                var cumulativeQty = sessions.Sum(s => s.SessionQty);
                var wastageQty    = sessions.Sum(s => s.WastageQty);
                var lastSession   = sessions.OrderByDescending(s => s.ProcessedAt).FirstOrDefault();
                var sessionStatus = lastSession?.SessionStatus ?? "none";
                var poQty         = lastSession?.PoQty ?? 0;

                // Use the most-recent record's breakdown — each save contains the full cumulative state,
                // so summing across records would double-count when auto-saves are in play.
                var breakdown = new Dictionary<string, int>();
                try
                {
                    var latestWithBreakdown = sessions
                        .OrderByDescending(s => s.ProcessedAt)
                        .FirstOrDefault(s => !string.IsNullOrWhiteSpace(s.VariantBreakdown) && s.VariantBreakdown != "{}");
                    if (latestWithBreakdown?.VariantBreakdown != null)
                        breakdown = Newtonsoft.Json.JsonConvert.DeserializeObject<Dictionary<string, int>>(latestWithBreakdown.VariantBreakdown) ?? new();
                }
                catch { }

                return await ResponseHelper.WriteSuccess(req, new
                {
                    poLineItemId,
                    sessionCount     = sessions.Count,
                    cumulativeQty,
                    wastageQty,
                    sessionStatus,
                    poQty,
                    variantBreakdown = breakdown,
                    sessions         = sessions.Select(s => new
                    {
                        sessionId     = s.RowKey,
                        sessionQty    = s.SessionQty,
                        cumulativeQty = s.CumulativeQty,
                        wastageQty    = s.WastageQty,
                        sessionStatus = s.SessionStatus,
                        processedAt   = s.ProcessedAt,
                    }),
                }, _allowedOrigins);
            }

            // POST — write a session close event
            var body = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<SaveProcessingSessionRequest>(body);

            if (string.IsNullOrWhiteSpace(request?.PoLineItemId))
                return await ResponseHelper.WriteError(req, "poLineItemId is required", HttpStatusCode.BadRequest, _allowedOrigins);
            if (string.IsNullOrWhiteSpace(request.PoId))
                return await ResponseHelper.WriteError(req, "poId is required", HttpStatusCode.BadRequest, _allowedOrigins);
            if (request.SessionQty < 0)
                return await ResponseHelper.WriteError(req, "sessionQty must be >= 0", HttpStatusCode.BadRequest, _allowedOrigins);

            var priorSessions  = await _tableStorage.GetProcessingSessionsByLineItemAsync(request.PoLineItemId);
            var priorQty       = priorSessions.Sum(s => s.SessionQty);
            var cumulativeTotal = priorQty + request.SessionQty;

            var sessionId = Guid.NewGuid().ToString("N");
            var now       = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ");

            var entity = new ProcessingSessionEntity
            {
                PartitionKey     = request.PoLineItemId,
                RowKey           = sessionId,
                PoId             = request.PoId,
                PoLineItemId     = request.PoLineItemId,
                MainVariantId    = request.MainVariantId ?? "",
                MainProductTitle = request.MainProductTitle ?? "",
                PoQty            = request.PoQty,
                SessionQty       = request.SessionQty,
                CumulativeQty    = cumulativeTotal,
                WastageQty       = request.WastageQty,
                SessionStatus    = request.SessionStatus,
                VariantBreakdown = request.VariantBreakdown != null
                    ? JsonConvert.SerializeObject(request.VariantBreakdown) : "{}",
                VendorName       = request.VendorName ?? "",
                LotNo            = request.LotNo ?? "",
                ProcessedBy      = userId ?? "",
                ProcessedAt      = now,
            };

            await _tableStorage.SaveProcessingSessionAsync(entity);

            _logger.LogInformation(
                "Processing session saved: {SessionId} PO {PoId} line {PoLineItemId} — sessionQty={Qty} cumulative={Cum} status={Status}",
                sessionId, request.PoId, request.PoLineItemId, request.SessionQty, cumulativeTotal, request.SessionStatus);

            return await ResponseHelper.WriteSuccess(req, new
            {
                ok            = true,
                sessionId,
                cumulativeQty = cumulativeTotal,
                sessionStatus = request.SessionStatus,
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "ProcessingSession endpoint failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    // ─── Bulk Sessions ────────────────────────────────────────────────────────

    [Function("ScaleBulkSessions")]
    public async Task<HttpResponseData> BulkSessions(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "options", Route = "scale/bulk-sessions")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (userId, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            if (req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
            {
                var qs = ParseQueryString(req.Url.Query);
                var limit = qs.TryGetValue("limit", out var l) && int.TryParse(l, out var lv) ? lv : 50;
                var sessions = await _tableStorage.ListBulkSessionsAsync(userId!, limit);
                var sessionDtos = sessions.Select(s => new
                {
                    id            = s.RowKey,
                    productTitle  = s.ProductTitle,
                    variantTitle  = s.VariantTitle,
                    poId          = s.PoId,
                    poLineItemId  = s.PoLineItemId,
                    vendorName    = s.VendorName,
                    lotNo         = s.LotNo,
                    expiryDate    = s.ExpiryDate,
                    mfgDate       = s.ManufacturingDate,
                    quantityOrdered  = s.QuantityOrdered,
                    quantityReceived = s.QuantityReceived,
                    quantityPrinted  = s.QuantityPrinted,
                    results          = s.Results,
                    sessionDateEst = s.SessionDateEst,
                }).ToList();
                return await ResponseHelper.WriteSuccess(req, new { sessions = sessionDtos, total = sessionDtos.Count }, _allowedOrigins);
            }

            var body = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<SaveBulkSessionRequest>(body);
            if (request == null || string.IsNullOrWhiteSpace(request.ProductTitle))
                return await ResponseHelper.WriteError(req, "productTitle is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var sessionId = Guid.NewGuid().ToString("N");
            var entity = new BulkSessionEntity
            {
                PartitionKey    = userId!,
                RowKey          = sessionId,
                ProductTitle    = request.ProductTitle,
                VariantTitle    = request.VariantTitle,
                PoId            = request.PoId,
                PoLineItemId    = request.PoLineItemId,
                VendorName      = request.VendorName,
                LotNo           = request.LotNo,
                ExpiryDate      = request.ExpiryDate,
                ManufacturingDate = request.MfgDate,
                QuantityOrdered  = request.QuantityOrdered,
                QuantityReceived = request.QuantityReceived,
                QuantityPrinted  = request.QuantityPrinted,
                Results          = JsonConvert.SerializeObject(request.Results),
                SessionDateEst  = request.SessionDateEst,
            };
            await _tableStorage.SaveBulkSessionAsync(entity);
            _logger.LogInformation("Saved bulk session {SessionId}: {Printed}/{Ordered} for {Product}",
                sessionId, request.QuantityPrinted, request.QuantityOrdered, request.ProductTitle);
            return await ResponseHelper.WriteSuccess(req, new { ok = true, id = sessionId }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "BulkSessions endpoint failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    // GET /api/scale/lot-products  — list all configured lot products
    // POST /api/scale/lot-products — mark a product as lot method
    [Function("ScaleLotProducts")]
    public async Task<HttpResponseData> LotProducts(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "options", Route = "scale/lot-products")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (userId, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            if (req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
            {
                var products = await _tableStorage.GetLotProductsAsync();
                var dtos = products.Select(p => new
                {
                    productId    = p.PartitionKey,
                    productTitle = p.ProductTitle,
                    configuredBy = p.ConfiguredBy,
                    configuredAt = p.ConfiguredAt,
                }).ToList();
                return await ResponseHelper.WriteSuccess(req, new { products = dtos }, _allowedOrigins);
            }

            // POST — save a product as lot method
            var body = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<SaveLotProductRequest>(body);
            if (request == null || string.IsNullOrWhiteSpace(request.ProductId))
                return await ResponseHelper.WriteError(req, "productId is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var entity = await _tableStorage.SaveLotProductAsync(request.ProductId, request.ProductTitle, userId ?? "unknown");
            _logger.LogInformation("Lot product saved: {ProductId} ({ProductTitle}) by {UserId}",
                request.ProductId, request.ProductTitle, userId);

            return await ResponseHelper.WriteSuccess(req, new
            {
                productId    = entity.PartitionKey,
                productTitle = entity.ProductTitle,
                configuredAt = entity.ConfiguredAt,
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "LotProducts endpoint failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    // ── POST /api/scale/out-of-range-event (CRH-272) ─────────────────────────

    [Function("ScaleOutOfRangeEvent")]
    public async Task<HttpResponseData> OutOfRangeEvent(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "scale/out-of-range-event")]
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
            var request = JsonConvert.DeserializeObject<LogOutOfRangeEventRequest>(body);

            if (request == null || request.WeightLbs <= 0)
                return await ResponseHelper.WriteError(req, "weightLbs is required and must be > 0", HttpStatusCode.BadRequest, _allowedOrigins);

            await _tableStorage.LogOutOfRangeEventAsync(request);
            _logger.LogInformation(
                "Out-of-range event logged: product={ProductTitle} weight={WeightLbs} action={Action}",
                request.ProductTitle, request.WeightLbs, request.Action);

            return await ResponseHelper.WriteSuccess(req, new { ok = true }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "ScaleOutOfRangeEvent endpoint failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("ScalePendingScan")]
    public async Task<HttpResponseData> PendingScan(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "delete", "options", Route = "scale/pending-scan")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            if (req.Method.Equals("DELETE", StringComparison.OrdinalIgnoreCase))
            {
                await _tableStorage.DeletePendingScanAsync();
                return await ResponseHelper.WriteSuccess(req, new { deleted = true }, _allowedOrigins);
            }

            if (req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
            {
                var body    = await req.ReadAsStringAsync() ?? "{}";
                var request = JsonConvert.DeserializeObject<SavePendingScanRequest>(body);
                if (request == null || string.IsNullOrWhiteSpace(request.VariantId))
                    return await ResponseHelper.WriteError(req, "variantId is required", HttpStatusCode.BadRequest, _allowedOrigins);

                var entity = new PendingScanEntity
                {
                    VariantId        = request.VariantId,
                    ProductId        = request.ProductId,
                    ProductTitle     = request.ProductTitle,
                    VariantTitle     = request.VariantTitle,
                    ItemNumber       = request.ItemNumber,
                    Plu              = request.Plu,
                    Sn               = request.Sn,
                    PoId             = request.PoId,
                    PoLineItemId     = request.PoLineItemId,
                    VendorName       = request.VendorName,
                    LotNo            = request.LotNo,
                    WeightRangesJson = request.WeightRangesJson,
                    IsLotProduct     = request.IsLotProduct,
                    PostedAt         = DateTimeOffset.UtcNow,
                };
                await _tableStorage.UpsertPendingScanAsync(entity);
                _logger.LogInformation("Pending scan posted: {ProductTitle} variant={VariantId}", entity.ProductTitle, entity.VariantId);
                return await ResponseHelper.WriteSuccess(req, new { posted = true }, _allowedOrigins);
            }

            // GET — poll for a pending scan
            var scan = await _tableStorage.GetPendingScanAsync();
            if (scan == null)
                return await ResponseHelper.WriteSuccess(req, new { found = false }, _allowedOrigins);

            // Auto-expire after 5 minutes
            if (DateTimeOffset.UtcNow - scan.PostedAt > TimeSpan.FromMinutes(5))
            {
                await _tableStorage.DeletePendingScanAsync();
                return await ResponseHelper.WriteSuccess(req, new { found = false }, _allowedOrigins);
            }

            return await ResponseHelper.WriteSuccess(req, new
            {
                found            = true,
                variantId        = scan.VariantId,
                productId        = scan.ProductId,
                productTitle     = scan.ProductTitle,
                variantTitle     = scan.VariantTitle,
                itemNumber       = scan.ItemNumber,
                plu              = scan.Plu,
                sn               = scan.Sn,
                poId             = scan.PoId,
                poLineItemId     = scan.PoLineItemId,
                vendorName       = scan.VendorName,
                lotNo            = scan.LotNo,
                weightRangesJson = scan.WeightRangesJson,
                isLotProduct     = scan.IsLotProduct,
                postedAt         = scan.PostedAt.ToString("o"),
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "ScalePendingScan endpoint failed");
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
