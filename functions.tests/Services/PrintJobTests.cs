using Azure.Data.Tables;
using Microsoft.Extensions.Logging.Abstractions;
using ShipScan.Functions.Models;
using ShipScan.Functions.Services;
using Xunit;

namespace ShipScan.Functions.Tests.Services;

/// <summary>
/// Tests for the Cross-Device Print Sync feature (Story 4).
///
/// Live tests require an Azure Storage connection string:
///   AZURE_STORAGE_CONNECTION_STRING   e.g. DefaultEndpointsProtocol=https;AccountName=...
///   (or the Azurite default: UseDevelopmentStorage=true)
///
/// Without that var the live tests are skipped at runtime.
/// </summary>
public class PrintJobTests : IAsyncLifetime
{
    private static bool HasLiveCredentials =>
        !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("AZURE_STORAGE_CONNECTION_STRING"));

    private TableStorageService? _svc;
    private readonly List<(string userId, string rowKey)> _cleanup = new();

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    public async Task InitializeAsync()
    {
        if (!HasLiveCredentials) return;
        var connStr = Environment.GetEnvironmentVariable("AZURE_STORAGE_CONNECTION_STRING")!;
        var tableClient = new TableServiceClient(connStr);
        _svc = new TableStorageService(tableClient, NullLogger<TableStorageService>.Instance);
        await _svc.EnsureTablesExistAsync();
    }

    public async Task DisposeAsync()
    {
        if (_svc == null) return;
        foreach (var (userId, rowKey) in _cleanup)
        {
            try
            {
                var job = await _svc.GetPrintJobAsync(userId, rowKey);
                if (job != null)
                {
                    // Delete by marking — Table Storage delete requires ETag; use ETag.All
                    var tableClient = new TableServiceClient(
                        Environment.GetEnvironmentVariable("AZURE_STORAGE_CONNECTION_STRING")!);
                    var tc = tableClient.GetTableClient("printjobs");
                    await tc.DeleteEntityAsync(userId, rowKey, Azure.ETag.All);
                }
            }
            catch { }
        }
    }

    private async Task<PrintJobEntity> CreateTestJob(string userId = "test-user", string createdBy = "test-device")
    {
        var job = await _svc!.CreatePrintJobAsync(userId, "{\"plu\":\"123\"}", "label", createdBy);
        _cleanup.Add((userId, job.RowKey));
        return job;
    }

    // ─── Model defaults ───────────────────────────────────────────────────────

    [Fact]
    public void PrintJobEntity_Defaults_StatusIsQueued()
    {
        var entity = new PrintJobEntity();
        Assert.Equal("queued", entity.Status);
        Assert.Equal("label", entity.JobType);
        Assert.Equal("{}", entity.Payload);
        Assert.Equal(0, entity.RetryCount);
        Assert.Null(entity.ClaimedBy);
        Assert.Null(entity.ClaimedAt);
        Assert.Null(entity.CompletedAt);
        Assert.Null(entity.FailedReason);
    }

    [Fact]
    public void CreatePrintJobRequest_Defaults()
    {
        var req = new CreatePrintJobRequest();
        Assert.Equal("label", req.JobType);
    }

    // ─── Create ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task CreateJob_Live_SetsStatusQueued()
    {
        if (!HasLiveCredentials) return;
        var job = await CreateTestJob();
        Assert.Equal("queued", job.Status);
        Assert.NotEmpty(job.RowKey);
        Assert.Equal("test-device", job.CreatedBy);
    }

    [Fact]
    public async Task CreateJob_Live_RowKeyIsUnique()
    {
        if (!HasLiveCredentials) return;
        var j1 = await CreateTestJob();
        var j2 = await CreateTestJob();
        Assert.NotEqual(j1.RowKey, j2.RowKey);
    }

    [Fact]
    public async Task CreateJob_Live_CreatedAtIsSet()
    {
        if (!HasLiveCredentials) return;
        var before = DateTimeOffset.UtcNow.AddSeconds(-1);
        var job = await CreateTestJob();
        Assert.True(job.CreatedAt >= before);
    }

    // ─── Get ──────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetJob_Live_ReturnsCreatedJob()
    {
        if (!HasLiveCredentials) return;
        var created = await CreateTestJob();
        var fetched = await _svc!.GetPrintJobAsync("test-user", created.RowKey);
        Assert.NotNull(fetched);
        Assert.Equal(created.RowKey, fetched!.RowKey);
        Assert.Equal("queued", fetched.Status);
    }

    [Fact]
    public async Task GetJob_Live_NonExistent_ReturnsNull()
    {
        if (!HasLiveCredentials) return;
        var result = await _svc!.GetPrintJobAsync("test-user", "nonexistent-row-key-xyz");
        Assert.Null(result);
    }

    [Fact]
    public async Task GetJob_Live_WrongUserId_ReturnsNull()
    {
        if (!HasLiveCredentials) return;
        var created = await CreateTestJob("user-a");
        var result = await _svc!.GetPrintJobAsync("user-b", created.RowKey);
        Assert.Null(result);
    }

    // ─── List ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ListJobs_Live_FilterByStatus_ReturnsOnlyQueued()
    {
        if (!HasLiveCredentials) return;
        var userId = $"list-test-{Guid.NewGuid():N}";
        var j1 = await CreateTestJob(userId);
        var j2 = await CreateTestJob(userId);

        // Claim j1
        await _svc!.ClaimPrintJobAsync(userId, j1.RowKey, "claimer");

        var queued = await _svc!.ListPrintJobsAsync(userId, "queued");
        var claimed = await _svc!.ListPrintJobsAsync(userId, "claimed");

        Assert.All(queued, j => Assert.Equal("queued", j.Status));
        Assert.All(claimed, j => Assert.Equal("claimed", j.Status));
        Assert.Contains(queued, j => j.RowKey == j2.RowKey);
        Assert.Contains(claimed, j => j.RowKey == j1.RowKey);
        Assert.DoesNotContain(queued, j => j.RowKey == j1.RowKey);
    }

    [Fact]
    public async Task ListJobs_Live_NoFilter_ReturnsAll()
    {
        if (!HasLiveCredentials) return;
        var userId = $"list-all-{Guid.NewGuid():N}";
        var j1 = await CreateTestJob(userId);
        var j2 = await CreateTestJob(userId);

        var all = await _svc!.ListPrintJobsAsync(userId, null);
        Assert.True(all.Count >= 2);
        Assert.Contains(all, j => j.RowKey == j1.RowKey);
        Assert.Contains(all, j => j.RowKey == j2.RowKey);
    }

    // ─── Claim ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ClaimJob_Live_FirstClaim_Succeeds()
    {
        if (!HasLiveCredentials) return;
        var job = await CreateTestJob();
        var claimed = await _svc!.ClaimPrintJobAsync("test-user", job.RowKey, "printer-pc");
        Assert.True(claimed);

        var updated = await _svc!.GetPrintJobAsync("test-user", job.RowKey);
        Assert.Equal("claimed", updated!.Status);
        Assert.Equal("printer-pc", updated.ClaimedBy);
        Assert.NotNull(updated.ClaimedAt);
    }

    [Fact]
    public async Task ClaimJob_Live_AlreadyClaimed_ReturnsFalse()
    {
        if (!HasLiveCredentials) return;
        var job = await CreateTestJob();
        await _svc!.ClaimPrintJobAsync("test-user", job.RowKey, "device-1");
        var second = await _svc!.ClaimPrintJobAsync("test-user", job.RowKey, "device-2");
        Assert.False(second);

        var updated = await _svc!.GetPrintJobAsync("test-user", job.RowKey);
        Assert.Equal("device-1", updated!.ClaimedBy);
    }

    [Fact]
    public async Task ClaimJob_Live_NonExistent_ReturnsFalse()
    {
        if (!HasLiveCredentials) return;
        var result = await _svc!.ClaimPrintJobAsync("test-user", "nonexistent-xyz", "device");
        Assert.False(result);
    }

    [Fact]
    public async Task ClaimJob_Live_ConcurrentClaim_OnlyOneWins()
    {
        if (!HasLiveCredentials) return;
        var job = await CreateTestJob();
        // Two devices race to claim the same job; exactly one should win
        var tasks = Enumerable.Range(0, 5).Select(i =>
            _svc!.ClaimPrintJobAsync("test-user", job.RowKey, $"device-{i}")
        ).ToList();
        var results = await Task.WhenAll(tasks);
        Assert.Equal(1, results.Count(r => r));
    }

    // ─── Complete ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task CompleteJob_Live_SetsStatusCompleted()
    {
        if (!HasLiveCredentials) return;
        var job = await CreateTestJob();
        await _svc!.ClaimPrintJobAsync("test-user", job.RowKey, "printer-pc");
        await _svc!.CompletePrintJobAsync("test-user", job.RowKey);

        var updated = await _svc!.GetPrintJobAsync("test-user", job.RowKey);
        Assert.Equal("completed", updated!.Status);
        Assert.NotNull(updated.CompletedAt);
    }

    [Fact]
    public async Task CompleteJob_Live_NonExistent_DoesNotThrow()
    {
        if (!HasLiveCredentials) return;
        // Should log warning but not throw
        await _svc!.CompletePrintJobAsync("test-user", "nonexistent-xyz");
    }

    // ─── Fail / Retry ─────────────────────────────────────────────────────────

    [Fact]
    public async Task FailJob_Live_ReleasesBackToQueued()
    {
        if (!HasLiveCredentials) return;
        var job = await CreateTestJob();
        await _svc!.ClaimPrintJobAsync("test-user", job.RowKey, "printer-pc");
        await _svc!.FailPrintJobAsync("test-user", job.RowKey, "printer offline");

        var updated = await _svc!.GetPrintJobAsync("test-user", job.RowKey);
        Assert.Equal("queued", updated!.Status);
        Assert.Null(updated.ClaimedBy);
        Assert.Null(updated.ClaimedAt);
        Assert.Equal("printer offline", updated.FailedReason);
        Assert.Equal(1, updated.RetryCount);
    }

    [Fact]
    public async Task FailJob_Live_RetryCountIncrementsOnEachFailure()
    {
        if (!HasLiveCredentials) return;
        var job = await CreateTestJob();

        for (var i = 1; i <= 3; i++)
        {
            await _svc!.ClaimPrintJobAsync("test-user", job.RowKey, "printer-pc");
            await _svc!.FailPrintJobAsync("test-user", job.RowKey, $"failure {i}");
            var updated = await _svc!.GetPrintJobAsync("test-user", job.RowKey);
            Assert.Equal("queued", updated!.Status);
            Assert.Equal(i, updated.RetryCount);
        }
    }

    [Fact]
    public async Task FailJob_Live_FailedJobCanBeReClaimedByAnotherDevice()
    {
        if (!HasLiveCredentials) return;
        var job = await CreateTestJob();
        await _svc!.ClaimPrintJobAsync("test-user", job.RowKey, "device-a");
        await _svc!.FailPrintJobAsync("test-user", job.RowKey, "crash");

        var reclaimed = await _svc!.ClaimPrintJobAsync("test-user", job.RowKey, "device-b");
        Assert.True(reclaimed);

        var updated = await _svc!.GetPrintJobAsync("test-user", job.RowKey);
        Assert.Equal("claimed", updated!.Status);
        Assert.Equal("device-b", updated.ClaimedBy);
    }

    [Fact]
    public async Task FailJob_Live_NonExistent_DoesNotThrow()
    {
        if (!HasLiveCredentials) return;
        await _svc!.FailPrintJobAsync("test-user", "nonexistent-xyz", "reason");
    }

    // ─── End-to-end flows ─────────────────────────────────────────────────────

    [Fact]
    public async Task EndToEnd_Live_HappyPath_QueuedToCompleted()
    {
        if (!HasLiveCredentials) return;
        var job = await CreateTestJob();
        Assert.Equal("queued", job.Status);

        var claimed = await _svc!.ClaimPrintJobAsync("test-user", job.RowKey, "warehouse-pc");
        Assert.True(claimed);

        var midState = await _svc!.GetPrintJobAsync("test-user", job.RowKey);
        Assert.Equal("claimed", midState!.Status);

        await _svc!.CompletePrintJobAsync("test-user", job.RowKey);
        var finalState = await _svc!.GetPrintJobAsync("test-user", job.RowKey);
        Assert.Equal("completed", finalState!.Status);
        Assert.NotNull(finalState.CompletedAt);
    }

    [Fact]
    public async Task EndToEnd_Live_FailAndRetry()
    {
        if (!HasLiveCredentials) return;
        var job = await CreateTestJob();

        // First attempt fails
        await _svc!.ClaimPrintJobAsync("test-user", job.RowKey, "device-a");
        await _svc!.FailPrintJobAsync("test-user", job.RowKey, "printer jammed");

        // Second attempt succeeds
        var reclaimed = await _svc!.ClaimPrintJobAsync("test-user", job.RowKey, "device-b");
        Assert.True(reclaimed);
        await _svc!.CompletePrintJobAsync("test-user", job.RowKey);

        var final = await _svc!.GetPrintJobAsync("test-user", job.RowKey);
        Assert.Equal("completed", final!.Status);
        Assert.Equal(1, final.RetryCount);
    }

    [Fact]
    public async Task EndToEnd_Live_NoPrinterOnline_JobStaysQueued()
    {
        if (!HasLiveCredentials) return;
        var job = await CreateTestJob();

        // No device claims it — job stays queued
        var fetched = await _svc!.GetPrintJobAsync("test-user", job.RowKey);
        Assert.Equal("queued", fetched!.Status);
        Assert.Null(fetched.ClaimedBy);

        // Listing queued jobs returns it
        var queued = await _svc!.ListPrintJobsAsync("test-user", "queued");
        Assert.Contains(queued, j => j.RowKey == job.RowKey);
    }
}
