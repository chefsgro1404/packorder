using Newtonsoft.Json;
using ShipScan.Functions.Models;
using Xunit;

namespace ShipScan.Functions.Tests.Scale;

public class LotProductTests
{
    // ─── LotProductEntity defaults ────────────────────────────────────────────

    [Fact]
    public void LotProductEntity_RowKey_DefaultsToConfig()
    {
        var entity = new LotProductEntity();
        Assert.Equal("config", entity.RowKey);
    }

    [Fact]
    public void LotProductEntity_PartitionKey_DefaultsToEmptyString()
    {
        var entity = new LotProductEntity();
        Assert.Equal("", entity.PartitionKey);
    }

    [Fact]
    public void LotProductEntity_ProductTitle_DefaultsToEmptyString()
    {
        var entity = new LotProductEntity();
        Assert.Equal("", entity.ProductTitle);
    }

    [Fact]
    public void LotProductEntity_ConfiguredBy_DefaultsToNull()
    {
        var entity = new LotProductEntity();
        Assert.Null(entity.ConfiguredBy);
    }

    [Fact]
    public void LotProductEntity_CanSetAllFields()
    {
        var entity = new LotProductEntity
        {
            PartitionKey = "7654321",
            RowKey = "config",
            ProductTitle = "Beef Tenderloin",
            ConfiguredBy = "admin@store.com",
            ConfiguredAt = "2025-06-01T10:00:00Z",
        };
        Assert.Equal("7654321", entity.PartitionKey);
        Assert.Equal("config", entity.RowKey);
        Assert.Equal("Beef Tenderloin", entity.ProductTitle);
        Assert.Equal("admin@store.com", entity.ConfiguredBy);
        Assert.Equal("2025-06-01T10:00:00Z", entity.ConfiguredAt);
    }

    [Fact]
    public void LotProductEntity_Timestamp_DefaultsToNull()
    {
        var entity = new LotProductEntity();
        Assert.Null(entity.Timestamp);
    }

    // ─── SaveLotProductRequest ────────────────────────────────────────────────

    [Fact]
    public void SaveLotProductRequest_ProductId_DefaultsToEmptyString()
    {
        var req = new SaveLotProductRequest();
        Assert.Equal("", req.ProductId);
    }

    [Fact]
    public void SaveLotProductRequest_ProductTitle_DefaultsToEmptyString()
    {
        var req = new SaveLotProductRequest();
        Assert.Equal("", req.ProductTitle);
    }

    [Fact]
    public void SaveLotProductRequest_DeserializesFromJson()
    {
        var json = """{"productId":"8001234","productTitle":"Lamb Shoulder"}""";
        var req = JsonConvert.DeserializeObject<SaveLotProductRequest>(json)!;
        Assert.Equal("8001234", req.ProductId);
        Assert.Equal("Lamb Shoulder", req.ProductTitle);
    }

    [Fact]
    public void SaveLotProductRequest_MissingFieldsDeserializeToDefaults()
    {
        var json = "{}";
        var req = JsonConvert.DeserializeObject<SaveLotProductRequest>(json)!;
        Assert.Equal("", req.ProductId);
        Assert.Equal("", req.ProductTitle);
    }

    [Fact]
    public void SaveLotProductRequest_ExtraFieldsAreIgnored()
    {
        var json = """{"productId":"123","productTitle":"Chicken","extra":"ignored"}""";
        var req = JsonConvert.DeserializeObject<SaveLotProductRequest>(json)!;
        Assert.Equal("123", req.ProductId);
        Assert.Equal("Chicken", req.ProductTitle);
    }

    // ─── PurchaseOrderLineItemEntity discrepancy fields ───────────────────────

    [Fact]
    public void PurchaseOrderLineItemEntity_DiscrepancyQty_DefaultsToNull()
    {
        var entity = new PurchaseOrderLineItemEntity();
        Assert.Null(entity.DiscrepancyQty);
    }

    [Fact]
    public void PurchaseOrderLineItemEntity_DiscrepancyType_DefaultsToNull()
    {
        var entity = new PurchaseOrderLineItemEntity();
        Assert.Null(entity.DiscrepancyType);
    }

    [Fact]
    public void PurchaseOrderLineItemEntity_DiscrepancyType_Short()
    {
        var entity = new PurchaseOrderLineItemEntity
        {
            QuantityOrdered = 100,
            QuantityReceived = 90,
            DiscrepancyQty = 10,
            DiscrepancyType = "short",
        };
        Assert.Equal(10, entity.DiscrepancyQty);
        Assert.Equal("short", entity.DiscrepancyType);
    }

    [Fact]
    public void PurchaseOrderLineItemEntity_DiscrepancyType_Over()
    {
        var entity = new PurchaseOrderLineItemEntity
        {
            QuantityOrdered = 50,
            QuantityReceived = 55,
            DiscrepancyQty = 5,
            DiscrepancyType = "over",
        };
        Assert.Equal(5, entity.DiscrepancyQty);
        Assert.Equal("over", entity.DiscrepancyType);
    }

    [Fact]
    public void PurchaseOrderLineItemEntity_DiscrepancyType_LotMethod()
    {
        var entity = new PurchaseOrderLineItemEntity
        {
            QuantityOrdered = 1,
            QuantityReceived = 3,
            DiscrepancyQty = 0,
            DiscrepancyType = "lot_method",
        };
        Assert.Equal(0, entity.DiscrepancyQty);
        Assert.Equal("lot_method", entity.DiscrepancyType);
    }

    [Fact]
    public void PurchaseOrderLineItemEntity_NoDiscrepancy_FieldsRemainNull()
    {
        var entity = new PurchaseOrderLineItemEntity
        {
            QuantityOrdered = 10,
            QuantityReceived = 10,
        };
        Assert.Null(entity.DiscrepancyQty);
        Assert.Null(entity.DiscrepancyType);
    }

    // ─── ApprovePurchaseOrderLineItemRequest ──────────────────────────────────

    [Fact]
    public void ApprovePurchaseOrderLineItemRequest_DiscrepancyQty_DefaultsToNull()
    {
        var req = new ApprovePurchaseOrderLineItemRequest();
        Assert.Null(req.DiscrepancyQty);
    }

    [Fact]
    public void ApprovePurchaseOrderLineItemRequest_DiscrepancyType_DefaultsToNull()
    {
        var req = new ApprovePurchaseOrderLineItemRequest();
        Assert.Null(req.DiscrepancyType);
    }

    [Fact]
    public void ApprovePurchaseOrderLineItemRequest_DeserializesDiscrepancyFields()
    {
        var json = """
        {
          "poId": "PO/001",
          "lineItemId": "LI/001",
          "quantityReceived": 90,
          "printedBy": "user@store.com",
          "forceApprove": false,
          "discrepancyQty": 10,
          "discrepancyType": "short"
        }
        """;
        var req = JsonConvert.DeserializeObject<ApprovePurchaseOrderLineItemRequest>(json)!;
        Assert.Equal(10, req.DiscrepancyQty);
        Assert.Equal("short", req.DiscrepancyType);
    }

    [Fact]
    public void ApprovePurchaseOrderLineItemRequest_NullDiscrepancyFieldsRoundTrip()
    {
        var json = """{"poId":"PO/1","lineItemId":"LI/1","quantityReceived":5,"printedBy":"u"}""";
        var req = JsonConvert.DeserializeObject<ApprovePurchaseOrderLineItemRequest>(json)!;
        Assert.Null(req.DiscrepancyQty);
        Assert.Null(req.DiscrepancyType);
    }

    [Fact]
    public void ApprovePurchaseOrderLineItemRequest_LotMethodDiscrepancyQtyIsZero()
    {
        var json = """
        {
          "poId": "PO/001",
          "lineItemId": "LI/001",
          "quantityReceived": 1,
          "printedBy": "user@store.com",
          "discrepancyQty": 0,
          "discrepancyType": "lot_method"
        }
        """;
        var req = JsonConvert.DeserializeObject<ApprovePurchaseOrderLineItemRequest>(json)!;
        Assert.Equal(0, req.DiscrepancyQty);
        Assert.Equal("lot_method", req.DiscrepancyType);
    }

    [Fact]
    public void ApprovePurchaseOrderLineItemRequest_ForceApprove_DefaultsFalse()
    {
        var req = new ApprovePurchaseOrderLineItemRequest();
        Assert.False(req.ForceApprove);
    }

    // ─── Discrepancy logic invariants ─────────────────────────────────────────

    [Theory]
    [InlineData(100, 90, 10, "short")]
    [InlineData(100, 110, 10, "over")]
    [InlineData(100, 100, null, null)]
    public void DiscrepancyQty_IsAbsoluteDifference_ForStandardMethod(
        int ordered, int printed, int? expectedQty, string? expectedType)
    {
        // Mirror the frontend applyBulkApprovalAndInventory logic in C# invariants
        bool hasDiscrepancy = printed != ordered;
        int? discrepancyQty = hasDiscrepancy ? (int?)Math.Abs(ordered - printed) : null;
        string? discrepancyType = hasDiscrepancy
            ? (printed < ordered ? "short" : "over")
            : null;

        Assert.Equal(expectedQty, discrepancyQty);
        Assert.Equal(expectedType, discrepancyType);
    }

    [Fact]
    public void DiscrepancyQty_IsZero_ForLotMethod_RegardlessOfPrintedCount()
    {
        // Lot method: discrepancyQty = 0, discrepancyType = "lot_method"
        int ordered = 1;
        bool isLotMethod = true;
        bool hasDiscrepancy = 5 != ordered; // printed 5 barcodes for 1 lot
        int? discrepancyQty = hasDiscrepancy ? (isLotMethod ? 0 : (int?)Math.Abs(ordered - 5)) : null;
        string? discrepancyType = hasDiscrepancy ? (isLotMethod ? "lot_method" : "short") : null;

        Assert.Equal(0, discrepancyQty);
        Assert.Equal("lot_method", discrepancyType);
    }

    [Fact]
    public void InventoryDelta_IsQuantityOrdered_ForLotMethod()
    {
        // inventoryDelta = isLotMethod ? li.quantityOrdered : printedCount
        int quantityOrdered = 1;
        int printedCount = 3;
        bool isLotMethod = true;
        int inventoryDelta = isLotMethod ? quantityOrdered : printedCount;
        Assert.Equal(1, inventoryDelta);
    }

    [Fact]
    public void InventoryDelta_IsPrintedCount_ForStandardMethod()
    {
        int quantityOrdered = 100;
        int printedCount = 90;
        bool isLotMethod = false;
        int inventoryDelta = isLotMethod ? quantityOrdered : printedCount;
        Assert.Equal(90, inventoryDelta);
    }

    [Fact]
    public void InventoryDelta_IsPrintedCount_WhenNoDiscrepancy()
    {
        int quantityOrdered = 50;
        int printedCount = 50;
        bool isLotMethod = false;
        int inventoryDelta = isLotMethod ? quantityOrdered : printedCount;
        Assert.Equal(50, inventoryDelta);
    }
}
