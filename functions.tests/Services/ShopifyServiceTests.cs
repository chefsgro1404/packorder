using System.Net;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Moq.Protected;
using Newtonsoft.Json;
using ShipScan.Functions.Services;
using Xunit;

namespace ShipScan.Functions.Tests.Services;

public class ShopifyServiceTests
{
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
        var client = new HttpClient(handler);
        httpClientFactory.Setup(f => f.CreateClient("shopify")).Returns(client);

        return new ShopifyService(httpClientFactory.Object, config, NullLogger<ShopifyService>.Instance);
    }

    private static HttpMessageHandler MockHandler(object responseBody, HttpStatusCode statusCode = HttpStatusCode.OK)
    {
        var handlerMock = new Mock<HttpMessageHandler>();
        handlerMock
            .Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = statusCode,
                Content = new StringContent(JsonConvert.SerializeObject(responseBody))
            });
        return handlerMock.Object;
    }

    [Fact]
    public async Task GetVariantByBarcodeAsync_Found_ReturnsVariant()
    {
        var shopifyResponse = new
        {
            data = new
            {
                productVariants = new
                {
                    edges = new[]
                    {
                        new
                        {
                            node = new
                            {
                                id = "gid://shopify/ProductVariant/123",
                                sku = "SKU-001",
                                barcode = "1234567890",
                                price = "9.99",
                                title = "Small",
                                inventoryQuantity = 10,
                                product = new
                                {
                                    id = "gid://shopify/Product/1",
                                    title = "Test Product",
                                    featuredImage = (object?)null
                                }
                            }
                        }
                    }
                }
            }
        };

        var svc = CreateService(MockHandler(shopifyResponse));
        var result = await svc.GetVariantByBarcodeAsync("1234567890");

        Assert.NotNull(result);
        Assert.Equal("gid://shopify/ProductVariant/123", result!.Id);
        Assert.Equal("SKU-001", result.Sku);
        Assert.Equal("9.99", result.Price);
    }

    [Fact]
    public async Task GetVariantByBarcodeAsync_NotFound_ReturnsNull()
    {
        var shopifyResponse = new
        {
            data = new
            {
                productVariants = new { edges = Array.Empty<object>() }
            }
        };

        var svc = CreateService(MockHandler(shopifyResponse));
        var result = await svc.GetVariantByBarcodeAsync("NOTEXIST");
        Assert.Null(result);
    }

    [Fact]
    public async Task GetOrderByRefAsync_Found_ReturnsOrder()
    {
        var shopifyResponse = new
        {
            data = new
            {
                orders = new
                {
                    edges = new[]
                    {
                        new
                        {
                            node = new
                            {
                                id = "gid://shopify/Order/456",
                                name = "#1001",
                                displayFulfillmentStatus = "UNFULFILLED",
                                tags = new string[] { "label-printed" },
                                lineItems = new { edges = Array.Empty<object>() },
                                metafield = new { value = "1Z999AA10123456784" },
                                trackingCarrier = new { value = "UPS" },
                                trackingUrl = (object?)null,
                                shippingAddress = new
                                {
                                    name = "John Doe",
                                    address1 = "123 Main St",
                                    city = "Toronto",
                                    provinceCode = "ON",
                                    zip = "M5V 3A8"
                                },
                                fulfillmentOrders = new
                                {
                                    edges = new[]
                                    {
                                        new
                                        {
                                            node = new
                                            {
                                                id = "gid://shopify/FulfillmentOrder/789",
                                                status = "OPEN",
                                                lineItems = new
                                                {
                                                    edges = new[]
                                                    {
                                                        new { node = new { id = "gid://shopify/FulfillmentOrderLineItem/1", remainingQuantity = 2 } }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        };

        var svc = CreateService(MockHandler(shopifyResponse));
        var result = await svc.GetOrderByRefAsync("#1001");

        Assert.NotNull(result);
        Assert.Equal("#1001", result!.Name);
        Assert.Equal("UNFULFILLED", result.DisplayFulfillmentStatus);
        Assert.Equal("1Z999AA10123456784", result.TrackingNumber?.Value);
    }

    [Fact]
    public async Task GetOrderByRefAsync_NotFound_ReturnsNull()
    {
        var shopifyResponse = new
        {
            data = new
            {
                orders = new { edges = Array.Empty<object>() }
            }
        };

        var svc = CreateService(MockHandler(shopifyResponse));
        var result = await svc.GetOrderByRefAsync("#9999");
        Assert.Null(result);
    }

    [Fact]
    public async Task CreateDraftOrderAsync_Success_ReturnsDraftOrder()
    {
        var shopifyResponse = new
        {
            data = new
            {
                draftOrderCreate = new
                {
                    draftOrder = new
                    {
                        id = "gid://shopify/DraftOrder/1",
                        name = "#D1",
                        totalPrice = "19.99",
                        lineItems = new { edges = Array.Empty<object>() }
                    },
                    userErrors = Array.Empty<object>()
                }
            }
        };

        var svc = CreateService(MockHandler(shopifyResponse));
        var result = await svc.CreateDraftOrderAsync("gid://shopify/ProductVariant/123", 1);

        Assert.NotNull(result);
        Assert.Equal("#D1", result.Name);
        Assert.Equal("19.99", result.TotalPrice);
    }

    [Fact]
    public async Task CreateDraftOrderAsync_WithUserErrors_Throws()
    {
        var shopifyResponse = new
        {
            data = new
            {
                draftOrderCreate = new
                {
                    draftOrder = (object?)null,
                    userErrors = new[] { new { field = new[] { "variantId" }, message = "Variant not found" } }
                }
            }
        };

        var svc = CreateService(MockHandler(shopifyResponse));
        await Assert.ThrowsAsync<Exception>(() =>
            svc.CreateDraftOrderAsync("invalid-id", 1));
    }

    [Fact]
    public async Task FetchAllProductVariantsAsync_NullFeaturedImage_DoesNotThrow()
    {
        var shopifyResponse = new
        {
            data = new
            {
                products = new
                {
                    pageInfo = new { hasNextPage = false, endCursor = (string?)null },
                    edges = new[]
                    {
                        new
                        {
                            node = new
                            {
                                id = "gid://shopify/Product/1",
                                title = "Widget",
                                vendor = "Acme",
                                tags = new string[] { },
                                updatedAt = "2025-01-01T00:00:00Z",
                                featuredImage = (object?)null,
                                variants = new
                                {
                                    edges = new[]
                                    {
                                        new { node = new { id = "gid://shopify/ProductVariant/10", sku = "W-001", barcode = "111", title = "Default Title", price = "5.00" } }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        };

        var svc = CreateService(MockHandler(shopifyResponse));
        var results = await svc.FetchAllProductVariantsAsync();

        Assert.Single(results);
        Assert.Null(results[0].ImageUrl);
        Assert.Equal("W-001", results[0].Sku);
    }

    [Fact]
    public async Task FetchAllProductVariantsAsync_WithImage_MapsCorrectly()
    {
        var shopifyResponse = new
        {
            data = new
            {
                products = new
                {
                    pageInfo = new { hasNextPage = false, endCursor = (string?)null },
                    edges = new[]
                    {
                        new
                        {
                            node = new
                            {
                                id = "gid://shopify/Product/2",
                                title = "Gadget",
                                vendor = "Corp",
                                tags = new[] { "featured" },
                                updatedAt = "2025-06-01T00:00:00Z",
                                featuredImage = new { url = "https://cdn.shopify.com/img.jpg" },
                                variants = new
                                {
                                    edges = new[]
                                    {
                                        new { node = new { id = "gid://shopify/ProductVariant/20", sku = "G-001", barcode = "222", title = "Red", price = "12.00" } },
                                        new { node = new { id = "gid://shopify/ProductVariant/21", sku = "G-002", barcode = (string?)null, title = "Blue", price = "12.00" } }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        };

        var svc = CreateService(MockHandler(shopifyResponse));
        var results = await svc.FetchAllProductVariantsAsync();

        Assert.Equal(2, results.Count);
        Assert.Equal("https://cdn.shopify.com/img.jpg", results[0].ImageUrl);
        Assert.Equal("https://cdn.shopify.com/img.jpg", results[1].ImageUrl);
        Assert.Equal("Corp", results[0].Vendor);
        Assert.Null(results[1].Barcode);
    }

    [Fact]
    public async Task SearchVariantsByProductTitleAsync_ReturnsFlattened()
    {
        var shopifyResponse = new
        {
            data = new
            {
                products = new
                {
                    edges = new[]
                    {
                        new
                        {
                            node = new
                            {
                                id = "gid://shopify/Product/1",
                                title = "Green Chilli",
                                featuredImage = (object?)null,
                                variants = new
                                {
                                    edges = new[]
                                    {
                                        new { node = new { id = "gid://shopify/ProductVariant/1", sku = "GC-500G", barcode = (string?)null, title = "500g" } },
                                        new { node = new { id = "gid://shopify/ProductVariant/2", sku = "GC-1KG", barcode = (string?)null, title = "1kg" } }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        };

        var svc = CreateService(MockHandler(shopifyResponse));
        var results = await svc.SearchVariantsByProductTitleAsync("Green");

        Assert.Equal(2, results.Count);
        Assert.Equal("500g", results[0].Title);
        Assert.Equal("1kg", results[1].Title);
        Assert.Equal("Green Chilli", results[0].Product.Title);
    }
}
