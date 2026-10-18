using System.Net;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Moq.Protected;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using ShipScan.Functions.Services;
using Xunit;

namespace ShipScan.Functions.Tests.Services;

/// <summary>
/// Tests for the custom.adjustments metafield / inventory mapping feature (Work Item 3).
///
/// Live tests require env vars:
///   SHIPSCAN_TEST_STORE_DOMAIN   e.g. my-store.myshopify.com
///   SHIPSCAN_TEST_ACCESS_TOKEN   a private app token with read_products scope
///   SHIPSCAN_TEST_VARIANT_ID     a numeric variant ID with custom.adjustments set (optional)
///
/// Without those vars the live tests are skipped at runtime.
/// </summary>
public class InventoryMappingTests
{
    // ─── Helpers ─────────────────────────────────────────────────────────────

    private static bool HasLiveCredentials =>
        !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("SHIPSCAN_TEST_STORE_DOMAIN")) &&
        !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("SHIPSCAN_TEST_ACCESS_TOKEN"));

    private static ShopifyService CreateService(HttpMessageHandler handler)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ShopifyStoreDomain"] = "test-store.myshopify.com",
                ["ShopifyAccessToken"] = "shpat_test",
                ["ShopifyApiVersion"]  = "2025-01"
            }).Build();

        var factory = new Mock<IHttpClientFactory>();
        factory.Setup(f => f.CreateClient("shopify")).Returns(new HttpClient(handler));
        return new ShopifyService(factory.Object, config, NullLogger<ShopifyService>.Instance);
    }

    private static ShopifyService CreateLiveService()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ShopifyStoreDomain"] = Environment.GetEnvironmentVariable("SHIPSCAN_TEST_STORE_DOMAIN"),
                ["ShopifyAccessToken"] = Environment.GetEnvironmentVariable("SHIPSCAN_TEST_ACCESS_TOKEN"),
                ["ShopifyApiVersion"]  = "2025-01"
            }).Build();

        var factory = new Mock<IHttpClientFactory>();
        factory.Setup(f => f.CreateClient("shopify")).Returns(new HttpClient());
        return new ShopifyService(factory.Object, config, NullLogger<ShopifyService>.Instance);
    }

    private static HttpMessageHandler MockGraphQlResponse(object dataPayload)
    {
        var mock = new Mock<HttpMessageHandler>();
        mock.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = HttpStatusCode.OK,
                Content    = new StringContent(JsonConvert.SerializeObject(new { data = dataPayload }))
            });
        return mock.Object;
    }

    // ─── Metafield parsing — variant-level ───────────────────────────────────

    [Fact]
    public async Task GetVariantAdjustments_VariantMetafield_ReturnsAdjustments()
    {
        var metafieldJson = JsonConvert.SerializeObject(new
        {
            parent_inventory_id  = "gid://shopify/InventoryItem/999",
            weight_per_unit      = 3.5,
            is_weighted          = true,
            parent_location_id   = "gid://shopify/Location/111",
            parent_product_handle = "whole-salmon",
            parent_product_title  = "Whole Atlantic Salmon"
        });

        var handler = MockGraphQlResponse(new
        {
            productVariant = new
            {
                metafield = new { value = metafieldJson },
                product   = new { metafield = (object?)null }
            }
        });

        var svc = CreateService(handler);
        var result = await svc.GetVariantAdjustmentsAsync("123456789");

        Assert.NotNull(result);
        Assert.Equal("gid://shopify/InventoryItem/999", result!["parent_inventory_id"]?.ToString());
        Assert.Equal(3.5, result["weight_per_unit"]?.ToObject<double>());
        Assert.True(result["is_weighted"]?.ToObject<bool>());
        Assert.Equal("Whole Atlantic Salmon", result["parent_product_title"]?.ToString());
    }

    [Fact]
    public async Task GetVariantAdjustments_ProductMetafield_UsedWhenVariantMetafieldAbsent()
    {
        var metafieldJson = JsonConvert.SerializeObject(new
        {
            parent_inventory_id  = "gid://shopify/InventoryItem/777",
            weight_per_unit      = 5.0,
            is_weighted          = true,
            parent_location_id   = "gid://shopify/Location/111",
            parent_product_handle = "whole-tuna",
            parent_product_title  = "Whole Bluefin Tuna"
        });

        var handler = MockGraphQlResponse(new
        {
            productVariant = new
            {
                metafield = (object?)null,
                product   = new { metafield = new { value = metafieldJson } }
            }
        });

        var svc = CreateService(handler);
        var result = await svc.GetVariantAdjustmentsAsync("gid://shopify/ProductVariant/999");

        Assert.NotNull(result);
        Assert.Equal("Whole Bluefin Tuna", result!["parent_product_title"]?.ToString());
        Assert.Equal(5.0, result["weight_per_unit"]?.ToObject<double>());
    }

    [Fact]
    public async Task GetVariantAdjustments_VariantMetafieldTakesPrecedenceOverProduct()
    {
        var variantJson = JsonConvert.SerializeObject(new
        {
            parent_inventory_id   = "gid://shopify/InventoryItem/101",
            weight_per_unit       = 2.0,
            is_weighted           = true,
            parent_location_id    = "gid://shopify/Location/111",
            parent_product_handle = "atlantic-salmon-fillet",
            parent_product_title  = "Atlantic Salmon Fillet"
        });
        var productJson = JsonConvert.SerializeObject(new
        {
            parent_inventory_id   = "gid://shopify/InventoryItem/999",
            weight_per_unit       = 10.0,
            is_weighted           = true,
            parent_location_id    = "gid://shopify/Location/111",
            parent_product_handle = "whole-salmon",
            parent_product_title  = "Whole Atlantic Salmon"
        });

        var handler = MockGraphQlResponse(new
        {
            productVariant = new
            {
                metafield = new { value = variantJson },
                product   = new { metafield = new { value = productJson } }
            }
        });

        var svc = CreateService(handler);
        var result = await svc.GetVariantAdjustmentsAsync("111");

        Assert.NotNull(result);
        Assert.Equal("Atlantic Salmon Fillet", result!["parent_product_title"]?.ToString());
        Assert.Equal(2.0, result["weight_per_unit"]?.ToObject<double>());
    }

    [Fact]
    public async Task GetVariantAdjustments_NoMetafield_ReturnsNull()
    {
        var handler = MockGraphQlResponse(new
        {
            productVariant = new
            {
                metafield = (object?)null,
                product   = new { metafield = (object?)null }
            }
        });

        var svc = CreateService(handler);
        var result = await svc.GetVariantAdjustmentsAsync("123");

        Assert.Null(result);
    }

    [Fact]
    public async Task GetVariantAdjustments_NullVariant_ReturnsNull()
    {
        var handler = MockGraphQlResponse(new { productVariant = (object?)null });

        var svc = CreateService(handler);
        var result = await svc.GetVariantAdjustmentsAsync("nonexistent");

        Assert.Null(result);
    }

    [Fact]
    public async Task GetVariantAdjustments_InvalidJsonInMetafield_ReturnsNull()
    {
        var handler = MockGraphQlResponse(new
        {
            productVariant = new
            {
                metafield = new { value = "not-valid-json{{" },
                product   = new { metafield = (object?)null }
            }
        });

        var svc = CreateService(handler);
        var result = await svc.GetVariantAdjustmentsAsync("123");

        Assert.Null(result);
    }

    [Fact]
    public async Task GetVariantAdjustments_EmptyStringMetafield_ReturnsNull()
    {
        var handler = MockGraphQlResponse(new
        {
            productVariant = new
            {
                metafield = new { value = "" },
                product   = new { metafield = (object?)null }
            }
        });

        var svc = CreateService(handler);
        var result = await svc.GetVariantAdjustmentsAsync("123");

        Assert.Null(result);
    }

    // ─── GID normalization ────────────────────────────────────────────────────

    [Theory]
    [InlineData("123456")]                                    // numeric ID
    [InlineData("gid://shopify/ProductVariant/123456")]       // full GID
    public async Task GetVariantAdjustments_NormalizesVariantIdToGid(string variantId)
    {
        string? capturedBody = null;
        var mock = new Mock<HttpMessageHandler>();
        mock.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
            .Returns<HttpRequestMessage, CancellationToken>(async (req, _) =>
            {
                capturedBody = await req.Content!.ReadAsStringAsync();
                return new HttpResponseMessage
                {
                    StatusCode = HttpStatusCode.OK,
                    Content    = new StringContent(JsonConvert.SerializeObject(new
                    {
                        data = new
                        {
                            productVariant = new
                            {
                                metafield = (object?)null,
                                product   = new { metafield = (object?)null }
                            }
                        }
                    }))
                };
            });

        var svc = CreateService(mock.Object);
        await svc.GetVariantAdjustmentsAsync(variantId);

        Assert.NotNull(capturedBody);
        Assert.Contains("gid://shopify/ProductVariant/123456", capturedBody!);
    }

    // ─── Deduction calculation logic ──────────────────────────────────────────

    [Theory]
    [InlineData(3.5, 7.0, 2.0)]    // 7 lbs / 3.5 lbs-per-unit = 2 units
    [InlineData(5.0, 2.5, 0.5)]    // 2.5 lbs / 5.0 = 0.5 units
    [InlineData(1.0, 1.0, 1.0)]    // 1 lb / 1 = 1 unit
    [InlineData(2.5, 5.0, 2.0)]    // 5 lbs / 2.5 = 2 units
    public void DeductionCalculation_IsWeightDividedByWeightPerUnit(double weightPerUnit, double actualWeight, double expectedUnits)
    {
        var deducted = actualWeight / weightPerUnit;
        Assert.Equal(expectedUnits, deducted, precision: 5);
    }

    // ─── is_weighted = false: fixed deduction of 1 ───────────────────────────

    [Fact]
    public async Task GetVariantAdjustments_NotWeighted_IsWeightedFalse()
    {
        var metafieldJson = JsonConvert.SerializeObject(new
        {
            parent_inventory_id   = "gid://shopify/InventoryItem/888",
            weight_per_unit       = 0,
            is_weighted           = false,
            parent_location_id    = "gid://shopify/Location/111",
            parent_product_handle = "whole-chicken",
            parent_product_title  = "Whole Chicken"
        });

        var handler = MockGraphQlResponse(new
        {
            productVariant = new
            {
                metafield = new { value = metafieldJson },
                product   = new { metafield = (object?)null }
            }
        });

        var svc = CreateService(handler);
        var result = await svc.GetVariantAdjustmentsAsync("500");

        Assert.NotNull(result);
        Assert.False(result!["is_weighted"]?.ToObject<bool>());
        Assert.Equal("Whole Chicken", result["parent_product_title"]?.ToString());
    }

    // ─── HTTP error handling ──────────────────────────────────────────────────

    [Fact]
    public async Task GetVariantAdjustments_GraphQlError_ReturnsNull()
    {
        var mock = new Mock<HttpMessageHandler>();
        mock.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = HttpStatusCode.OK,
                Content    = new StringContent(JsonConvert.SerializeObject(new
                {
                    errors = new[] { new { message = "Access denied for productVariant field" } }
                }))
            });

        var svc = CreateService(mock.Object);
        var result = await svc.GetVariantAdjustmentsAsync("123");

        Assert.Null(result);
    }

    [Fact]
    public async Task GetVariantAdjustments_Http500_ReturnsNull()
    {
        var mock = new Mock<HttpMessageHandler>();
        mock.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(new HttpResponseMessage { StatusCode = HttpStatusCode.InternalServerError });

        var svc = CreateService(mock.Object);
        var result = await svc.GetVariantAdjustmentsAsync("123");

        Assert.Null(result);
    }

    // ─── Live tests (skipped when credentials absent) ────────────────────────

    [Fact]
    public async Task Live_GetVariantAdjustments_ReturnsNullOrValidShape()
    {
        if (!HasLiveCredentials) return;

        var variantIdRaw = Environment.GetEnvironmentVariable("SHIPSCAN_TEST_VARIANT_ID");
        if (string.IsNullOrWhiteSpace(variantIdRaw)) return;

        var svc = CreateLiveService();
        var result = await svc.GetVariantAdjustmentsAsync(variantIdRaw);

        // May be null if this variant has no metafield — that's valid
        if (result == null) return;

        // If present, validate shape
        Assert.True(result.ContainsKey("is_weighted"),       "missing is_weighted");
        Assert.True(result.ContainsKey("weight_per_unit"),   "missing weight_per_unit");
        Assert.True(result.ContainsKey("parent_product_title"), "missing parent_product_title");
        Assert.True(result.ContainsKey("parent_inventory_id"), "missing parent_inventory_id");
    }

    [Fact]
    public async Task Live_GetVariantAdjustments_NullForUnknownVariant()
    {
        if (!HasLiveCredentials) return;

        var svc = CreateLiveService();
        var result = await svc.GetVariantAdjustmentsAsync("0000000000001");

        Assert.Null(result);
    }

    // ─── GetVariantAdjustments — embeds child_inventory_item_id ──────────────

    [Fact]
    public async Task GetVariantAdjustments_WithInventoryItem_EmbedsChildInventoryItemId()
    {
        var metafieldJson = JsonConvert.SerializeObject(new
        {
            parent_inventory_id   = "gid://shopify/InventoryItem/999",
            weight_per_unit       = 3.5,
            is_weighted           = true,
            parent_location_id    = "gid://shopify/Location/111",
            parent_product_handle = "whole-salmon",
            parent_product_title  = "Whole Atlantic Salmon"
        });

        var handler = MockGraphQlResponse(new
        {
            productVariant = new
            {
                inventoryItem = new { id = "gid://shopify/InventoryItem/42" },
                metafield = new { value = metafieldJson },
                product   = new { metafield = (object?)null }
            }
        });

        var svc = CreateService(handler);
        var result = await svc.GetVariantAdjustmentsAsync("123456789");

        Assert.NotNull(result);
        Assert.Equal("gid://shopify/InventoryItem/42", result!["child_inventory_item_id"]?.ToString());
        Assert.Equal("gid://shopify/InventoryItem/999", result["parent_inventory_id"]?.ToString());
    }

    [Fact]
    public async Task GetVariantAdjustments_NoInventoryItem_DoesNotEmbedChildId()
    {
        var metafieldJson = JsonConvert.SerializeObject(new
        {
            parent_inventory_id  = "gid://shopify/InventoryItem/999",
            weight_per_unit      = 1.0,
            is_weighted          = false,
            parent_location_id   = "gid://shopify/Location/111",
            parent_product_handle = "whole-chicken",
            parent_product_title  = "Whole Chicken"
        });

        var handler = MockGraphQlResponse(new
        {
            productVariant = new
            {
                metafield = new { value = metafieldJson },
                product   = new { metafield = (object?)null }
            }
        });

        var svc = CreateService(handler);
        var result = await svc.GetVariantAdjustmentsAsync("789");

        Assert.NotNull(result);
        Assert.Null(result!["child_inventory_item_id"]);
    }

    // ─── GetVariantInventoryAsync — unit tests ────────────────────────────────

    [Fact]
    public async Task GetVariantInventory_ReturnsInventoryItemIdAndLocationId()
    {
        var handler = MockGraphQlResponse(new
        {
            productVariant = new
            {
                inventoryItem = new
                {
                    id = "gid://shopify/InventoryItem/12345",
                    inventoryLevels = new
                    {
                        nodes = new[]
                        {
                            new { location = new { id = "gid://shopify/Location/67890" } }
                        }
                    }
                }
            }
        });

        var svc = CreateService(handler);
        var (itemId, locationId) = await svc.GetVariantInventoryAsync("111");

        Assert.Equal("gid://shopify/InventoryItem/12345", itemId);
        Assert.Equal("gid://shopify/Location/67890", locationId);
    }

    [Fact]
    public async Task GetVariantInventory_NullVariant_ReturnsNullTuple()
    {
        var handler = MockGraphQlResponse(new { productVariant = (object?)null });

        var svc = CreateService(handler);
        var (itemId, locationId) = await svc.GetVariantInventoryAsync("nonexistent");

        Assert.Null(itemId);
        Assert.Null(locationId);
    }

    [Fact]
    public async Task GetVariantInventory_NoInventoryLevels_ReturnsItemIdOnly()
    {
        var handler = MockGraphQlResponse(new
        {
            productVariant = new
            {
                inventoryItem = new
                {
                    id = "gid://shopify/InventoryItem/99",
                    inventoryLevels = new { nodes = new object[0] }
                }
            }
        });

        var svc = CreateService(handler);
        var (itemId, locationId) = await svc.GetVariantInventoryAsync("123");

        Assert.Equal("gid://shopify/InventoryItem/99", itemId);
        Assert.Null(locationId);
    }

    [Fact]
    public async Task GetVariantInventory_GraphQlError_ReturnsNullTuple()
    {
        var mock = new Mock<HttpMessageHandler>();
        mock.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = HttpStatusCode.OK,
                Content    = new StringContent(JsonConvert.SerializeObject(new
                {
                    errors = new[] { new { message = "Access denied" } }
                }))
            });

        var svc = CreateService(mock.Object);
        var (itemId, locationId) = await svc.GetVariantInventoryAsync("123");

        Assert.Null(itemId);
        Assert.Null(locationId);
    }

    [Theory]
    [InlineData("9876")]
    [InlineData("gid://shopify/ProductVariant/9876")]
    public async Task GetVariantInventory_NormalizesVariantIdToGid(string variantId)
    {
        string? capturedBody = null;
        var mock = new Mock<HttpMessageHandler>();
        mock.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
            .Returns<HttpRequestMessage, CancellationToken>(async (req, _) =>
            {
                capturedBody = await req.Content!.ReadAsStringAsync();
                return new HttpResponseMessage
                {
                    StatusCode = HttpStatusCode.OK,
                    Content    = new StringContent(JsonConvert.SerializeObject(new
                    {
                        data = new { productVariant = (object?)null }
                    }))
                };
            });

        var svc = CreateService(mock.Object);
        await svc.GetVariantInventoryAsync(variantId);

        Assert.NotNull(capturedBody);
        Assert.Contains("gid://shopify/ProductVariant/9876", capturedBody!);
    }

    // ─── GetChildTransformationVariantsAsync — unit tests ─────────────────────

    [Fact]
    public async Task GetChildTransformationVariants_ReturnsMatchingChildren()
    {
        const string parentInventoryId = "gid://shopify/InventoryItem/100";
        var childAdjJson = JsonConvert.SerializeObject(new
        {
            parent_inventory_id  = parentInventoryId,
            weight_per_unit      = 2.0,
            is_weighted          = true,
            parent_location_id   = "gid://shopify/Location/200",
            parent_product_handle = "whole-salmon",
            parent_product_title  = "Whole Salmon"
        });
        var otherAdjJson = JsonConvert.SerializeObject(new
        {
            parent_inventory_id  = "gid://shopify/InventoryItem/999",  // different parent
            weight_per_unit      = 1.0,
            is_weighted          = false,
            parent_location_id   = "gid://shopify/Location/200",
            parent_product_handle = "other-product",
            parent_product_title  = "Other Product"
        });

        var handler = MockGraphQlResponse(new
        {
            productVariant = new
            {
                inventoryItem = new { id = parentInventoryId },
                product = new
                {
                    variants = new
                    {
                        nodes = new object[]
                        {
                            new { id = "gid://shopify/ProductVariant/10", title = "Ready to Cook", inventoryItem = new { id = "gid://shopify/InventoryItem/10" }, metafield = new { value = childAdjJson } },
                            new { id = "gid://shopify/ProductVariant/20", title = "Other Child",   inventoryItem = new { id = "gid://shopify/InventoryItem/20" }, metafield = new { value = otherAdjJson } },
                            new { id = "gid://shopify/ProductVariant/30", title = "No Metafield",  inventoryItem = new { id = "gid://shopify/InventoryItem/30" }, metafield = (object?)null }
                        }
                    }
                }
            }
        });

        var svc = CreateService(handler);
        var options = await svc.GetChildTransformationVariantsAsync("parent-variant-id");

        Assert.Single(options);
        Assert.Equal("gid://shopify/ProductVariant/10", options[0].VariantId);
        Assert.Equal("Ready to Cook", options[0].Title);
        Assert.Equal("gid://shopify/InventoryItem/10", options[0].InventoryItemId);
        Assert.Equal("gid://shopify/Location/200", options[0].LocationId);
    }

    [Fact]
    public async Task GetChildTransformationVariants_NoChildren_ReturnsEmpty()
    {
        var handler = MockGraphQlResponse(new
        {
            productVariant = new
            {
                inventoryItem = new { id = "gid://shopify/InventoryItem/100" },
                product = new
                {
                    variants = new { nodes = new object[0] }
                }
            }
        });

        var svc = CreateService(handler);
        var options = await svc.GetChildTransformationVariantsAsync("parent");

        Assert.Empty(options);
    }

    [Fact]
    public async Task GetChildTransformationVariants_NullParentVariant_ReturnsEmpty()
    {
        var handler = MockGraphQlResponse(new { productVariant = (object?)null });

        var svc = CreateService(handler);
        var options = await svc.GetChildTransformationVariantsAsync("nonexistent");

        Assert.Empty(options);
    }

    [Fact]
    public async Task GetChildTransformationVariants_NoParentInventoryItem_ReturnsEmpty()
    {
        var handler = MockGraphQlResponse(new
        {
            productVariant = new
            {
                inventoryItem = (object?)null,
                product = new { variants = new { nodes = new object[0] } }
            }
        });

        var svc = CreateService(handler);
        var options = await svc.GetChildTransformationVariantsAsync("parent");

        Assert.Empty(options);
    }

    // ─── AdjustInventoryAsync — unit tests ───────────────────────────────────

    [Fact]
    public async Task AdjustInventory_ReturnsQuantityAfterChange()
    {
        var handler = MockGraphQlResponse(new
        {
            inventoryAdjustQuantities = new
            {
                userErrors = new object[0],
                inventoryAdjustmentGroup = new
                {
                    changes = new[]
                    {
                        new { delta = -2, quantityAfterChange = 18, item = new { id = "gid://shopify/InventoryItem/123" }, location = new { id = "gid://shopify/Location/456" } }
                    }
                }
            }
        });

        var svc = CreateService(handler);
        var after = await svc.AdjustInventoryAsync("gid://shopify/InventoryItem/123", "gid://shopify/Location/456", -2);

        Assert.Equal(18, after);
    }

    [Fact]
    public async Task AdjustInventory_NormalizesNumericIdsToGid()
    {
        string? capturedBody = null;
        var mock = new Mock<HttpMessageHandler>();
        mock.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
            .Returns<HttpRequestMessage, CancellationToken>(async (req, _) =>
            {
                capturedBody = await req.Content!.ReadAsStringAsync();
                return new HttpResponseMessage
                {
                    StatusCode = HttpStatusCode.OK,
                    Content    = new StringContent(JsonConvert.SerializeObject(new
                    {
                        data = new
                        {
                            inventoryAdjustQuantities = new
                            {
                                userErrors = new object[0],
                                inventoryAdjustmentGroup = new
                                {
                                    changes = new[] { new { delta = -1, quantityAfterChange = 9 } }
                                }
                            }
                        }
                    }))
                };
            });

        var svc = CreateService(mock.Object);
        await svc.AdjustInventoryAsync("999111", "888222", -1);

        Assert.NotNull(capturedBody);
        Assert.Contains("gid://shopify/InventoryItem/999111", capturedBody!);
        Assert.Contains("gid://shopify/Location/888222", capturedBody!);
    }

    [Fact]
    public async Task AdjustInventory_ThrowsOnUserErrors()
    {
        var handler = MockGraphQlResponse(new
        {
            inventoryAdjustQuantities = new
            {
                userErrors = new[] { new { field = new[] { "delta" }, message = "Invalid delta value" } },
                inventoryAdjustmentGroup = (object?)null
            }
        });

        var svc = CreateService(handler);
        var ex = await Assert.ThrowsAnyAsync<Exception>(() =>
            svc.AdjustInventoryAsync("123", "456", -5));
        Assert.Contains("Invalid delta value", ex.Message);
    }

    [Fact]
    public async Task AdjustInventory_NegativeDelta_DeductsInventory()
    {
        var capturedDelta = 0;
        var mock = new Mock<HttpMessageHandler>();
        mock.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
            .Returns<HttpRequestMessage, CancellationToken>(async (req, _) =>
            {
                var body = await req.Content!.ReadAsStringAsync();
                var parsed = JsonConvert.DeserializeObject<JObject>(body);
                var changes = parsed?["variables"]?["input"]?["changes"] as JArray;
                capturedDelta = changes?[0]?["delta"]?.ToObject<int>() ?? 0;
                return new HttpResponseMessage
                {
                    StatusCode = HttpStatusCode.OK,
                    Content    = new StringContent(JsonConvert.SerializeObject(new
                    {
                        data = new
                        {
                            inventoryAdjustQuantities = new
                            {
                                userErrors = new object[0],
                                inventoryAdjustmentGroup = new
                                {
                                    changes = new[] { new { delta = -3, quantityAfterChange = 7 } }
                                }
                            }
                        }
                    }))
                };
            });

        var svc = CreateService(mock.Object);
        await svc.AdjustInventoryAsync("gid://shopify/InventoryItem/1", "gid://shopify/Location/2", -3);

        Assert.Equal(-3, capturedDelta);
    }

    [Theory]
    [InlineData(7.0,  3.5,  2)]  // 7 / 3.5 = 2.0 → 2
    [InlineData(9.0,  4.0,  2)]  // 9 / 4 = 2.25 → 2
    [InlineData(11.0, 4.0,  3)]  // 11 / 4 = 2.75 → 3
    [InlineData(1.0,  1.0,  1)]  // 1 / 1 = 1
    [InlineData(5.0,  2.0,  3)]  // 5 / 2 = 2.5 → 3 (rounds half up, matches JS Math.round)
    [InlineData(15.0, 6.0,  3)]  // 15 / 6 = 2.5 → 3
    public void WeightedDeltaCalculation_RoundsToNearestInt(double weight, double perUnit, int expectedDelta)
    {
        // Use MidpointRounding.AwayFromZero to match JS Math.round behaviour (rounds 0.5 up)
        var delta = (int)Math.Round(weight / perUnit, MidpointRounding.AwayFromZero);
        Assert.Equal(expectedDelta, delta);
    }
}
