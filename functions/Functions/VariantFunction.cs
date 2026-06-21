using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Models;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class VariantFunction
{
    private readonly ILogger<VariantFunction> _logger;
    private readonly ShopifyService _shopify;
    private readonly TableStorageService _tableStorage;
    private readonly AuthHelper _authHelper;
    private readonly string[] _allowedOrigins;

    public VariantFunction(ILogger<VariantFunction> logger, ShopifyService shopify,
        TableStorageService tableStorage, AuthHelper authHelper, string[] allowedOrigins)
    {
        _logger = logger;
        _shopify = shopify;
        _tableStorage = tableStorage;
        _authHelper = authHelper;
        _allowedOrigins = allowedOrigins;
    }

    [Function("Variant")]
    public async Task<HttpResponseData> Handle(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "patch", "options", Route = "variant")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        if (req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
            return await Search(req);

        if (req.Method.Equals("PATCH", StringComparison.OrdinalIgnoreCase))
            return await UpdateBarcode(req);

        return req.CreateResponse(HttpStatusCode.MethodNotAllowed);
    }

    private async Task<HttpResponseData> Search(HttpRequestData req)
    {
        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        var q = GetQueryParam(req, "q");
        if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2)
            return await ResponseHelper.WriteSuccess(req, new { variants = Array.Empty<object>() }, _allowedOrigins);

        try
        {
            var byTitle = await _shopify.SearchVariantsByProductTitleAsync(q.Trim());
            var bySku = await _shopify.SearchVariantsBySkuAsync(q.Trim());

            var seen = new HashSet<string>();
            var variants = byTitle.Concat(bySku)
                .Where(v => seen.Add(v.Id))
                .ToList();

            return await ResponseHelper.WriteSuccess(req, new { variants }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Variant search error");
            return await ResponseHelper.WriteError(req, "Search failed", HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    private async Task<HttpResponseData> UpdateBarcode(HttpRequestData req)
    {
        var (userId, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var body = await req.ReadAsStringAsync() ?? "";
            var request = JsonConvert.DeserializeObject<UpdateBarcodeRequest>(body);

            if (string.IsNullOrWhiteSpace(request?.ProductId) ||
                string.IsNullOrWhiteSpace(request.VariantId) ||
                request.Barcode == null)
                return await ResponseHelper.WriteError(req,
                    "productId, variantId and barcode are required",
                    HttpStatusCode.BadRequest, _allowedOrigins);

            var barcode = request.Barcode.Trim();
            var cached = await _tableStorage.GetProductVariantAsync(request.ProductId, request.VariantId);
            var oldBarcode = cached?.Barcode;

            var variant = await _shopify.UpdateVariantBarcodeAsync(request.ProductId, request.VariantId, barcode);

            _ = _tableStorage.UpdateProductVariantBarcodeAsync(request.ProductId, request.VariantId, barcode);

            var action = string.IsNullOrEmpty(oldBarcode) && !string.IsNullOrEmpty(barcode) ? "added"
                : !string.IsNullOrEmpty(oldBarcode) && string.IsNullOrEmpty(barcode) ? "removed"
                : !string.IsNullOrEmpty(oldBarcode) && string.Equals(oldBarcode, barcode, StringComparison.OrdinalIgnoreCase) ? "rescanned"
                : "changed";

            _ = _tableStorage.LogBarcodeAuditAsync(new BarcodeAuditEntity
            {
                ProductId = request.ProductId,
                VariantId = request.VariantId,
                ProductTitle = cached?.ProductTitle ?? variant?["product"]?["title"]?.ToString() ?? "",
                VariantTitle = cached?.VariantTitle,
                Sku = cached?.Sku,
                OldBarcode = oldBarcode,
                NewBarcode = barcode,
                Action = action,
                AssignedBy = userId,
            });

            return await ResponseHelper.WriteSuccess(req, new { ok = true, variant }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Variant barcode update error");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    private async Task<HttpResponseData> AuditHistory(HttpRequestData req)
    {
        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var qs = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
            DateTimeOffset? from = DateTimeOffset.TryParse(qs["from"], out var f) ? f : null;
            DateTimeOffset? to   = DateTimeOffset.TryParse(qs["to"],   out var t) ? t : null;
            var productId  = qs["productId"];
            var variantId  = qs["variantId"];
            var assignedBy = qs["assignedBy"];

            var entities = await _tableStorage.ListBarcodeAuditsAsync(from, to, productId, variantId, assignedBy);
            var audits = entities.Select(e => new
            {
                id = e.RowKey,
                productId = e.ProductId,
                variantId = e.VariantId,
                productTitle = e.ProductTitle,
                variantTitle = e.VariantTitle,
                sku = e.Sku,
                oldBarcode = e.OldBarcode,
                newBarcode = e.NewBarcode,
                action = e.Action,
                assignedBy = e.AssignedBy,
                assignedAt = e.AssignedAt,
            }).ToList();

            return await ResponseHelper.WriteSuccess(req, new { audits, total = audits.Count }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Barcode audit history error");
            return await ResponseHelper.WriteError(req, "Failed to load audit history", HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("VariantAudit")]
    public async Task<HttpResponseData> HandleAudit(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "variant/audit")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        return await AuditHistory(req);
    }

    private static string? GetQueryParam(HttpRequestData req, string key)
    {
        var query = req.Url.Query.TrimStart('?');
        foreach (var part in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var kv = part.Split('=', 2);
            if (kv.Length == 2 && Uri.UnescapeDataString(kv[0]) == key)
                return Uri.UnescapeDataString(kv[1]);
        }
        return null;
    }
}
