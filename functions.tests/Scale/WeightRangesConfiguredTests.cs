using ShipScan.Functions.Models;
using Xunit;

namespace ShipScan.Functions.Tests.Scale;

/// <summary>
/// Tests for the no-productId GET /api/scale/weight-ranges path that returns
/// all products with configured weight ranges (for the settings page list).
/// </summary>
public class WeightRangesConfiguredTests
{
    private const string OneRule  = "[{\"variantId\":\"v1\",\"label\":\"Small\",\"minLbs\":1.5,\"maxLbs\":2.0}]";
    private const string ThreeRules =
        "[{\"variantId\":\"v1\",\"label\":\"Small\",\"minLbs\":1.5,\"maxLbs\":2.0}," +
         "{\"variantId\":\"v2\",\"label\":\"Medium\",\"minLbs\":2.0,\"maxLbs\":2.5}," +
         "{\"variantId\":\"v3\",\"label\":\"Large\",\"minLbs\":2.5,\"maxLbs\":null}]";

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private static List<ProductVariantEntity> BuildVariants(
        params (string pk, string productId, string productTitle, string? weightRanges)[] rows)
    {
        return rows.Select(r => new ProductVariantEntity
        {
            PartitionKey = r.pk,
            ProductId    = r.productId,
            ProductTitle = r.productTitle,
            WeightRanges = r.weightRanges ?? "[]",
        }).ToList();
    }

    private static List<(string productId, string productTitle, int rulesCount)> FilterConfigured(
        List<ProductVariantEntity> all)
    {
        return all
            .Where(v => !string.IsNullOrWhiteSpace(v.WeightRanges) && v.WeightRanges != "[]")
            .GroupBy(v => v.PartitionKey)
            .Select(g =>
            {
                var first = g.First();
                int count = 0;
                try
                {
                    var rules = Newtonsoft.Json.JsonConvert.DeserializeObject<List<WeightRangeRule>>(first.WeightRanges ?? "[]");
                    count = rules?.Count ?? 0;
                }
                catch { }
                return (productId: first.ProductId ?? g.Key, productTitle: first.ProductTitle, rulesCount: count);
            })
            .Where(x => x.rulesCount > 0)
            .OrderBy(x => x.productTitle)
            .ToList();
    }

    // ─── Core listing ─────────────────────────────────────────────────────────

    [Fact]
    public void NoProductId_ReturnsOnlyProductsWithRules()
    {
        var variants = BuildVariants(
            ("100", "gid://shopify/Product/100", "Red Chicken", OneRule),
            ("200", "gid://shopify/Product/200", "Beef",        "[]")
        );

        var result = FilterConfigured(variants);

        Assert.Single(result);
        Assert.Equal("Red Chicken", result[0].productTitle);
    }

    [Fact]
    public void NoProductId_ExcludesProductsWithEmptyRulesJson()
    {
        var variants = BuildVariants(
            ("300", "gid://shopify/Product/300", "Lamb", "[]")
        );

        var result = FilterConfigured(variants);
        Assert.Empty(result);
    }

    [Fact]
    public void NoProductId_ExcludesProductsWithNullWeightRanges()
    {
        var variants = BuildVariants(
            ("400", "gid://shopify/Product/400", "Goat", null)
        );

        var result = FilterConfigured(variants);
        Assert.Empty(result);
    }

    [Fact]
    public void NoProductId_MultipleProductsReturnedAlphabetically()
    {
        var variants = BuildVariants(
            ("100", "gid://shopify/Product/100", "Red Chicken",   OneRule),
            ("200", "gid://shopify/Product/200", "Atlantic Salmon", OneRule)
        );

        var result = FilterConfigured(variants);

        Assert.Equal(2, result.Count);
        Assert.Equal("Atlantic Salmon", result[0].productTitle);
        Assert.Equal("Red Chicken", result[1].productTitle);
    }

    [Fact]
    public void NoProductId_MultipleVariantsSameProduct_DeduplicatesOnPartitionKey()
    {
        var variants = new List<ProductVariantEntity>
        {
            new() { PartitionKey = "100", ProductId = "gid://shopify/Product/100", ProductTitle = "Red Chicken", WeightRanges = OneRule },
            new() { PartitionKey = "100", ProductId = "gid://shopify/Product/100", ProductTitle = "Red Chicken", WeightRanges = OneRule },
        };

        var result = FilterConfigured(variants);
        Assert.Single(result);
    }

    [Fact]
    public void NoProductId_RulesCount_ReflectsActualTierCount()
    {
        var variants = BuildVariants(
            ("100", "gid://shopify/Product/100", "Red Chicken", ThreeRules)
        );

        var result = FilterConfigured(variants);

        Assert.Single(result);
        Assert.Equal(3, result[0].rulesCount);
    }

    [Fact]
    public void NoProductId_MalformedJson_ExcludedGracefully()
    {
        var variants = BuildVariants(
            ("500", "gid://shopify/Product/500", "Bad Product", "not-valid-json")
        );

        var result = FilterConfigured(variants);
        Assert.Empty(result);
    }

    [Fact]
    public void NoProductId_EmptyVariantList_ReturnsEmpty()
    {
        var result = FilterConfigured(new List<ProductVariantEntity>());
        Assert.Empty(result);
    }

    [Fact]
    public void NoProductId_OnlyOneProductHasRules_OthersHaveEmptyOrNull()
    {
        var variants = BuildVariants(
            ("100", "gid://shopify/Product/100", "Red Chicken", ThreeRules),
            ("200", "gid://shopify/Product/200", "Beef",        "[]"),
            ("300", "gid://shopify/Product/300", "Goat",        null)
        );

        var result = FilterConfigured(variants);
        Assert.Single(result);
        Assert.Equal("Red Chicken", result[0].productTitle);
        Assert.Equal("gid://shopify/Product/100", result[0].productId);
    }

    // ─── WeightRangeRule model ────────────────────────────────────────────────

    [Fact]
    public void WeightRangeRule_Deserializes_AllFields()
    {
        var json = "{\"variantId\":\"gid://shopify/ProductVariant/1\",\"label\":\"Medium\",\"minLbs\":2.0,\"maxLbs\":2.5}";
        var rule = Newtonsoft.Json.JsonConvert.DeserializeObject<WeightRangeRule>(json);

        Assert.NotNull(rule);
        Assert.Equal("gid://shopify/ProductVariant/1", rule!.VariantId);
        Assert.Equal("Medium", rule.Label);
        Assert.Equal(2.0, rule.MinLbs);
        Assert.Equal(2.5, rule.MaxLbs);
    }

    [Fact]
    public void WeightRangeRule_NullMaxLbs_DeserializesCorrectly()
    {
        var json = "{\"variantId\":\"v1\",\"label\":\"Large\",\"minLbs\":2.5,\"maxLbs\":null}";
        var rule = Newtonsoft.Json.JsonConvert.DeserializeObject<WeightRangeRule>(json);

        Assert.NotNull(rule);
        Assert.Null(rule!.MaxLbs);
    }

    [Fact]
    public void WeightRangeRule_DefaultVariantId_IsEmpty()
    {
        var rule = new WeightRangeRule();
        Assert.Equal("", rule.VariantId);
    }

    [Fact]
    public void WeightRangeRule_DefaultLabel_IsEmpty()
    {
        var rule = new WeightRangeRule();
        Assert.Equal("", rule.Label);
    }
}
