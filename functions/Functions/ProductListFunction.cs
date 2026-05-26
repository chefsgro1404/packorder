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
            var search      = qs["search"]?.Trim();
            var vendor      = qs["vendor"]?.Trim();
            var hasBarcodeQ = qs["hasBarcode"]?.Trim(); // "yes" | "no" | absent
            var statusQ     = qs["status"]?.Trim().ToUpperInvariant(); // "ACTIVE" | "DRAFT" | "ARCHIVED" | absent

            var entities = await _tableStorage.GetAllProductVariantsAsync();
            var lastSync = await _tableStorage.GetLastSyncAsync();

            // Build vendor list from the full unfiltered set
            var vendors = entities
                .Select(e => e.Vendor)
                .Where(v => !string.IsNullOrEmpty(v))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(v => v)
                .ToList();

            // Apply filters
            IEnumerable<ProductVariantEntity> filtered = entities;

            if (!string.IsNullOrEmpty(vendor))
                filtered = filtered.Where(e => string.Equals(e.Vendor, vendor, StringComparison.OrdinalIgnoreCase));

            if (!string.IsNullOrEmpty(statusQ))
                filtered = filtered.Where(e => string.Equals(e.Status, statusQ, StringComparison.OrdinalIgnoreCase));

            if (hasBarcodeQ == "yes")
                filtered = filtered.Where(e => !string.IsNullOrEmpty(e.Barcode));
            else if (hasBarcodeQ == "no")
                filtered = filtered.Where(e => string.IsNullOrEmpty(e.Barcode));

            if (!string.IsNullOrEmpty(search))
            {
                var q = search.ToLowerInvariant();
                filtered = filtered.Where(e =>
                    (e.ProductTitle?.ToLowerInvariant().Contains(q) ?? false) ||
                    (e.VariantTitle?.ToLowerInvariant().Contains(q) ?? false) ||
                    (e.Sku?.ToLowerInvariant().Contains(q) ?? false) ||
                    (e.Barcode?.ToLowerInvariant().Contains(q) ?? false));
            }

            var filteredList = filtered.ToList();
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
}
