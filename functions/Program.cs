using Azure.Data.Tables;
using Azure.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Middleware;
using ShipScan.Functions.Services;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults(worker =>
    {
        worker.UseMiddleware<InternalSecretMiddleware>();
    })
    .ConfigureAppConfiguration(config =>
    {
        config.AddEnvironmentVariables();
    })
    .ConfigureServices((ctx, services) =>
    {
        var config = ctx.Configuration;

        TableServiceClient tableClient;
        if (config["AzureWebJobsStorage"] == "UseDevelopmentStorage=true")
        {
            tableClient = new TableServiceClient("UseDevelopmentStorage=true");
        }
        else
        {
            var storageAccountName = config["StorageAccountName"]
                ?? throw new InvalidOperationException("StorageAccountName required");
            tableClient = new TableServiceClient(
                new Uri($"https://{storageAccountName}.table.core.windows.net"),
                new DefaultAzureCredential());
        }

        services.AddSingleton(tableClient);

        services.AddSingleton<TableStorageService>();
        services.AddSingleton<AuthService>();
        services.AddSingleton<ShopifyService>();
        services.AddSingleton<AuthHelper>();
        services.AddHttpClient();

        var allowedOrigins = (config["AllowedOrigins"] ?? "http://localhost:3000")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        services.AddSingleton(allowedOrigins);
    })
    .Build();

var tables = host.Services.GetRequiredService<TableStorageService>();
await tables.EnsureTablesExistAsync();

host.Run();
