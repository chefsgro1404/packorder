using System.Net;
using Microsoft.Azure.Functions.Worker.Http;
using Newtonsoft.Json;

namespace ShipScan.Functions.Helpers;

public static class ResponseHelper
{
    private static readonly JsonSerializerSettings Settings = new()
    {
        NullValueHandling = NullValueHandling.Ignore,
        DateTimeZoneHandling = DateTimeZoneHandling.Utc
    };

    public static async Task<HttpResponseData> WriteSuccess<T>(
        HttpRequestData req, T data,
        string[]? allowedOrigins = null,
        HttpStatusCode status = HttpStatusCode.OK)
    {
        var response = req.CreateResponse(status);
        response.Headers.Add("Content-Type", "application/json");
        CorsHelper.Apply(response, req, allowedOrigins);
        await response.WriteStringAsync(
            JsonConvert.SerializeObject(new { success = true, data }, Settings));
        return response;
    }

    public static async Task<HttpResponseData> WriteError(
        HttpRequestData req, string error,
        HttpStatusCode status = HttpStatusCode.InternalServerError,
        string[]? allowedOrigins = null)
    {
        var response = req.CreateResponse(status);
        response.Headers.Add("Content-Type", "application/json");
        CorsHelper.Apply(response, req, allowedOrigins);
        await response.WriteStringAsync(
            JsonConvert.SerializeObject(new { success = false, error }, Settings));
        return response;
    }
}
