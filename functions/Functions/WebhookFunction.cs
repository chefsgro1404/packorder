using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Models;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class WebhookFunction
{
    private readonly ILogger<WebhookFunction> _logger;
    private readonly TableStorageService _tableStorage;
    private readonly string _webhookSecret;

    public WebhookFunction(ILogger<WebhookFunction> logger, TableStorageService tableStorage,
        IConfiguration config)
    {
        _logger = logger;
        _tableStorage = tableStorage;
        _webhookSecret = config["ShopifyWebhookSecret"]
            ?? throw new InvalidOperationException("ShopifyWebhookSecret required");
    }

    [Function("WebhookShopify")]
    public async Task<HttpResponseData> Handle(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "webhooks/shopify")]
        HttpRequestData req)
    {
        // Read raw bytes first — HMAC must be computed before any parsing
        using var ms = new MemoryStream();
        await req.Body.CopyToAsync(ms);
        var rawBody = ms.ToArray();

        if (!VerifyHmac(rawBody, req))
        {
            _logger.LogWarning("Shopify webhook HMAC verification failed");
            var denied = req.CreateResponse(HttpStatusCode.Unauthorized);
            return denied;
        }

        // Return 200 immediately — Shopify requires a response within 5 seconds
        var ok = req.CreateResponse(HttpStatusCode.OK);

        var topic = req.Headers.TryGetValues("X-Shopify-Topic", out var topicValues)
            ? topicValues.FirstOrDefault() ?? ""
            : "";

        var bodyJson = Encoding.UTF8.GetString(rawBody);

        // Fire-and-forget background processing
        _ = Task.Run(async () =>
        {
            try
            {
                switch (topic)
                {
                    case "products/create":
                    case "products/update":
                        await HandleProductUpsert(bodyJson);
                        break;

                    case "products/delete":
                        await HandleProductDelete(bodyJson);
                        break;

                    case "orders/create":
                    case "orders/updated":
                        await HandleOrderUpsert(bodyJson);
                        break;

                    case "orders/cancelled":
                    case "orders/fulfilled":
                    case "orders/partially_fulfilled":
                        await HandleOrderRemoveIfFulfilled(bodyJson);
                        break;

                    default:
                        _logger.LogInformation("Unhandled webhook topic: {Topic}", topic);
                        break;
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Webhook background processing failed for topic {Topic}", topic);
            }
        });

        return ok;
    }

    private async Task HandleProductUpsert(string bodyJson)
    {
        var product = JsonConvert.DeserializeObject<WebhookProduct>(bodyJson);
        if (product == null) return;

        var productGid = $"gid://shopify/Product/{product.Id}";
        var numericProductId = product.Id.ToString();
        var imageUrl = product.Images?.FirstOrDefault()?.Src;
        var tags = product.Tags
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(t => t.Trim())
            .Where(t => t.Length > 0)
            .ToList();
        var tagsJson = JsonConvert.SerializeObject(tags);

        var entities = product.Variants.Select(v => new ProductVariantEntity
        {
            PartitionKey = numericProductId,
            RowKey       = v.Id.ToString(),
            ProductId    = productGid,
            VariantId    = $"gid://shopify/ProductVariant/{v.Id}",
            ProductTitle = product.Title,
            VariantTitle = v.Title,
            Sku          = v.Sku,
            Barcode      = string.IsNullOrWhiteSpace(v.Barcode) ? null : v.Barcode,
            Vendor       = product.Vendor,
            Tags         = tagsJson,
            ImageUrl     = imageUrl,
            Price        = v.Price
        }).ToList();

        if (entities.Count > 0)
            await _tableStorage.BulkUpsertProductVariantsAsync(entities);

        _logger.LogInformation("Webhook upserted {Count} variants for product {ProductId}", entities.Count, product.Id);
    }

    private async Task HandleProductDelete(string bodyJson)
    {
        var payload = JsonConvert.DeserializeObject<WebhookDeletePayload>(bodyJson);
        if (payload == null) return;

        await _tableStorage.DeleteProductVariantsByProductIdAsync(payload.Id.ToString());
        _logger.LogInformation("Webhook deleted variants for product {ProductId}", payload.Id);
    }

    private async Task HandleOrderUpsert(string bodyJson)
    {
        var order = JsonConvert.DeserializeObject<WebhookOrder>(bodyJson);
        if (order == null) return;

        // Only cache orders that are not fully fulfilled
        if (order.FulfillmentStatus != null &&
            order.FulfillmentStatus.Equals("fulfilled", StringComparison.OrdinalIgnoreCase))
        {
            await _tableStorage.RemoveUnfulfilledOrderAsync(order.Id.ToString());
            _logger.LogInformation("Webhook: order {OrderId} is fulfilled — removed from cache", order.Id);
            return;
        }

        var tags = order.Tags
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(t => t.Trim())
            .Where(t => t.Length > 0)
            .ToList();

        var lineItems = order.LineItems.Select(li => new OrderLineItemCache
        {
            Id           = li.Id.ToString(),
            Name         = li.Name,
            Quantity     = li.Quantity,
            VariantId    = li.VariantId.HasValue
                               ? $"gid://shopify/ProductVariant/{li.VariantId.Value}"
                               : null,
            Sku          = li.Sku,
            ProductTitle = li.Title,
            VariantTitle = li.VariantTitle,
            Price        = li.Price
        }).ToList();

        var entity = new UnfulfilledOrderEntity
        {
            PartitionKey  = "order",
            RowKey        = order.Id.ToString(),
            OrderId       = $"gid://shopify/Order/{order.Id}",
            OrderName     = order.Name,
            Status        = order.FulfillmentStatus ?? "unfulfilled",
            Tags          = JsonConvert.SerializeObject(tags),
            LineItemsJson = JsonConvert.SerializeObject(lineItems),
            CreatedAt     = DateTimeOffset.TryParse(order.CreatedAt, out var dt) ? dt : DateTimeOffset.UtcNow
        };

        await _tableStorage.UpsertUnfulfilledOrderAsync(entity);
        _logger.LogInformation("Webhook upserted order {OrderId} ({OrderName})", order.Id, order.Name);
    }

    private async Task HandleOrderRemoveIfFulfilled(string bodyJson)
    {
        var order = JsonConvert.DeserializeObject<WebhookOrder>(bodyJson);
        if (order == null) return;

        // For partial fulfillment, update the cached entry rather than deleting it
        if (order.FulfillmentStatus != null &&
            order.FulfillmentStatus.Equals("partial", StringComparison.OrdinalIgnoreCase))
        {
            await HandleOrderUpsert(bodyJson);
            return;
        }

        await _tableStorage.RemoveUnfulfilledOrderAsync(order.Id.ToString());
        _logger.LogInformation("Webhook removed order {OrderId} from unfulfilled cache", order.Id);
    }

    private bool VerifyHmac(byte[] body, HttpRequestData req)
    {
        if (!req.Headers.TryGetValues("X-Shopify-Hmac-Sha256", out var values))
            return false;

        var hmacHeader = values.FirstOrDefault();
        if (string.IsNullOrEmpty(hmacHeader)) return false;

        try
        {
            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(_webhookSecret));
            var computed = hmac.ComputeHash(body);
            var headerBytes = Convert.FromBase64String(hmacHeader);
            return CryptographicOperations.FixedTimeEquals(computed, headerBytes);
        }
        catch
        {
            return false;
        }
    }
}
