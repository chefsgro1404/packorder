using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class QrFunction
{
    private readonly ILogger<QrFunction> _logger;
    private readonly QrEncryptionService _qrEncryption;
    private readonly AuthHelper _authHelper;
    private readonly string[] _allowedOrigins;

    public QrFunction(ILogger<QrFunction> logger, QrEncryptionService qrEncryption,
        AuthHelper authHelper, string[] allowedOrigins)
    {
        _logger         = logger;
        _qrEncryption   = qrEncryption;
        _authHelper     = authHelper;
        _allowedOrigins = allowedOrigins;
    }

    [Function("QrEncrypt")]
    public async Task<HttpResponseData> Encrypt(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "qr/encrypt")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var body    = await req.ReadAsStringAsync() ?? "";
            var request = JsonConvert.DeserializeObject<dynamic>(body);
            string? payload = request?.payload;
            if (string.IsNullOrWhiteSpace(payload))
                return await ResponseHelper.WriteError(req, "payload is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var encrypted = _qrEncryption.Encrypt(payload);
            return await ResponseHelper.WriteSuccess(req, new { encrypted }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "QR encrypt failed");
            return await ResponseHelper.WriteError(req, "Encryption failed", HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    [Function("QrDecrypt")]
    public async Task<HttpResponseData> Decrypt(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "qr/decrypt")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            var body    = await req.ReadAsStringAsync() ?? "";
            var request = JsonConvert.DeserializeObject<dynamic>(body);
            string? encrypted = request?.encrypted;
            if (string.IsNullOrWhiteSpace(encrypted))
                return await ResponseHelper.WriteError(req, "encrypted is required", HttpStatusCode.BadRequest, _allowedOrigins);

            var plainPayload = _qrEncryption.Decrypt(encrypted);
            return await ResponseHelper.WriteSuccess(req, new { payload = plainPayload }, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "QR decrypt failed");
            return await ResponseHelper.WriteError(req, "Decryption failed", HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }
}
