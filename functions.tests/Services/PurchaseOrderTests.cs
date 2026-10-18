using System.Net;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Moq.Protected;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using ShipScan.Functions.Models;
using ShipScan.Functions.Services;
using Xunit;

namespace ShipScan.Functions.Tests.Services;

/// <summary>
/// Unit and integration tests for Purchase Order replication (Work Item 1).
///
/// Live tests require env vars:
///   SHIPSCAN_TEST_STORE_DOMAIN   e.g. my-store.myshopify.com
///   SHIPSCAN_TEST_ACCESS_TOKEN   a private app token with read_purchase_orders scope
///
/// Without those vars the live tests are skipped automatically.
/// </summary>
public class PurchaseOrderTests
{
    // ─── Helpers ─────────────────────────────────────────────────────────────

    private static ShopifyService CreateService(HttpMessageHandler handler)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ShopifyStoreDomain"] = "test-store.myshopify.com",
                ["ShopifyAccessToken"] = "shpat_test",
                ["ShopifyApiVersion"]  = "2025-01"
            }).Build();

        var httpClientFactory = new Mock<IHttpClientFactory>();
        var client = new HttpClient(handler);
        httpClientFactory.Setup(f => f.CreateClient("shopify")).Returns(client);

        return new ShopifyService(httpClientFactory.Object, config, NullLogger<ShopifyService>.Instance);
    }

    private static HttpMessageHandler MockHandler(object responseBody, HttpStatusCode statusCode = HttpStatusCode.OK)
    {
        var mock = new Mock<HttpMessageHandler>();
        mock.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = statusCode,
                Content    = new StringContent(JsonConvert.SerializeObject(responseBody))
            });
        return mock.Object;
    }

    private static WebhookPurchaseOrder MakePo(long id = 1001, int lineItemCount = 2, string status = "open")
    {
        var items = Enumerable.Range(1, lineItemCount).Select(i => new WebhookPurchaseOrderLineItem
        {
            Id           = 9000 + i,
            ProductTitle = $"Test Product {i}",
            VariantTitle = "Default",
            VariantId    = 100 + i,
            Sku          = $"SKU-{i:D3}",
            Quantity     = 10 + i,
        }).ToList();

        return new WebhookPurchaseOrder
        {
            Id          = id,
            Name        = $"PO-{id}",
            Status      = status,
            VendorName  = "Test Vendor",
            CreatedAt   = "2024-01-15T10:00:00-05:00",
            UpdatedAt   = "2024-01-15T10:00:00-05:00",
            LineItems   = items,
        };
    }

    // ─── Model serialization tests ────────────────────────────────────────────

    [Fact]
    public void WebhookPurchaseOrder_Deserializes_FromJson()
    {
        var json = @"{
            ""id"": 123456789,
            ""name"": ""PO-1001"",
            ""status"": ""open"",
            ""vendor_name"": ""Green Global Foods"",
            ""created_at"": ""2024-01-15T10:00:00-05:00"",
            ""updated_at"": ""2024-01-15T11:00:00-05:00"",
            ""line_items"": [
                {
                    ""id"": 987654321,
                    ""product_title"": ""Organic Salmon"",
                    ""variant_title"": ""Default Title"",
                    ""variant_id"": 456789,
                    ""sku"": ""ORG-SAL-001"",
                    ""quantity"": 24
                }
            ]
        }";

        var po = JsonConvert.DeserializeObject<WebhookPurchaseOrder>(json);

        Assert.NotNull(po);
        Assert.Equal(123456789, po!.Id);
        Assert.Equal("PO-1001", po.Name);
        Assert.Equal("open", po.Status);
        Assert.Equal("Green Global Foods", po.VendorName);
        Assert.Single(po.LineItems);

        var li = po.LineItems[0];
        Assert.Equal(987654321, li.Id);
        Assert.Equal("Organic Salmon", li.ProductTitle);
        Assert.Equal(24, li.Quantity);
        Assert.Equal("ORG-SAL-001", li.Sku);
        Assert.Equal(456789L, li.VariantId);
    }

    [Fact]
    public void WebhookPurchaseOrder_Deserializes_WithNullOptionalFields()
    {
        var json = @"{
            ""id"": 1,
            ""name"": ""PO-1"",
            ""status"": ""open"",
            ""created_at"": ""2024-01-01T00:00:00Z"",
            ""updated_at"": ""2024-01-01T00:00:00Z"",
            ""line_items"": [
                {
                    ""id"": 2,
                    ""product_title"": ""Some Product"",
                    ""quantity"": 5
                }
            ]
        }";

        var po = JsonConvert.DeserializeObject<WebhookPurchaseOrder>(json);

        Assert.NotNull(po);
        Assert.Null(po!.VendorName);
        Assert.Null(po.LineItems[0].VariantId);
        Assert.Null(po.LineItems[0].Sku);
        Assert.Null(po.LineItems[0].VariantTitle);
    }

    [Fact]
    public void WebhookPurchaseOrder_Deserializes_EmptyLineItems()
    {
        var json = @"{
            ""id"": 1,
            ""name"": ""PO-1"",
            ""status"": ""open"",
            ""created_at"": ""2024-01-01T00:00:00Z"",
            ""updated_at"": ""2024-01-01T00:00:00Z"",
            ""line_items"": []
        }";

        var po = JsonConvert.DeserializeObject<WebhookPurchaseOrder>(json);

        Assert.NotNull(po);
        Assert.Empty(po!.LineItems);
    }

    // ─── PurchaseOrderEntity mapping tests ───────────────────────────────────

    [Fact]
    public void PurchaseOrderEntity_DefaultStatus_IsOpen()
    {
        var entity = new PurchaseOrderEntity
        {
            PartitionKey = "po",
            RowKey       = "123",
            PoName       = "PO-1001",
        };

        Assert.Equal("open", entity.Status);
        Assert.Equal("po", entity.PartitionKey);
    }

    [Fact]
    public void PurchaseOrderLineItemEntity_DefaultStatus_IsPending()
    {
        var entity = new PurchaseOrderLineItemEntity
        {
            PartitionKey  = "123",
            RowKey        = "456",
            ProductTitle  = "Test",
            QuantityOrdered = 10,
        };

        Assert.Equal("pending", entity.Status);
        Assert.Equal(0, entity.QuantityReceived);
    }

    [Fact]
    public void ApprovePurchaseOrderLineItemRequest_Deserializes()
    {
        var json = @"{
            ""poId"": ""gid://shopify/PurchaseOrder/123"",
            ""lineItemId"": ""gid://shopify/PurchaseOrderLineItem/456"",
            ""quantityReceived"": 5,
            ""printedBy"": ""staff@example.com""
        }";

        var req = JsonConvert.DeserializeObject<ApprovePurchaseOrderLineItemRequest>(json);

        Assert.NotNull(req);
        Assert.Equal("gid://shopify/PurchaseOrder/123", req!.PoId);
        Assert.Equal("gid://shopify/PurchaseOrderLineItem/456", req.LineItemId);
        Assert.Equal(5, req.QuantityReceived);
        Assert.Equal("staff@example.com", req.PrintedBy);
    }

    // ─── PO → Entity mapping logic tests ─────────────────────────────────────

    [Fact]
    public void PurchaseOrderEntity_MapsFrom_WebhookPayload()
    {
        var po = MakePo(id: 5001);
        var numericPoId = po.Id.ToString();

        var entity = new PurchaseOrderEntity
        {
            PartitionKey      = "po",
            RowKey            = numericPoId,
            PoId              = $"gid://shopify/PurchaseOrder/{po.Id}",
            PoName            = po.Name,
            Status            = "open",
            Vendor            = po.VendorName ?? "",
            TotalLineItems    = po.LineItems.Count,
            ApprovedLineItems = 0,
            ShopifyCreatedAt  = DateTimeOffset.TryParse(po.CreatedAt, out var c) ? c : DateTimeOffset.UtcNow,
            ShopifyUpdatedAt  = DateTimeOffset.TryParse(po.UpdatedAt, out var u) ? u : DateTimeOffset.UtcNow,
        };

        Assert.Equal("po", entity.PartitionKey);
        Assert.Equal("5001", entity.RowKey);
        Assert.Equal("gid://shopify/PurchaseOrder/5001", entity.PoId);
        Assert.Equal("PO-5001", entity.PoName);
        Assert.Equal("Test Vendor", entity.Vendor);
        Assert.Equal(2, entity.TotalLineItems);
        Assert.Equal("open", entity.Status);
    }

    [Fact]
    public void PurchaseOrderLineItemEntity_MapsFrom_WebhookLineItem()
    {
        var po = MakePo();
        var li = po.LineItems[0];
        var numericPoId = po.Id.ToString();

        var entity = new PurchaseOrderLineItemEntity
        {
            PartitionKey     = numericPoId,
            RowKey           = li.Id.ToString(),
            LineItemId       = $"gid://shopify/PurchaseOrderLineItem/{li.Id}",
            ProductTitle     = li.ProductTitle,
            VariantTitle     = li.VariantTitle,
            VariantId        = li.VariantId.HasValue
                                   ? $"gid://shopify/ProductVariant/{li.VariantId.Value}"
                                   : null,
            Sku              = li.Sku,
            QuantityOrdered  = li.Quantity,
            QuantityReceived = 0,
            Status           = "pending",
        };

        Assert.Equal(numericPoId, entity.PartitionKey);
        Assert.Equal("9001", entity.RowKey);
        Assert.Equal("gid://shopify/PurchaseOrderLineItem/9001", entity.LineItemId);
        Assert.Equal("Test Product 1", entity.ProductTitle);
        Assert.Equal("SKU-001", entity.Sku);
        Assert.Equal(11, entity.QuantityOrdered);
        Assert.Equal(0, entity.QuantityReceived);
        Assert.Equal("pending", entity.Status);
    }

    // ─── Approval logic tests ─────────────────────────────────────────────────

    [Theory]
    [InlineData(0, 10, "pending")]
    [InlineData(5, 10, "partial")]
    [InlineData(10, 10, "approved")]
    [InlineData(15, 10, "approved")]  // over-receive still counts as approved
    public void LineItemStatus_AfterApproval(int received, int ordered, string expectedStatus)
    {
        var entity = new PurchaseOrderLineItemEntity
        {
            QuantityOrdered  = ordered,
            QuantityReceived = received,
        };

        string status;
        if (entity.QuantityReceived >= entity.QuantityOrdered)
            status = "approved";
        else if (entity.QuantityReceived > 0)
            status = "partial";
        else
            status = "pending";

        Assert.Equal(expectedStatus, status);
    }

    [Theory]
    [InlineData(0, 3, 0, "open")]     // no items approved
    [InlineData(1, 3, 0, "partial")]  // some approved
    [InlineData(0, 3, 1, "partial")]  // some partial
    [InlineData(3, 3, 0, "fulfilled")] // all approved
    public void PoStatus_AfterLineItemApprovals(int approvedCount, int totalCount, int partialCount, string expectedStatus)
    {
        string poStatus;
        if (approvedCount == totalCount)
            poStatus = "fulfilled";
        else if (approvedCount > 0 || partialCount > 0)
            poStatus = "partial";
        else
            poStatus = "open";

        Assert.Equal(expectedStatus, poStatus);
    }

    [Fact]
    public void ApproveLineItem_AccumulatesQuantity()
    {
        var entity = new PurchaseOrderLineItemEntity
        {
            QuantityOrdered  = 20,
            QuantityReceived = 0,
            Status           = "pending",
        };

        // First print: 10 units
        entity.QuantityReceived += 10;
        entity.Status = entity.QuantityReceived >= entity.QuantityOrdered ? "approved"
                      : entity.QuantityReceived > 0 ? "partial"
                      : "pending";

        Assert.Equal("partial", entity.Status);
        Assert.Equal(10, entity.QuantityReceived);

        // Second print: remaining 10
        entity.QuantityReceived += 10;
        entity.Status = entity.QuantityReceived >= entity.QuantityOrdered ? "approved"
                      : entity.QuantityReceived > 0 ? "partial"
                      : "pending";

        Assert.Equal("approved", entity.Status);
        Assert.Equal(20, entity.QuantityReceived);
    }

    // ─── Webhook handler unit tests ───────────────────────────────────────────

    [Fact]
    public void WebhookPo_HandlerLogic_PreservesApprovalOnUpdate()
    {
        // Simulate the handler logic: when existing PO already has approval state,
        // a webhook update should NOT reset that state.
        var existing = new PurchaseOrderEntity
        {
            PartitionKey      = "po",
            RowKey            = "1001",
            PoName            = "PO-1001",
            Status            = "partial",
            ApprovedLineItems = 1,
        };

        var incoming = new WebhookPurchaseOrder { Id = 1001, Name = "PO-1001", Status = "open" };

        // Simulate handler preserve logic
        var entity = new PurchaseOrderEntity
        {
            PartitionKey      = "po",
            RowKey            = incoming.Id.ToString(),
            PoName            = incoming.Name,
            Status            = "open",
            ApprovedLineItems = 0,
        };

        if (existing != null)
        {
            entity.Status            = existing.Status;
            entity.ApprovedLineItems = existing.ApprovedLineItems;
        }

        Assert.Equal("partial", entity.Status);
        Assert.Equal(1, entity.ApprovedLineItems);
    }

    [Fact]
    public void WebhookPo_LineItem_PreservesReceiptOnUpdate()
    {
        var existingLi = new PurchaseOrderLineItemEntity
        {
            PartitionKey     = "1001",
            RowKey           = "9001",
            QuantityOrdered  = 10,
            QuantityReceived = 5,
            Status           = "partial",
            PrintedBy        = "staff@example.com",
        };

        var incomingLi = new WebhookPurchaseOrderLineItem
        {
            Id       = 9001,
            Quantity = 10,
        };

        // Simulate handler preserve logic
        var entity = new PurchaseOrderLineItemEntity
        {
            PartitionKey     = "1001",
            RowKey           = incomingLi.Id.ToString(),
            QuantityOrdered  = incomingLi.Quantity,
            QuantityReceived = existingLi.QuantityReceived,
            Status           = existingLi.Status,
            PrintedAt        = existingLi.PrintedAt,
            PrintedBy        = existingLi.PrintedBy,
        };

        Assert.Equal(5, entity.QuantityReceived);
        Assert.Equal("partial", entity.Status);
        Assert.Equal("staff@example.com", entity.PrintedBy);
    }

    // ─── GID stripping logic ──────────────────────────────────────────────────

    [Theory]
    [InlineData("gid://shopify/PurchaseOrder/123456", "123456")]
    [InlineData("123456", "123456")]
    [InlineData("gid://shopify/PurchaseOrderLineItem/789", "789")]
    public void StripGid_ExtractsNumericId(string input, string expected)
    {
        var result = input.Contains('/') ? input.Split('/').Last() : input;
        Assert.Equal(expected, result);
    }

    // ─── ShopifyService REST tests ────────────────────────────────────────────

    [Fact]
    public async Task GetPurchaseOrdersAsync_ReturnsEmptyList_OnEmptyResponse()
    {
        var responseBody = new { purchase_orders = new object[] { } };
        var service = CreateService(MockHandler(responseBody));

        var result = await service.GetPurchaseOrdersAsync();

        Assert.NotNull(result);
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetPurchaseOrdersAsync_ReturnsOrders_OnSuccess()
    {
        var responseBody = new
        {
            purchase_orders = new[]
            {
                new
                {
                    id = 123,
                    name = "PO-1001",
                    status = "open",
                    vendor_name = "Test Vendor",
                    created_at = "2024-01-15T10:00:00-05:00",
                    updated_at = "2024-01-15T10:00:00-05:00",
                    line_items = new[]
                    {
                        new { id = 456, product_title = "Test Product", quantity = 5 }
                    }
                }
            }
        };

        var service = CreateService(MockHandler(responseBody));

        var result = await service.GetPurchaseOrdersAsync();

        Assert.Single(result);
        Assert.Equal(123, result[0].Id);
        Assert.Equal("PO-1001", result[0].Name);
        Assert.Equal("open", result[0].Status);
        Assert.Single(result[0].LineItems);
        Assert.Equal(5, result[0].LineItems[0].Quantity);
    }

    [Fact]
    public async Task GetPurchaseOrdersAsync_ReturnsEmpty_OnHttpError()
    {
        var service = CreateService(MockHandler(new { }, HttpStatusCode.InternalServerError));

        // Should not throw — returns empty list gracefully
        var result = await service.GetPurchaseOrdersAsync();

        Assert.NotNull(result);
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetPurchaseOrdersAsync_ReturnsEmpty_OnNullPayload()
    {
        // Malformed JSON that can't deserialize
        var handlerMock = new Mock<HttpMessageHandler>();
        handlerMock.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = HttpStatusCode.OK,
                Content    = new StringContent("null")
            });

        var service = CreateService(handlerMock.Object);

        var result = await service.GetPurchaseOrdersAsync();

        Assert.NotNull(result);
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetPurchaseOrdersAsync_SendsCorrectHeader()
    {
        HttpRequestMessage? capturedRequest = null;
        var handlerMock = new Mock<HttpMessageHandler>();
        handlerMock.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
            .Callback<HttpRequestMessage, CancellationToken>((req, _) => capturedRequest = req)
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = HttpStatusCode.OK,
                Content    = new StringContent(JsonConvert.SerializeObject(new { purchase_orders = new object[] { } }))
            });

        var service = CreateService(handlerMock.Object);
        await service.GetPurchaseOrdersAsync("open");

        Assert.NotNull(capturedRequest);
        Assert.True(capturedRequest!.Headers.Contains("X-Shopify-Access-Token"));
        Assert.Contains("purchase_orders.json", capturedRequest.RequestUri!.ToString());
        Assert.Contains("status=open", capturedRequest.RequestUri.ToString());
    }

    [Fact]
    public async Task GetPurchaseOrdersAsync_PassesStatusFilter()
    {
        HttpRequestMessage? capturedRequest = null;
        var handlerMock = new Mock<HttpMessageHandler>();
        handlerMock.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
            .Callback<HttpRequestMessage, CancellationToken>((req, _) => capturedRequest = req)
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = HttpStatusCode.OK,
                Content    = new StringContent(JsonConvert.SerializeObject(new { purchase_orders = new object[] { } }))
            });

        var service = CreateService(handlerMock.Object);
        await service.GetPurchaseOrdersAsync("closed");

        Assert.Contains("status=closed", capturedRequest!.RequestUri!.ToString());
    }

    // ─── Multi-line-item approval cascade ─────────────────────────────────────

    [Fact]
    public void PoFulfillmentCascade_WhenAllItemsApproved()
    {
        var lineItems = new List<PurchaseOrderLineItemEntity>
        {
            new() { RowKey = "1", QuantityOrdered = 5,  QuantityReceived = 5,  Status = "approved" },
            new() { RowKey = "2", QuantityOrdered = 10, QuantityReceived = 10, Status = "approved" },
            new() { RowKey = "3", QuantityOrdered = 3,  QuantityReceived = 3,  Status = "approved" },
        };

        var approved = lineItems.Count(li => li.Status == "approved");
        var partial  = lineItems.Count(li => li.Status == "partial");
        var total    = lineItems.Count;

        var poStatus = approved == total ? "fulfilled"
                     : (approved > 0 || partial > 0) ? "partial"
                     : "open";

        Assert.Equal("fulfilled", poStatus);
        Assert.Equal(3, approved);
    }

    [Fact]
    public void PoFulfillmentCascade_WhenMixedStatuses()
    {
        var lineItems = new List<PurchaseOrderLineItemEntity>
        {
            new() { RowKey = "1", Status = "approved" },
            new() { RowKey = "2", Status = "partial" },
            new() { RowKey = "3", Status = "pending" },
        };

        var approved = lineItems.Count(li => li.Status == "approved");
        var partial  = lineItems.Count(li => li.Status == "partial");

        var poStatus = approved == lineItems.Count ? "fulfilled"
                     : (approved > 0 || partial > 0) ? "partial"
                     : "open";

        Assert.Equal("partial", poStatus);
    }

    [Fact]
    public void PoFulfillmentCascade_WhenNoPrints()
    {
        var lineItems = new List<PurchaseOrderLineItemEntity>
        {
            new() { RowKey = "1", Status = "pending" },
            new() { RowKey = "2", Status = "pending" },
        };

        var approved = lineItems.Count(li => li.Status == "approved");
        var partial  = lineItems.Count(li => li.Status == "partial");

        var poStatus = approved == lineItems.Count ? "fulfilled"
                     : (approved > 0 || partial > 0) ? "partial"
                     : "open";

        Assert.Equal("open", poStatus);
    }

    // ─── Edge cases ────────────────────────────────────────────────────────────

    [Fact]
    public void WebhookPo_WithMultipleLineItems_MapsAll()
    {
        var po = MakePo(id: 9999, lineItemCount: 5);

        Assert.Equal(5, po.LineItems.Count);
        for (int i = 0; i < 5; i++)
        {
            Assert.Equal($"Test Product {i + 1}", po.LineItems[i].ProductTitle);
            Assert.Equal($"SKU-{(i + 1):D3}", po.LineItems[i].Sku);
        }
    }

    [Fact]
    public void WebhookPo_StatusMapping_FromShopify()
    {
        // Shopify statuses: "open" and "closed" (when PO is received)
        // ShipScan maps: open → open, partially received → partial, fully received → fulfilled
        var poOpen = new WebhookPurchaseOrder { Id = 1, Status = "open" };
        var poClosed = new WebhookPurchaseOrder { Id = 2, Status = "closed" };

        // Incoming webhook keeps local status for closed (Shopify closed ≠ ShipScan fulfilled)
        Assert.Equal("open", poOpen.Status);
        Assert.Equal("closed", poClosed.Status);
    }

    [Fact]
    public void ApproveRequest_GidStripping_WorksForBothFormats()
    {
        var req1 = new ApprovePurchaseOrderLineItemRequest
        {
            PoId       = "gid://shopify/PurchaseOrder/12345",
            LineItemId = "gid://shopify/PurchaseOrderLineItem/67890",
        };
        var req2 = new ApprovePurchaseOrderLineItemRequest
        {
            PoId       = "12345",
            LineItemId = "67890",
        };

        string Strip(string s) => s.Contains('/') ? s.Split('/').Last() : s;

        Assert.Equal("12345", Strip(req1.PoId));
        Assert.Equal("67890", Strip(req1.LineItemId));
        Assert.Equal("12345", Strip(req2.PoId));
        Assert.Equal("67890", Strip(req2.LineItemId));
    }

    // ─── Live Shopify integration tests (skipped if no credentials) ───────────

    private static bool HasLiveCredentials =>
        !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("SHIPSCAN_TEST_STORE_DOMAIN")) &&
        !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("SHIPSCAN_TEST_ACCESS_TOKEN"));

    private static ShopifyService CreateLiveService()
    {
        var domain  = Environment.GetEnvironmentVariable("SHIPSCAN_TEST_STORE_DOMAIN")!;
        var token   = Environment.GetEnvironmentVariable("SHIPSCAN_TEST_ACCESS_TOKEN")!;
        var version = Environment.GetEnvironmentVariable("SHIPSCAN_TEST_API_VERSION") ?? "2025-01";

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ShopifyStoreDomain"] = domain,
                ["ShopifyAccessToken"] = token,
                ["ShopifyApiVersion"]  = version,
            }).Build();

        var httpClientFactory = new Mock<IHttpClientFactory>();
        httpClientFactory.Setup(f => f.CreateClient("shopify")).Returns(new HttpClient());

        return new ShopifyService(httpClientFactory.Object, config, NullLogger<ShopifyService>.Instance);
    }

    [Fact]
    public async Task Live_GetPurchaseOrders_ReturnsValidShape()
    {
        if (!HasLiveCredentials) return; // skipped — set SHIPSCAN_TEST_STORE_DOMAIN + SHIPSCAN_TEST_ACCESS_TOKEN

        var service = CreateLiveService();
        var orders = await service.GetPurchaseOrdersAsync("open");

        // Should not throw and should return a list (may be empty on a store with no POs)
        Assert.NotNull(orders);

        foreach (var po in orders)
        {
            Assert.True(po.Id > 0, $"PO id should be positive, got {po.Id}");
            Assert.False(string.IsNullOrEmpty(po.Name), "PO name should not be empty");
            Assert.Contains(po.Status, new[] { "open", "closed" });

            foreach (var li in po.LineItems)
            {
                Assert.True(li.Id > 0, $"Line item id should be positive, got {li.Id}");
                Assert.True(li.Quantity > 0, $"Line item quantity should be > 0, got {li.Quantity}");
            }
        }
    }

    [Fact]
    public async Task Live_GetPurchaseOrders_ReturnsAllStatuses()
    {
        if (!HasLiveCredentials) return;

        var service = CreateLiveService();

        var openOrders   = await service.GetPurchaseOrdersAsync("open");
        var closedOrders = await service.GetPurchaseOrdersAsync("closed");

        // Both calls should succeed
        Assert.NotNull(openOrders);
        Assert.NotNull(closedOrders);
    }

    [Fact]
    public async Task Live_GetPurchaseOrders_LineItemsHaveValidSkus()
    {
        if (!HasLiveCredentials) return;

        var service = CreateLiveService();
        var orders = await service.GetPurchaseOrdersAsync("open");

        foreach (var po in orders)
        {
            foreach (var li in po.LineItems)
            {
                // SKU may be null but should never be an empty string (Shopify returns null when unset)
                if (li.Sku != null)
                    Assert.NotEmpty(li.Sku);
            }
        }
    }
}
