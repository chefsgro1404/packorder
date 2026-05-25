using System.Net;
using Microsoft.Azure.Functions.Worker.Http;

namespace ShipScan.Functions.Helpers;

public static class CorsHelper
{
    public static HttpResponseData Preflight(HttpRequestData req, string[]? allowedOrigins)
    {
        var response = req.CreateResponse(HttpStatusCode.OK);
        Apply(response, req, allowedOrigins);
        return response;
    }

    public static void Apply(HttpResponseData response, HttpRequestData req, string[]? allowedOrigins)
    {
        var origin = req.Headers.TryGetValues("Origin", out var origins)
            ? origins.FirstOrDefault() : null;

        if (origin != null && (allowedOrigins == null || allowedOrigins.Contains(origin)))
            response.Headers.Add("Access-Control-Allow-Origin", origin);

        response.Headers.Add("Access-Control-Allow-Credentials", "true");
        response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
        response.Headers.Add("Access-Control-Allow-Headers",
            "Content-Type, Authorization, X-Requested-With, X-Internal-Secret");
    }
}
