using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;

namespace ShipScan.Functions.Services;

public class AuthService
{
    private readonly string _email;
    private readonly string _password;
    private readonly string _jwtSecret;
    private readonly string _jwtRefreshSecret;
    private readonly TimeSpan _accessTokenExpiry;
    private readonly TimeSpan _refreshTokenExpiry;
    private readonly ILogger<AuthService> _logger;

    public AuthService(IConfiguration config, ILogger<AuthService> logger)
    {
        _logger = logger;
        _email    = config["AppEmail"]    ?? throw new InvalidOperationException("AppEmail is required");
        _password = config["AppPassword"] ?? throw new InvalidOperationException("AppPassword is required");
        _jwtSecret = config["JwtSecret"] ?? throw new InvalidOperationException("JwtSecret is required");
        _jwtRefreshSecret = config["JwtRefreshSecret"] ?? throw new InvalidOperationException("JwtRefreshSecret is required");
        _accessTokenExpiry = ParseDuration(config["JwtExpiresIn"] ?? "24h");
        _refreshTokenExpiry = ParseDuration(config["JwtRefreshExpiresIn"] ?? "30d");
    }

    public bool ValidateCredentials(string email, string password)
    {
        // Constant-time comparison to prevent timing attacks
        var emailOk = System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.UTF8.GetBytes(email.ToLowerInvariant()),
            System.Text.Encoding.UTF8.GetBytes(_email.ToLowerInvariant()));
        var passwordOk = System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.UTF8.GetBytes(password),
            System.Text.Encoding.UTF8.GetBytes(_password));
        return emailOk && passwordOk;
    }

    // Returns (token, jti)
    public (string Token, string Jti) GenerateAccessToken(string userId = "staff")
        => GenerateToken(_jwtSecret, userId, _accessTokenExpiry);

    // Returns (token, jti)
    public (string Token, string Jti) GenerateRefreshToken(string userId = "staff")
        => GenerateToken(_jwtRefreshSecret, userId, _refreshTokenExpiry);

    // Returns (userId, jti) or (null, null) if invalid
    public (string? UserId, string? Jti) ValidateAccessToken(string token)
        => ValidateTokenInternal(_jwtSecret, token);

    // Returns (userId, jti) or (null, null) if invalid
    public (string? UserId, string? Jti) ValidateRefreshToken(string token)
        => ValidateTokenInternal(_jwtRefreshSecret, token);

    // ─── Private helpers ─────────────────────────────────────────────────────

    private static (string Token, string Jti) GenerateToken(string secret, string userId, TimeSpan expiry)
    {
        var jti = Guid.NewGuid().ToString();
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: "shipscan",
            audience: "shipscan",
            claims: new[]
            {
                new Claim(ClaimTypes.NameIdentifier, userId),
                new Claim(JwtRegisteredClaimNames.Jti, jti)
            },
            expires: DateTime.UtcNow.Add(expiry),
            signingCredentials: credentials
        );

        return (new JwtSecurityTokenHandler().WriteToken(token), jti);
    }

    private (string? UserId, string? Jti) ValidateTokenInternal(string secret, string token)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var handler = new JwtSecurityTokenHandler();

        try
        {
            var principal = handler.ValidateToken(token, new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = key,
                ValidateIssuer = true,
                ValidIssuer = "shipscan",
                ValidateAudience = true,
                ValidAudience = "shipscan",
                ValidateLifetime = true,
                ClockSkew = TimeSpan.Zero
            }, out var validatedToken);

            var userId = principal.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            var jti = (validatedToken as JwtSecurityToken)?.Id;
            return (userId, jti);
        }
        catch (Exception ex)
        {
            _logger.LogDebug("Token validation failed: {Message}", ex.Message);
            return (null, null);
        }
    }

    private static TimeSpan ParseDuration(string duration)
    {
        if (duration.EndsWith('h') && int.TryParse(duration[..^1], out var hours))
            return TimeSpan.FromHours(hours);
        if (duration.EndsWith('d') && int.TryParse(duration[..^1], out var days))
            return TimeSpan.FromDays(days);
        return TimeSpan.FromHours(24);
    }
}
