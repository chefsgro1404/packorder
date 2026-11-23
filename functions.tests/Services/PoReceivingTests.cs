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

// Accepting a PO line with a counted qty that differs from the PO: the client sends the counted
// qty as quantityReceived (with the discrepancy) and as the Shopify inventory delta.
public class PoReceivingTests
{
    [Fact]
    public void ApproveRequest_CountedQtyAndDiscrepancy_Deserialize()
    {
        // PO of 10, counted 100
        var json = @"{ ""poId"": ""1"", ""lineItemId"": ""2"", ""quantityReceived"": 100,
                       ""forceApprove"": true, ""discrepancyQty"": 90, ""discrepancyType"": ""over"" }";

        var req = JsonConvert.DeserializeObject<ApprovePurchaseOrderLineItemRequest>(json)!;

        Assert.Equal(100, req.QuantityReceived);
        Assert.True(req.ForceApprove);
        Assert.Equal(90, req.DiscrepancyQty);
        Assert.Equal("over", req.DiscrepancyType);
    }

    [Fact]
    public void ApproveRequest_DecimalQty_IsRejected()
    {
        // Why the client rounds lot-receiving weights: a decimal quantityReceived fails to
        // deserialize, the endpoint answers 400 and the PO line is never approved.
        var json = @"{ ""poId"": ""1"", ""lineItemId"": ""2"", ""quantityReceived"": 400.5 }";

        Assert.ThrowsAny<JsonException>(() => JsonConvert.DeserializeObject<ApprovePurchaseOrderLineItemRequest>(json));
    }

    [Fact]
    public async Task AdjustInventory_Received_SendsCountedQtyAsDelta()
    {
        string? sentBody = null;
        var handler = new Mock<HttpMessageHandler>();
        handler.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync", ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
            .Returns<HttpRequestMessage, CancellationToken>(async (msg, _) =>
            {
                sentBody = await msg.Content!.ReadAsStringAsync();
                return new HttpResponseMessage
                {
                    StatusCode = HttpStatusCode.OK,
                    Content = new StringContent(JsonConvert.SerializeObject(new
                    {
                        data = new
                        {
                            inventoryAdjustQuantities = new
                            {
                                userErrors = Array.Empty<object>(),
                                inventoryAdjustmentGroup = new
                                {
                                    changes = new[] { new { delta = 100, quantityAfterChange = 112 } },
                                },
                            },
                        },
                    })),
                };
            });

        var after = await CreateService(handler.Object).AdjustInventoryAsync("4455", "82125062435", 100, "received");

        Assert.Equal(112, after);
        var input = JObject.Parse(sentBody!)["variables"]!["input"]!;
        Assert.Equal("received", input["reason"]!.Value<string>());
        Assert.Equal("available", input["name"]!.Value<string>());
        var change = input["changes"]![0]!;
        Assert.Equal(100, change["delta"]!.Value<int>());
        Assert.Equal("gid://shopify/InventoryItem/4455", change["inventoryItemId"]!.Value<string>());
        Assert.Equal("gid://shopify/Location/82125062435", change["locationId"]!.Value<string>());
    }

    private static ShopifyService CreateService(HttpMessageHandler handler)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ShopifyStoreDomain"] = "test-store.myshopify.com",
                ["ShopifyAccessToken"] = "shpat_test",
                ["ShopifyApiVersion"] = "2025-01"
            })
            .Build();

        var httpClientFactory = new Mock<IHttpClientFactory>();
        httpClientFactory.Setup(f => f.CreateClient("shopify")).Returns(new HttpClient(handler));
        return new ShopifyService(httpClientFactory.Object, config, NullLogger<ShopifyService>.Instance);
    }
}
