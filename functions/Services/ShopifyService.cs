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

    private async Task<JObject> GraphQlAsync(string query, object? variables = null, int retries = 3)
    {
        var url = $"https://{_storeDomain}/admin/api/{_apiVersion}/graphql.json";
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
                        ImageUrl = imageUrl,
                        Price = v["price"]?.ToString() ?? "0.00"
                    });
                }
            }
        }

        return results;
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
}

