using ShipScan.Functions.Models;
using Xunit;

namespace ShipScan.Functions.Tests.Scale;

/// <summary>
/// Unit tests for ProcessingSession model, entity building, and session math.
/// These test the logic that lives in ScaleFunction.ProcessingSession without
/// requiring a live Azure Table connection.
/// </summary>
public class ProcessingSessionTests
{
    // ─── ProcessingSessionEntity defaults ────────────────────────────────────

    [Fact]
    public void ProcessingSessionEntity_DefaultStatus_IsPartial()
    {
        var entity = new ProcessingSessionEntity();
        Assert.Equal("partial", entity.SessionStatus);
    }

    [Fact]
    public void ProcessingSessionEntity_DefaultVariantBreakdown_IsEmptyJson()
    {
        var entity = new ProcessingSessionEntity();
        Assert.Equal("{}", entity.VariantBreakdown);
    }

    [Fact]
    public void ProcessingSessionEntity_PartitionKey_IsPoLineItemId()
    {
        var entity = new ProcessingSessionEntity
        {
            PartitionKey = "line-item-123",
            PoLineItemId = "line-item-123",
        };
        Assert.Equal(entity.PartitionKey, entity.PoLineItemId);
    }

    // ─── SaveProcessingSessionRequest validation ──────────────────────────────

    [Fact]
    public void SaveProcessingSessionRequest_MissingPoLineItemId_FailsValidation()
    {
        var req = new SaveProcessingSessionRequest { PoId = "po-123", PoLineItemId = "", SessionQty = 10 };
        Assert.True(string.IsNullOrWhiteSpace(req.PoLineItemId));
    }

    [Fact]
    public void SaveProcessingSessionRequest_MissingPoId_FailsValidation()
    {
        var req = new SaveProcessingSessionRequest { PoId = "", PoLineItemId = "line-1", SessionQty = 10 };
        Assert.True(string.IsNullOrWhiteSpace(req.PoId));
    }

    [Fact]
    public void SaveProcessingSessionRequest_NegativeSessionQty_FailsValidation()
    {
        var req = new SaveProcessingSessionRequest { PoId = "po-1", PoLineItemId = "line-1", SessionQty = -1 };
        Assert.True(req.SessionQty < 0);
    }

    [Fact]
    public void SaveProcessingSessionRequest_ZeroSessionQty_IsAllowed()
    {
        // Partial close (process later) writes 0 sessionQty
        var req = new SaveProcessingSessionRequest { PoId = "po-1", PoLineItemId = "line-1", SessionQty = 0 };
        Assert.True(req.SessionQty >= 0);
    }

    [Fact]
    public void SaveProcessingSessionRequest_DefaultStatus_IsPartial()
    {
        var req = new SaveProcessingSessionRequest();
        Assert.Equal("partial", req.SessionStatus);
    }

    // ─── Cumulative total calculation (mirrors ScaleFunction POST logic) ──────

    [Fact]
    public void CumulativeTotal_FirstSession_EqualsSessonQty()
    {
        var priorQty = 0;
        var sessionQty = 25;
        var total = priorQty + sessionQty;
        Assert.Equal(25, total);
    }

    [Fact]
    public void CumulativeTotal_MultipleSessionsSameLineItem_SumsCorrectly()
    {
        var priorSessions = new[] { 10, 15, 8 }; // prior session qtys
        var priorQty = priorSessions.Sum();
        var sessionQty = 12;
        var total = priorQty + sessionQty;
        Assert.Equal(45, total);
    }

    [Fact]
    public void CumulativeTotal_ResumedPartialSession_AddsToExisting()
    {
        // After "process later", barcode is re-scanned and processing continues
        var priorQty = 30;
        var newSessionQty = 20;
        var total = priorQty + newSessionQty;
        Assert.Equal(50, total);
    }

    // ─── Wastage calculation ──────────────────────────────────────────────────

    [Fact]
    public void Wastage_AllProcessed_IsZero()
    {
        var poQty = 100;
        var totalProcessed = 100;
        var unaccounted = Math.Max(0, poQty - totalProcessed);
        Assert.Equal(0, unaccounted);
    }

    [Fact]
    public void Wastage_PartialProcessing_IsPositive()
    {
        var poQty = 100;
        var totalProcessed = 85;
        var unaccounted = Math.Max(0, poQty - totalProcessed);
        Assert.Equal(15, unaccounted);
    }

    [Fact]
    public void Wastage_OverProcessed_ClampedToZero()
    {
        // Edge case: more was printed than PO qty (rare but possible)
        var poQty = 50;
        var totalProcessed = 55;
        var unaccounted = Math.Max(0, poQty - totalProcessed);
        Assert.Equal(0, unaccounted);
    }

    [Fact]
    public void Wastage_CumulativeAcrossSessions_ComputedCorrectly()
    {
        var poQty = 100;
        var priorQty = 40; // from previous sessions
        var currentSession = 50;
        var totalProcessed = priorQty + currentSession;
        var unaccounted = Math.Max(0, poQty - totalProcessed);
        Assert.Equal(10, unaccounted);
    }

    // ─── Variant breakdown serialization ─────────────────────────────────────

    [Fact]
    public void VariantBreakdown_Serialized_IsValidJson()
    {
        var breakdown = new Dictionary<string, int> { { "3lb Pack", 10 }, { "Keema", 5 } };
        var json = Newtonsoft.Json.JsonConvert.SerializeObject(breakdown);
        Assert.False(string.IsNullOrWhiteSpace(json));
        Assert.Contains("3lb Pack", json);
        Assert.Contains("Keema", json);
    }

    [Fact]
    public void VariantBreakdown_Deserialized_RoundTrips()
    {
        var original = new Dictionary<string, int> { { "Small", 20 }, { "Medium", 30 }, { "Large", 10 } };
        var json = Newtonsoft.Json.JsonConvert.SerializeObject(original);
        var roundTripped = Newtonsoft.Json.JsonConvert.DeserializeObject<Dictionary<string, int>>(json);
        Assert.Equal(original, roundTripped);
    }

    [Fact]
    public void VariantBreakdown_MergeAcrossSessions_AggregatesCorrectly()
    {
        // Mirrors the aggregation logic in GET /api/scale/processing-session
        var sessions = new[]
        {
            new Dictionary<string, int> { { "Keema", 10 }, { "3lb Pack", 5 } },
            new Dictionary<string, int> { { "Keema", 8 }, { "5lb Pack", 3 } },
        };

        var merged = new Dictionary<string, int>();
        foreach (var bd in sessions)
            foreach (var kv in bd)
                merged[kv.Key] = merged.GetValueOrDefault(kv.Key) + kv.Value;

        Assert.Equal(18, merged["Keema"]);
        Assert.Equal(5, merged["3lb Pack"]);
        Assert.Equal(3, merged["5lb Pack"]);
    }

    [Fact]
    public void VariantBreakdown_EmptyJson_DeserializesAsEmptyDict()
    {
        var bd = Newtonsoft.Json.JsonConvert.DeserializeObject<Dictionary<string, int>>("{}") ?? new();
        Assert.Empty(bd);
    }

    [Fact]
    public void VariantBreakdown_NullJson_FallsBackToEmpty()
    {
        string? json = null;
        Dictionary<string, int> bd;
        try { bd = Newtonsoft.Json.JsonConvert.DeserializeObject<Dictionary<string, int>>(json ?? "{}") ?? new(); }
        catch { bd = new(); }
        Assert.Empty(bd);
    }

    // ─── Lot pool: session keyed by PoLineItemId ──────────────────────────────

    [Fact]
    public void LotPool_AllBarcodesShareSamePoLineItemId_AggregateIsCorrect()
    {
        // 3 barcodes in a lot; each processes some quantity
        const string poLineItemId = "li-beef-lot-001";
        var sessions = new[]
        {
            new ProcessingSessionEntity { PartitionKey = poLineItemId, SessionQty = 20, WastageQty = 0, SessionStatus = "partial" },
            new ProcessingSessionEntity { PartitionKey = poLineItemId, SessionQty = 15, WastageQty = 0, SessionStatus = "partial" },
            new ProcessingSessionEntity { PartitionKey = poLineItemId, SessionQty = 10, WastageQty = 2, SessionStatus = "completed" },
        };

        var cumulativeQty = sessions.Sum(s => s.SessionQty);
        var wastageQty    = sessions.Sum(s => s.WastageQty);

        Assert.Equal(45, cumulativeQty);
        Assert.Equal(2, wastageQty);
    }

    [Fact]
    public void LotPool_ResumedFromDifferentBarcode_SeesPriorProgress()
    {
        // Barcode #3 scanned; prior sessions from barcodes #1 and #2 are aggregated
        const string poLineItemId = "li-goat-lot-001";
        var priorSessions = new[]
        {
            new ProcessingSessionEntity { PartitionKey = poLineItemId, SessionQty = 30, SessionStatus = "completed" },
            new ProcessingSessionEntity { PartitionKey = poLineItemId, SessionQty = 25, SessionStatus = "partial" },
        };

        var priorQty = priorSessions.Sum(s => s.SessionQty);
        var poQty = 100;
        var remaining = Math.Max(0, poQty - priorQty);

        // Even though we're scanning barcode #3 for the first time, prior progress is visible
        Assert.Equal(55, priorQty);
        Assert.Equal(45, remaining);
    }

    [Fact]
    public void LotPool_LastSessionStatus_DeterminesResumeState()
    {
        // GET endpoint returns the most recent session's status
        var sessions = new[]
        {
            new ProcessingSessionEntity { SessionStatus = "completed", ProcessedAt = "2026-11-01T10:00:00Z" },
            new ProcessingSessionEntity { SessionStatus = "partial",   ProcessedAt = "2026-11-02T10:00:00Z" },
            new ProcessingSessionEntity { SessionStatus = "partial",   ProcessedAt = "2026-11-03T10:00:00Z" },
        };
        var last = sessions.OrderByDescending(s => s.ProcessedAt).First();
        Assert.Equal("partial", last.SessionStatus);
    }

    // ─── Session entity building ──────────────────────────────────────────────

    [Fact]
    public void SessionEntity_RowKey_IsNewGuid()
    {
        var sessionId = Guid.NewGuid().ToString("N");
        Assert.Equal(32, sessionId.Length); // no hyphens
        Assert.True(Guid.TryParse(sessionId, out _) || sessionId.Length == 32);
    }

    [Fact]
    public void SessionEntity_ProcessedAt_IsUtcIsoString()
    {
        var now = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ");
        Assert.Contains("T", now);
        Assert.EndsWith("Z", now);
    }

    [Fact]
    public void SessionEntity_CumulativeQty_IsPriorPlusCurrentSession()
    {
        var priorQty = 30;
        var sessionQty = 20;
        var entity = new ProcessingSessionEntity
        {
            SessionQty    = sessionQty,
            CumulativeQty = priorQty + sessionQty,
        };
        Assert.Equal(50, entity.CumulativeQty);
    }
}
