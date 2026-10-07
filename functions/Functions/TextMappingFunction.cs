using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using ShipScan.Functions.Helpers;
using ShipScan.Functions.Models;
using ShipScan.Functions.Services;

namespace ShipScan.Functions.Functions;

public class TextMappingFunction
{
    private readonly ILogger<TextMappingFunction> _logger;
    private readonly TableStorageService _tableStorage;
    private readonly AuthHelper _authHelper;
    private readonly string[] _allowedOrigins;

    public TextMappingFunction(ILogger<TextMappingFunction> logger, TableStorageService tableStorage,
        AuthHelper authHelper, string[] allowedOrigins)
    {
        _logger = logger;
        _tableStorage = tableStorage;
        _authHelper = authHelper;
        _allowedOrigins = allowedOrigins;
    }

    [Function("TextMappings")]
    public async Task<HttpResponseData> Handle(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "put", "delete", "options", Route = "scale/text-mappings")]
        HttpRequestData req)
    {
        if (req.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            return CorsHelper.Preflight(req, _allowedOrigins);

        var (_, _, authError) = await _authHelper.ValidateRequest(req);
        if (authError != null)
            return await ResponseHelper.WriteError(req, authError, HttpStatusCode.Unauthorized, _allowedOrigins);

        try
        {
            if (req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
            {
                var mappings = await _tableStorage.ListTextMappingsAsync();
                var result = mappings.Select(m => new { phrase = m.Phrase, abbreviation = m.Abbreviation }).ToList();
                return await ResponseHelper.WriteSuccess(req, new { mappings = result }, _allowedOrigins);
            }

            if (req.Method.Equals("DELETE", StringComparison.OrdinalIgnoreCase))
            {
                var body = await req.ReadAsStringAsync() ?? "{}";
                var request = JsonConvert.DeserializeObject<TextMappingDeleteRequest>(body);
                if (string.IsNullOrWhiteSpace(request?.Phrase))
                    return await ResponseHelper.WriteError(req, "phrase is required", HttpStatusCode.BadRequest, _allowedOrigins);

                var deleted = await _tableStorage.DeleteTextMappingAsync(request.Phrase);
                _logger.LogInformation("Text mapping deleted: phrase={Phrase} found={Found}", request.Phrase, deleted);
                return await ResponseHelper.WriteSuccess(req, new { ok = true }, _allowedOrigins);
            }

            // PUT — upsert
            {
                var body = await req.ReadAsStringAsync() ?? "{}";
                var request = JsonConvert.DeserializeObject<TextMappingRequest>(body);
                if (string.IsNullOrWhiteSpace(request?.Phrase))
                    return await ResponseHelper.WriteError(req, "phrase is required", HttpStatusCode.BadRequest, _allowedOrigins);
                if (string.IsNullOrWhiteSpace(request.Abbreviation))
                    return await ResponseHelper.WriteError(req, "abbreviation is required", HttpStatusCode.BadRequest, _allowedOrigins);

                var entity = new TextMappingEntity
                {
                    PartitionKey = "mapping",
                    RowKey       = TextMappingEntity.NormalizeKey(request.Phrase),
                    Phrase       = request.Phrase.Trim(),
                    Abbreviation = request.Abbreviation.Trim(),
                };
                await _tableStorage.UpsertTextMappingAsync(entity);
                _logger.LogInformation("Text mapping saved: \"{Phrase}\" → \"{Abbreviation}\"", entity.Phrase, entity.Abbreviation);
                return await ResponseHelper.WriteSuccess(req, new { phrase = entity.Phrase, abbreviation = entity.Abbreviation }, _allowedOrigins);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Text mapping operation failed");
            return await ResponseHelper.WriteError(req, ex.Message, HttpStatusCode.InternalServerError, _allowedOrigins);
        }
    }
}
