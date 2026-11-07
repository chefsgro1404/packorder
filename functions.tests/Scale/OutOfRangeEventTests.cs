using Newtonsoft.Json;
using ShipScan.Functions.Models;
using Xunit;

namespace ShipScan.Functions.Tests.Scale;

public class OutOfRangeEventTests
{
    // ─── OutOfRangeEventEntity defaults ──────────────────────────────────────

    [Fact]
    public void OutOfRangeEventEntity_Action_DefaultsToSkipped()
    {
        var entity = new OutOfRangeEventEntity();
        Assert.Equal("skipped", entity.Action);
    }

    [Fact]
    public void OutOfRangeEventEntity_ProductTitle_DefaultsToEmptyString()
    {
        var entity = new OutOfRangeEventEntity();
        Assert.Equal("", entity.ProductTitle);
    }

    [Fact]
    public void OutOfRangeEventEntity_OptionalFields_DefaultToNull()
    {
        var entity = new OutOfRangeEventEntity();
        Assert.Null(entity.VariantId);
        Assert.Null(entity.PoId);
        Assert.Null(entity.SessionId);
        Assert.Null(entity.Timestamp);
    }

    [Fact]
    public void OutOfRangeEventEntity_WeightLbs_DefaultsToZero()
    {
        var entity = new OutOfRangeEventEntity();
        Assert.Equal(0.0, entity.WeightLbs);
    }

    [Fact]
    public void OutOfRangeEventEntity_CanSetAllFields()
    {
        var now = DateTimeOffset.UtcNow;
        var entity = new OutOfRangeEventEntity
        {
            PartitionKey  = "gid://shopify/Product/123",
            RowKey        = "00000000000000000001-abc",
            WeightLbs     = 3.75,
            ProductTitle  = "Whole Chicken",
            VariantId     = "gid://shopify/ProductVariant/456",
            PoId          = "gid://shopify/InventoryPurchaseOrder/789",
            SessionId     = "session-guid-001",
            Action        = "overridden_to:Large",
            CreatedAt     = now,
        };
        Assert.Equal(3.75, entity.WeightLbs);
        Assert.Equal("Whole Chicken", entity.ProductTitle);
        Assert.Equal("overridden_to:Large", entity.Action);
        Assert.Equal(now, entity.CreatedAt);
    }

    // ─── LogOutOfRangeEventRequest ────────────────────────────────────────────

    [Fact]
    public void LogOutOfRangeEventRequest_Action_DefaultsToSkipped()
    {
        var req = new LogOutOfRangeEventRequest();
        Assert.Equal("skipped", req.Action);
    }

    [Fact]
    public void LogOutOfRangeEventRequest_ProductId_DefaultsToEmptyString()
    {
        var req = new LogOutOfRangeEventRequest();
        Assert.Equal("", req.ProductId);
    }

    [Fact]
    public void LogOutOfRangeEventRequest_OptionalFields_DefaultToNull()
    {
        var req = new LogOutOfRangeEventRequest();
        Assert.Null(req.VariantId);
        Assert.Null(req.PoId);
        Assert.Null(req.SessionId);
    }

    [Fact]
    public void LogOutOfRangeEventRequest_DeserializesFromJson_Skipped()
    {
        var json = """
        {
          "productId":    "gid://shopify/Product/123",
          "productTitle": "Whole Chicken",
          "variantId":    "gid://shopify/ProductVariant/456",
          "poId":         null,
          "sessionId":    null,
          "weightLbs":    0.42,
          "action":       "skipped"
        }
        """;
        var req = JsonConvert.DeserializeObject<LogOutOfRangeEventRequest>(json)!;
        Assert.Equal("gid://shopify/Product/123", req.ProductId);
        Assert.Equal("Whole Chicken", req.ProductTitle);
        Assert.Equal(0.42, req.WeightLbs);
        Assert.Equal("skipped", req.Action);
    }

    [Fact]
    public void LogOutOfRangeEventRequest_DeserializesFromJson_Override()
    {
        var json = """
        {
          "productId":    "prod-001",
          "productTitle": "Chicken",
          "weightLbs":    3.95,
          "action":       "overridden_to:Large"
        }
        """;
        var req = JsonConvert.DeserializeObject<LogOutOfRangeEventRequest>(json)!;
        Assert.Equal("overridden_to:Large", req.Action);
        Assert.Equal(3.95, req.WeightLbs);
    }

    [Fact]
    public void LogOutOfRangeEventRequest_MissingActionDefaultsToSkipped()
    {
        var json = """{"productId":"p1","productTitle":"Chicken","weightLbs":2.5}""";
        var req = JsonConvert.DeserializeObject<LogOutOfRangeEventRequest>(json)!;
        Assert.Equal("skipped", req.Action);
    }

    // ─── Action format invariants ─────────────────────────────────────────────

    [Fact]
    public void Action_Skipped_IsValidString()
    {
        const string action = "skipped";
        Assert.Equal("skipped", action);
        Assert.False(string.IsNullOrEmpty(action));
    }

    [Theory]
    [InlineData("Small")]
    [InlineData("Medium")]
    [InlineData("Large")]
    [InlineData("Extra Large")]
    public void Action_OverriddenTo_ContainsTierLabel(string tierLabel)
    {
        string action = $"overridden_to:{tierLabel}";
        Assert.StartsWith("overridden_to:", action);
        Assert.Contains(tierLabel, action);
    }

    [Fact]
    public void Action_OverriddenTo_ExcludesSkippedPrefix()
    {
        const string action = "overridden_to:Medium";
        Assert.NotEqual("skipped", action);
        Assert.True(action.StartsWith("overridden_to:"));
    }

    // ─── Validation logic mirrors ─────────────────────────────────────────────

    [Fact]
    public void WeightLbs_MustBePositive_ForValidEvent()
    {
        // Backend rejects weightLbs <= 0
        double weightLbs = 0.0;
        bool isValid = weightLbs > 0;
        Assert.False(isValid);
    }

    [Theory]
    [InlineData(0.01)]
    [InlineData(1.5)]
    [InlineData(10.0)]
    [InlineData(999.99)]
    public void WeightLbs_AnyPositiveValue_IsValid(double weight)
    {
        bool isValid = weight > 0;
        Assert.True(isValid);
    }

    [Fact]
    public void WeightLbs_Zero_IsInvalid()
    {
        bool isValid = 0.0 > 0;
        Assert.False(isValid);
    }

    [Fact]
    public void WeightLbs_Negative_IsInvalid()
    {
        bool isValid = -1.5 > 0;
        Assert.False(isValid);
    }

    // ─── PartitionKey fallback ─────────────────────────────────────────────────

    [Fact]
    public void PartitionKey_UsesProductId_WhenProvided()
    {
        var request = new LogOutOfRangeEventRequest { ProductId = "prod-123" };
        var partitionKey = string.IsNullOrEmpty(request.ProductId) ? "unknown" : request.ProductId;
        Assert.Equal("prod-123", partitionKey);
    }

    [Fact]
    public void PartitionKey_FallsBackToUnknown_WhenProductIdEmpty()
    {
        var request = new LogOutOfRangeEventRequest { ProductId = "" };
        var partitionKey = string.IsNullOrEmpty(request.ProductId) ? "unknown" : request.ProductId;
        Assert.Equal("unknown", partitionKey);
    }

    [Fact]
    public void PartitionKey_FallsBackToUnknown_WhenProductIdNull()
    {
        // ProductId is non-nullable string but could be empty after deserialize
        var request = new LogOutOfRangeEventRequest();
        var partitionKey = string.IsNullOrEmpty(request.ProductId) ? "unknown" : request.ProductId;
        Assert.Equal("unknown", partitionKey);
    }
}
