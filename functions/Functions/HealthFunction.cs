using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using ShipScan.Functions.Helpers;

namespace ShipScan.Functions.Functions;

public class HealthFunction
{
    private readonly ILogger<HealthFunction> _logger;
    private readonly string[] _allowedOrigins;

    public HealthFunction(ILogger<HealthFunction> logger, string[] allowedOrigins)
    {
        _logger = logger;
        _allowedOrigins = allowedOrigins;
    }

    [Function("Health")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "health")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        _logger.LogInformation("Health check called");
        return await ResponseHelper.WriteSuccess(req,
            new { status = "ok", timestamp = DateTimeOffset.UtcNow }, _allowedOrigins);
    }
}
