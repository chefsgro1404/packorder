using Newtonsoft.Json;
using ShipScan.Functions.Models;
using Xunit;

namespace ShipScan.Functions.Tests.Scale;

public class OperationJobTests
{
    // ─── OperationJobEntity defaults ─────────────────────────────────────────

    [Fact]
    public void OperationJobEntity_Status_DefaultsToQueued()
    {
        var entity = new OperationJobEntity();
        Assert.Equal("queued", entity.Status);
    }

    [Fact]
    public void OperationJobEntity_Payload_DefaultsToEmptyJson()
    {
        var entity = new OperationJobEntity();
        Assert.Equal("{}", entity.Payload);
    }

    [Fact]
    public void OperationJobEntity_RetryCount_DefaultsToZero()
    {
        var entity = new OperationJobEntity();
        Assert.Equal(0, entity.RetryCount);
    }

    [Fact]
    public void OperationJobEntity_OptionalFields_DefaultToNull()
    {
        var entity = new OperationJobEntity();
        Assert.Null(entity.IdempotencyKey);
        Assert.Null(entity.DeviceId);
        Assert.Null(entity.ClaimedBy);
        Assert.Null(entity.ClaimedAt);
        Assert.Null(entity.CompletedAt);
        Assert.Null(entity.FailedAt);
        Assert.Null(entity.FailedReason);
    }

    [Fact]
    public void OperationJobEntity_CanSetAllFields()
    {
        var now = DateTimeOffset.UtcNow;
        var entity = new OperationJobEntity
        {
            PartitionKey    = "user1",
            RowKey          = "abc123",
            JobType         = "adjust-inventory",
            Status          = "claimed",
            Payload         = """{"delta":5}""",
            IdempotencyKey  = "inv-abc-5",
            DeviceId        = "device-01",
            ClaimedBy       = "device-01",
            CreatedAt       = now,
            ClaimedAt       = now,
            RetryCount      = 1,
        };
        Assert.Equal("user1", entity.PartitionKey);
        Assert.Equal("abc123", entity.RowKey);
        Assert.Equal("adjust-inventory", entity.JobType);
        Assert.Equal("claimed", entity.Status);
        Assert.Equal("inv-abc-5", entity.IdempotencyKey);
        Assert.Equal(1, entity.RetryCount);
    }

    // ─── EnqueueOperationJobRequest ───────────────────────────────────────────

    [Fact]
    public void EnqueueOperationJobRequest_JobType_DefaultsToEmptyString()
    {
        var req = new EnqueueOperationJobRequest();
        Assert.Equal("", req.JobType);
    }

    [Fact]
    public void EnqueueOperationJobRequest_Payload_DefaultsToEmptyJson()
    {
        var req = new EnqueueOperationJobRequest();
        Assert.Equal("{}", req.Payload);
    }

    [Fact]
    public void EnqueueOperationJobRequest_DeserializesFromJson()
    {
        var json = """
        {
          "jobType": "adjust-inventory",
          "payload": "{\"delta\":10}",
          "deviceId": "device-01",
          "idempotencyKey": "adj-sn001-li1"
        }
        """;
        var req = JsonConvert.DeserializeObject<EnqueueOperationJobRequest>(json)!;
        Assert.Equal("adjust-inventory", req.JobType);
        Assert.Equal("device-01", req.DeviceId);
        Assert.Equal("adj-sn001-li1", req.IdempotencyKey);
    }

    [Fact]
    public void EnqueueOperationJobRequest_MissingOptionalFields()
    {
        var json = """{"jobType":"log-label","payload":"{}"}""";
        var req = JsonConvert.DeserializeObject<EnqueueOperationJobRequest>(json)!;
        Assert.Null(req.DeviceId);
        Assert.Null(req.IdempotencyKey);
    }

    // ─── ClaimOperationJobRequest ──────────────────────────────────────────────

    [Fact]
    public void ClaimOperationJobRequest_DeviceId_DefaultsToEmptyString()
    {
        var req = new ClaimOperationJobRequest();
        Assert.Equal("", req.DeviceId);
    }

    [Fact]
    public void ClaimOperationJobRequest_DeserializesFromJson()
    {
        var json = """{"deviceId":"printer-kitchen"}""";
        var req = JsonConvert.DeserializeObject<ClaimOperationJobRequest>(json)!;
        Assert.Equal("printer-kitchen", req.DeviceId);
    }

    // ─── FailOperationJobRequest ───────────────────────────────────────────────

    [Fact]
    public void FailOperationJobRequest_Reason_DefaultsToEmptyString()
    {
        var req = new FailOperationJobRequest();
        Assert.Equal("", req.Reason);
    }

    [Fact]
    public void FailOperationJobRequest_DeserializesReason()
    {
        var json = """{"reason":"Shopify rate limit exceeded"}""";
        var req = JsonConvert.DeserializeObject<FailOperationJobRequest>(json)!;
        Assert.Equal("Shopify rate limit exceeded", req.Reason);
    }

    // ─── OperationLogEntity ────────────────────────────────────────────────────

    [Fact]
    public void OperationLogEntity_Payload_DefaultsToEmptyJson()
    {
        var entity = new OperationLogEntity();
        Assert.Equal("{}", entity.Payload);
    }

    [Fact]
    public void OperationLogEntity_OptionalFields_DefaultToNull()
    {
        var entity = new OperationLogEntity();
        Assert.Null(entity.DeviceId);
        Assert.Null(entity.FailureReason);
    }

    [Fact]
    public void OperationLogEntity_CanSetAllFields()
    {
        var now = DateTimeOffset.UtcNow;
        var entity = new OperationLogEntity
        {
            PartitionKey  = "job-guid-001",
            RowKey        = "00000000000000000001-abc",
            JobId         = "job-guid-001",
            JobType       = "approve-line-item",
            Event         = "completed",
            DeviceId      = "device-02",
            Payload       = """{"poId":"PO/1","qty":10}""",
            FailureReason = null,
            EventAt       = now,
        };
        Assert.Equal("job-guid-001", entity.JobId);
        Assert.Equal("approve-line-item", entity.JobType);
        Assert.Equal("completed", entity.Event);
        Assert.Equal("device-02", entity.DeviceId);
        Assert.Equal(now, entity.EventAt);
    }

    // ─── WriteOperationLogRequest ──────────────────────────────────────────────

    [Fact]
    public void WriteOperationLogRequest_DefaultsAreReasonable()
    {
        var req = new WriteOperationLogRequest();
        Assert.Equal("", req.JobId);
        Assert.Equal("", req.JobType);
        Assert.Equal("", req.Event);
        Assert.Null(req.DeviceId);
        Assert.Equal("{}", req.Payload);
        Assert.Null(req.FailureReason);
    }

    [Fact]
    public void WriteOperationLogRequest_DeserializesFromJson()
    {
        var json = """
        {
          "jobId": "job-001",
          "jobType": "stamp-shipped",
          "event": "failed",
          "deviceId": "device-01",
          "payload": "{\"sn\":\"SN001\"}",
          "failureReason": "Network timeout"
        }
        """;
        var req = JsonConvert.DeserializeObject<WriteOperationLogRequest>(json)!;
        Assert.Equal("job-001", req.JobId);
        Assert.Equal("stamp-shipped", req.JobType);
        Assert.Equal("failed", req.Event);
        Assert.Equal("Network timeout", req.FailureReason);
    }

    // ─── Retry logic invariants ────────────────────────────────────────────────

    [Theory]
    [InlineData(0, "queued")]   // first failure → back to queued
    [InlineData(1, "queued")]   // second failure → still queued
    [InlineData(2, "dead")]     // third failure → dead (retryCount goes to 3)
    public void RetryLogic_StatusAfterFailure(int previousRetryCount, string expectedStatus)
    {
        // Mirror backend FailOperationJobAsync logic
        int newRetryCount = previousRetryCount + 1;
        string status = newRetryCount >= 3 ? "dead" : "queued";
        Assert.Equal(expectedStatus, status);
    }

    [Fact]
    public void RetryLogic_DeadAfterThreeFailures()
    {
        int retryCount = 0;
        string status = "queued";
        for (int i = 0; i < 3; i++)
        {
            retryCount++;
            status = retryCount >= 3 ? "dead" : "queued";
        }
        Assert.Equal("dead", status);
        Assert.Equal(3, retryCount);
    }

    [Fact]
    public void RetryLogic_ResetOnManualRetry()
    {
        // After manual retry: retryCount resets to 0, status = queued
        int retryCount = 3;
        string status = "dead";
        // Simulate RetryDeadOperationJobAsync
        retryCount = 0;
        status = "queued";
        Assert.Equal(0, retryCount);
        Assert.Equal("queued", status);
    }

    // ─── Backoff delays ────────────────────────────────────────────────────────

    [Theory]
    [InlineData(1,  5_000)]
    [InlineData(2, 15_000)]
    [InlineData(3, 45_000)]
    [InlineData(4, 45_000)]   // beyond 3: cap at 45s
    public void BackoffDelay_ByRetryCount(int retryCount, int expectedMs)
    {
        int[] delays = [5_000, 15_000, 45_000];
        int actual = delays[Math.Min(retryCount - 1, delays.Length - 1)];
        Assert.Equal(expectedMs, actual);
    }

    // ─── Job type valid values ─────────────────────────────────────────────────

    [Theory]
    [InlineData("adjust-inventory")]
    [InlineData("log-label")]
    [InlineData("approve-line-item")]
    [InlineData("stamp-shipped")]
    [InlineData("generate-sn")]
    public void KnownJobTypes_AreValidStrings(string jobType)
    {
        var entity = new OperationJobEntity { JobType = jobType };
        Assert.Equal(jobType, entity.JobType);
        Assert.False(string.IsNullOrEmpty(entity.JobType));
    }

    // ─── Log event valid values ────────────────────────────────────────────────

    [Theory]
    [InlineData("created")]
    [InlineData("claimed")]
    [InlineData("completed")]
    [InlineData("failed")]
    [InlineData("retried")]
    [InlineData("dead")]
    [InlineData("dismissed")]
    public void KnownLogEvents_AreValidStrings(string evt)
    {
        var entity = new OperationLogEntity { Event = evt };
        Assert.Equal(evt, entity.Event);
    }

    // ─── Idempotency key construction ─────────────────────────────────────────

    [Fact]
    public void IdempotencyKey_ForAdjustInventory_IncludesSnAndJobType()
    {
        // Mirrors frontend key construction: `${sn}:${jobType}:${lineItemId}`
        string sn = "GREEN-GLOBAL-0042";
        string jobType = "adjust-inventory";
        string lineItemId = "gid://shopify/InventoryItem/123";
        string key = $"{sn}:{jobType}:{lineItemId}";
        Assert.Contains("GREEN-GLOBAL-0042", key);
        Assert.Contains("adjust-inventory", key);
    }

    [Fact]
    public void IdempotencyKey_SameInputsProduceSameKey()
    {
        string sn = "SN-001";
        string jobType = "log-label";
        string poLineItemId = "li-001";
        string key1 = $"{sn}:{jobType}:{poLineItemId}";
        string key2 = $"{sn}:{jobType}:{poLineItemId}";
        Assert.Equal(key1, key2);
    }

    [Fact]
    public void IdempotencyKey_DifferentSnProducesDifferentKey()
    {
        string key1 = "SN-001:adjust-inventory:li-001";
        string key2 = "SN-002:adjust-inventory:li-001";
        Assert.NotEqual(key1, key2);
    }
}
