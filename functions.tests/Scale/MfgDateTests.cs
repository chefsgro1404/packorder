using ShipScan.Functions.Models;
using Xunit;

namespace ShipScan.Functions.Tests.Scale;

/// <summary>
/// Unit tests for the ManufacturingDate field across PrintedLabelEntity,
/// LogPrintedLabelRequest, BulkSessionEntity, and SaveBulkSessionRequest.
/// </summary>
public class MfgDateTests
{
    // ─── PrintedLabelEntity ───────────────────────────────────────────────────

    [Fact]
    public void PrintedLabelEntity_ManufacturingDate_DefaultsToNull()
    {
        var entity = new PrintedLabelEntity();
        Assert.Null(entity.ManufacturingDate);
    }

    [Fact]
    public void PrintedLabelEntity_ManufacturingDate_CanBeSet()
    {
        var entity = new PrintedLabelEntity { ManufacturingDate = "2025-01-10" };
        Assert.Equal("2025-01-10", entity.ManufacturingDate);
    }

    [Fact]
    public void PrintedLabelEntity_ExpiryDateAndManufacturingDate_AreIndependent()
    {
        var entity = new PrintedLabelEntity
        {
            ExpiryDate = "2025-12-31",
            ManufacturingDate = "2025-01-10",
        };
        Assert.Equal("2025-12-31", entity.ExpiryDate);
        Assert.Equal("2025-01-10", entity.ManufacturingDate);
    }

    [Fact]
    public void PrintedLabelEntity_ExpiryDateSet_ManufacturingDateCanBeNull()
    {
        var entity = new PrintedLabelEntity { ExpiryDate = "2025-12-31" };
        Assert.Equal("2025-12-31", entity.ExpiryDate);
        Assert.Null(entity.ManufacturingDate);
    }

    [Fact]
    public void PrintedLabelEntity_ManufacturingDateSet_ExpiryDateCanBeNull()
    {
        var entity = new PrintedLabelEntity { ManufacturingDate = "2025-01-10" };
        Assert.Null(entity.ExpiryDate);
        Assert.Equal("2025-01-10", entity.ManufacturingDate);
    }

    // ─── LogPrintedLabelRequest ───────────────────────────────────────────────

    [Fact]
    public void LogPrintedLabelRequest_MfgDate_DefaultsToNull()
    {
        var req = new LogPrintedLabelRequest();
        Assert.Null(req.MfgDate);
    }

    [Fact]
    public void LogPrintedLabelRequest_MfgDate_CanBeSet()
    {
        var req = new LogPrintedLabelRequest { MfgDate = "2025-02-01" };
        Assert.Equal("2025-02-01", req.MfgDate);
    }

    [Fact]
    public void LogPrintedLabelRequest_MfgDateAndExpiryDate_BothSet()
    {
        var req = new LogPrintedLabelRequest
        {
            ExpiryDate = "2025-12-31",
            MfgDate = "2025-02-01",
        };
        Assert.Equal("2025-12-31", req.ExpiryDate);
        Assert.Equal("2025-02-01", req.MfgDate);
    }

    [Fact]
    public void LogPrintedLabelRequest_MfgDate_DeserializesFromJsonProperty()
    {
        var json = """{"mfgDate":"2025-03-15","expiryDate":"2026-03-15"}""";
        var req = Newtonsoft.Json.JsonConvert.DeserializeObject<LogPrintedLabelRequest>(json);
        Assert.NotNull(req);
        Assert.Equal("2025-03-15", req!.MfgDate);
        Assert.Equal("2026-03-15", req.ExpiryDate);
    }

    [Fact]
    public void LogPrintedLabelRequest_MissingMfgDate_DeserializesAsNull()
    {
        var json = """{"expiryDate":"2026-03-15","productTitle":"Beef"}""";
        var req = Newtonsoft.Json.JsonConvert.DeserializeObject<LogPrintedLabelRequest>(json);
        Assert.NotNull(req);
        Assert.Null(req!.MfgDate);
    }

    // ─── BulkSessionEntity ────────────────────────────────────────────────────

    [Fact]
    public void BulkSessionEntity_ManufacturingDate_DefaultsToNull()
    {
        var entity = new BulkSessionEntity();
        Assert.Null(entity.ManufacturingDate);
    }

    [Fact]
    public void BulkSessionEntity_ManufacturingDate_CanBeSet()
    {
        var entity = new BulkSessionEntity { ManufacturingDate = "2025-01-01" };
        Assert.Equal("2025-01-01", entity.ManufacturingDate);
    }

    [Fact]
    public void BulkSessionEntity_ExpiryAndManufacturingDate_AreIndependent()
    {
        var entity = new BulkSessionEntity
        {
            ExpiryDate = "2026-06-01",
            ManufacturingDate = "2025-06-01",
        };
        Assert.Equal("2026-06-01", entity.ExpiryDate);
        Assert.Equal("2025-06-01", entity.ManufacturingDate);
    }

    // ─── SaveBulkSessionRequest ───────────────────────────────────────────────

    [Fact]
    public void SaveBulkSessionRequest_MfgDate_DefaultsToNull()
    {
        var req = new SaveBulkSessionRequest();
        Assert.Null(req.MfgDate);
    }

    [Fact]
    public void SaveBulkSessionRequest_MfgDate_CanBeSet()
    {
        var req = new SaveBulkSessionRequest { MfgDate = "2025-04-20" };
        Assert.Equal("2025-04-20", req.MfgDate);
    }

    [Fact]
    public void SaveBulkSessionRequest_MfgDate_DeserializesFromJson()
    {
        var json = """{"productTitle":"Lamb","mfgDate":"2025-04-20","expiryDate":"2026-04-20","quantityOrdered":10,"quantityPrinted":10,"sessionDateEst":"2025-04-20 09:00:00","results":[]}""";
        var req = Newtonsoft.Json.JsonConvert.DeserializeObject<SaveBulkSessionRequest>(json);
        Assert.NotNull(req);
        Assert.Equal("2025-04-20", req!.MfgDate);
        Assert.Equal("2026-04-20", req.ExpiryDate);
    }

    [Fact]
    public void SaveBulkSessionRequest_MissingMfgDate_DeserializesAsNull()
    {
        var json = """{"productTitle":"Beef","expiryDate":"2026-01-01","quantityOrdered":5,"quantityPrinted":5,"sessionDateEst":"2025-01-01 10:00:00","results":[]}""";
        var req = Newtonsoft.Json.JsonConvert.DeserializeObject<SaveBulkSessionRequest>(json);
        Assert.NotNull(req);
        Assert.Null(req!.MfgDate);
    }

    // ─── Entity-building logic (mirrors ScaleFunction POST logic) ────────────

    [Fact]
    public void EntityBuild_PrintedLabel_MfgDateFromRequest()
    {
        var request = new LogPrintedLabelRequest
        {
            ProductTitle = "Beef Keema",
            QrPayload = "payload",
            PrintedAtEst = "2025-01-10 09:00:00",
            ExpiryDate = "2026-01-10",
            MfgDate = "2025-01-10",
        };
        // Mirror what ScaleFunction does
        var entity = new PrintedLabelEntity
        {
            ProductTitle = request.ProductTitle,
            QrPayload = request.QrPayload,
            ExpiryDate = request.ExpiryDate,
            ManufacturingDate = request.MfgDate,
        };
        Assert.Equal("2025-01-10", entity.ManufacturingDate);
        Assert.Equal("2026-01-10", entity.ExpiryDate);
    }

    [Fact]
    public void EntityBuild_PrintedLabel_NullMfgDateFromRequest()
    {
        var request = new LogPrintedLabelRequest
        {
            ProductTitle = "Beef Keema",
            QrPayload = "payload",
            PrintedAtEst = "2025-01-10 09:00:00",
            ExpiryDate = "2026-01-10",
            MfgDate = null,
        };
        var entity = new PrintedLabelEntity
        {
            ExpiryDate = request.ExpiryDate,
            ManufacturingDate = request.MfgDate,
        };
        Assert.Null(entity.ManufacturingDate);
        Assert.Equal("2026-01-10", entity.ExpiryDate);
    }

    [Fact]
    public void EntityBuild_BulkSession_MfgDateFromRequest()
    {
        var request = new SaveBulkSessionRequest
        {
            ProductTitle = "Lamb",
            ExpiryDate = "2026-06-01",
            MfgDate = "2025-06-01",
            QuantityOrdered = 20,
            QuantityPrinted = 20,
        };
        var entity = new BulkSessionEntity
        {
            ProductTitle = request.ProductTitle,
            ExpiryDate = request.ExpiryDate,
            ManufacturingDate = request.MfgDate,
            QuantityOrdered = request.QuantityOrdered,
            QuantityPrinted = request.QuantityPrinted,
        };
        Assert.Equal("2025-06-01", entity.ManufacturingDate);
        Assert.Equal("2026-06-01", entity.ExpiryDate);
        Assert.Equal(20, entity.QuantityPrinted);
    }

    [Fact]
    public void EntityBuild_BulkSession_BothDatesNull_IsValid()
    {
        var request = new SaveBulkSessionRequest
        {
            ProductTitle = "Seeds",
            ExpiryDate = null,
            MfgDate = null,
            QuantityOrdered = 5,
            QuantityPrinted = 5,
        };
        var entity = new BulkSessionEntity
        {
            ExpiryDate = request.ExpiryDate,
            ManufacturingDate = request.MfgDate,
        };
        Assert.Null(entity.ExpiryDate);
        Assert.Null(entity.ManufacturingDate);
    }
}
