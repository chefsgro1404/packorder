using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using ShipScan.Functions.Helpers;
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
            var entities = await _tableStorage.GetAllProductVariantsAsync();
            var lastSync = await _tableStorage.GetLastSyncAsync();

            var variants = entities.Select(e => new
            {
                productId    = e.ProductId,
                variantId    = e.VariantId,
                productTitle = e.ProductTitle,
                variantTitle = e.VariantTitle,
                sku          = e.Sku,
                barcode      = e.Barcode,
                vendor       = e.Vendor,
                tags         = JsonConvert.DeserializeObject<List<string>>(e.Tags) ?? new List<string>(),
                imageUrl     = e.ImageUrl,
                price        = e.Price
            }).ToList();

            return await ResponseHelper.WriteSuccess(req, new
            {
                variants,
                lastSync = lastSync?.LastSyncedAt.ToString("o"),
                total = variants.Count
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load product list");
            return await ResponseHelper.WriteError(req, "Failed to load products", HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }
}
