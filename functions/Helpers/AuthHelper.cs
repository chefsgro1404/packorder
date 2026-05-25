using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Helpers;

public class AuthHelper
{
    private readonly AuthService _authService;
    private readonly TableStorageService _tableStorage;
    private readonly ILogger<AuthHelper> _logger;

    public AuthHelper(AuthService authService, TableStorageService tableStorage, ILogger<AuthHelper> logger)
    {
        _authService = authService;
        _tableStorage = tableStorage;
        _logger = logger;
    }

    // Returns (userId, jti, errorMessage).
    // userId and jti are non-null only on success; errorMessage is non-null only on failure.
    public async Task<(string? UserId, string? Jti, string? Error)> ValidateRequest(HttpRequestData req)
    {
        var token = GetCookieValue(req, "access_token");
        if (string.IsNullOrEmpty(token))
            return (null, null, "Missing access_token cookie");

        var (userId, jti) = _authService.ValidateAccessToken(token);
        if (userId == null || jti == null)
            return (null, null, "Invalid or expired token");

        try
        {
            if (await _tableStorage.IsTokenRevokedAsync(jti))
            {
                _logger.LogWarning("Revoked token used: JTI {Jti}", jti);
                return (null, null, "Token has been revoked");
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Revocation check failed for JTI {Jti}", jti);
            return (null, null, "Authentication service unavailable");
        }

        return (userId, jti, null);
    }

    // Reads a named value from the Cookie request header.
    public static string? GetCookieValue(HttpRequestData req, string name)
    {
        if (!req.Headers.TryGetValues("Cookie", out var cookieValues))
            return null;

        var header = cookieValues.FirstOrDefault() ?? "";
        foreach (var segment in header.Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            var kv = segment.Trim().Split('=', 2);
            if (kv.Length == 2 && kv[0].Trim() == name)
                return kv[1].Trim();
        }
        return null;
    }
}
