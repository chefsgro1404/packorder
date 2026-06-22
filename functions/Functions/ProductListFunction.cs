using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Models;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class ProductListFunction
{
    private readonly ILogger<ProductListFunction> _logger;
    private readonly TableStorageService _tableStorage;
    private readonly AuthHelper _authHelper;
    private readonly string[] _allowedOrigins;

    public ProductListFunction(ILogger<ProductListFunction> logger, TableStorageService tableStorage,
        AuthHelper authHelper, string[] allowedOrigins)
    {
        _logger = logger;
        _tableStorage = tableStorage;
        _authHelper = authHelper;
        _allowedOrigins = allowedOrigins;
    }

    [Function("ProductList")]
    public async Task<HttpResponseData> Get(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "products")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var qs = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
            var page     = int.TryParse(qs["page"],     out var p)  ? Math.Max(1, p)          : 1;
            var pageSize = int.TryParse(qs["pageSize"], out var ps) ? Math.Clamp(ps, 1, 200)  : 50;

            var entities = await _tableStorage.GetAllProductVariantsAsync();
            var lastSync = await _tableStorage.GetLastSyncAsync();

            var vendors = BuildDistinctList(entities, e => new[] { e.Vendor });
            var collections = BuildDistinctList(entities,
                e => JsonConvert.DeserializeObject<List<string>>(e.Collections ?? "[]") ?? new List<string>());

            var filteredList = ApplyFilters(entities, qs);
            var missingCount = filteredList.Count(e => string.IsNullOrEmpty(e.Barcode));

            // Group by product — pagination is over products, not variants
            var grouped = filteredList
                .GroupBy(e => e.ProductId)
                .ToList();

            var total = grouped.Count;

            var pageProducts = grouped
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(g =>
                {
                    var first = g.First();
                    return new
                    {
                        productId    = first.ProductId,
                        productTitle = first.ProductTitle,
                        vendor       = first.Vendor,
                        imageUrl     = first.ImageUrl,
                        status       = first.Status,
                        tags         = JsonConvert.DeserializeObject<List<string>>(first.Tags ?? "[]") ?? new List<string>(),
                        collections  = JsonConvert.DeserializeObject<List<string>>(first.Collections ?? "[]") ?? new List<string>(),
                        variants     = g.Select(e => new
                        {
                            variantId    = e.VariantId,
                            variantTitle = e.VariantTitle,
                            sku          = e.Sku,
                            barcode      = e.Barcode,
                            price        = e.Price,
                        }).ToList(),
                    };
                })
                .ToList();

            return await ResponseHelper.WriteSuccess(req, new
            {
                products       = pageProducts,
                total,
                missingCount,
                totalInStorage = entities.Count,
                vendors,
                collections,
                page,
                pageSize,
                hasMore        = page * pageSize < total,
                lastSync       = lastSync?.LastSyncedAt.ToString("o"),
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load product list");
            return await ResponseHelper.WriteError(req, "Failed to load products", HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("ProductByVariant")]
    public async Task<HttpResponseData> GetByVariant(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "products/variant")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var qs = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
            var variantId = qs["variantId"] ?? "";
            if (string.IsNullOrWhiteSpace(variantId))
                return await ResponseHelper.WriteError(req, "variantId is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var entity = await _tableStorage.GetProductVariantByVariantIdAsync(variantId);
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
                barcode = entity.Barcode,
                price = entity.Price,
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load product by variant");
            return await ResponseHelper.WriteError(req, "Failed to load product", HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("ProductExport")]
    public async Task<HttpResponseData> Export(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "products/export")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var qs = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
            var entities = await _tableStorage.GetAllProductVariantsAsync();
            var filteredList = ApplyFilters(entities, qs);

            var rows = filteredList
                .OrderBy(e => e.ProductTitle, StringComparer.OrdinalIgnoreCase)
                .ThenBy(e => e.VariantTitle, StringComparer.OrdinalIgnoreCase)
                .Select(e => new
                {
                    productTitle = e.ProductTitle,
                    variantTitle = e.VariantTitle,
                    sku          = e.Sku ?? "",
                    barcode      = e.Barcode ?? "",
                    vendor       = e.Vendor,
                    status       = e.Status,
                    collections  = string.Join(", ", JsonConvert.DeserializeObject<List<string>>(e.Collections ?? "[]") ?? new List<string>()),
                })
                .ToList();

            return await ResponseHelper.WriteSuccess(req, new { rows, total = rows.Count }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to export products");
            return await ResponseHelper.WriteError(req, "Failed to export products", HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    private static List<string> BuildDistinctList(
        List<ProductVariantEntity> entities, Func<ProductVariantEntity, IEnumerable<string>> select)
    {
        return entities
            .SelectMany(select)
            .Where(v => !string.IsNullOrEmpty(v))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(v => v)
            .ToList();
    }

    private static List<ProductVariantEntity> ApplyFilters(
        List<ProductVariantEntity> entities, System.Collections.Specialized.NameValueCollection qs)
    {
        var search             = qs["search"]?.Trim();
        var vendor             = qs["vendor"]?.Trim();
        var hasBarcodeQ        = qs["hasBarcode"]?.Trim(); // "yes" | "no" | absent
        var statusQ            = qs["status"]?.Trim().ToUpperInvariant(); // "ACTIVE" | "DRAFT" | "ARCHIVED" | absent
        var includeCollections = SplitCsv(qs["collections"]);
        var excludeCollections = SplitCsv(qs["excludeCollections"]);

        IEnumerable<ProductVariantEntity> filtered = entities;

        if (!string.IsNullOrEmpty(vendor))
            filtered = filtered.Where(e => string.Equals(e.Vendor, vendor, StringComparison.OrdinalIgnoreCase));

        if (!string.IsNullOrEmpty(statusQ))
            filtered = filtered.Where(e => string.Equals(e.Status, statusQ, StringComparison.OrdinalIgnoreCase));

        if (hasBarcodeQ == "yes")
            filtered = filtered.Where(e => !string.IsNullOrEmpty(e.Barcode));
        else if (hasBarcodeQ == "no")
            filtered = filtered.Where(e => string.IsNullOrEmpty(e.Barcode));

        // Include: product must be in at least one of the selected collections.
        // Exclude: product must not be in any of the selected collections. Both can be applied together.
        if (includeCollections.Count > 0 || excludeCollections.Count > 0)
        {
            filtered = filtered.Where(e =>
            {
                var productCollections = JsonConvert.DeserializeObject<List<string>>(e.Collections ?? "[]") ?? new List<string>();
                if (includeCollections.Count > 0 &&
                    !productCollections.Any(c => includeCollections.Contains(c, StringComparer.OrdinalIgnoreCase)))
                    return false;
                if (excludeCollections.Count > 0 &&
                    productCollections.Any(c => excludeCollections.Contains(c, StringComparer.OrdinalIgnoreCase)))
                    return false;
                return true;
            });
        }

        if (!string.IsNullOrEmpty(search))
        {
            var q = search.ToLowerInvariant();
            filtered = filtered.Where(e =>
                (e.ProductTitle?.ToLowerInvariant().Contains(q) ?? false) ||
                (e.VariantTitle?.ToLowerInvariant().Contains(q) ?? false) ||
                (e.Sku?.ToLowerInvariant().Contains(q) ?? false) ||
                (e.Barcode?.ToLowerInvariant().Contains(q) ?? false));
        }

        return filtered.ToList();
    }

    private static List<string> SplitCsv(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return new List<string>();
        return value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
    }
}
