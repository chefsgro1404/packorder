using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Models;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class OperationFunction
{
    private readonly ILogger<OperationFunction> _logger;
    private readonly TableStorageService _tableStorage;
    private readonly AuthHelper _authHelper;
    private readonly string[] _allowedOrigins;

    public OperationFunction(ILogger<OperationFunction> logger, TableStorageService tableStorage,
        AuthHelper authHelper, string[] allowedOrigins)
    {
        _logger = logger;
        _tableStorage = tableStorage;
        _authHelper = authHelper;
        _allowedOrigins = allowedOrigins;
    }

    // ── GET/POST /api/operations/jobs ─────────────────────────────────────────

    [Function("OperationJobs")]
    public async Task<HttpResponseData> Jobs(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "options", Route = "operations/jobs")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (userId, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            if (req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
            {
                var qs     = ParseQs(req.Url.Query);
                var status  = qs.GetValueOrDefault("status");
                var jobType = qs.GetValueOrDefault("jobType");
                var jobs    = await _tableStorage.GetOperationJobsAsync(userId!, status, jobType);
                return await ResponseHelper.WriteSuccess(req, new { jobs = jobs.Select(MapJob).ToList(), total = jobs.Count }, _allowedOrigins);
            }

            // POST — enqueue a new job
            var body    = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<EnqueueOperationJobRequest>(body);

            if (string.IsNullOrWhiteSpace(request?.JobType))
                return await ResponseHelper.WriteError(req, "jobType is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var entity = await _tableStorage.EnqueueOperationJobAsync(
                userId!, request.JobType, request.Payload ?? "{}",
                request.DeviceId, request.IdempotencyKey);

            await _tableStorage.WriteOperationLogAsync(
                entity.RowKey, entity.JobType, "created",
                entity.Payload, request.DeviceId);

            _logger.LogInformation("Operation job enqueued: {JobId} type={JobType}", entity.RowKey, entity.JobType);
            return await ResponseHelper.WriteSuccess(req, MapJob(entity), _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "OperationJobs endpoint failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    // ── GET /api/operations/jobs/dead ─────────────────────────────────────────

    [Function("OperationJobsDead")]
    public async Task<HttpResponseData> DeadJobs(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "operations/jobs/dead")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (userId, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var jobs = await _tableStorage.GetOperationJobsAsync(userId!, "dead");
            return await ResponseHelper.WriteSuccess(req, new { jobs = jobs.Select(MapJob).ToList(), total = jobs.Count }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "OperationJobsDead failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    // ── POST /api/operations/jobs/{id}/claim ──────────────────────────────────

    [Function("OperationJobClaim")]
    public async Task<HttpResponseData> Claim(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "operations/jobs/{id}/claim")]
        HttpRequestData req, string id)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (userId, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var body    = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<ClaimOperationJobRequest>(body);

            if (string.IsNullOrWhiteSpace(request?.DeviceId))
                return await ResponseHelper.WriteError(req, "deviceId is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var claimed = await _tableStorage.ClaimOperationJobAsync(userId!, id, request.DeviceId);
            if (!claimed)
            {
                var existing = await _tableStorage.GetOperationJobAsync(userId!, id);
                if (existing == null)
                    return await ResponseHelper.WriteError(req, "Job not found", HttpStatusCode.NotFound, _allowedOrigins);
                return await ResponseHelper.WriteError(req,
                    $"Job already {existing.Status}{(existing.ClaimedBy != null ? $" by {existing.ClaimedBy}" : "")}",
                    HttpStatusCode.Conflict, _allowedOrigins);
            }

            var job = await _tableStorage.GetOperationJobAsync(userId!, id);
            await _tableStorage.WriteOperationLogAsync(id, job!.JobType, "claimed", job.Payload, request.DeviceId);
            _logger.LogInformation("Operation job {JobId} claimed by {DeviceId}", id, request.DeviceId);
            return await ResponseHelper.WriteSuccess(req, MapJob(job!), _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "OperationJobClaim failed for {JobId}", id);
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    // ── POST /api/operations/jobs/{id}/complete ───────────────────────────────

    [Function("OperationJobComplete")]
    public async Task<HttpResponseData> Complete(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "operations/jobs/{id}/complete")]
        HttpRequestData req, string id)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (userId, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var job = await _tableStorage.GetOperationJobAsync(userId!, id);
            if (job == null)
                return await ResponseHelper.WriteError(req, "Job not found", HttpStatusCode.NotFound, _allowedOrigins);

            await _tableStorage.CompleteOperationJobAsync(userId!, id);
            await _tableStorage.WriteOperationLogAsync(id, job.JobType, "completed", job.Payload, job.ClaimedBy);
            _logger.LogInformation("Operation job {JobId} completed", id);
            return await ResponseHelper.WriteSuccess(req, new { ok = true, id }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "OperationJobComplete failed for {JobId}", id);
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    // ── POST /api/operations/jobs/{id}/fail ───────────────────────────────────

    [Function("OperationJobFail")]
    public async Task<HttpResponseData> Fail(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "operations/jobs/{id}/fail")]
        HttpRequestData req, string id)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (userId, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var job = await _tableStorage.GetOperationJobAsync(userId!, id);
            if (job == null)
                return await ResponseHelper.WriteError(req, "Job not found", HttpStatusCode.NotFound, _allowedOrigins);

            var body    = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<FailOperationJobRequest>(body);
            var reason  = request?.Reason ?? "unknown error";

            await _tableStorage.FailOperationJobAsync(userId!, id, reason);

            // Determine whether the job is now dead or retrying
            var updated = await _tableStorage.GetOperationJobAsync(userId!, id);
            var evt     = updated?.Status == "dead" ? "dead" : "failed";
            await _tableStorage.WriteOperationLogAsync(id, job.JobType, evt, job.Payload, job.ClaimedBy, reason);

            _logger.LogInformation("Operation job {JobId} failed ({RetryCount} retries) — now {Status}", id, updated?.RetryCount, updated?.Status);
            return await ResponseHelper.WriteSuccess(req, new { ok = true, id, status = updated?.Status }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "OperationJobFail failed for {JobId}", id);
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    // ── POST /api/operations/jobs/{id}/retry ──────────────────────────────────

    [Function("OperationJobRetry")]
    public async Task<HttpResponseData> Retry(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "operations/jobs/{id}/retry")]
        HttpRequestData req, string id)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (userId, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var job = await _tableStorage.GetOperationJobAsync(userId!, id);
            if (job == null)
                return await ResponseHelper.WriteError(req, "Job not found", HttpStatusCode.NotFound, _allowedOrigins);
            if (job.Status != "dead" && job.Status != "dismissed")
                return await ResponseHelper.WriteError(req, "Only dead or dismissed jobs can be retried", HttpStatusCode.BadRequest, _allowedOrigins);

            await _tableStorage.RetryDeadOperationJobAsync(userId!, id);
            await _tableStorage.WriteOperationLogAsync(id, job.JobType, "retried", job.Payload);
            _logger.LogInformation("Dead operation job {JobId} re-enqueued for retry", id);
            return await ResponseHelper.WriteSuccess(req, new { ok = true, id }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "OperationJobRetry failed for {JobId}", id);
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    // ── POST /api/operations/jobs/{id}/dismiss ────────────────────────────────

    [Function("OperationJobDismiss")]
    public async Task<HttpResponseData> Dismiss(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "operations/jobs/{id}/dismiss")]
        HttpRequestData req, string id)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (userId, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var job = await _tableStorage.GetOperationJobAsync(userId!, id);
            if (job == null)
                return await ResponseHelper.WriteError(req, "Job not found", HttpStatusCode.NotFound, _allowedOrigins);

            await _tableStorage.DismissOperationJobAsync(userId!, id);
            await _tableStorage.WriteOperationLogAsync(id, job.JobType, "dismissed", job.Payload);
            _logger.LogInformation("Operation job {JobId} dismissed", id);
            return await ResponseHelper.WriteSuccess(req, new { ok = true, id }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "OperationJobDismiss failed for {JobId}", id);
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    // ── POST /api/operations/log ──────────────────────────────────────────────

    [Function("OperationLogWrite")]
    public async Task<HttpResponseData> LogWrite(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "operations/log")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var body    = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<WriteOperationLogRequest>(body);

            if (string.IsNullOrWhiteSpace(request?.JobId))
                return await ResponseHelper.WriteError(req, "jobId is required", HttpStatusCode.BadRequest, _allowedOrigins);
            if (string.IsNullOrWhiteSpace(request.Event))
                return await ResponseHelper.WriteError(req, "event is required", HttpStatusCode.BadRequest, _allowedOrigins);

            await _tableStorage.WriteOperationLogAsync(
                request.JobId, request.JobType ?? "", request.Event,
                request.Payload ?? "{}", request.DeviceId, request.FailureReason);

            return await ResponseHelper.WriteSuccess(req, new { ok = true }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "OperationLogWrite failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    // ── GET /api/operations/logs ──────────────────────────────────────────────

    [Function("OperationLogs")]
    public async Task<HttpResponseData> Logs(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "operations/logs")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var qs       = ParseQs(req.Url.Query);
            var jobId    = qs.GetValueOrDefault("jobId");
            var jobType  = qs.GetValueOrDefault("jobType");
            var evt      = qs.GetValueOrDefault("event");
            var deviceId = qs.GetValueOrDefault("deviceId");
            DateTimeOffset? since = null;
            if (qs.TryGetValue("since", out var sinceStr) && DateTimeOffset.TryParse(sinceStr, out var sinceVal))
                since = sinceVal;

            var logs = await _tableStorage.GetOperationLogsAsync(jobId, jobType, evt, deviceId, since);
            return await ResponseHelper.WriteSuccess(req, new { logs = logs.Select(MapLog).ToList(), total = logs.Count }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "OperationLogs query failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static object MapJob(OperationJobEntity e) => new
    {
        id             = e.RowKey,
        jobType        = e.JobType,
        status         = e.Status,
        payload        = e.Payload,
        idempotencyKey = e.IdempotencyKey,
        deviceId       = e.DeviceId,
        claimedBy      = e.ClaimedBy,
        createdAt      = e.CreatedAt,
        claimedAt      = e.ClaimedAt,
        completedAt    = e.CompletedAt,
        failedAt       = e.FailedAt,
        failedReason   = e.FailedReason,
        retryCount     = e.RetryCount,
    };

    private static object MapLog(OperationLogEntity e) => new
    {
        jobId         = e.JobId,
        jobType       = e.JobType,
        @event        = e.Event,
        deviceId      = e.DeviceId,
        payload       = e.Payload,
        failureReason = e.FailureReason,
        eventAt       = e.EventAt,
    };

    private static Dictionary<string, string> ParseQs(string query)
    {
        var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(query)) return dict;
        var q = query.TrimStart('?');
        foreach (var pair in q.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var idx = pair.IndexOf('=');
            if (idx < 0) continue;
            dict[Uri.UnescapeDataString(pair[..idx])] = Uri.UnescapeDataString(pair[(idx + 1)..]);
        }
        return dict;
    }
}
