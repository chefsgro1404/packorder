using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Models;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class PrintJobFunction
{
    private readonly ILogger<PrintJobFunction> _logger;
    private readonly TableStorageService _tableStorage;
    private readonly AuthHelper _authHelper;
    private readonly string[] _allowedOrigins;

    public PrintJobFunction(ILogger<PrintJobFunction> logger, TableStorageService tableStorage,
        AuthHelper authHelper, string[] allowedOrigins)
    {
        _logger = logger;
        _tableStorage = tableStorage;
        _authHelper = authHelper;
        _allowedOrigins = allowedOrigins;
    }

    [Function("PrintJobs")]
    public async Task<HttpResponseData> PrintJobs(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "options", Route = "print-jobs")]
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
                var qs = ParseQueryString(req.Url.Query);
                var status = qs.TryGetValue("status", out var s) ? s : null;
                var jobs = await _tableStorage.ListPrintJobsAsync(userId!, status);
                return await ResponseHelper.WriteSuccess(req, new
                {
                    jobs = jobs.Select(MapJob).ToList(),
                    total = jobs.Count,
                }, _allowedOrigins);
            }

            var body = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<CreatePrintJobRequest>(body);

            if (string.IsNullOrWhiteSpace(request?.Payload))
                return await ResponseHelper.WriteError(req, "payload is required", HttpStatusCode.BadRequest, _allowedOrigins);
            if (string.IsNullOrWhiteSpace(request.CreatedBy))
                return await ResponseHelper.WriteError(req, "createdBy is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var entity = await _tableStorage.CreatePrintJobAsync(userId!, request.Payload, request.JobType ?? "label", request.CreatedBy);
            _logger.LogInformation("Print job created: {RowKey} by device {DeviceId}", entity.RowKey, request.CreatedBy);
            return await ResponseHelper.WriteSuccess(req, MapJob(entity), _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PrintJobs endpoint failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("PrintJobById")]
    public async Task<HttpResponseData> PrintJobById(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "print-jobs/{id}")]
        HttpRequestData req, string id)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (userId, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var job = await _tableStorage.GetPrintJobAsync(userId!, id);
            if (job == null)
                return await ResponseHelper.WriteError(req, "Job not found", HttpStatusCode.NotFound, _allowedOrigins);

            return await ResponseHelper.WriteSuccess(req, MapJob(job), _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PrintJobById failed for job {JobId}", id);
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("PrintJobClaim")]
    public async Task<HttpResponseData> Claim(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "print-jobs/{id}/claim")]
        HttpRequestData req, string id)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (userId, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var body = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<ClaimPrintJobRequest>(body);

            if (string.IsNullOrWhiteSpace(request?.DeviceId))
                return await ResponseHelper.WriteError(req, "deviceId is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var claimed = await _tableStorage.ClaimPrintJobAsync(userId!, id, request.DeviceId);
            if (!claimed)
            {
                var existing = await _tableStorage.GetPrintJobAsync(userId!, id);
                if (existing == null)
                    return await ResponseHelper.WriteError(req, "Job not found", HttpStatusCode.NotFound, _allowedOrigins);
                _logger.LogInformation("Print job {JobId} claim lost — already {Status} by {ClaimedBy}", id, existing.Status, existing.ClaimedBy);
                return await ResponseHelper.WriteError(req,
                    $"Job already {existing.Status}{(existing.ClaimedBy != null ? $" by {existing.ClaimedBy}" : "")}",
                    HttpStatusCode.Conflict, _allowedOrigins);
            }

            var job = await _tableStorage.GetPrintJobAsync(userId!, id);
            _logger.LogInformation("Print job {JobId} claimed by device {DeviceId}", id, request.DeviceId);
            return await ResponseHelper.WriteSuccess(req, MapJob(job!), _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PrintJobClaim failed for job {JobId}", id);
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("PrintJobComplete")]
    public async Task<HttpResponseData> Complete(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "print-jobs/{id}/complete")]
        HttpRequestData req, string id)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (userId, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            await _tableStorage.CompletePrintJobAsync(userId!, id);
            _logger.LogInformation("Print job {JobId} completed", id);
            return await ResponseHelper.WriteSuccess(req, new { ok = true, id }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PrintJobComplete failed for job {JobId}", id);
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("PrintJobFail")]
    public async Task<HttpResponseData> Fail(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "print-jobs/{id}/fail")]
        HttpRequestData req, string id)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (userId, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var body = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<FailPrintJobRequest>(body);
            await _tableStorage.FailPrintJobAsync(userId!, id, request?.Reason ?? "unknown error");
            _logger.LogInformation("Print job {JobId} failed — released back to queue", id);
            return await ResponseHelper.WriteSuccess(req, new { ok = true, id }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PrintJobFail failed for job {JobId}", id);
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    private static object MapJob(PrintJobEntity e) => new
    {
        id          = e.RowKey,
        status      = e.Status,
        payload     = e.Payload,
        jobType     = e.JobType,
        createdBy   = e.CreatedBy,
        claimedBy   = e.ClaimedBy,
        claimedAt   = e.ClaimedAt,
        completedAt = e.CompletedAt,
        failedReason = e.FailedReason,
        retryCount  = e.RetryCount,
        createdAt   = e.CreatedAt,
    };

    private static Dictionary<string, string> ParseQueryString(string query)
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
