using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Models;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class AuthFunction
{
    private readonly ILogger<AuthFunction> _logger;
    private readonly AuthService _authService;
    private readonly TableStorageService _tableStorage;
    private readonly AuthHelper _authHelper;
    private readonly string[] _allowedOrigins;
    private readonly bool _cookieSecure;

    public AuthFunction(
        ILogger<AuthFunction> logger,
        AuthService authService,
        TableStorageService tableStorage,
        AuthHelper authHelper,
        string[] allowedOrigins,
        IConfiguration config)
    {
        _logger = logger;
        _authService = authService;
        _tableStorage = tableStorage;
        _authHelper = authHelper;
        _allowedOrigins = allowedOrigins;
        _cookieSecure = !string.Equals(config["CookieSecure"], "false", StringComparison.OrdinalIgnoreCase);
    }

    // ─── /api/auth — GET (check), POST (login), DELETE (logout) ─────────────

    [Function("Auth")]
    public async Task<HttpResponseData> Handle(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", "delete", "options", Route = "auth")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        if (req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
            return await Check(req);

        if (req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
            return await Login(req);

        if (req.Method.Equals("DELETE", StringComparison.OrdinalIgnoreCase))
            return await Logout(req);

        return req.CreateResponse(HttpStatusCode.MethodNotAllowed);
    }

    // ─── POST /api/auth/refresh — issue new access token ─────────────────────

    [Function("AuthRefresh")]
    public async Task<HttpResponseData> Refresh(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "auth/refresh")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var refreshTokenValue = AuthHelper.GetCookieValue(req, "refresh_token");
        if (string.IsNullOrEmpty(refreshTokenValue))
            return await ResponseHelper.WriteError(req, "Missing refresh_token cookie", HttpStatusCode.Unauthorized, _allowedOrigins);

        var (userId, refreshJti) = _authService.ValidateRefreshToken(refreshTokenValue);
        if (userId == null || refreshJti == null)
            return await ResponseHelper.WriteError(req, "Invalid or expired refresh token", HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            if (await _tableStorage.IsTokenRevokedAsync(refreshJti))
                return await ResponseHelper.WriteError(req, "Refresh token has been revoked", HttpStatusCode.Unauthorized, _allowedOrigins);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Revocation check failed during refresh");
            return await ResponseHelper.WriteError(req, "Authentication service unavailable", HttpStatusCode.InternalServerError, _allowedOrigins);
        }

        var (newAccessToken, _) = _authService.GenerateAccessToken(userId);
        var response = await ResponseHelper.WriteSuccess(req, new { ok = true }, _allowedOrigins);
        SetAccessTokenCookie(response, newAccessToken);
        return response;
    }

    // ─── Handlers ─────────────────────────────────────────────────────────────

    private async Task<HttpResponseData> Check(HttpRequestData req)
    {
        var (userId, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        return await ResponseHelper.WriteSuccess(req, new { authenticated = true, userId }, _allowedOrigins);
    }

    private async Task<HttpResponseData> Login(HttpRequestData req)
    {
        try
        {
            var body = await req.ReadAsStringAsync() ?? "";
            var loginReq = JsonConvert.DeserializeObject<LoginRequest>(body);

            if (string.IsNullOrWhiteSpace(loginReq?.Email) || string.IsNullOrWhiteSpace(loginReq.Password) ||
                !_authService.ValidateCredentials(loginReq.Email, loginReq.Password))
            {
                _logger.LogWarning("Failed login attempt for email: {Email}", loginReq?.Email ?? "(empty)");
                return await ResponseHelper.WriteError(req, "Invalid email or password", HttpStatusCode.Unauthorized, _allowedOrigins);
            }

            var (accessToken, _) = _authService.GenerateAccessToken("staff");
            var (refreshToken, _) = _authService.GenerateRefreshToken("staff");

            var response = await ResponseHelper.WriteSuccess(req, new { ok = true }, _allowedOrigins);
            SetTokenCookies(response, accessToken, refreshToken);
            return response;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Login error");
            return await ResponseHelper.WriteError(req, "Authentication failed", HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }

    private async Task<HttpResponseData> Logout(HttpRequestData req)
    {
        var accessTokenValue = AuthHelper.GetCookieValue(req, "access_token");
        if (!string.IsNullOrEmpty(accessTokenValue))
        {
            var (_, jti) = _authService.ValidateAccessToken(accessTokenValue);
            if (jti != null)
            {
                try
                {
                    var handler = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler();
                    var parsed = handler.ReadJwtToken(accessTokenValue);
                    var expiry = parsed.ValidTo == DateTime.MinValue
                        ? DateTimeOffset.UtcNow.AddDays(1)
                        : new DateTimeOffset(parsed.ValidTo, TimeSpan.Zero);

                    await _tableStorage.RevokeTokenAsync(jti, expiry);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to revoke access token JTI {Jti} on logout", jti);
                }
            }
        }

        var refreshTokenValue = AuthHelper.GetCookieValue(req, "refresh_token");
        if (!string.IsNullOrEmpty(refreshTokenValue))
        {
            var (_, refreshJti) = _authService.ValidateRefreshToken(refreshTokenValue);
            if (refreshJti != null)
            {
                try
                {
                    var handler = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler();
                    var parsed = handler.ReadJwtToken(refreshTokenValue);
                    var expiry = parsed.ValidTo == DateTime.MinValue
                        ? DateTimeOffset.UtcNow.AddDays(30)
                        : new DateTimeOffset(parsed.ValidTo, TimeSpan.Zero);

                    await _tableStorage.RevokeTokenAsync(refreshJti, expiry);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to revoke refresh token JTI {Jti} on logout", refreshJti);
                }
            }
        }

        var response = await ResponseHelper.WriteSuccess(req, new { ok = true }, _allowedOrigins);
        ClearTokenCookies(response);
        return response;
    }

    // ─── Cookie helpers ───────────────────────────────────────────────────────

    private void SetTokenCookies(HttpResponseData response, string accessToken, string refreshToken)
    {
        SetAccessTokenCookie(response, accessToken);
        var (secureAttr, sameSite) = CookieAttrs();
        response.Headers.Add("Set-Cookie",
            $"refresh_token={refreshToken}; HttpOnly; SameSite={sameSite}; Path=/; Max-Age=2592000{secureAttr}");
    }

    private void SetAccessTokenCookie(HttpResponseData response, string accessToken)
    {
        var (secureAttr, sameSite) = CookieAttrs();
        response.Headers.Add("Set-Cookie",
            $"access_token={accessToken}; HttpOnly; SameSite={sameSite}; Path=/; Max-Age=86400{secureAttr}");
    }

    private void ClearTokenCookies(HttpResponseData response)
    {
        var (secureAttr, sameSite) = CookieAttrs();
        response.Headers.Add("Set-Cookie",
            $"access_token=; HttpOnly; SameSite={sameSite}; Path=/; Max-Age=0{secureAttr}");
        response.Headers.Add("Set-Cookie",
            $"refresh_token=; HttpOnly; SameSite={sameSite}; Path=/; Max-Age=0{secureAttr}");
    }

    // SameSite=None requires Secure; on plain HTTP (local dev) use Lax instead
    private (string secureAttr, string sameSite) CookieAttrs() =>
        _cookieSecure ? ("; Secure", "None") : ("", "Lax");
}
