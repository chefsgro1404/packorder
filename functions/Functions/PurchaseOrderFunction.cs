using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Models;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class PurchaseOrderFunction
{
    private readonly ILogger<PurchaseOrderFunction> _logger;
    private readonly TableStorageService _tableStorage;
    private readonly AuthHelper _authHelper;
    private readonly string[] _allowedOrigins;

    public PurchaseOrderFunction(
        ILogger<PurchaseOrderFunction> logger,
        TableStorageService tableStorage,
        AuthHelper authHelper,
        string[] allowedOrigins)
    {
        _logger = logger;
        _tableStorage = tableStorage;
        _authHelper = authHelper;
        _allowedOrigins = allowedOrigins;
    }

    // GET /api/purchase-orders — returns open + partial POs
    [Function("GetPurchaseOrders")]
    public async Task<HttpResponseData> GetPurchaseOrders(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "purchase-orders")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        var orders = await _tableStorage.GetOpenPurchaseOrdersAsync();
        var mapped = orders.Select(o => new
        {
            id                = o.RowKey,
            poId              = o.PoId,
            poName            = o.PoName,
            status            = o.Status,
            vendor            = o.Vendor,
            totalLineItems    = o.TotalLineItems,
            approvedLineItems = o.ApprovedLineItems,
            shopifyCreatedAt  = o.ShopifyCreatedAt,
            shopifyUpdatedAt  = o.ShopifyUpdatedAt,
        });
        return await ResponseHelper.WriteSuccess(req, mapped, _allowedOrigins);
    }

    // GET /api/purchase-orders/{id} — returns PO with its line items
    [Function("GetPurchaseOrderById")]
    public async Task<HttpResponseData> GetPurchaseOrderById(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "purchase-orders/{id}")]
        HttpRequestData req,
        string id)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        var po = await _tableStorage.GetPurchaseOrderByIdAsync(id);
        if (po == null)
            return await ResponseHelper.WriteError(req, "Purchase order not found", HttpStatusCode.NotFound, _allowedOrigins);

        var lineItems = await _tableStorage.GetPurchaseOrderLineItemsAsync(id);

        return await ResponseHelper.WriteSuccess(req, new
        {
            purchaseOrder = new
            {
                id                = po.RowKey,
                poId              = po.PoId,
                poName            = po.PoName,
                status            = po.Status,
                vendor            = po.Vendor,
                totalLineItems    = po.TotalLineItems,
                approvedLineItems = po.ApprovedLineItems,
                shopifyCreatedAt  = po.ShopifyCreatedAt,
                shopifyUpdatedAt  = po.ShopifyUpdatedAt,
            },
            lineItems = lineItems.Select(li => new
            {
                id               = li.RowKey,
                poId             = li.PartitionKey,
                lineItemId       = li.LineItemId,
                productTitle     = li.ProductTitle,
                variantTitle     = li.VariantTitle,
                variantId        = li.VariantId,
                sku              = li.Sku,
                quantityOrdered  = li.QuantityOrdered,
                quantityReceived = li.QuantityReceived,
                status           = li.Status,
                printedAt        = li.PrintedAt,
                printedBy        = li.PrintedBy,
            }),
        }, _allowedOrigins);
    }

    // POST /api/purchase-orders/approve — marks a line item approved after barcode print
    [Function("ApprovePurchaseOrderLineItem")]
    public async Task<HttpResponseData> ApprovePurchaseOrderLineItem(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "purchase-orders/approve")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (userId, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        ApprovePurchaseOrderLineItemRequest? body;
        try
        {
            var json = await new StreamReader(req.Body).ReadToEndAsync();
            body = JsonConvert.DeserializeObject<ApprovePurchaseOrderLineItemRequest>(json);
        }
        catch
        {
            return await ResponseHelper.WriteError(req, "Invalid request body", HttpStatusCode.BadRequest, _allowedOrigins);
        }

        if (body == null || string.IsNullOrWhiteSpace(body.PoId) || string.IsNullOrWhiteSpace(body.LineItemId))
            return await ResponseHelper.WriteError(req, "poId and lineItemId are required", HttpStatusCode.BadRequest, _allowedOrigins);

        if (body.QuantityReceived <= 0)
            return await ResponseHelper.WriteError(req, "quantityReceived must be > 0", HttpStatusCode.BadRequest, _allowedOrigins);

        var numericPoId = body.PoId.Contains('/') ? body.PoId.Split('/').Last() : body.PoId;
        var numericLineItemId = body.LineItemId.Contains('/') ? body.LineItemId.Split('/').Last() : body.LineItemId;

        var printedBy = string.IsNullOrWhiteSpace(body.PrintedBy) ? (userId ?? "unknown") : body.PrintedBy;

        var updated = await _tableStorage.ApprovePurchaseOrderLineItemAsync(
            numericPoId, numericLineItemId, body.QuantityReceived, printedBy, body.ForceApprove);

        if (updated == null)
            return await ResponseHelper.WriteError(req, "Line item not found", HttpStatusCode.NotFound, _allowedOrigins);

        await _tableStorage.CheckAndFulfillPurchaseOrderAsync(numericPoId);

        _logger.LogInformation("Approved PO {PoId} line item {LineItemId} qty={Qty} by {By}",
            numericPoId, numericLineItemId, body.QuantityReceived, printedBy);

        return await ResponseHelper.WriteSuccess(req, new
        {
            id               = updated.RowKey,
            poId             = updated.PartitionKey,
            lineItemId       = updated.LineItemId,
            productTitle     = updated.ProductTitle,
            variantTitle     = updated.VariantTitle,
            sku              = updated.Sku,
            quantityOrdered  = updated.QuantityOrdered,
            quantityReceived = updated.QuantityReceived,
            status           = updated.Status,
            printedAt        = updated.PrintedAt,
            printedBy        = updated.PrintedBy,
        }, _allowedOrigins);
    }
}
