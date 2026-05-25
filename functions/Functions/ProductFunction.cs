using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class ProductFunction
{
    private readonly ILogger<ProductFunction> _logger;
    private readonly ShopifyService _shopify;
    private readonly TableStorageService _tableStorage;
    private readonly AuthHelper _authHelper;
    private readonly string[] _allowedOrigins;

    public ProductFunction(ILogger<ProductFunction> logger, ShopifyService shopify,
        TableStorageService tableStorage, AuthHelper authHelper, string[] allowedOrigins)
    {
        _logger = logger;
        _shopify = shopify;
        _tableStorage = tableStorage;
        _authHelper = authHelper;
        _allowedOrigins = allowedOrigins;
    }

    [Function("ProductLookup")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "product")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        var barcode = GetQueryParam(req, "barcode");
        if (string.IsNullOrWhiteSpace(barcode))
            return await ResponseHelper.WriteError(req, "barcode is required", HttpStatusCode.BadRequest, _allowedOrigins);

        try
        {
            var variant = await _shopify.GetVariantByBarcodeAsync(barcode);

            await _tableStorage.LogScanAsync("pos", barcode, variant != null ? "found" : "not_found");

            if (variant == null)
                return await ResponseHelper.WriteSuccess(req, new { found = false, scanned = barcode }, _allowedOrigins);

            return await ResponseHelper.WriteSuccess(req, new { found = true, variant }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Product lookup failed for barcode {Barcode}", barcode);
            return await ResponseHelper.WriteError(req, "Failed to look up product", HttpStatusCode.InternalServerError, _allowedOrigins);
        }
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
