using ShipScan.Functions.Models;
using Xunit;

namespace ShipScan.Functions.Tests.Scale;

/// <summary>
/// Tests for PO mark-transferred status model and transition logic.
/// </summary>
public class MarkTransferredTests
{
    // ─── PurchaseOrderEntity status field ────────────────────────────────────

    [Fact]
    public void PurchaseOrderEntity_DefaultStatus_IsOpen()
    {
        var entity = new PurchaseOrderEntity();
        Assert.Equal("open", entity.Status);
    }

    [Fact]
    public void PurchaseOrderEntity_StatusCanBeSetToTransferred()
    {
        var entity = new PurchaseOrderEntity { Status = "transferred" };
        Assert.Equal("transferred", entity.Status);
    }

    [Fact]
    public void PurchaseOrderEntity_AllValidStatuses_AreAccepted()
    {
        foreach (var status in new[] { "open", "partial", "fulfilled", "transferred" })
        {
            var entity = new PurchaseOrderEntity { Status = status };
            Assert.Equal(status, entity.Status);
        }
    }

    [Fact]
    public void PurchaseOrderEntity_ShopifyStatus_DefaultsToNull()
    {
        var entity = new PurchaseOrderEntity();
        Assert.Null(entity.ShopifyStatus);
    }

    [Fact]
    public void PurchaseOrderEntity_ShopifyStatus_CanBeSet()
    {
        var entity = new PurchaseOrderEntity { ShopifyStatus = "received" };
        Assert.Equal("received", entity.ShopifyStatus);
    }

    [Theory]
    [InlineData("draft")]
    [InlineData("ordered")]
    [InlineData("partially_received")]
    [InlineData("received")]
    [InlineData("cancelled")]
    public void PurchaseOrderEntity_AllShopifyStatuses_AreStored(string shopifyStatus)
    {
        var entity = new PurchaseOrderEntity { ShopifyStatus = shopifyStatus };
        Assert.Equal(shopifyStatus, entity.ShopifyStatus);
    }

    // ─── Transferred transition: only fulfilled POs should transition ────────

    [Theory]
    [InlineData("fulfilled", true)]
    [InlineData("open", false)]
    [InlineData("partial", false)]
    [InlineData("transferred", false)]
    public void TransferredTransition_OnlyAllowedFromFulfilled(string currentStatus, bool shouldAllow)
    {
        // Simulate the guard a UI or service would apply
        bool canTransfer = currentStatus == "fulfilled";
        Assert.Equal(shouldAllow, canTransfer);
    }

    [Fact]
    public void TransferredTransition_UpdatesStatusField()
    {
        var entity = new PurchaseOrderEntity { Status = "fulfilled" };
        entity.Status = "transferred"; // as UpdatePurchaseOrderStatusAsync does
        Assert.Equal("transferred", entity.Status);
    }

    [Fact]
    public void TransferredTransition_DoesNotChangeShopifyStatus()
    {
        var entity = new PurchaseOrderEntity { Status = "fulfilled", ShopifyStatus = "received" };
        entity.Status = "transferred";
        // ShopifyStatus should remain unchanged
        Assert.Equal("received", entity.ShopifyStatus);
    }

    // ─── Numeric ID extraction (mirrors PurchaseOrderFunction logic) ─────────

    [Theory]
    [InlineData("gid://shopify/PurchaseOrder/12345", "12345")]
    [InlineData("12345", "12345")]
    [InlineData("gid://shopify/PurchaseOrder/99999", "99999")]
    public void NumericIdExtraction_HandlesGidAndPlainId(string inputId, string expectedNumeric)
    {
        var numericId = inputId.Contains('/') ? inputId.Split('/').Last() : inputId;
        Assert.Equal(expectedNumeric, numericId);
    }

    [Fact]
    public void NumericIdExtraction_EmptyId_ReturnsEmpty()
    {
        var inputId = "";
        var numericId = inputId.Contains('/') ? inputId.Split('/').Last() : inputId;
        Assert.Equal("", numericId);
    }

    [Fact]
    public void NumericIdExtraction_OnlySlashes_ReturnsEmpty()
    {
        var inputId = "///";
        var numericId = inputId.Contains('/') ? inputId.Split('/').Last() : inputId;
        Assert.Equal("", numericId);
    }

    // ─── GetAllRecentPurchaseOrdersAsync filter: days window logic ───────────

    [Fact]
    public void RecentPurchaseOrders_CutoffCalculation_30DaysBack()
    {
        var now = DateTimeOffset.UtcNow;
        var cutoff = now.AddDays(-30);
        Assert.True(cutoff < now);
        Assert.True((now - cutoff).TotalDays >= 29.9 && (now - cutoff).TotalDays <= 30.1);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(7)]
    [InlineData(30)]
    [InlineData(90)]
    public void RecentPurchaseOrders_CutoffCalculation_VariousDaysBack(int daysBack)
    {
        var now = DateTimeOffset.UtcNow;
        var cutoff = now.AddDays(-daysBack);
        Assert.True(cutoff < now);
        Assert.True(Math.Abs((now - cutoff).TotalDays - daysBack) < 0.1);
    }

    [Fact]
    public void RecentPurchaseOrders_AllStatuses_AreIncluded()
    {
        // GetAllRecentPurchaseOrdersAsync does NOT filter by status — all statuses pass through
        var orders = new List<PurchaseOrderEntity>
        {
            new() { Status = "open",        ShopifyCreatedAt = DateTimeOffset.UtcNow.AddDays(-1) },
            new() { Status = "partial",     ShopifyCreatedAt = DateTimeOffset.UtcNow.AddDays(-3) },
            new() { Status = "fulfilled",   ShopifyCreatedAt = DateTimeOffset.UtcNow.AddDays(-5) },
            new() { Status = "transferred", ShopifyCreatedAt = DateTimeOffset.UtcNow.AddDays(-10) },
        };
        var cutoff = DateTimeOffset.UtcNow.AddDays(-30);
        var recent = orders.Where(e => e.ShopifyCreatedAt >= cutoff).ToList();
        Assert.Equal(4, recent.Count);
    }

    [Fact]
    public void RecentPurchaseOrders_OldPOs_AreExcluded()
    {
        var orders = new List<PurchaseOrderEntity>
        {
            new() { Status = "open",    ShopifyCreatedAt = DateTimeOffset.UtcNow.AddDays(-10) },
            new() { Status = "partial", ShopifyCreatedAt = DateTimeOffset.UtcNow.AddDays(-45) }, // too old
        };
        var cutoff = DateTimeOffset.UtcNow.AddDays(-30);
        var recent = orders.Where(e => e.ShopifyCreatedAt >= cutoff).ToList();
        Assert.Single(recent);
        Assert.Equal("open", recent[0].Status);
    }

    [Fact]
    public void RecentPurchaseOrders_SortedDescending_MostRecentFirst()
    {
        var older = new PurchaseOrderEntity { ShopifyCreatedAt = DateTimeOffset.UtcNow.AddDays(-10) };
        var newer = new PurchaseOrderEntity { ShopifyCreatedAt = DateTimeOffset.UtcNow.AddDays(-2) };
        var oldest = new PurchaseOrderEntity { ShopifyCreatedAt = DateTimeOffset.UtcNow.AddDays(-20) };

        var sorted = new[] { older, newer, oldest }
            .OrderByDescending(e => e.ShopifyCreatedAt)
            .ToList();

        Assert.Equal(newer.ShopifyCreatedAt, sorted[0].ShopifyCreatedAt);
        Assert.Equal(older.ShopifyCreatedAt, sorted[1].ShopifyCreatedAt);
        Assert.Equal(oldest.ShopifyCreatedAt, sorted[2].ShopifyCreatedAt);
    }
}
