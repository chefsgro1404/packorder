using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using ShipScan.Functions.Models;

namespace ShipScan.Functions.Services;

public class ShopifyService
{
    private readonly HttpClient _http;
    private readonly string _storeDomain;
    private readonly string _accessToken;
    private readonly string _apiVersion;
    private readonly ILogger<ShopifyService> _logger;

    public ShopifyService(IHttpClientFactory httpClientFactory, IConfiguration config, ILogger<ShopifyService> logger)
    {
        _http = httpClientFactory.CreateClient("shopify");
        _logger = logger;
        _storeDomain = config["ShopifyStoreDomain"] ?? throw new InvalidOperationException("ShopifyStoreDomain required");
        _accessToken = config["ShopifyAccessToken"] ?? throw new InvalidOperationException("ShopifyAccessToken required");
        _apiVersion = config["ShopifyApiVersion"] ?? "2025-01";
    }

    // ─── Core GraphQL request ────────────────────────────────────────────────

    private async Task<JObject> GraphQlAsync(string query, object? variables = null, int retries = 3, string? apiVersionOverride = null)
    {
        var version = apiVersionOverride ?? _apiVersion;
        var url = $"https://{_storeDomain}/admin/api/{version}/graphql.json";
        var body = JsonConvert.SerializeObject(new { query, variables });

        var delay = TimeSpan.FromSeconds(1);
        for (var attempt = 1; attempt <= retries; attempt++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, url);
            request.Headers.Add("X-Shopify-Access-Token", _accessToken);
            request.Content = new StringContent(body, Encoding.UTF8, "application/json");

            var response = await _http.SendAsync(request);

            if ((int)response.StatusCode == 429 && attempt < retries)
            {
                await Task.Delay(delay);
                delay = TimeSpan.FromSeconds(delay.TotalSeconds * 2);
                continue;
            }

            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadAsStringAsync();
            var result = JObject.Parse(json);

            var errors = result["errors"];
            if (errors != null && errors.Type != JTokenType.Null)
            {
                var msg = errors.Type == JTokenType.Array
                    ? string.Join(", ", errors.Select(e => e["message"]?.ToString()))
                    : errors.ToString();
                throw new Exception($"Shopify GraphQL error: {msg}");
            }

            return result["data"] as JObject ?? throw new Exception("Empty GraphQL response");
        }

        throw new Exception("Max Shopify retries exceeded");
    }

    // ─── Product lookup ──────────────────────────────────────────────────────

    private const string GetVariantByBarcodeQuery = @"
        query GetVariantByBarcode($barcode: String!) {
          productVariants(first: 1, query: $barcode) {
            edges {
              node {
                id sku barcode price title inventoryQuantity
                product {
                  id title
                  featuredImage { url altText }
                }
                inventoryItem {
                  measurement {
                    weight { value unit }
                  }
                }
              }
            }
          }
        }";

    public async Task<ProductVariant?> GetVariantByBarcodeAsync(string barcode)
    {
        // Try barcode field first, then SKU
        foreach (var q in new[] { $"barcode:{barcode}", $"sku:{barcode}" })
        {
            var data = await GraphQlAsync(GetVariantByBarcodeQuery, new { barcode = q });
            var edges = data["productVariants"]?["edges"];
            if (edges is JArray arr && arr.Count > 0)
                return arr[0]["node"]!.ToObject<ProductVariant>();
        }
        return null;
    }

    // ─── Order lookup ────────────────────────────────────────────────────────

    private const string GetOrderByRefQuery = @"
        query GetOrderByRef($query: String!) {
          orders(first: 1, query: $query) {
            edges {
              node {
                id name displayFulfillmentStatus tags
                lineItems(first: 20) {
                  edges { node { id name quantity variant { id sku } } }
                }
                metafield(namespace: ""shipping"", key: ""tracking_number"") { value }
                trackingCarrier: metafield(namespace: ""shipping"", key: ""tracking_carrier"") { value }
                trackingUrl: metafield(namespace: ""shipping"", key: ""tracking_url"") { value }
                shippingAddress { name address1 city provinceCode zip }
                fulfillmentOrders(first: 5) {
                  edges {
                    node {
                      id status
                      lineItems(first: 20) {
                        edges { node { id remainingQuantity } }
                      }
                    }
                  }
                }
              }
            }
          }
        }";

    public async Task<ShopifyOrder?> GetOrderByRefAsync(string orderRef)
    {
        var data = await GraphQlAsync(GetOrderByRefQuery, new { query = $"name:{orderRef} OR tag:{orderRef}" });
        var edges = data["orders"]?["edges"];
        if (edges is JArray arr && arr.Count > 0)
            return arr[0]["node"]!.ToObject<ShopifyOrder>();
        return null;
    }

    // ─── Draft order ─────────────────────────────────────────────────────────

    private const string CreateDraftOrderMutation = @"
        mutation CreateDraftOrder($input: DraftOrderInput!) {
          draftOrderCreate(input: $input) {
            draftOrder {
              id name totalPrice
              lineItems(first: 50) {
                edges { node { id title quantity variant { id price } } }
              }
            }
            userErrors { field message }
          }
        }";

    public async Task<DraftOrder> CreateDraftOrderAsync(string variantId, int quantity)
    {
        var data = await GraphQlAsync(CreateDraftOrderMutation, new
        {
            input = new { lineItems = new[] { new { variantId, quantity } } }
        });

        var errors = data["draftOrderCreate"]?["userErrors"]?.ToObject<List<GraphQlUserError>>();
        if (errors?.Any() == true)
            throw new Exception(errors[0].Message);

        return data["draftOrderCreate"]!["draftOrder"]!.ToObject<DraftOrder>()!;
    }

    private const string UpdateDraftOrderMutation = @"
        mutation UpdateDraftOrder($id: ID!, $input: DraftOrderInput!) {
          draftOrderUpdate(id: $id, input: $input) {
            draftOrder {
              id name totalPrice
              lineItems(first: 50) {
                edges { node { id title quantity variant { id price } } }
              }
            }
            userErrors { field message }
          }
        }";

    public async Task<DraftOrder> UpdateDraftOrderAsync(string draftOrderId, List<DraftOrderLineItemInput> lineItems)
    {
        var data = await GraphQlAsync(UpdateDraftOrderMutation, new
        {
            id = draftOrderId,
            input = new { lineItems = lineItems.Select(li => new { variantId = li.VariantId, quantity = li.Quantity }) }
        });

        var errors = data["draftOrderUpdate"]?["userErrors"]?.ToObject<List<GraphQlUserError>>();
        if (errors?.Any() == true)
            throw new Exception(errors[0].Message);

        return data["draftOrderUpdate"]!["draftOrder"]!.ToObject<DraftOrder>()!;
    }

    private const string CompleteDraftOrderMutation = @"
        mutation CompleteDraftOrder($id: ID!) {
          draftOrderComplete(id: $id) {
            draftOrder { id order { id name } }
            userErrors { field message }
          }
        }";

    public async Task<JObject> CompleteDraftOrderAsync(string draftOrderId)
    {
        var data = await GraphQlAsync(CompleteDraftOrderMutation, new { id = draftOrderId });

        var errors = data["draftOrderComplete"]?["userErrors"]?.ToObject<List<GraphQlUserError>>();
        if (errors?.Any() == true)
            throw new Exception(errors[0].Message);

        return data["draftOrderComplete"]!["draftOrder"] as JObject
               ?? throw new Exception("Null draftOrder in response");
    }

    // ─── Fulfillment ─────────────────────────────────────────────────────────

    private const string FulfillOrderMutation = @"
        mutation FulfillOrder($fulfillment: FulfillmentV2Input!) {
          fulfillmentCreateV2(fulfillment: $fulfillment) {
            fulfillment {
              id status
              trackingInfo { number url company }
            }
            userErrors { field message }
          }
        }";

    public async Task<JObject> FulfillOrderAsync(
        string fulfillmentOrderId,
        List<FulfillmentOrderLineItem> lineItems,
        string trackingNumber,
        string trackingUrl,
        string trackingCarrier)
    {
        var data = await GraphQlAsync(FulfillOrderMutation, new
        {
            fulfillment = new
            {
                lineItemsByFulfillmentOrder = new[]
                {
                    new
                    {
                        fulfillmentOrderId,
                        fulfillmentOrderLineItems = lineItems
                            .Where(li => li.RemainingQuantity > 0)
                            .Select(li => new { id = li.Id, quantity = li.RemainingQuantity })
                    }
                },
                trackingInfo = new
                {
                    number = trackingNumber,
                    url = trackingUrl,
                    company = string.IsNullOrEmpty(trackingCarrier) ? "Other" : trackingCarrier
                },
                notifyCustomer = true
            }
        });

        var errors = data["fulfillmentCreateV2"]?["userErrors"]?.ToObject<List<GraphQlUserError>>();
        if (errors?.Any() == true)
            throw new Exception(errors[0].Message);

        return data["fulfillmentCreateV2"]!["fulfillment"] as JObject
               ?? throw new Exception("Null fulfillment in response");
    }

    // ─── Variant search ──────────────────────────────────────────────────────

    private const string SearchProductsQuery = @"
        query SearchProducts($query: String!) {
          products(first: 15, query: $query) {
            edges {
              node {
                id title
                featuredImage { url altText }
                variants(first: 20) {
                  edges { node { id sku barcode title } }
                }
              }
            }
          }
        }";

    public async Task<List<VariantSearchResult>> SearchVariantsByProductTitleAsync(string query)
    {
        var data = await GraphQlAsync(SearchProductsQuery, new { query = $"title:{query}*" });
        var results = new List<VariantSearchResult>();

        var products = data["products"]?["edges"] as JArray ?? new JArray();
        foreach (var productEdge in products)
        {
            var product = productEdge["node"]!;
            var productInfo = new ProductInfo
            {
                Id = product["id"]!.ToString(),
                Title = product["title"]!.ToString(),
                FeaturedImage = product["featuredImage"]?.ToObject<ProductImage>()
            };

            var variantEdges = product["variants"]?["edges"] as JArray ?? new JArray();
            foreach (var variantEdge in variantEdges)
            {
                var node = variantEdge["node"]!;
                results.Add(new VariantSearchResult
                {
                    Id = node["id"]!.ToString(),
                    Sku = node["sku"]?.ToString(),
                    Barcode = node["barcode"]?.ToString(),
                    Title = node["title"]?.ToString() ?? "Default Title",
                    Product = productInfo
                });
            }
        }

        return results;
    }

    private const string SearchVariantsBySkuQuery = @"
        query SearchVariantsBySku($query: String!) {
          productVariants(first: 20, query: $query) {
            edges {
              node {
                id sku barcode title
                product {
                  id title
                  featuredImage { url altText }
                }
              }
            }
          }
        }";

    public async Task<List<VariantSearchResult>> SearchVariantsBySkuAsync(string sku)
    {
        var data = await GraphQlAsync(SearchVariantsBySkuQuery, new { query = $"sku:{sku}*" });
        var edges = data["productVariants"]?["edges"] as JArray ?? new JArray();
        return edges.Select(e => e["node"]!.ToObject<VariantSearchResult>()!).ToList();
    }

    // ─── Unfulfilled order sync ──────────────────────────────────────────────

    private const string SyncOrdersQuery = @"
        query SyncOrders($cursor: String) {
          orders(
            first: 250
            after: $cursor
            query: ""fulfillment_status:unfulfilled OR fulfillment_status:partial""
            sortKey: CREATED_AT
            reverse: true
          ) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id name displayFulfillmentStatus tags createdAt
                lineItems(first: 30) {
                  edges {
                    node {
                      id name quantity
                      originalTotalSet { shopMoney { amount } }
                      variant {
                        id sku
                        product { title featuredImage { url } }
                      }
                    }
                  }
                }
              }
            }
          }
        }";

    public async Task<List<Models.UnfulfilledOrderEntity>> FetchUnfulfilledOrdersAsync()
    {
        var results = new List<Models.UnfulfilledOrderEntity>();
        string? cursor = null;
        bool hasMore = true;

        while (hasMore)
        {
            var data = await GraphQlAsync(SyncOrdersQuery, new { cursor });
            var orders = data["orders"];
            var pageInfo = orders?["pageInfo"];
            hasMore = pageInfo?["hasNextPage"]?.Value<bool>() ?? false;
            cursor = pageInfo?["endCursor"]?.ToString();

            foreach (var edge in (orders?["edges"] as JArray) ?? new JArray())
            {
                var order = edge["node"]!;
                var orderId = order["id"]!.ToString();
                var rawTags = order["tags"]?.ToObject<List<string>>() ?? new List<string>();
                var lineItems = new List<Models.OrderLineItemCache>();

                foreach (var li in (order["lineItems"]?["edges"] as JArray) ?? new JArray())
                {
                    var node = li["node"]!;

                    // variant can be JSON null (custom line items / deleted variants)
                    var variantToken = node["variant"];
                    var variant = variantToken != null && variantToken.Type != JTokenType.Null
                        ? variantToken : null;

                    // originalTotalSet can also be null; guard before drilling in
                    var totalSetToken = node["originalTotalSet"];
                    var price = totalSetToken != null && totalSetToken.Type != JTokenType.Null
                        ? totalSetToken["shopMoney"]?["amount"]?.ToString() ?? "0.00"
                        : "0.00";

                    // featuredImage can be null on products without images
                    var productToken = variant?["product"];
                    var product = productToken != null && productToken.Type != JTokenType.Null
                        ? productToken : null;
                    var featuredImageToken = product?["featuredImage"];
                    var imageUrl = featuredImageToken != null && featuredImageToken.Type != JTokenType.Null
                        ? featuredImageToken["url"]?.ToString() : null;

                    lineItems.Add(new Models.OrderLineItemCache
                    {
                        Id           = node["id"]!.ToString(),
                        Name         = node["name"]?.ToString() ?? "",
                        Quantity     = node["quantity"]?.Value<int>() ?? 0,
                        VariantId    = variant?["id"]?.ToString(),
                        Sku          = variant?["sku"]?.ToString(),
                        ProductTitle = product?["title"]?.ToString() ?? node["name"]?.ToString() ?? "",
                        VariantTitle = null,
                        ImageUrl     = imageUrl,
                        Price        = price
                    });
                }

                results.Add(new Models.UnfulfilledOrderEntity
                {
                    PartitionKey  = "order",
                    RowKey        = orderId.Split('/').Last(),
                    OrderId       = orderId,
                    OrderName     = order["name"]!.ToString(),
                    Status        = order["displayFulfillmentStatus"]?.ToString() ?? "",
                    Tags          = JsonConvert.SerializeObject(rawTags),
                    LineItemsJson = JsonConvert.SerializeObject(lineItems),
                    CreatedAt     = DateTimeOffset.TryParse(order["createdAt"]?.ToString(), out var dt) ? dt : DateTimeOffset.UtcNow
                });
            }
        }

        return results;
    }

    // ─── Product catalog sync ────────────────────────────────────────────────

    private const string SyncProductsQuery = @"
        query SyncProducts($query: String, $cursor: String) {
          products(first: 250, query: $query, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id title vendor tags status updatedAt
                featuredImage { url }
                collections(first: 10) {
                  edges { node { title } }
                }
                weightRanges: metafield(namespace: ""custom"", key: ""weight_ranges"") { id value }
                variants(first: 100) {
                  edges { node { id sku barcode title price } }
                }
              }
            }
          }
        }";

    public async Task<List<Models.ProductVariantEntity>> FetchAllProductVariantsAsync(string? shopifyQuery = null)
    {
        var results = new List<Models.ProductVariantEntity>();
        string? cursor = null;
        bool hasMore = true;

        while (hasMore)
        {
            var data = await GraphQlAsync(SyncProductsQuery, new { query = shopifyQuery, cursor });
            var products = data["products"];
            var pageInfo = products?["pageInfo"];
            hasMore = pageInfo?["hasNextPage"]?.Value<bool>() ?? false;
            cursor = pageInfo?["endCursor"]?.ToString();

            foreach (var edge in (products?["edges"] as JArray) ?? new JArray())
            {
                var product = edge["node"]!;
                var productId = product["id"]!.ToString();
                var numericProductId = productId.Split('/').Last();
                var productTitle = product["title"]!.ToString();
                var vendor = product["vendor"]?.ToString() ?? "";
                var status = product["status"]?.ToString() ?? "ACTIVE";
                var rawTags = product["tags"]?.ToObject<List<string>>() ?? new List<string>();
                var tagsJson = JsonConvert.SerializeObject(rawTags);
                var rawCollections = ((product["collections"]?["edges"] as JArray) ?? new JArray())
                    .Select(e => e["node"]?["title"]?.ToString())
                    .Where(t => !string.IsNullOrEmpty(t))
                    .ToList();
                var collectionsJson = JsonConvert.SerializeObject(rawCollections);
                var featuredImageToken = product["featuredImage"];
                var imageUrl = featuredImageToken != null && featuredImageToken.Type != JTokenType.Null
                    ? featuredImageToken["url"]?.ToString() : null;

                var weightRangesMeta = product["weightRanges"];
                var weightRangesRaw = weightRangesMeta != null && weightRangesMeta.Type != JTokenType.Null
                    ? weightRangesMeta["value"]?.ToString() : null;
                string weightRangesJson = "[]";
                if (!string.IsNullOrWhiteSpace(weightRangesRaw))
                {
                    try { JArray.Parse(weightRangesRaw); weightRangesJson = weightRangesRaw; }
                    catch { }
                }

                foreach (var ve in (product["variants"]?["edges"] as JArray) ?? new JArray())
                {
                    var v = ve["node"]!;
                    var variantId = v["id"]!.ToString();
                    results.Add(new Models.ProductVariantEntity
                    {
                        PartitionKey = numericProductId,
                        RowKey = variantId.Split('/').Last(),
                        ProductId = productId,
                        VariantId = variantId,
                        ProductTitle = productTitle,
                        VariantTitle = v["title"]?.ToString() ?? "Default Title",
                        Sku = v["sku"]?.ToString(),
                        Barcode = string.IsNullOrWhiteSpace(v["barcode"]?.ToString()) ? null : v["barcode"]!.ToString(),
                        Vendor = vendor,
                        Status = status,
                        Tags = tagsJson,
                        Collections = collectionsJson,
                        WeightRanges = weightRangesJson,
                        ImageUrl = imageUrl,
                        Price = v["price"]?.ToString() ?? "0.00"
                    });
                }
            }
        }

        return results;
    }

    // ─── Product weight ranges (custom.weight_ranges metafield) ─────────────

    private const string GetProductWeightRangesQuery = @"
        query GetProductWeightRanges($productId: ID!) {
          product(id: $productId) {
            id
            weightRanges: metafield(namespace: ""custom"", key: ""weight_ranges"") { id value }
          }
        }";

    private const string SetMetafieldsMutation = @"
        mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { id key namespace value }
            userErrors { field message }
          }
        }";

    /// <summary>
    /// Returns the raw weight_ranges JSON for a product (live Shopify fetch).
    /// </summary>
    public async Task<string?> GetProductWeightRangesRawAsync(string productId)
    {
        var gid = productId.StartsWith("gid://") ? productId : $"gid://shopify/Product/{productId}";
        try
        {
            var data = await GraphQlAsync(GetProductWeightRangesQuery, new { productId = gid });
            var meta = data["product"]?["weightRanges"];
            if (meta == null || meta.Type == JTokenType.Null) return null;
            return meta["value"]?.ToString();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to fetch weight_ranges for product {ProductId}", productId);
            return null;
        }
    }

    /// <summary>
    /// Saves weight_ranges JSON to Shopify via metafieldsSet mutation.
    /// </summary>
    public async Task SetProductWeightRangesAsync(string productId, string weightRangesJson)
    {
        var gid = productId.StartsWith("gid://") ? productId : $"gid://shopify/Product/{productId}";
        var data = await GraphQlAsync(SetMetafieldsMutation, new
        {
            metafields = new[]
            {
                new
                {
                    ownerId          = gid,
                    @namespace       = "custom",
                    key              = "weight_ranges",
                    type             = "json",
                    value            = weightRangesJson,
                }
            }
        });
        var errors = data["metafieldsSet"]?["userErrors"]?.ToObject<List<GraphQlUserError>>();
        if (errors?.Any() == true)
            throw new Exception($"metafieldsSet error: {errors[0].Message}");
    }

    // ─── Variant barcode update ──────────────────────────────────────────────

    private const string UpdateVariantBarcodeMutation = @"
        mutation UpdateVariantBarcode($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants {
              id barcode sku title
              product { title }
            }
            userErrors { field message }
          }
        }";

    public async Task<JObject> UpdateVariantBarcodeAsync(string productId, string variantId, string barcode)
    {
        var data = await GraphQlAsync(UpdateVariantBarcodeMutation, new
        {
            productId,
            variants = new[] { new { id = variantId, barcode } }
        });

        var errors = data["productVariantsBulkUpdate"]?["userErrors"]?.ToObject<List<GraphQlUserError>>();
        if (errors?.Any() == true)
            throw new Exception(errors[0].Message);

        var variants = data["productVariantsBulkUpdate"]?["productVariants"] as JArray;
        return variants?[0] as JObject ?? throw new Exception("No variant returned");
    }

    // ─── Fulfilled orders with tracking (Ship Mode sync) ────────────────────────

    private const string ShipOrderFields = @"
        id name displayFulfillmentStatus tags createdAt
        customer { displayName email }
        shippingAddress { name address1 city provinceCode zip country }
        lineItems(first: 30) {
          edges {
            node {
              id name sku quantity
              originalTotalSet { shopMoney { amount } }
              variant {
                id barcode title
                product { title featuredImage { url } }
              }
            }
          }
        }
        fulfillments {
          id status createdAt
          trackingInfo(first: 5) { number url company }
          fulfillmentLineItems(first: 30) {
            edges {
              node {
                id quantity
                lineItem {
                  id name sku quantity
                  originalTotalSet { shopMoney { amount } }
                  variant {
                    id barcode title
                    product { title featuredImage { url } }
                  }
                }
              }
            }
          }
        }";

    private const string SyncFulfilledOrdersQuery = @"
        query SyncFulfilledOrders($cursor: String, $query: String!) {
          orders(
            first: 100
            after: $cursor
            query: $query
            sortKey: CREATED_AT
            reverse: true
          ) {
            pageInfo { hasNextPage endCursor }
            edges { node { " + ShipOrderFields + @" } }
          }
        }";

    private const string GetShipOrderByRefQuery = @"
        query GetShipOrderByRef($query: String!) {
          orders(first: 1, query: $query) {
            edges { node { " + ShipOrderFields + @" } }
          }
        }";

    /// <summary>
    /// Fetches fulfilled/partial, non-POS orders whose `updatedAt` falls within [from-1day, to+1day]
    /// (a 1-day buffer covers timezone differences between our UTC date range and Shopify's stored
    /// timestamps), then narrows to fulfillments whose own `createdAt` falls within [from, to] and
    /// have tracking info. Scoping the Shopify-side query by `updated_at` avoids paginating through
    /// the store's entire fulfillment history on every sync.
    /// </summary>
    public async Task<List<FulfillmentShipmentEntity>> FetchFulfilledOrdersWithTrackingAsync(DateTime from, DateTime to)
    {
        var results = new List<FulfillmentShipmentEntity>();
        string? cursor = null;
        bool hasMore = true;
        var page = 0;
        var totalOrders = 0;

        var updatedFrom = from.AddDays(-1).ToString("yyyy-MM-dd");
        var updatedTo = to.AddDays(1).ToString("yyyy-MM-dd");
        var searchQuery = $"(fulfillment_status:fulfilled OR fulfillment_status:partial) -source_name:pos AND updated_at:>='{updatedFrom}' AND updated_at:<='{updatedTo}'";

        _logger.LogInformation("FetchFulfilledOrdersWithTracking: starting Shopify query \"{Query}\"", searchQuery);

        while (hasMore)
        {
            page++;
            var data = await GraphQlAsync(SyncFulfilledOrdersQuery, new { cursor, query = searchQuery });
            var orders = data["orders"];
            var pageInfo = orders?["pageInfo"];
            hasMore = pageInfo?["hasNextPage"]?.Value<bool>() ?? false;
            cursor = pageInfo?["endCursor"]?.ToString();

            var edges = (orders?["edges"] as JArray) ?? new JArray();
            totalOrders += edges.Count;
            _logger.LogInformation("FetchFulfilledOrdersWithTracking: page {Page} returned {OrderCount} orders (hasNextPage={HasMore})",
                page, edges.Count, hasMore);

            results.AddRange(ParseFulfillmentEntities(edges));
        }

        _logger.LogInformation("FetchFulfilledOrdersWithTracking: {OrderCount} order(s) matched fulfillment_status filter, {FulfillmentCount} fulfillment(s) had tracking info and were returned",
            totalOrders, results.Count);

        return results;
    }

    /// <summary>
    /// Looks up a single order by name or tag for the Ship Mode search bar. Returns whether the
    /// order exists, its display fulfillment status, and any eligible fulfillment shipments.
    /// For unfulfilled orders a synthetic entry is built from the order's own line items so
    /// the packer can still select and pre-scan the order.
    /// </summary>
    public async Task<(bool Found, string? OrderName, string? DisplayFulfillmentStatus, bool IsUnfulfilled, List<FulfillmentShipmentEntity> Entities)>
        GetShipOrderByRefAsync(string orderRef)
    {
        var data = await GraphQlAsync(GetShipOrderByRefQuery, new { query = $"(name:{orderRef} OR tag:{orderRef}) -source_name:pos" });
        var edges = data["orders"]?["edges"] as JArray;
        if (edges == null || edges.Count == 0)
            return (false, null, null, false, new List<FulfillmentShipmentEntity>());

        var node = edges[0]["node"]!;
        var orderId = node["id"]!.ToString();
        var orderName = node["name"]?.ToString();
        var displayStatus = node["displayFulfillmentStatus"]?.ToString();
        var entities = ParseFulfillmentEntities(edges);

        bool isUnfulfilled = false;
        if (entities.Count == 0 && displayStatus == "UNFULFILLED")
        {
            var synthetic = BuildSyntheticFulfillmentEntity(node, orderId, orderName ?? "");
            if (synthetic != null)
            {
                entities.Add(synthetic);
                isUnfulfilled = true;
            }
        }

        return (true, orderName, displayStatus, isUnfulfilled, entities);
    }

    private FulfillmentShipmentEntity? BuildSyntheticFulfillmentEntity(JToken orderNode, string orderId, string orderName)
    {
        var lineItemEdges = orderNode["lineItems"]?["edges"] as JArray ?? new JArray();
        if (lineItemEdges.Count == 0) return null;

        var tags = orderNode["tags"]?.ToObject<List<string>>() ?? new List<string>();
        var customer = orderNode["customer"];
        var customerName  = customer != null && customer.Type != JTokenType.Null ? customer["displayName"]?.ToString() : null;
        var customerEmail = customer != null && customer.Type != JTokenType.Null ? customer["email"]?.ToString() : null;
        var shippingAddrToken = orderNode["shippingAddress"];
        var shippingAddressJson = shippingAddrToken != null && shippingAddrToken.Type != JTokenType.Null
            ? shippingAddrToken.ToString(Formatting.None) : null;
        var numericOrderId = orderId.Split('/').Last();

        var lineItems = new List<ShipmentLineItemCache>();
        foreach (var edge in lineItemEdges)
        {
            var li = edge["node"]!;
            var variantToken = li["variant"];
            var variant = variantToken != null && variantToken.Type != JTokenType.Null ? variantToken : null;
            var productToken = variant?["product"];
            var product = productToken != null && productToken.Type != JTokenType.Null ? productToken : null;
            var featImgToken = product?["featuredImage"];
            var imageUrl = featImgToken != null && featImgToken.Type != JTokenType.Null ? featImgToken["url"]?.ToString() : null;
            var rawVarTitle = variant?["title"]?.ToString();
            var variantTitle = rawVarTitle == "Default Title" ? null : rawVarTitle;
            var productTitle = product?["title"]?.ToString() ?? li["name"]?.ToString() ?? "";
            var price = li["originalTotalSet"]?["shopMoney"]?["amount"]?.ToString() ?? "0.00";

            lineItems.Add(new ShipmentLineItemCache
            {
                FulfillmentLineItemId = li["id"]!.ToString(),
                LineItemId   = li["id"]!.ToString(),
                Name         = li["name"]?.ToString() ?? "",
                QuantityExpected = li["quantity"]?.Value<int>() ?? 0,
                QuantityShipped  = 0,
                ProductId    = product?["id"]?.ToString(),
                VariantId    = variant?["id"]?.ToString(),
                Sku          = li["sku"]?.ToString(),
                Barcode      = variant?["barcode"]?.ToString(),
                ProductTitle = productTitle,
                VariantTitle = variantTitle,
                ImageUrl     = imageUrl,
                Price        = price,
            });
        }

        if (lineItems.Count == 0) return null;

        var syntheticId = $"order-{numericOrderId}";
        return new FulfillmentShipmentEntity
        {
            PartitionKey             = "ship",
            RowKey                   = syntheticId,
            OrderId                  = orderId,
            OrderName                = orderName,
            OrderTags                = JsonConvert.SerializeObject(tags),
            OrderCreatedAt           = orderNode["createdAt"]?.ToString() ?? "",
            CustomerName             = customerName,
            CustomerEmail            = customerEmail,
            ShippingAddressJson      = shippingAddressJson,
            FulfillmentId            = syntheticId,
            TrackingNumber           = "",
            TrackingCarrier          = null,
            TrackingUrl              = null,
            ShopifyFulfillmentStatus = "UNFULFILLED",
            Status                   = "pending",
            LineItemsJson            = JsonConvert.SerializeObject(lineItems),
            FulfillmentCreatedAt     = DateTimeOffset.UtcNow,
        };
    }

    private List<FulfillmentShipmentEntity> ParseFulfillmentEntities(JArray edges)
    {
        var results = new List<FulfillmentShipmentEntity>();
        foreach (var edge in edges)
        {
                var order = edge["node"]!;
                var orderId   = order["id"]!.ToString();
                var orderName = order["name"]!.ToString();
                var tags      = order["tags"]?.ToObject<List<string>>() ?? new List<string>();

                var customer      = order["customer"];
                var customerName  = customer != null && customer.Type != JTokenType.Null ? customer["displayName"]?.ToString() : null;
                var customerEmail = customer != null && customer.Type != JTokenType.Null ? customer["email"]?.ToString() : null;

                var shippingAddrToken   = order["shippingAddress"];
                var shippingAddressJson = shippingAddrToken != null && shippingAddrToken.Type != JTokenType.Null
                    ? shippingAddrToken.ToString(Formatting.None) : null;

                var fulfillments = order["fulfillments"] as JArray ?? new JArray();
                if (fulfillments.Count == 0)
                {
                    _logger.LogInformation("ParseFulfillmentEntities: order {OrderName} (status={Status}) has no fulfillments, skipping",
                        orderName, order["displayFulfillmentStatus"]?.ToString());
                    continue;
                }

                foreach (var fulfillment in fulfillments)
                {
                    var trackingArray = fulfillment["trackingInfo"] as JArray ?? new JArray();
                    var firstTracking = trackingArray.FirstOrDefault(t => !string.IsNullOrEmpty(t["number"]?.ToString()));
                    if (firstTracking == null)
                        _logger.LogInformation("ParseFulfillmentEntities: order {OrderName} fulfillment {FulfillmentId} (status={Status}) has no tracking number — including anyway",
                            orderName, fulfillment["id"]?.ToString(), fulfillment["status"]?.ToString());

                    var trackingNumber  = firstTracking?["number"]?.ToString();
                    var trackingCarrier = firstTracking?["company"]?.ToString();
                    var trackingUrl     = firstTracking?["url"]?.ToString();
                    var fulfillmentId        = fulfillment["id"]!.ToString();
                    var numericFulfillmentId = fulfillmentId.Split('/').Last();

                    var lineItems = new List<ShipmentLineItemCache>();
                    foreach (var fliEdge in (fulfillment["fulfillmentLineItems"]?["edges"] as JArray) ?? new JArray())
                    {
                        var fliNode  = fliEdge["node"]!;
                        var lineItem = fliNode["lineItem"];
                        if (lineItem == null || lineItem.Type == JTokenType.Null) continue;

                        var variantToken  = lineItem["variant"];
                        var variant       = variantToken != null && variantToken.Type != JTokenType.Null ? variantToken : null;
                        var productToken  = variant?["product"];
                        var product       = productToken != null && productToken.Type != JTokenType.Null ? productToken : null;
                        var featImgToken  = product?["featuredImage"];
                        var imageUrl      = featImgToken != null && featImgToken.Type != JTokenType.Null
                            ? featImgToken["url"]?.ToString() : null;

                        var rawVarTitle  = variant?["title"]?.ToString();
                        var variantTitle = rawVarTitle == "Default Title" ? null : rawVarTitle;
                        var productTitle = product?["title"]?.ToString() ?? lineItem["name"]?.ToString() ?? "";

                        var totalSetToken = lineItem["originalTotalSet"];
                        var price = totalSetToken != null && totalSetToken.Type != JTokenType.Null
                            ? totalSetToken["shopMoney"]?["amount"]?.ToString() ?? "0.00" : "0.00";

                        lineItems.Add(new ShipmentLineItemCache
                        {
                            FulfillmentLineItemId = fliNode["id"]!.ToString(),
                            LineItemId   = lineItem["id"]?.ToString() ?? "",
                            Name         = lineItem["name"]?.ToString() ?? "",
                            QuantityExpected = fliNode["quantity"]?.Value<int>() ?? 0,
                            QuantityShipped  = 0,
                            ProductId    = product?["id"]?.ToString(),
                            VariantId    = variant?["id"]?.ToString(),
                            Sku          = lineItem["sku"]?.ToString(),
                            Barcode      = variant?["barcode"]?.ToString(),
                            ProductTitle = productTitle,
                            VariantTitle = variantTitle,
                            ImageUrl     = imageUrl,
                            Price        = price,
                        });
                    }

                    if (lineItems.Count == 0)
                    {
                        _logger.LogInformation("ParseFulfillmentEntities: order {OrderName} fulfillment {FulfillmentId} has tracking but no usable line items, skipping",
                            orderName, fulfillment["id"]?.ToString());
                        continue;
                    }

                    results.Add(new FulfillmentShipmentEntity
                    {
                        PartitionKey             = "ship",
                        RowKey                   = numericFulfillmentId,
                        OrderId                  = orderId,
                        OrderName                = orderName,
                        OrderTags                = JsonConvert.SerializeObject(tags),
                        OrderCreatedAt           = order["createdAt"]?.ToString() ?? "",
                        CustomerName             = customerName,
                        CustomerEmail            = customerEmail,
                        ShippingAddressJson      = shippingAddressJson,
                        FulfillmentId            = fulfillmentId,
                        TrackingNumber           = trackingNumber,
                        TrackingCarrier          = trackingCarrier,
                        TrackingUrl              = trackingUrl,
                        ShopifyFulfillmentStatus = fulfillment["status"]?.ToString() ?? "",
                        Status                   = "pending",
                        LineItemsJson            = JsonConvert.SerializeObject(lineItems),
                        FulfillmentCreatedAt     = DateTimeOffset.TryParse(fulfillment["createdAt"]?.ToString(), out var fdt)
                                                  ? fdt : DateTimeOffset.UtcNow,
                    });
                }
            }

        return results;
    }

    // ─── Inventory mapping (custom.adjustments metafield) ────────────────────

    private const string GetVariantAdjustmentsQuery = @"
        query GetVariantAdjustments($variantId: ID!) {
          productVariant(id: $variantId) {
            inventoryItem { id }
            metafield(namespace: ""custom"", key: ""adjustments"") { value }
            product {
              metafield(namespace: ""custom"", key: ""adjustments"") { value }
            }
          }
        }";

    /// <summary>
    /// Returns the parsed custom.adjustments metafield JSON for a variant.
    /// Checks variant-level first (multi-variant), then product-level (single-variant).
    /// Returns null if the metafield is absent or not parseable.
    /// When present, embeds "child_inventory_item_id" into the returned JObject.
    /// </summary>
    public async Task<JObject?> GetVariantAdjustmentsAsync(string variantId)
    {
        var gid = variantId.StartsWith("gid://") ? variantId : $"gid://shopify/ProductVariant/{variantId}";

        try
        {
            var data = await GraphQlAsync(GetVariantAdjustmentsQuery, new { variantId = gid });
            var variant = data["productVariant"];
            if (variant == null) return null;

            // Prefer variant-level metafield (multi-variant products);
            // fall back to product-level (single-variant/"Default Title" products).
            // Guard against JTokenType.Null tokens (JSON null vs absent key) before indexing.
            var variantMeta = variant["metafield"];
            var variantValue = variantMeta != null && variantMeta.Type != JTokenType.Null
                ? variantMeta["value"]?.ToString() : null;

            var productMeta = variant["product"]?["metafield"];
            var productValue = productMeta != null && productMeta.Type != JTokenType.Null
                ? productMeta["value"]?.ToString() : null;

            var raw = variantValue ?? productValue;

            if (string.IsNullOrWhiteSpace(raw)) return null;
            var parsed = JObject.Parse(raw);

            // Embed child's own inventory item ID so callers can do the +delta adjustment.
            var childInventoryItemId = variant["inventoryItem"]?["id"]?.ToString();
            if (!string.IsNullOrEmpty(childInventoryItemId))
                parsed["child_inventory_item_id"] = childInventoryItemId;

            return parsed;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to fetch custom.adjustments for variant {VariantId}", variantId);
            return null;
        }
    }

    // ─── Variant inventory item lookup ────────────────────────────────────────

    private const string GetVariantInventoryQuery = @"
        query GetVariantInventory($variantId: ID!) {
          productVariant(id: $variantId) {
            inventoryItem {
              id
              inventoryLevels(first: 1) {
                nodes { location { id } }
              }
            }
          }
        }";

    /// <summary>
    /// Returns the inventoryItemId and primary location for a variant.
    /// Used for PO quantity correction adjustments (Story 2).
    /// </summary>
    public async Task<(string? InventoryItemId, string? LocationId)> GetVariantInventoryAsync(string variantId)
    {
        var gid = variantId.StartsWith("gid://") ? variantId : $"gid://shopify/ProductVariant/{variantId}";
        try
        {
            var data = await GraphQlAsync(GetVariantInventoryQuery, new { variantId = gid });
            var inventoryItem = data["productVariant"]?["inventoryItem"];
            if (inventoryItem == null || inventoryItem.Type == JTokenType.Null) return (null, null);

            var itemId = inventoryItem["id"]?.ToString();
            var levels = inventoryItem["inventoryLevels"]?["nodes"] as JArray;
            var locationId = levels?.Count > 0 ? levels[0]["location"]?["id"]?.ToString() : null;

            return (itemId, locationId);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to fetch inventory info for variant {VariantId}", variantId);
            return (null, null);
        }
    }

    // ─── Transformation options (parent → children) ───────────────────────────

    private const string GetChildTransformationVariantsQuery = @"
        query GetChildVariants($variantId: ID!) {
          productVariant(id: $variantId) {
            inventoryItem { id }
            product {
              variants(first: 100) {
                nodes {
                  id title
                  inventoryItem { id }
                  metafield(namespace: ""custom"", key: ""adjustments"") { value }
                }
              }
            }
          }
        }";

    /// <summary>
    /// Given a parent variant ID, returns all child variants that reference this parent
    /// via their custom.adjustments metafield. Used by the transformation UI (Story 3).
    /// </summary>
    public async Task<List<Models.TransformationOption>> GetChildTransformationVariantsAsync(string parentVariantId)
    {
        var gid = parentVariantId.StartsWith("gid://") ? parentVariantId
            : $"gid://shopify/ProductVariant/{parentVariantId}";
        try
        {
            var data = await GraphQlAsync(GetChildTransformationVariantsQuery, new { variantId = gid });
            var parentVariant = data["productVariant"];
            if (parentVariant == null) return new List<Models.TransformationOption>();

            var parentInventoryItemId = parentVariant["inventoryItem"]?["id"]?.ToString();
            if (string.IsNullOrEmpty(parentInventoryItemId)) return new List<Models.TransformationOption>();

            var variants = parentVariant["product"]?["variants"]?["nodes"] as JArray;
            if (variants == null) return new List<Models.TransformationOption>();

            var results = new List<Models.TransformationOption>();
            foreach (var v in variants)
            {
                var metafieldNode = v["metafield"];
                if (metafieldNode == null || metafieldNode.Type == JTokenType.Null) continue;
                var metafieldValue = metafieldNode["value"]?.ToString();
                if (string.IsNullOrWhiteSpace(metafieldValue)) continue;

                JObject adjustments;
                try { adjustments = JObject.Parse(metafieldValue); }
                catch { continue; }

                var adjParentInventoryId = adjustments["parent_inventory_id"]?.ToString();
                if (adjParentInventoryId != parentInventoryItemId) continue;

                results.Add(new Models.TransformationOption
                {
                    VariantId       = v["id"]!.ToString(),
                    Title           = v["title"]?.ToString() ?? "",
                    InventoryItemId = v["inventoryItem"]?["id"]?.ToString() ?? "",
                    LocationId      = adjustments["parent_location_id"]?.ToString() ?? "",
                    ParentUnits     = adjustments["parent_units"]?.ToObject<int>() ?? 1,
                    ChildUnits      = adjustments["child_units"]?.ToObject<int>() ?? 1,
                });
            }
            return results;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to fetch child transformation variants for {VariantId}", parentVariantId);
            return new List<Models.TransformationOption>();
        }
    }

    // ─── Inventory adjustment ─────────────────────────────────────────────────

    private const string AdjustInventoryMutation = @"
        mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!) {
          inventoryAdjustQuantities(input: $input) {
            userErrors { field message }
            inventoryAdjustmentGroup {
              changes {
                delta
                quantityAfterChange
                item { id }
                location { id }
              }
            }
          }
        }";

    /// <summary>
    /// Adjusts available inventory for a parent product.
    /// delta is negative to deduct (e.g. -2 removes 2 units).
    /// Returns the quantity after adjustment, or null on error.
    /// </summary>
    public async Task<int?> AdjustInventoryAsync(string inventoryItemId, string locationId, int delta, string reason = "correction")
    {
        var itemGid = inventoryItemId.StartsWith("gid://") ? inventoryItemId
            : $"gid://shopify/InventoryItem/{inventoryItemId}";
        var locationGid = locationId.StartsWith("gid://") ? locationId
            : $"gid://shopify/Location/{locationId}";

        var data = await GraphQlAsync(AdjustInventoryMutation, new
        {
            input = new
            {
                reason,
                name    = "available",
                changes = new[]
                {
                    new { inventoryItemId = itemGid, locationId = locationGid, delta }
                }
            }
        });

        var errors = data["inventoryAdjustQuantities"]?["userErrors"]?.ToObject<List<GraphQlUserError>>();
        if (errors?.Any() == true)
            throw new Exception($"Inventory adjustment error: {errors[0].Message}");

        var changes = data["inventoryAdjustQuantities"]?["inventoryAdjustmentGroup"]?["changes"] as JArray;
        return changes?.Count > 0
            ? changes[0]["quantityAfterChange"]?.ToObject<int>()
            : null;
    }

    // ─── Purchase Orders (REST) ───────────────────────────────────────────────

    private async Task<JArray?> RestGetArrayAsync(string path, int retries = 3)
    {
        var url = $"https://{_storeDomain}/admin/api/{_apiVersion}/{path}";
        for (int attempt = 0; attempt < retries; attempt++)
        {
            var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Add("X-Shopify-Access-Token", _accessToken);

            var response = await _http.SendAsync(request);

            if (response.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
            {
                var delay = response.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(2);
                _logger.LogWarning("REST rate-limited, retrying in {Delay}s", delay.TotalSeconds);
                await Task.Delay(delay);
                continue;
            }

            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadAsStringAsync();
            var obj = JsonConvert.DeserializeObject<JObject>(json);
            return obj?.Properties().FirstOrDefault()?.Value as JArray;
        }
        throw new Exception($"REST GET {path} failed after {retries} retries");
    }

    // Shopify's native inventory POs are only in the 'unstable' GQL API.
    // REST purchase_orders.json and stable GQL purchaseOrders do not exist for this store type.
    private const string ListInventoryPurchaseOrdersQuery = @"
        query ListInventoryPOs($cursor: String) {
          inventoryPurchaseOrders(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id name status dateCreated
              origin { supplierName }
              lineItems(first: 100) {
                nodes {
                  id title variantTitle totalQuantity
                  inventoryItem { id sku variant { id title product { id title } } }
                }
              }
            }
          }
        }";

    public async Task<List<GqlInventoryPurchaseOrder>> GetInventoryPurchaseOrdersAsync()
    {
        var results = new List<GqlInventoryPurchaseOrder>();
        string? cursor = null;

        try
        {
            do
            {
                var data = await GraphQlAsync(ListInventoryPurchaseOrdersQuery, new { cursor }, apiVersionOverride: "unstable");
                var conn  = data["inventoryPurchaseOrders"];
                if (conn == null) break;

                var nodes = conn["nodes"] as JArray ?? new JArray();
                foreach (var node in nodes)
                {
                    var liNodes = node["lineItems"]?["nodes"] as JArray ?? new JArray();
                    var lineItems = liNodes.Select(n =>
                    {
                        var inv = n["inventoryItem"] as Newtonsoft.Json.Linq.JObject;
                        var vnt = inv?["variant"]    as Newtonsoft.Json.Linq.JObject;
                        var prd = vnt?["product"]    as Newtonsoft.Json.Linq.JObject;
                        return new GqlInventoryPurchaseOrderLineItem
                        {
                            Id           = n["id"]?.ToString() ?? "",
                            Title        = n["title"]?.ToString() ?? "",
                            VariantTitle = n["variantTitle"]?.ToString(),
                            TotalQuantity = n["totalQuantity"]?.Value<int>() ?? 0,
                            InventoryItem = inv != null ? new GqlInventoryItemRef
                            {
                                Id      = inv["id"]?.ToString() ?? "",
                                Sku     = inv["sku"]?.ToString(),
                                Variant = vnt != null ? new GqlVariantRef
                                {
                                    Id      = vnt["id"]?.ToString() ?? "",
                                    Title   = vnt["title"]?.ToString(),
                                    Product = prd != null ? new GqlProductRef
                                    {
                                        Id    = prd["id"]?.ToString() ?? "",
                                        Title = prd["title"]?.ToString() ?? "",
                                    } : null,
                                } : null,
                            } : null,
                        };
                    }).ToList();

                    results.Add(new GqlInventoryPurchaseOrder
                    {
                        Id          = node["id"]?.ToString() ?? "",
                        Name        = node["name"]?.ToString() ?? "",
                        Status      = node["status"]?.ToString() ?? "",
                        DateCreated = node["dateCreated"]?.ToString() ?? "",
                        Origin      = node["origin"] is { Type: Newtonsoft.Json.Linq.JTokenType.Object } originObj
                                          ? new GqlInventorySupplierSnapshot { SupplierName = originObj["supplierName"]?.ToString() }
                                          : null,
                        LineItems   = lineItems,
                    });
                }

                var pageInfo = conn["pageInfo"];
                var hasNext  = pageInfo?["hasNextPage"]?.Value<bool>() ?? false;
                cursor       = hasNext ? pageInfo?["endCursor"]?.ToString() : null;
            }
            while (cursor != null);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to fetch inventory purchase orders from Shopify");
        }

        return results;
    }

    // ─── Webhook Registration ─────────────────────────────────────────────────

    // purchase_orders/* do not exist as Shopify webhook topics; PO sync is polled via GQL only.
    private static readonly string[] RequiredWebhookTopics =
    [
        "products/create", "products/update", "products/delete",
        "orders/create", "orders/updated", "orders/cancelled", "orders/fulfilled",
    ];

    private const string ListWebhooksQuery = @"
        query ListWebhooks {
          webhookSubscriptions(first: 100) {
            nodes { id topic callbackUrl }
          }
        }";

    private const string CreateWebhookMutation = @"
        mutation CreateWebhook($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
          webhookSubscriptionCreate(topic: $topic, webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }) {
            userErrors { field message }
            webhookSubscription { id topic callbackUrl }
          }
        }";

    private async Task<JObject> RestPostAsync(string path, object body)
    {
        var url = $"https://{_storeDomain}/admin/api/{_apiVersion}/{path}";
        var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.Add("X-Shopify-Access-Token", _accessToken);
        request.Content = new StringContent(JsonConvert.SerializeObject(body), Encoding.UTF8, "application/json");
        var response = await _http.SendAsync(request);
        var json = await response.Content.ReadAsStringAsync();
        response.EnsureSuccessStatusCode();
        return JsonConvert.DeserializeObject<JObject>(json) ?? new JObject();
    }

    public async Task<List<WebhookResult>> ListWebhooksAsync()
    {
        try
        {
            var arr = await RestGetArrayAsync("webhooks.json");
            if (arr == null) return new List<WebhookResult>();
            return arr.Select(w => new WebhookResult
            {
                Id      = w["id"]?.ToString() ?? "",
                Topic   = w["topic"]?.ToString() ?? "",
                Address = w["address"]?.ToString() ?? "",
            }).ToList();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to list webhooks");
            return new List<WebhookResult>();
        }
    }

    public async Task<bool> DeleteWebhookAsync(string webhookId)
    {
        try
        {
            var url = $"https://{_storeDomain}/admin/api/{_apiVersion}/webhooks/{webhookId}.json";
            var req = new HttpRequestMessage(HttpMethod.Delete, url);
            req.Headers.Add("X-Shopify-Access-Token", _accessToken);
            var res = await _http.SendAsync(req);
            return res.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to delete webhook {WebhookId}", webhookId);
            return false;
        }
    }

    public async Task<List<WebhookRegistrationResult>> RegisterWebhooksAsync(string callbackBaseUrl)
    {
        var results    = new List<WebhookRegistrationResult>();
        var callbackUrl = $"{callbackBaseUrl.TrimEnd('/')}/api/webhooks/shopify";

        // Use REST webhook list for dedup — covers both REST and GQL registered webhooks
        var existing = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            var arr = await RestGetArrayAsync("webhooks.json");
            if (arr != null)
                foreach (var w in arr)
                    if ((w["address"]?.ToString() ?? "") == callbackUrl)
                        existing.Add(w["topic"]?.ToString() ?? "");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to list existing webhooks; will attempt to register all");
        }

        foreach (var topic in RequiredWebhookTopics)
        {
            if (existing.Contains(topic))
            {
                results.Add(new WebhookRegistrationResult { Topic = topic, Status = "already_registered" });
                continue;
            }

            try
            {
                await RestPostAsync("webhooks.json", new { webhook = new { topic, address = callbackUrl, format = "json" } });
                results.Add(new WebhookRegistrationResult { Topic = topic, Status = "registered" });
                _logger.LogInformation("Registered webhook for {Topic} → {CallbackUrl}", topic, callbackUrl);
            }
            catch (Exception ex)
            {
                results.Add(new WebhookRegistrationResult { Topic = topic, Status = "error", Error = ex.Message });
                _logger.LogError(ex, "Failed to register webhook for {Topic}", topic);
            }
        }

        return results;
    }
}

