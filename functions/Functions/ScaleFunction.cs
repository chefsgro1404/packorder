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

    [Function("ScaleLookup")]
    public async Task<HttpResponseData> Lookup(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "scale/lookup")]
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
            var itemNumber = qs.TryGetValue("itemNumber", out var i) ? i : "";
            if (string.IsNullOrWhiteSpace(itemNumber))
            {
                _logger.LogWarning("Scale lookup rejected: missing itemNumber");
                return await ResponseHelper.WriteError(req, "itemNumber is required", HttpStatusCode.BadRequest, _allowedOrigins);
            }

            var entity = await _tableStorage.FindProductLookupByItemNumberAsync(itemNumber);
            if (entity == null)
            {
                _logger.LogWarning("Scale lookup miss: item number {ItemNumber} not in productlookup", itemNumber);
                return await ResponseHelper.WriteSuccess(req, new { found = false, itemNumber }, _allowedOrigins);
            }

            _logger.LogInformation("Scale lookup hit: item {ItemNumber} -> PLU {Plu} ({ProductTitle})",
                itemNumber, entity.Plu, entity.ProductTitle);

            return await ResponseHelper.WriteSuccess(req, new
            {
                found = true,
                itemNumber,
                plu = entity.Plu,
                productTitle = entity.ProductTitle,
                pricePerLb = entity.PricePerLb,
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Scale lookup failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("ScaleProducts")]
    public async Task<HttpResponseData> Products(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "patch", "delete", "options", Route = "scale/products")]
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
                    }).ToList();
                return await ResponseHelper.WriteSuccess(req, new { products, total = products.Count }, _allowedOrigins);
            }

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

            // POST (create) and PATCH (update) share the same upsert body
            var body = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<UpsertProductLookupRequest>(body);

            if (string.IsNullOrWhiteSpace(request?.ItemNumber))
            {
                _logger.LogWarning("Scale product upsert rejected: missing itemNumber");
                return await ResponseHelper.WriteError(req, "itemNumber is required", HttpStatusCode.BadRequest, _allowedOrigins);
            }
            if (string.IsNullOrWhiteSpace(request.Plu))
            {
                _logger.LogWarning("Scale product upsert rejected: missing plu for item {ItemNumber}", request.ItemNumber);
                return await ResponseHelper.WriteError(req, "plu is required", HttpStatusCode.BadRequest, _allowedOrigins);
            }
            if (string.IsNullOrWhiteSpace(request.ProductTitle))
            {
                _logger.LogWarning("Scale product upsert rejected: missing productTitle for item {ItemNumber}", request.ItemNumber);
                return await ResponseHelper.WriteError(req, "productTitle is required", HttpStatusCode.BadRequest, _allowedOrigins);
            }

            var existing = await _tableStorage.GetProductLookupAsync(request.ItemNumber);
            if (req.Method.Equals("PATCH", StringComparison.OrdinalIgnoreCase))
            {
                if (existing == null)
                {
                    _logger.LogWarning("Scale product update failed: item {ItemNumber} not found", request.ItemNumber);
                    return await ResponseHelper.WriteError(req, "Product not found", HttpStatusCode.NotFound, _allowedOrigins);
                }
            }
            else if (existing != null)
            {
                _logger.LogWarning("Scale product create rejected: item {ItemNumber} already mapped", request.ItemNumber);
                return await ResponseHelper.WriteError(req, "Item number already mapped", HttpStatusCode.Conflict, _allowedOrigins);
            }

            var entityToSave = new ProductLookupEntity
            {
                RowKey = request.ItemNumber,
                ItemNumber = request.ItemNumber,
                Plu = request.Plu,
                ProductTitle = request.ProductTitle,
                PricePerLb = request.PricePerLb,
                Pinned = request.Pinned ?? existing?.Pinned ?? false,
                ProductId = existing?.ProductId,
                VariantId = existing?.VariantId,
                VariantTitle = existing?.VariantTitle,
                ImageUrl = existing?.ImageUrl,
            };
            await _tableStorage.UpsertProductLookupAsync(entityToSave);

            _logger.LogInformation("Scale product {Action}: item {ItemNumber} -> PLU {Plu} ({ProductTitle})",
                existing == null ? "created" : "updated", entityToSave.RowKey, entityToSave.Plu, entityToSave.ProductTitle);

            return await ResponseHelper.WriteSuccess(req, new
            {
                itemNumber = entityToSave.RowKey,
                plu = entityToSave.Plu,
                productTitle = entityToSave.ProductTitle,
                pricePerLb = entityToSave.PricePerLb,
            }, _allowedOrigins);
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
                if (entity == null)
                    return await ResponseHelper.WriteSuccess(req, new { found = false }, _allowedOrigins);

                return await ResponseHelper.WriteSuccess(req, new
                {
                    found = true,
                    productId = entity.ProductId,
                    variantId = entity.VariantId,
                    productTitle = entity.ProductTitle,
                    variantTitle = entity.VariantTitle,
                    imageUrl = entity.ImageUrl,
                    itemNumber = entity.ItemNumber,
                    plu = entity.Plu,
                    pricePerLb = entity.PricePerLb,
                    pinned = entity.Pinned,
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
                RowKey = $"v:{request.VariantId}",
                ProductId = request.ProductId,
                VariantId = request.VariantId,
                ProductTitle = request.ProductTitle,
                VariantTitle = request.VariantTitle,
                ImageUrl = request.ImageUrl,
                ItemNumber = string.IsNullOrWhiteSpace(request.ItemNumber) ? null : request.ItemNumber.Trim(),
                Plu = newPlu,
                PricePerLb = request.PricePerLb,
                Pinned = request.Pinned,
            };

            var (ok, conflictMessage) = await _tableStorage.UpsertScaleProductAsync(entityToSave);
            if (!ok)
            {
                _logger.LogWarning("Scale product upsert rejected: {Message}", conflictMessage);
                return await ResponseHelper.WriteError(req, conflictMessage ?? "Conflict", HttpStatusCode.Conflict, _allowedOrigins);
            }

            _logger.LogInformation("Scale product (by variant) saved: variant {VariantId} ({ProductTitle})",
                request.VariantId, request.ProductTitle);

            return await ResponseHelper.WriteSuccess(req, new
            {
                productId = entityToSave.ProductId,
                variantId = entityToSave.VariantId,
                productTitle = entityToSave.ProductTitle,
                variantTitle = entityToSave.VariantTitle,
                imageUrl = entityToSave.ImageUrl,
                itemNumber = entityToSave.ItemNumber,
                plu = entityToSave.Plu,
                pricePerLb = entityToSave.PricePerLb,
                pinned = entityToSave.Pinned,
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
