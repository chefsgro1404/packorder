using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Models;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class VendorFunction
{
    private readonly ILogger<VendorFunction> _logger;
    private readonly TableStorageService _tableStorage;
    private readonly AuthHelper _authHelper;
    private readonly string[] _allowedOrigins;

    public VendorFunction(ILogger<VendorFunction> logger, TableStorageService tableStorage,
        AuthHelper authHelper, string[] allowedOrigins)
    {
        _logger = logger;
        _tableStorage = tableStorage;
        _authHelper = authHelper;
        _allowedOrigins = allowedOrigins;
    }

    [Function("Vendors")]
    public async Task<HttpResponseData> Vendors(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "options", Route = "vendors")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            if (req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
            {
                var vendors = await _tableStorage.GetVendorsAsync();
                return await ResponseHelper.WriteSuccess(req, new
                {
                    vendors = vendors.Select(v => new
                    {
                        id         = v.RowKey,
                        vendorName = v.VendorName,
                    }).ToList(),
                }, _allowedOrigins);
            }

            var body    = await req.ReadAsStringAsync() ?? "{}";
            var request = JsonConvert.DeserializeObject<CreateVendorRequest>(body);

            if (string.IsNullOrWhiteSpace(request?.VendorName))
                return await ResponseHelper.WriteError(req, "vendorName is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var entity = await _tableStorage.SaveVendorAsync(request.VendorName);
            _logger.LogInformation("Vendor created: {VendorName} ({Id})", entity.VendorName, entity.RowKey);

            return await ResponseHelper.WriteSuccess(req, new
            {
                id         = entity.RowKey,
                vendorName = entity.VendorName,
            }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Vendors endpoint failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("VendorById")]
    public async Task<HttpResponseData> VendorById(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", "options", Route = "vendors/{id}")]
        HttpRequestData req, string id)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            await _tableStorage.DeleteVendorAsync(id);
            _logger.LogInformation("Vendor deleted: {Id}", id);
            return await ResponseHelper.WriteSuccess(req, new { ok = true, id }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "VendorById DELETE failed for {Id}", id);
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }
}
