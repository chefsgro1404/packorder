using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class OrderFunction
{
    private readonly ILogger<OrderFunction> _logger;
    private readonly ShopifyService _shopify;
    private readonly AuthHelper _authHelper;
    private readonly string[] _allowedOrigins;

    public OrderFunction(ILogger<OrderFunction> logger, ShopifyService shopify,
        AuthHelper authHelper, string[] allowedOrigins)
    {
        _logger = logger;
        _shopify = shopify;
        _authHelper = authHelper;
        _allowedOrigins = allowedOrigins;
    }

    [Function("OrderLookup")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "order")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        var orderRef = GetQueryParam(req, "ref");
        if (string.IsNullOrWhiteSpace(orderRef))
            return await ResponseHelper.WriteError(req, "ref is required", HttpStatusCode.BadRequest, _allowedOrigins);

        try
        {
            var order = await _shopify.GetOrderByRefAsync(orderRef);
            if (order == null)
                return await ResponseHelper.WriteSuccess(req, new { found = false }, _allowedOrigins);

            return await ResponseHelper.WriteSuccess(req, new { found = true, order }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Order lookup failed for ref {Ref}", orderRef);
            return await ResponseHelper.WriteError(req, "Failed to look up order", HttpStatusCode.InternalServerError, _allowedOrigins);
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
