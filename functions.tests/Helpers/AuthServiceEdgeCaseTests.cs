using Xunit;
using ShipScan.Functions.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace ShipScan.Functions.Tests.Helpers;

public class AuthServiceEdgeCaseTests
{
    [Fact]
    public void AuthService_MissingJwtSecret_ThrowsOnConstruction()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["AppEmail"]         = "admin@example.com",
                ["AppPassword"]      = "test-password-123",
                ["JwtRefreshSecret"] = "test-refresh-secret-that-is-long-enough-for-hmacsha256-ok"
                // JwtSecret intentionally missing
            })
            .Build();

        Assert.Throws<InvalidOperationException>(() =>
            new AuthService(config, NullLogger<AuthService>.Instance));
    }

    [Fact]
    public void AuthService_MissingJwtRefreshSecret_ThrowsOnConstruction()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["AppEmail"]    = "admin@example.com",
                ["AppPassword"] = "test-password-123",
                ["JwtSecret"]   = "test-access-secret-that-is-long-enough-for-hmacsha256-ok"
                // JwtRefreshSecret intentionally missing
            })
            .Build();

        Assert.Throws<InvalidOperationException>(() =>
            new AuthService(config, NullLogger<AuthService>.Instance));
    }

    [Fact]
    public void AuthService_MissingAppEmail_ThrowsOnConstruction()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["AppPassword"]      = "test-password-123",
                ["JwtSecret"]        = "test-access-secret-that-is-long-enough-for-hmacsha256-ok",
                ["JwtRefreshSecret"] = "test-refresh-secret-that-is-long-enough-for-hmacsha256-ok"
                // AppEmail intentionally missing
            })
            .Build();

        Assert.Throws<InvalidOperationException>(() =>
            new AuthService(config, NullLogger<AuthService>.Instance));
    }

    [Fact]
    public void AuthService_MissingAppPassword_ThrowsOnConstruction()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["AppEmail"]         = "admin@example.com",
                ["JwtSecret"]        = "test-access-secret-that-is-long-enough-for-hmacsha256-ok",
                ["JwtRefreshSecret"] = "test-refresh-secret-that-is-long-enough-for-hmacsha256-ok"
                // AppPassword intentionally missing
            })
            .Build();

        Assert.Throws<InvalidOperationException>(() =>
            new AuthService(config, NullLogger<AuthService>.Instance));
    }

    [Fact]
    public void ValidateAccessToken_EmptyString_ReturnsNulls()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["AppEmail"]         = "admin@example.com",
                ["AppPassword"]      = "test-password-123",
                ["JwtSecret"]        = "test-access-secret-that-is-long-enough-for-hmacsha256-ok",
                ["JwtRefreshSecret"] = "test-refresh-secret-that-is-long-enough-for-hmacsha256-ok"
            })
            .Build();

        var svc = new AuthService(config, NullLogger<AuthService>.Instance);
        var (userId, jti) = svc.ValidateAccessToken("");
        Assert.Null(userId);
        Assert.Null(jti);
    }
}
