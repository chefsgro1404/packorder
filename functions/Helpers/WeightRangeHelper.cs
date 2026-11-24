using Newtonsoft.Json;
using ShipScan.Functions.Models;

namespace ShipScan.Functions.Helpers;

// Categorical weight ranges (custom.weight_ranges). Same rules as client/lib/weightCategory.ts.
public static class WeightRangeHelper
{
    private const double Eps = 1e-9;

    public static List<WeightRangeRule> Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new();
        try { return JsonConvert.DeserializeObject<List<WeightRangeRule>>(json) ?? new(); }
        catch { return new(); }
    }

    public static bool HasOwnRanges(ProductVariantEntity v) => Parse(v.VariantWeightRanges).Count > 0;

    // The variant's own ranges when it has any; otherwise the product's. Never another variant's.
    public static List<WeightRangeRule> Effective(ProductVariantEntity v)
    {
        var own = Parse(v.VariantWeightRanges);
        return own.Count > 0 ? own : Parse(v.WeightRanges);
    }

    public record ConfiguredSetup(string ProductId, string ProductTitle, string? VariantId, string? VariantTitle, int RulesCount);

    // Every weight-range setup, for the settings list: one per product with product-level ranges,
    // plus one per variant that has its own.
    public static List<ConfiguredSetup> ListConfigured(IEnumerable<ProductVariantEntity> all)
    {
        var rows = all.ToList();
        var productLevel = rows
            .GroupBy(v => v.PartitionKey)
            .Select(g => (First: g.First(), Count: Parse(g.First().WeightRanges).Count))
            .Where(x => x.Count > 0)
            .Select(x => new ConfiguredSetup(string.IsNullOrEmpty(x.First.ProductId) ? x.First.PartitionKey : x.First.ProductId,
                x.First.ProductTitle, null, null, x.Count));
        var variantLevel = rows
            .Select(v => (Variant: v, Count: Parse(v.VariantWeightRanges).Count))
            .Where(x => x.Count > 0)
            .Select(x => new ConfiguredSetup(string.IsNullOrEmpty(x.Variant.ProductId) ? x.Variant.PartitionKey : x.Variant.ProductId,
                x.Variant.ProductTitle, x.Variant.VariantId, x.Variant.VariantTitle, x.Count));
        return productLevel.Concat(variantLevel)
            .OrderBy(x => x.ProductTitle).ThenBy(x => x.VariantTitle ?? "")
            .ToList();
    }

    // Every tier a weight falls in. Both ends included (max null = no upper bound). A weight exactly
    // on a shared boundary goes to the lower tier (1.5–1.9 and 1.9–2.5: 1.9 → first, 1.9001 → second);
    // any other overlap returns every tier it falls in so staff can choose.
    public static List<WeightRangeRule> Match(IReadOnlyList<WeightRangeRule> rules, double weightLbs)
    {
        if (rules.Count == 0 || !(weightLbs > 0)) return new();
        var inRange = rules.Where(r => weightLbs >= r.MinLbs - Eps && (r.MaxLbs == null || weightLbs <= r.MaxLbs + Eps)).ToList();
        if (inRange.Count <= 1) return inRange;
        return inRange.Where(r => !(Math.Abs(weightLbs - r.MinLbs) <= Eps &&
            inRange.Any(o => !ReferenceEquals(o, r) && o.MaxLbs != null && Math.Abs(weightLbs - o.MaxLbs.Value) <= Eps))).ToList();
    }
}
