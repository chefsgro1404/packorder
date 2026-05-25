using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Azure.Functions.Worker.Middleware;
using Microsoft.Extensions.Configuration;

namespace ShipScan.Functions.Middleware;

public class InternalSecretMiddleware : IFunctionsWorkerMiddleware
{
    private static readonly HashSet<string> ExemptFunctions = new(StringComparer.OrdinalIgnoreCase)
    {
        "Health",
        "WebhookShopify"   // Shopify sends directly; verified by HMAC instead
    };

    private readonly string _secret;

    public InternalSecretMiddleware(IConfiguration config)
    {
        _secret = config["InternalApiSecret"]
                  ?? throw new InvalidOperationException("InternalApiSecret required");
    }

    public async Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        if (ExemptFunctions.Contains(context.FunctionDefinition.Name))
        {
            await next(context);
            return;
        }

        var req = await context.GetHttpRequestDataAsync();
        if (req is not null)
        {
            var ok = req.Headers.TryGetValues("X-Internal-Secret", out var values)
                     && values.FirstOrDefault() == _secret;

            if (!ok)
            {
                var response = req.CreateResponse(HttpStatusCode.Unauthorized);
                response.Headers.Add("Content-Type", "application/json");
                await response.WriteStringAsync("{\"success\":false,\"error\":\"Unauthorized\"}");
                context.GetInvocationResult().Value = response;
                return;
            }
        }

        await next(context);
    }
}
