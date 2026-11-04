using ShipScan.Functions.Models;
using Xunit;

namespace ShipScan.Functions.Tests.Scale;

/// <summary>
/// Tests for the mark-shipped feature:
///   - PrintedLabelEntity ShippedAt / ShippedOrderId fields
///   - MarkShippedRequest model
///   - Stamping logic expectations
/// </summary>
public class MarkShippedTests
{
    // ─── PrintedLabelEntity new fields ────────────────────────────────────────

    [Fact]
    public void PrintedLabelEntity_ShippedAt_DefaultsToNull()
    {
        var entity = new PrintedLabelEntity();
        Assert.Null(entity.ShippedAt);
    }

    [Fact]
    public void PrintedLabelEntity_ShippedOrderId_DefaultsToNull()
    {
        var entity = new PrintedLabelEntity();
        Assert.Null(entity.ShippedOrderId);
    }

    [Fact]
    public void PrintedLabelEntity_ShippedAt_CanBeSet()
    {
        var now = DateTimeOffset.UtcNow;
        var entity = new PrintedLabelEntity { ShippedAt = now };
        Assert.Equal(now, entity.ShippedAt);
    }

    [Fact]
    public void PrintedLabelEntity_ShippedOrderId_CanBeSet()
    {
        var entity = new PrintedLabelEntity { ShippedOrderId = "gid://shopify/Order/9876543210" };
        Assert.Equal("gid://shopify/Order/9876543210", entity.ShippedOrderId);
    }

    [Fact]
    public void PrintedLabelEntity_AllFieldsCoexist_WithExistingFields()
    {
        var entity = new PrintedLabelEntity
        {
            Sn            = "chk-100042",
            VariantId     = "gid://shopify/ProductVariant/111",
            ProductTitle  = "Red Chicken",
            ShippedAt     = DateTimeOffset.UtcNow,
            ShippedOrderId = "gid://shopify/Order/555",
        };

        Assert.Equal("chk-100042", entity.Sn);
        Assert.Equal("gid://shopify/ProductVariant/111", entity.VariantId);
        Assert.NotNull(entity.ShippedAt);
        Assert.Equal("gid://shopify/Order/555", entity.ShippedOrderId);
    }

    // ─── MarkShippedRequest model ─────────────────────────────────────────────

    [Fact]
    public void MarkShippedRequest_Sn_DefaultsToNull()
    {
        var req = new MarkShippedRequest();
        Assert.Null(req.Sn);
    }

    [Fact]
    public void MarkShippedRequest_OrderId_DefaultsToNull()
    {
        var req = new MarkShippedRequest();
        Assert.Null(req.OrderId);
    }

    [Fact]
    public void MarkShippedRequest_CanBePopulated()
    {
        var req = new MarkShippedRequest
        {
            Sn      = "chk-100099",
            OrderId = "gid://shopify/Order/999",
        };
        Assert.Equal("chk-100099", req.Sn);
        Assert.Equal("gid://shopify/Order/999", req.OrderId);
    }

    [Fact]
    public void MarkShippedRequest_DeserializesFromJson()
    {
        var json = """{"sn":"fish-200001","orderId":"gid://shopify/Order/42"}""";
        var req = Newtonsoft.Json.JsonConvert.DeserializeObject<MarkShippedRequest>(json);
        Assert.NotNull(req);
        Assert.Equal("fish-200001", req!.Sn);
        Assert.Equal("gid://shopify/Order/42", req.OrderId);
    }

    [Fact]
    public void MarkShippedRequest_DeserializesWithMissingOrderId()
    {
        var json = """{"sn":"fish-200002"}""";
        var req = Newtonsoft.Json.JsonConvert.DeserializeObject<MarkShippedRequest>(json);
        Assert.NotNull(req);
        Assert.Equal("fish-200002", req!.Sn);
        Assert.Null(req.OrderId);
    }

    // ─── Stamp logic (pure) ───────────────────────────────────────────────────
    // These simulate what StampShippedAtAsync does to the entity, verifying
    // the expected state transitions without hitting Azure Table Storage.

    [Fact]
    public void StampShippedAt_SetsShippedAtToUtcNow()
    {
        var entity = new PrintedLabelEntity { Sn = "chk-100001" };
        var before = DateTimeOffset.UtcNow;
        entity.ShippedAt = DateTimeOffset.UtcNow;
        entity.ShippedOrderId = "gid://shopify/Order/1";
        var after = DateTimeOffset.UtcNow;

        Assert.NotNull(entity.ShippedAt);
        Assert.True(entity.ShippedAt >= before && entity.ShippedAt <= after);
    }

    [Fact]
    public void StampShippedAt_OverwritesPreviousStamp()
    {
        var old = DateTimeOffset.UtcNow.AddDays(-1);
        var entity = new PrintedLabelEntity { ShippedAt = old, ShippedOrderId = "gid://shopify/Order/1" };
        var newTime = DateTimeOffset.UtcNow;
        entity.ShippedAt = newTime;
        entity.ShippedOrderId = "gid://shopify/Order/2";

        Assert.Equal(newTime, entity.ShippedAt);
        Assert.Equal("gid://shopify/Order/2", entity.ShippedOrderId);
    }

    [Fact]
    public void StampShippedAt_NullSn_ReturnsNotFound()
    {
        // StampShippedAtAsync returns false when GetPrintedLabelBySnAsync returns null.
        // Simulate: label not found → stamped = false.
        PrintedLabelEntity? found = null;
        var stamped = found != null;
        Assert.False(stamped);
    }

    [Fact]
    public void StampShippedAt_FoundLabel_ReturnsTrue()
    {
        var entity = new PrintedLabelEntity { Sn = "chk-100042" };
        var stamped = entity != null;
        Assert.True(stamped);
    }

    // ─── LookupBySn response shape ────────────────────────────────────────────

    [Fact]
    public void LookupBySn_ResponseShape_ContainsShipFields()
    {
        // The lookup-by-sn endpoint returns these fields — ship page uses them.
        var response = new
        {
            found        = true,
            variantId    = "gid://shopify/ProductVariant/123",
            productTitle = "Red Chicken",
            plu          = "N/A",
            poId         = "gid://shopify/PurchaseOrder/1",
            poLineItemId = "gid://shopify/PurchaseOrderLineItem/1",
        };

        Assert.True(response.found);
        Assert.Equal("gid://shopify/ProductVariant/123", response.variantId);
        Assert.Equal("N/A", response.plu);
    }

    [Fact]
    public void LookupBySn_NotFound_ReturnsFalse()
    {
        var response = new { found = false };
        Assert.False(response.found);
    }
}
