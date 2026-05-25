using System.Net;
using System.Text.RegularExpressions;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Models;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class OrderListFunction
{
    private readonly ILogger<OrderListFunction> _logger;
    private readonly TableStorageService _tableStorage;
    private readonly AuthHelper _authHelper;
    private readonly string[] _allowedOrigins;

    public OrderListFunction(ILogger<OrderListFunction> logger, TableStorageService tableStorage,
        AuthHelper authHelper, string[] allowedOrigins)
    {
        _logger = logger;
        _tableStorage = tableStorage;
        _authHelper = authHelper;
        _allowedOrigins = allowedOrigins;
    }

    [Function("OrderList")]
    public async Task<HttpResponseData> List(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "orders")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var entities = await _tableStorage.GetAllUnfulfilledOrdersAsync();
            var orders = entities
                .OrderByDescending(e => e.CreatedAt)
                .Select(e => SerializeOrder(e))
                .ToList();

            return await ResponseHelper.WriteSuccess(req, new { orders, total = orders.Count }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load unfulfilled orders");
            return await ResponseHelper.WriteError(req, "Failed to load orders", HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("OrderSearch")]
    public async Task<HttpResponseData> SearchByBarcode(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "orders/search")]
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
            var request = JsonConvert.DeserializeObject<ScanSearchRequest>(body);
            var barcode = request?.Barcode?.Trim() ?? "";

            if (string.IsNullOrEmpty(barcode))
                return await ResponseHelper.WriteError(req, "barcode is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var parsed = ParseBarcode(barcode);

            // Find matching variantIds from product cache
            var productVariants = await _tableStorage.GetAllProductVariantsAsync();
            var matchingVariantIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var pv in productVariants)
            {
                // Exact barcode match
                if (!string.IsNullOrEmpty(pv.Barcode) && pv.Barcode.Equals(barcode, StringComparison.OrdinalIgnoreCase))
                    matchingVariantIds.Add(pv.VariantId);

                // PLU match (for variable weight barcodes)
                if (parsed.IsVariableWeight && parsed.Plu != null)
                {
                    if ((!string.IsNullOrEmpty(pv.Barcode) && pv.Barcode.Equals(parsed.Plu, StringComparison.OrdinalIgnoreCase)) ||
                        (!string.IsNullOrEmpty(pv.Sku) && pv.Sku.Equals(parsed.Plu, StringComparison.OrdinalIgnoreCase)))
                        matchingVariantIds.Add(pv.VariantId);
                }
            }

            // Also match by SKU if no variable weight
            if (!parsed.IsVariableWeight)
            {
                foreach (var pv in productVariants)
                {
                    if (!string.IsNullOrEmpty(pv.Sku) && pv.Sku.Equals(barcode, StringComparison.OrdinalIgnoreCase))
                        matchingVariantIds.Add(pv.VariantId);
                }
            }

            // Find matching orders
            var allOrders = await _tableStorage.GetAllUnfulfilledOrdersAsync();
            var matchedOrders = new List<object>();
            ProductVariantEntity? matchedProduct = null;

            if (matchingVariantIds.Count > 0)
            {
                matchedProduct = productVariants.FirstOrDefault(pv => matchingVariantIds.Contains(pv.VariantId));

                foreach (var orderEntity in allOrders)
                {
                    var lineItems = JsonConvert.DeserializeObject<List<OrderLineItemCache>>(orderEntity.LineItemsJson)
                        ?? new List<OrderLineItemCache>();

                    if (lineItems.Any(li => li.VariantId != null && matchingVariantIds.Contains(li.VariantId)))
                        matchedOrders.Add(SerializeOrder(orderEntity));
                }
            }

            // Log scan history
            _ = _tableStorage.LogScanHistoryAsync(new ScanHistoryEntity
            {
                Barcode           = barcode,
                Plu               = parsed.Plu,
                WeightGrams       = parsed.WeightGrams,
                IsVariableWeight  = parsed.IsVariableWeight,
                MatchedVariantId  = matchedProduct?.VariantId,
                ProductTitle      = matchedProduct?.ProductTitle,
                VariantTitle      = matchedProduct?.VariantTitle,
                Price             = matchedProduct?.Price
            });

            return await ResponseHelper.WriteSuccess(req, new
            {
                orders       = matchedOrders,
                plu          = parsed.Plu,
                weightGrams  = parsed.WeightGrams,
                isVariableWeight = parsed.IsVariableWeight,
                matchedProduct = matchedProduct == null ? null : new
                {
                    productTitle = matchedProduct.ProductTitle,
                    variantTitle = matchedProduct.VariantTitle,
                    sku          = matchedProduct.Sku,
                    imageUrl     = matchedProduct.ImageUrl
                }
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Order search by barcode failed");
            return await ResponseHelper.WriteError(req, "Search failed", HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private static object SerializeOrder(UnfulfilledOrderEntity e)
    {
        var lineItems = JsonConvert.DeserializeObject<List<OrderLineItemCache>>(e.LineItemsJson)
            ?? new List<OrderLineItemCache>();
        return new
        {
            orderId   = e.OrderId,
            orderName = e.OrderName,
            status    = e.Status,
            tags      = JsonConvert.DeserializeObject<List<string>>(e.Tags) ?? new List<string>(),
            createdAt = e.CreatedAt.ToString("o"),
            lineItems
        };
    }

    private static (bool IsVariableWeight, string? Plu, double? WeightGrams) ParseBarcode(string barcode)
    {
        // EAN-13 variable weight: starts with '2', exactly 13 digits
        if (barcode.Length == 13 && barcode[0] == '2' && Regex.IsMatch(barcode, @"^\d{13}$"))
        {
            var plu = barcode.Substring(1, 5);
            var rawWeight = int.Parse(barcode.Substring(6, 5));
            return (true, plu, (double)rawWeight);
        }
        return (false, null, null);
    }
}
