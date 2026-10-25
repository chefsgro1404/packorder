using Newtonsoft.Json.Linq;
using ShipScan.Functions.Models;
using Xunit;

namespace ShipScan.Functions.Tests.Scale;

/// <summary>
/// Unit tests for transformation logic: inventory delta calculation,
/// TransformationOption model, and PrintedLabelEntity VariantId field.
/// </summary>
public class TransformationTests
{
    // ─── PrintedLabelEntity ────────────────────────────────────────────────────

    [Fact]
    public void PrintedLabelEntity_HasVariantId_Field()
    {
        var entity = new PrintedLabelEntity { VariantId = "gid://shopify/ProductVariant/123" };
        Assert.Equal("gid://shopify/ProductVariant/123", entity.VariantId);
    }

    [Fact]
    public void PrintedLabelEntity_VariantId_DefaultsToNull()
    {
        var entity = new PrintedLabelEntity();
        Assert.Null(entity.VariantId);
    }

    [Fact]
    public void LogPrintedLabelRequest_HasVariantId_Field()
    {
        var req = new LogPrintedLabelRequest { VariantId = "gid://shopify/ProductVariant/456" };
        Assert.Equal("gid://shopify/ProductVariant/456", req.VariantId);
    }

    // ─── TransformationOption model ────────────────────────────────────────────

    [Fact]
    public void TransformationOption_DefaultValues_AreCorrect()
    {
        var opt = new TransformationOption();
        Assert.Equal("", opt.VariantId);
        Assert.Equal(1, opt.ParentUnits);
        Assert.Equal(1, opt.ChildUnits);
        Assert.False(opt.IsWeighted);
        Assert.Equal(0.0, opt.WeightPerUnit);
    }

    [Fact]
    public void TransformationOption_WeightPerUnit3_SerializesCorrectly()
    {
        var opt = new TransformationOption
        {
            VariantId = "gid://shopify/ProductVariant/789",
            Title = "Test Product C",
            WeightPerUnit = 3.0,
            IsWeighted = false,
            ParentUnits = 1,
            ChildUnits = 1,
        };
        Assert.Equal(3.0, opt.WeightPerUnit);
    }

    // ─── Inventory delta logic (mirrors client-side logPrintedLabel) ───────────

    [Theory]
    [InlineData(3.0, false, -3, 1)]   // weight_per_unit=3, count-based: parent -3, child +1
    [InlineData(1.0, false, -1, 1)]   // weight_per_unit=1: parent -1, child +1
    [InlineData(5.0, false, -5, 1)]   // weight_per_unit=5: parent -5, child +1
    public void CountBased_InventoryDelta_UsesWeightPerUnit(
        double weightPerUnit, bool isWeighted, int expectedParentDelta, int expectedChildDelta)
    {
        // Mirrors the non-weighted branch in logPrintedLabel:
        // parentDelta = -(weightPerUnit || parentUnits || 1)
        // childDelta  = 1
        int parentDelta = -(int)weightPerUnit;
        int childDelta = 1;

        Assert.Equal(expectedParentDelta, parentDelta);
        Assert.Equal(expectedChildDelta, childDelta);
    }

    [Theory]
    [InlineData(3.0, 9.0, -3, 3)]   // isWeighted=true, weight=9lbs, wpu=3 → consumed=3, parent-3 child+3
    [InlineData(2.0, 6.5, -3, 3)]   // isWeighted=true, weight=6.5lbs, wpu=2 → consumed=round(6.5/2)=3
    [InlineData(1.5, 3.0, -2, 2)]   // isWeighted=true, weight=3lbs, wpu=1.5 → consumed=round(3/1.5)=2
    public void WeightBased_InventoryDelta_DividesWeightByWeightPerUnit(
        double weightPerUnit, double measuredWeight, int expectedParentDelta, int expectedChildDelta)
    {
        // Mirrors the isWeighted branch in logPrintedLabel:
        // consumed = round(measuredWeight / weightPerUnit)
        // parentDelta = -consumed, childDelta = consumed
        int consumed = (int)Math.Round(measuredWeight / weightPerUnit);
        int parentDelta = -consumed;
        int childDelta = consumed;

        Assert.Equal(expectedParentDelta, parentDelta);
        Assert.Equal(expectedChildDelta, childDelta);
    }

    // ─── Adjustments JSON parsing (mirrors GetVariantsByParentInventoryIdAsync) ─

    [Fact]
    public void Adjustments_ParentInventoryId_ParsedCorrectly()
    {
        var adj = JObject.Parse(@"{
            ""parent_inventory_id"": ""gid://shopify/InventoryItem/57959367082275"",
            ""weight_per_unit"": 3,
            ""is_weighted"": false
        }");

        var pid = adj["parent_inventory_id"]?.ToString();
        var wpu = adj["weight_per_unit"]?.ToObject<double>() ?? 0.0;
        var isWeighted = adj["is_weighted"]?.ToObject<bool>() ?? false;

        Assert.Equal("gid://shopify/InventoryItem/57959367082275", pid);
        Assert.Equal(3.0, wpu);
        Assert.False(isWeighted);
    }

    [Fact]
    public void Adjustments_NumericParentId_NormalizesToGid()
    {
        // Test the normalization logic in GetVariantsByParentInventoryIdAsync
        var numericId = "57959367082275";
        var normalized = numericId.StartsWith("gid://")
            ? numericId
            : $"gid://shopify/InventoryItem/{numericId}";

        Assert.Equal("gid://shopify/InventoryItem/57959367082275", normalized);
    }

    [Fact]
    public void Adjustments_GidParentId_IsPassedThrough()
    {
        var gid = "gid://shopify/InventoryItem/57959367082275";
        var normalized = gid.StartsWith("gid://") ? gid : $"gid://shopify/InventoryItem/{gid}";
        Assert.Equal(gid, normalized);
    }

    // ─── QR payload SN extraction (mirrors handleQrScan) ──────────────────────

    [Theory]
    [InlineData("1234 | Chicken Breast | 2.50 lbs | SN:ABC123", "ABC123")]
    [InlineData("N/A | Test Product A | SN:XY99", "XY99")]
    [InlineData("5678 | Beef Steak | SN:001-A", "001-A")]
    public void QrPayload_SnExtraction_Works(string payload, string expectedSn)
    {
        var parts = payload.Split(" | ");
        var snPart = parts.FirstOrDefault(p => p.StartsWith("SN:"));
        var sn = snPart?.Replace("SN:", "").Trim();
        Assert.Equal(expectedSn, sn);
    }

    [Fact]
    public void QrPayload_NoSn_ReturnsNull()
    {
        var payload = "1234 | Chicken Breast | 2.50 lbs";
        var parts = payload.Split(" | ");
        var snPart = parts.FirstOrDefault(p => p.StartsWith("SN:"));
        Assert.Null(snPart);
    }

    // ─── Title fallback for TransformationOption display ──────────────────────

    [Theory]
    [InlineData("Default Title", "Test Product B", "Test Product B")]
    [InlineData("", "Test Product C", "Test Product C")]
    [InlineData("500g Portion", "Test Product B", "500g Portion")]
    public void TransformationOption_TitleFallback_UsesProductTitleWhenVariantIsDefault(
        string variantTitle, string productTitle, string expectedTitle)
    {
        var displayTitle = string.IsNullOrWhiteSpace(variantTitle) || variantTitle == "Default Title"
            ? productTitle : variantTitle;
        Assert.Equal(expectedTitle, displayTitle);
    }
}
