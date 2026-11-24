using ShipScan.Functions.Helpers;
using ShipScan.Functions.Models;
using Xunit;

namespace ShipScan.Functions.Tests.Scale;

public class WeightRangeHelperTests
{
    private static WeightRangeRule Rule(string label, double min, double? max, string? variantId = null) =>
        new() { VariantId = variantId ?? label, Label = label, MinLbs = min, MaxLbs = max };

    private static string Json(params WeightRangeRule[] rules) => Newtonsoft.Json.JsonConvert.SerializeObject(rules);

    // ─── Variant first, then product; never a sibling ────────────────────────

    [Fact]
    public void Effective_VariantWithOwnRanges_UsesThem()
    {
        var v = new ProductVariantEntity { WeightRanges = Json(Rule("P", 1, 2)), VariantWeightRanges = Json(Rule("V", 3, 4)) };
        Assert.Equal("V", Assert.Single(WeightRangeHelper.Effective(v)).Label);
    }

    [Fact]
    public void Effective_VariantWithoutOwnRanges_UsesProducts()
    {
        var v = new ProductVariantEntity { WeightRanges = Json(Rule("P", 1, 2)), VariantWeightRanges = null };
        Assert.Equal("P", Assert.Single(WeightRangeHelper.Effective(v)).Label);
    }

    [Fact]
    public void Effective_EmptyOwnRanges_FallBackToProducts()
    {
        var v = new ProductVariantEntity { WeightRanges = Json(Rule("P", 1, 2)), VariantWeightRanges = "[]" };
        Assert.Equal("P", Assert.Single(WeightRangeHelper.Effective(v)).Label);
    }

    [Fact]
    public void Effective_NothingConfigured_IsEmpty()
    {
        Assert.Empty(WeightRangeHelper.Effective(new ProductVariantEntity { WeightRanges = "[]" }));
        Assert.Empty(WeightRangeHelper.Effective(new ProductVariantEntity { WeightRanges = "not json" }));
    }

    // ─── Boundaries: both ends included, shared boundary → lower tier ────────

    [Theory]
    [InlineData(1.5, "A")]
    [InlineData(1.7, "A")]
    [InlineData(1.9, "A")]      // shared boundary → lower tier
    [InlineData(1.9001, "B")]
    [InlineData(2.5, "B")]      // upper bound included
    public void Match_SharedBoundary_GoesToLowerTier(double lbs, string expected)
    {
        var rules = new List<WeightRangeRule> { Rule("A", 1.5, 1.9), Rule("B", 1.9, 2.5) };
        Assert.Equal(expected, Assert.Single(WeightRangeHelper.Match(rules, lbs)).Label);
    }

    [Theory]
    [InlineData(1.4)]
    [InlineData(2.5001)]
    [InlineData(0)]
    [InlineData(-1)]
    public void Match_OutsideEveryTier_IsEmpty(double lbs)
    {
        var rules = new List<WeightRangeRule> { Rule("A", 1.5, 1.9), Rule("B", 1.9, 2.5) };
        Assert.Empty(WeightRangeHelper.Match(rules, lbs));
    }

    [Fact]
    public void Match_NoUpperBound_MatchesAnyHeavierWeight()
    {
        var rules = new List<WeightRangeRule> { Rule("A", 1.5, 2.0), Rule("XL", 2.0, null) };
        Assert.Equal("XL", Assert.Single(WeightRangeHelper.Match(rules, 50)).Label);
        Assert.Equal("A", Assert.Single(WeightRangeHelper.Match(rules, 2.0)).Label);
    }

    [Fact]
    public void Match_SameRangeOnTwoTiers_ReturnsBoth()
    {
        var rules = new List<WeightRangeRule> { Rule("Halal", 1.5, 2.0), Rule("Regular", 1.5, 2.0) };
        Assert.Equal(new[] { "Halal", "Regular" }, WeightRangeHelper.Match(rules, 1.7).Select(r => r.Label));
    }

    [Fact]
    public void Match_PartialOverlap_ReturnsBothOnlyInsideIt()
    {
        var rules = new List<WeightRangeRule> { Rule("A", 1.5, 2.5), Rule("B", 2.0, 3.0) };
        Assert.Equal(new[] { "A" }, WeightRangeHelper.Match(rules, 1.8).Select(r => r.Label));
        Assert.Equal(new[] { "A", "B" }, WeightRangeHelper.Match(rules, 2.2).Select(r => r.Label));
        Assert.Equal(new[] { "B" }, WeightRangeHelper.Match(rules, 2.8).Select(r => r.Label));
    }

    // ─── Settings list: product setups plus variant setups ───────────────────

    [Fact]
    public void ListConfigured_IncludesVariantsWithOwnRanges()
    {
        var all = new List<ProductVariantEntity>
        {
            new() { PartitionKey = "1", ProductId = "gid://p/1", ProductTitle = "Chicken", VariantId = "gid://v/11", VariantTitle = "Halal",
                    WeightRanges = "[]", VariantWeightRanges = Json(Rule("S", 1, 2), Rule("M", 2, 3)) },
            new() { PartitionKey = "1", ProductId = "gid://p/1", ProductTitle = "Chicken", VariantId = "gid://v/12", VariantTitle = "Regular",
                    WeightRanges = "[]", VariantWeightRanges = Json(Rule("S", 1, 2)) },
            new() { PartitionKey = "2", ProductId = "gid://p/2", ProductTitle = "Duck", VariantId = "gid://v/21", VariantTitle = "Default Title",
                    WeightRanges = Json(Rule("S", 1, 2)) },
        };
        var list = WeightRangeHelper.ListConfigured(all);
        Assert.Equal(3, list.Count);
        Assert.Contains(list, x => x.VariantTitle == "Halal" && x.RulesCount == 2);
        Assert.Contains(list, x => x.VariantTitle == "Regular" && x.RulesCount == 1);
        Assert.Contains(list, x => x.ProductTitle == "Duck" && x.VariantId == null && x.RulesCount == 1);
    }
}
