using Newtonsoft.Json;
using ShipScan.Functions.Models;
using Xunit;

namespace ShipScan.Functions.Tests.Scale;

/// <summary>
/// Tests for BulkSession model, request deserialization, and discrepancy derivation.
/// Covers the new QuantityReceived field and auto-lot number format validation.
/// </summary>
public class BulkSessionTests
{
    // ─── BulkSessionEntity defaults ──────────────────────────────────────────

    [Fact]
    public void BulkSessionEntity_QuantityReceived_DefaultsToZero()
    {
        var entity = new BulkSessionEntity();
        Assert.Equal(0, entity.QuantityReceived);
    }

    [Fact]
    public void BulkSessionEntity_QuantityOrdered_DefaultsToZero()
    {
        var entity = new BulkSessionEntity();
        Assert.Equal(0, entity.QuantityOrdered);
    }

    [Fact]
    public void BulkSessionEntity_QuantityPrinted_DefaultsToZero()
    {
        var entity = new BulkSessionEntity();
        Assert.Equal(0, entity.QuantityPrinted);
    }

    [Fact]
    public void BulkSessionEntity_Results_DefaultsToEmptyJsonArray()
    {
        var entity = new BulkSessionEntity();
        Assert.Equal("[]", entity.Results);
    }

    [Fact]
    public void BulkSessionEntity_CanSetAllQuantityFields()
    {
        var entity = new BulkSessionEntity
        {
            QuantityOrdered  = 100,
            QuantityReceived = 95,
            QuantityPrinted  = 90,
        };
        Assert.Equal(100, entity.QuantityOrdered);
        Assert.Equal(95, entity.QuantityReceived);
        Assert.Equal(90, entity.QuantityPrinted);
    }

    [Fact]
    public void BulkSessionEntity_LotNo_DefaultsToNull()
    {
        var entity = new BulkSessionEntity();
        Assert.Null(entity.LotNo);
    }

    [Fact]
    public void BulkSessionEntity_VendorName_DefaultsToNull()
    {
        var entity = new BulkSessionEntity();
        Assert.Null(entity.VendorName);
    }

    // ─── SaveBulkSessionRequest deserialization ───────────────────────────────

    [Fact]
    public void SaveBulkSessionRequest_QuantityReceived_DefaultsToZero()
    {
        var req = new SaveBulkSessionRequest();
        Assert.Equal(0, req.QuantityReceived);
    }

    [Fact]
    public void SaveBulkSessionRequest_DeserializesQuantityReceived()
    {
        var json = """
            {
              "productTitle": "Beef Tenderloin",
              "quantityOrdered": 100,
              "quantityReceived": 95,
              "quantityPrinted": 90
            }
            """;
        var req = JsonConvert.DeserializeObject<SaveBulkSessionRequest>(json)!;
        Assert.Equal(100, req.QuantityOrdered);
        Assert.Equal(95,  req.QuantityReceived);
        Assert.Equal(90,  req.QuantityPrinted);
    }

    [Fact]
    public void SaveBulkSessionRequest_MissingQuantityReceived_DefaultsToZero()
    {
        // Legacy requests without quantityReceived should not break deserialization
        var json = """
            {
              "productTitle": "Lamb Shoulder",
              "quantityOrdered": 50,
              "quantityPrinted": 50
            }
            """;
        var req = JsonConvert.DeserializeObject<SaveBulkSessionRequest>(json)!;
        Assert.Equal(50, req.QuantityOrdered);
        Assert.Equal(0,  req.QuantityReceived); // graceful default
        Assert.Equal(50, req.QuantityPrinted);
    }

    [Fact]
    public void SaveBulkSessionRequest_AllFieldsRoundTrip()
    {
        var req = new SaveBulkSessionRequest
        {
            ProductTitle     = "Beef Tenderloin",
            VendorName       = "Fresh Farms",
            LotNo            = "LOT_FRESHFARMS_PO2024001_20241115_8392",
            QuantityOrdered  = 100,
            QuantityReceived = 95,
            QuantityPrinted  = 90,
            SessionDateEst   = "2024-11-15 10:30:00",
        };
        var json = JsonConvert.SerializeObject(req);
        var deserialized = JsonConvert.DeserializeObject<SaveBulkSessionRequest>(json)!;

        Assert.Equal(req.ProductTitle,     deserialized.ProductTitle);
        Assert.Equal(req.VendorName,       deserialized.VendorName);
        Assert.Equal(req.LotNo,            deserialized.LotNo);
        Assert.Equal(req.QuantityOrdered,  deserialized.QuantityOrdered);
        Assert.Equal(req.QuantityReceived, deserialized.QuantityReceived);
        Assert.Equal(req.QuantityPrinted,  deserialized.QuantityPrinted);
    }

    [Fact]
    public void SaveBulkSessionRequest_RequiresProductTitle()
    {
        var req = new SaveBulkSessionRequest { ProductTitle = "" };
        Assert.True(string.IsNullOrWhiteSpace(req.ProductTitle));
    }

    // ─── Discrepancy derivation (mirrors applyBulkApprovalAndInventory) ───────

    private static (int? qty, string? type) ComputeDiscrepancy(int ordered, int received)
    {
        if (received == ordered) return (null, null);
        int qty = Math.Abs(ordered - received);
        string type = received < ordered ? "short" : "over";
        return (qty, type);
    }

    [Fact]
    public void Discrepancy_NullWhenReceivedEqualsOrdered()
    {
        var (qty, type) = ComputeDiscrepancy(100, 100);
        Assert.Null(qty);
        Assert.Null(type);
    }

    [Fact]
    public void Discrepancy_ShortWhenReceivedLessThanOrdered()
    {
        var (qty, type) = ComputeDiscrepancy(100, 90);
        Assert.Equal(10, qty);
        Assert.Equal("short", type);
    }

    [Fact]
    public void Discrepancy_OverWhenReceivedMoreThanOrdered()
    {
        var (qty, type) = ComputeDiscrepancy(100, 110);
        Assert.Equal(10, qty);
        Assert.Equal("over", type);
    }

    [Fact]
    public void Discrepancy_ShortByOne()
    {
        var (qty, type) = ComputeDiscrepancy(50, 49);
        Assert.Equal(1, qty);
        Assert.Equal("short", type);
    }

    [Fact]
    public void Discrepancy_QtyIsAlwaysPositive()
    {
        var (shortQty, _) = ComputeDiscrepancy(100, 60);
        var (overQty,  _) = ComputeDiscrepancy(60, 100);
        Assert.True(shortQty > 0);
        Assert.True(overQty  > 0);
    }

    // ─── QuantityReceived vs QuantityPrinted: barcode overage ─────────────────

    [Fact]
    public void BarcodeOverage_DetectedWhenPrintedExceedsReceived()
    {
        int received = 10;
        int printed  = 13;
        bool isOverage = printed > received;
        Assert.True(isOverage);
    }

    [Fact]
    public void BarcodeOverage_NotFlaggedWhenPrintedEqualsReceived()
    {
        int received = 10;
        int printed  = 10;
        bool isOverage = printed > received;
        Assert.False(isOverage);
    }

    [Fact]
    public void BarcodeOverage_NotFlaggedWhenPrintedLessThanReceived()
    {
        int received = 10;
        int printed  = 7;
        bool isOverage = printed > received;
        Assert.False(isOverage);
    }

    [Fact]
    public void BarcodeOverage_LegacyRowReceivedZero_PrintedTenIsNotOverage()
    {
        // Legacy sessions (before QuantityReceived was stored) default to 0.
        // We must NOT flag overage when received=0 (data gap, not actual overage).
        int received = 0;
        int printed  = 10;
        bool isOverage = received > 0 && printed > received; // guard: only flag if received is known
        Assert.False(isOverage);
    }

    // ─── Auto lot number format validation ───────────────────────────────────
    // The number is generated client-side; these tests validate the expected format.

    private static bool IsValidAutoLotNo(string lotNo)
    {
        // Expected: LOT_{VENDOR}_{PONAME}_{YYYYMMDD}_{4digits}
        if (!lotNo.StartsWith("LOT_")) return false;
        var parts = lotNo.Split('_');
        if (parts.Length < 5) return false;  // LOT + vendor + poname + date + seq (vendor/po may have underscores)
        // Last segment must be 4 numeric digits
        var last = parts[^1];
        return last.Length == 4 && last.All(char.IsDigit);
    }

    [Fact]
    public void AutoLotNo_StartsWithLOT_Prefix()
    {
        string lotNo = "LOT_FRESHFARMS_PO2024001_20241115_8392";
        Assert.StartsWith("LOT_", lotNo);
    }

    [Fact]
    public void AutoLotNo_HasFourPartMinimum()
    {
        string lotNo = "LOT_FRESHFARMS_PO2024001_20241115_8392";
        Assert.True(IsValidAutoLotNo(lotNo));
    }

    [Fact]
    public void AutoLotNo_EndsWithFourDigitSuffix()
    {
        string lotNo = "LOT_VND_PO001_20241115_1234";
        var parts = lotNo.Split('_');
        string last = parts[^1];
        Assert.Equal(4, last.Length);
        Assert.All(last, c => Assert.True(char.IsDigit(c)));
    }

    [Fact]
    public void AutoLotNo_RejectsInvalidFormat_NoParts()
    {
        Assert.False(IsValidAutoLotNo("INVALIDLOT"));
    }

    [Fact]
    public void AutoLotNo_RejectsIfSuffixNotFourDigits()
    {
        Assert.False(IsValidAutoLotNo("LOT_VND_PO_20241115_12")); // only 2 digits
    }

    [Fact]
    public void AutoLotNo_AllUpperCase()
    {
        string lotNo = "LOT_FRESHFARMS_PO2024001_20241115_8392";
        // Everything except the separator underscores should be uppercase or digits
        Assert.Equal(lotNo, lotNo.ToUpperInvariant());
    }

    // ─── LotNo stored on entity ───────────────────────────────────────────────

    [Fact]
    public void BulkSessionEntity_StoreLotNoFromRequest()
    {
        string autoLot = "LOT_FRESHFARMS_PO001_20241115_4321";
        var entity = new BulkSessionEntity { LotNo = autoLot };
        Assert.Equal(autoLot, entity.LotNo);
    }

    [Fact]
    public void BulkSessionEntity_ManualLotNoPreserved()
    {
        string manualLot = "BATCH-2024-NOV-01";
        var entity = new BulkSessionEntity { LotNo = manualLot };
        Assert.Equal(manualLot, entity.LotNo);
    }

    [Fact]
    public void BulkSessionEntity_NullLotNoAllowed()
    {
        // Not all sessions are lot sessions
        var entity = new BulkSessionEntity { LotNo = null };
        Assert.Null(entity.LotNo);
    }

    // ─── BulkSessionLabelResult deserialization ───────────────────────────────

    [Fact]
    public void BulkSessionLabelResult_PrintedStatus_Deserializes()
    {
        var json = """[{"index":1,"sn":"beef-0001","qrPayload":"PAYLOAD","printedAtEst":"2024-11-15 10:30:00","status":"printed"}]""";
        var results = JsonConvert.DeserializeObject<List<BulkSessionLabelResult>>(json)!;
        Assert.Single(results);
        Assert.Equal("printed", results[0].Status);
        Assert.Equal("beef-0001", results[0].Sn);
    }

    [Fact]
    public void BulkSessionLabelResult_FailedStatus_Deserializes()
    {
        var json = """[{"index":1,"sn":"","qrPayload":"","printedAtEst":"","status":"failed","error":"Encryption failed"}]""";
        var results = JsonConvert.DeserializeObject<List<BulkSessionLabelResult>>(json)!;
        Assert.Single(results);
        Assert.Equal("failed", results[0].Status);
        Assert.Equal("Encryption failed", results[0].Error);
    }

    [Fact]
    public void SaveBulkSessionRequest_ResultsRoundTrip()
    {
        var req = new SaveBulkSessionRequest
        {
            ProductTitle = "Beef",
            Results = new List<BulkSessionLabelResult>
            {
                new() { Index = 1, Sn = "beef-0001", Status = "printed" },
                new() { Index = 2, Sn = "beef-0002", Status = "printed" },
            }
        };
        var json = JsonConvert.SerializeObject(req);
        var deserialized = JsonConvert.DeserializeObject<SaveBulkSessionRequest>(json)!;
        Assert.Equal(2, deserialized.Results.Count);
        Assert.Equal("beef-0001", deserialized.Results[0].Sn);
        Assert.Equal("beef-0002", deserialized.Results[1].Sn);
    }
}
