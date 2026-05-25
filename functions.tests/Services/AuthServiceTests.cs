using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using ShipScan.Functions.Services;
using Xunit;

namespace ShipScan.Functions.Tests.Services;

public class AuthServiceTests
{
    private static AuthService CreateService(
        string email = "admin@example.com",
        string password = "test-password-123",
        string jwtSecret = "test-access-secret-that-is-long-enough-for-hmacsha256-ok",
        string jwtRefreshSecret = "test-refresh-secret-that-is-long-enough-for-hmacsha256-ok")
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["AppEmail"]          = email,
                ["AppPassword"]       = password,
                ["JwtSecret"]         = jwtSecret,
                ["JwtRefreshSecret"]  = jwtRefreshSecret,
                ["JwtExpiresIn"]      = "24h",
                ["JwtRefreshExpiresIn"] = "30d"
            })
            .Build();

        return new AuthService(config, NullLogger<AuthService>.Instance);
    }

    // ─── Credential validation ────────────────────────────────────────────────

    [Fact]
    public void ValidateCredentials_CorrectEmailAndPassword_ReturnsTrue()
    {
        var svc = CreateService(email: "staff@shop.com", password: "secret99");
        Assert.True(svc.ValidateCredentials("staff@shop.com", "secret99"));
    }

    [Fact]
    public void ValidateCredentials_WrongPassword_ReturnsFalse()
    {
        var svc = CreateService(email: "admin@example.com", password: "correct");
        Assert.False(svc.ValidateCredentials("admin@example.com", "wrong"));
    }

    [Fact]
    public void ValidateCredentials_WrongEmail_ReturnsFalse()
    {
        var svc = CreateService(email: "admin@example.com", password: "correct");
        Assert.False(svc.ValidateCredentials("other@example.com", "correct"));
    }

    [Fact]
    public void ValidateCredentials_EmptyPassword_ReturnsFalse()
    {
        var svc = CreateService(email: "admin@example.com", password: "correct");
        Assert.False(svc.ValidateCredentials("admin@example.com", ""));
    }

    [Fact]
    public void ValidateCredentials_EmailCaseInsensitive_ReturnsTrue()
    {
        var svc = CreateService(email: "Admin@Example.com", password: "pass");
        Assert.True(svc.ValidateCredentials("admin@example.com", "pass"));
    }

    [Fact]
    public void ValidateCredentials_PasswordCaseSensitive_ReturnsFalse()
    {
        var svc = CreateService(email: "admin@example.com", password: "Password");
        Assert.False(svc.ValidateCredentials("admin@example.com", "password"));
    }

    // ─── Access token ─────────────────────────────────────────────────────────

    [Fact]
    public void GenerateAccessToken_ReturnsNonEmptyTokenAndJti()
    {
        var svc = CreateService();
        var (token, jti) = svc.GenerateAccessToken("staff");
        Assert.False(string.IsNullOrWhiteSpace(token));
        Assert.False(string.IsNullOrWhiteSpace(jti));
    }

    [Fact]
    public void ValidateAccessToken_ValidToken_ReturnsUserIdAndJti()
    {
        var svc = CreateService();
        var (token, jti) = svc.GenerateAccessToken("staff");
        var (userId, returnedJti) = svc.ValidateAccessToken(token);
        Assert.Equal("staff", userId);
        Assert.Equal(jti, returnedJti);
    }

    [Fact]
    public void ValidateAccessToken_InvalidToken_ReturnsNulls()
    {
        var svc = CreateService();
        var (userId, jti) = svc.ValidateAccessToken("not.a.valid.jwt");
        Assert.Null(userId);
        Assert.Null(jti);
    }

    [Fact]
    public void ValidateAccessToken_TamperedToken_ReturnsNulls()
    {
        var svc = CreateService();
        var (token, _) = svc.GenerateAccessToken("staff");
        var tampered = token[..^5] + "XXXXX";
        var (userId, jti) = svc.ValidateAccessToken(tampered);
        Assert.Null(userId);
        Assert.Null(jti);
    }

    [Fact]
    public void ValidateAccessToken_TokenFromDifferentSecret_ReturnsNulls()
    {
        var svc1 = CreateService(jwtSecret: "secret-one-that-is-long-enough-for-hmacsha256-algorithm");
        var svc2 = CreateService(jwtSecret: "secret-two-that-is-long-enough-for-hmacsha256-algorithm");
        var (token, _) = svc1.GenerateAccessToken("staff");
        var (userId, _) = svc2.ValidateAccessToken(token);
        Assert.Null(userId);
    }

    // ─── Refresh token ────────────────────────────────────────────────────────

    [Fact]
    public void GenerateRefreshToken_ReturnsNonEmptyTokenAndJti()
    {
        var svc = CreateService();
        var (token, jti) = svc.GenerateRefreshToken("staff");
        Assert.False(string.IsNullOrWhiteSpace(token));
        Assert.False(string.IsNullOrWhiteSpace(jti));
    }

    [Fact]
    public void ValidateRefreshToken_ValidToken_ReturnsUserIdAndJti()
    {
        var svc = CreateService();
        var (token, jti) = svc.GenerateRefreshToken("staff");
        var (userId, returnedJti) = svc.ValidateRefreshToken(token);
        Assert.Equal("staff", userId);
        Assert.Equal(jti, returnedJti);
    }

    [Fact]
    public void AccessTokenAndRefreshToken_HaveDifferentJtis()
    {
        var svc = CreateService();
        var (_, accessJti) = svc.GenerateAccessToken("staff");
        var (_, refreshJti) = svc.GenerateRefreshToken("staff");
        Assert.NotEqual(accessJti, refreshJti);
    }

    [Fact]
    public void AccessToken_DoesNotValidateAsRefreshToken()
    {
        var svc = CreateService();
        var (accessToken, _) = svc.GenerateAccessToken("staff");
        var (userId, _) = svc.ValidateRefreshToken(accessToken);
        Assert.Null(userId);
    }

    [Fact]
    public void RefreshToken_DoesNotValidateAsAccessToken()
    {
        var svc = CreateService();
        var (refreshToken, _) = svc.GenerateRefreshToken("staff");
        var (userId, _) = svc.ValidateAccessToken(refreshToken);
        Assert.Null(userId);
    }

    // ─── Duration parsing ─────────────────────────────────────────────────────

    [Theory]
    [InlineData("1h")]
    [InlineData("24h")]
    [InlineData("48h")]
    public void GenerateAccessToken_HourDurations_TokenIsValid(string duration)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["AppEmail"]         = "admin@example.com",
                ["AppPassword"]      = "test-password-123",
                ["JwtSecret"]        = "test-access-secret-that-is-long-enough-for-hmacsha256-ok",
                ["JwtRefreshSecret"] = "test-refresh-secret-that-is-long-enough-for-hmacsha256-ok",
                ["JwtExpiresIn"]     = duration
            })
            .Build();

        var svc = new AuthService(config, NullLogger<AuthService>.Instance);
        var (token, _) = svc.GenerateAccessToken();
        var (userId, _) = svc.ValidateAccessToken(token);
        Assert.NotNull(userId);
    }
}
