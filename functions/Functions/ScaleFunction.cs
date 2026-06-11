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
    private readonly AuthHelper _authHelper;
    private readonly string[] _allowedOrigins;

    public ScaleFunction(ILogger<ScaleFunction> logger, TableStorageService tableStorage,
        AuthHelper authHelper, string[] allowedOrigins)
    {
        _logger = logger; _tableStorage = tableStorage;
        _authHelper = authHelper; _allowedOrigins = allowedOrigins;
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

            var entity = await _tableStorage.GetProductLookupAsync(itemNumber);
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
                itemNumber = entity.RowKey,
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
                var entities = await _tableStorage.ListProductLookupsAsync();
                var products = entities.Select(e => new
                {
                    itemNumber = e.RowKey,
                    plu = e.Plu,
                    productTitle = e.ProductTitle,
                    pricePerLb = e.PricePerLb,
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
                Plu = request.Plu,
                ProductTitle = request.ProductTitle,
                PricePerLb = request.PricePerLb,
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
