using Newtonsoft.Json;
using ShipScan.Functions.Models;
using Xunit;

namespace ShipScan.Functions.Tests.Scale;

public class SnCounterTests
{
    // ─── SnCounterEntity model ────────────────────────────────────────────────

    [Fact]
    public void SnCounterEntity_DefaultPartitionKey_IsSn()
    {
        var entity = new SnCounterEntity();
        Assert.Equal("sn", entity.PartitionKey);
    }

    [Fact]
    public void SnCounterEntity_DefaultCount_IsZero()
    {
        var entity = new SnCounterEntity();
        Assert.Equal(0, entity.Count);
    }

    [Fact]
    public void SnCounterEntity_AfterIncrement_CountIsOne()
    {
        var entity = new SnCounterEntity { Count = 0 };
        entity.Count++;
        Assert.Equal(1, entity.Count);
    }

    // ─── NextSnRequest JSON deserialization ───────────────────────────────────

    [Fact]
    public void NextSnRequest_Deserialization_MapsVariantId()
    {
        const string json = """{"variantId":"gid://shopify/ProductVariant/12345","plu":"2000001","prefix":"rohu-2k-rc"}""";
        var req = JsonConvert.DeserializeObject<NextSnRequest>(json)!;
        Assert.Equal("gid://shopify/ProductVariant/12345", req.VariantId);
        Assert.Equal("2000001", req.Plu);
        Assert.Equal("rohu-2k-rc", req.Prefix);
    }

    [Fact]
    public void NextSnRequest_Deserialization_NullVariantId_IsNull()
    {
        const string json = """{"variantId":null,"plu":"2000001","prefix":"rohu-2k-rc"}""";
        var req = JsonConvert.DeserializeObject<NextSnRequest>(json)!;
        Assert.Null(req.VariantId);
        Assert.Equal("2000001", req.Plu);
    }

    [Fact]
    public void NextSnRequest_EmptyJson_PrefixDefaultsToEmptyString()
    {
        const string json = "{}";
        var req = JsonConvert.DeserializeObject<NextSnRequest>(json)!;
        Assert.Equal("", req.Prefix);
        Assert.Null(req.VariantId);
        Assert.Null(req.Plu);
    }

    // ─── Counter key derivation (mirrors ScaleFunction logic) ────────────────

    [Theory]
    [InlineData("gid://shopify/ProductVariant/54349178667299", "54349178667299")]
    [InlineData("gid://shopify/ProductVariant/1",             "1")]
    [InlineData("54349178667299",                             "54349178667299")]
    public void CounterKey_FromVariantId_StripsGidPrefix(string variantId, string expectedKey)
    {
        var lastSlash = variantId.LastIndexOf('/');
        var key = lastSlash >= 0 ? variantId[(lastSlash + 1)..] : variantId;
        Assert.Equal(expectedKey, key);
    }

    [Fact]
    public void CounterKey_FromPlu_HasPluPrefix()
    {
        const string plu = "2000001";
        var key = $"plu:{plu}";
        Assert.Equal("plu:2000001", key);
    }

    // ─── SN string format ─────────────────────────────────────────────────────

    [Theory]
    [InlineData("rohu-2k-rc", 1,  "rohu-2k-rc-100001")]
    [InlineData("rohu-2k-rc", 99, "rohu-2k-rc-100099")]
    [InlineData("bd-hilsha-1k", 1000, "bd-hilsha-1k-101000")]
    [InlineData("radhuni-turmeric-200g", 1, "radhuni-turmeric-200g-100001")]
    public void SnFormat_PrefixPlusCount_MatchesExpectedPattern(string prefix, int count, string expected)
    {
        var sn = $"{prefix}-{100000 + count}";
        Assert.Equal(expected, sn);
    }

    // ─── Reprint suffix format ────────────────────────────────────────────────

    [Theory]
    [InlineData("rohu-2k-rc-100001", 1, "rohu-2k-rc-100001-r001")]
    [InlineData("rohu-2k-rc-100001", 2, "rohu-2k-rc-100001-r002")]
    [InlineData("rohu-2k-rc-100001", 99, "rohu-2k-rc-100001-r099")]
    public void ReprintSn_Format_IsBasePlusPaddedSuffix(string baseSn, int reprintN, string expected)
    {
        var reprintSn = $"{baseSn}-r{reprintN:D3}";
        Assert.Equal(expected, reprintSn);
    }

    [Fact]
    public void ReprintSn_StripPriorSuffix_YieldsBaseSn()
    {
        const string sn = "rohu-2k-rc-100001-r001";
        var baseSn = System.Text.RegularExpressions.Regex.Replace(sn, @"-r\d+$", "");
        Assert.Equal("rohu-2k-rc-100001", baseSn);
    }

    // ─── ProductLookupEntity NoWeight flag ───────────────────────────────────

    [Fact]
    public void ProductLookupEntity_NoWeight_DefaultsFalse()
    {
        var entity = new ProductLookupEntity();
        Assert.False(entity.NoWeight);
    }

    [Fact]
    public void ProductLookupEntity_NoWeight_CanBeSetTrue()
    {
        var entity = new ProductLookupEntity { NoWeight = true };
        Assert.True(entity.NoWeight);
    }
}
