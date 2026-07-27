using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;
using Newtonsoft.Json;

namespace ShipScan.Functions.Services;

/// <summary>
/// AES-256-GCM encryption for QR label payloads.
///
/// Encrypted format: v{version}.{base64(12-byte-IV || ciphertext || 16-byte-tag)}
///
/// Key rotation: add a new entry to QrEncryptionKeys JSON and bump
/// QrEncryptionKeyCurrentVersion. Old labels encrypted with earlier
/// versions continue to decrypt as long as their key version remains in
/// QrEncryptionKeys — remove a version only when you are certain no
/// physical labels carrying it are still in circulation.
/// </summary>
public class QrEncryptionService
{
    private readonly Dictionary<string, byte[]> _keys;
    private readonly string _currentVersion;

    public QrEncryptionService(IConfiguration config)
    {
        // QrEncryptionKeys  = '{"1":"<64-hex-chars>","2":"<64-hex-chars>", ...}'
        var keysJson = config["QrEncryptionKeys"] ?? "{}";
        var keysRaw  = JsonConvert.DeserializeObject<Dictionary<string, string>>(keysJson)
                       ?? new Dictionary<string, string>();

        _keys = keysRaw.ToDictionary(
            k => k.Key,
            k => Convert.FromHexString(k.Value)
        );
        _currentVersion = config["QrEncryptionKeyCurrentVersion"] ?? "1";
    }

    public string Encrypt(string plaintext)
    {
        if (!_keys.TryGetValue(_currentVersion, out var key))
            throw new InvalidOperationException(
                $"QR encryption key for version '{_currentVersion}' is not configured.");

        var iv           = RandomNumberGenerator.GetBytes(12);
        var plaintextBytes = Encoding.UTF8.GetBytes(plaintext);
        var ciphertext   = new byte[plaintextBytes.Length];
        var tag          = new byte[16];

        using var aes = new AesGcm(key, 16);
        aes.Encrypt(iv, plaintextBytes, ciphertext, tag);

        // Lay out as IV || ciphertext || tag so Decrypt can slice by position
        var blob = new byte[12 + ciphertext.Length + 16];
        iv.CopyTo(blob, 0);
        ciphertext.CopyTo(blob, 12);
        tag.CopyTo(blob, 12 + ciphertext.Length);

        return $"v{_currentVersion}.{Convert.ToBase64String(blob)}";
    }

    public string Decrypt(string encrypted)
    {
        var dotIdx = encrypted.IndexOf('.');
        if (dotIdx < 2 || encrypted[0] != 'v')
            throw new FormatException("Invalid encrypted QR format — expected v{n}.{base64}.");

        var version = encrypted[1..dotIdx];
        var blob    = Convert.FromBase64String(encrypted[(dotIdx + 1)..]);

        if (!_keys.TryGetValue(version, out var key))
            throw new InvalidOperationException(
                $"QR encryption key for version '{version}' is not configured. " +
                "Add it to QrEncryptionKeys so old labels can still be decrypted.");

        var iv         = blob[..12];
        var tag        = blob[^16..];
        var ciphertext = blob[12..^16];
        var plaintext  = new byte[ciphertext.Length];

        using var aes = new AesGcm(key, 16);
        aes.Decrypt(iv, ciphertext, tag, plaintext);
        return Encoding.UTF8.GetString(plaintext);
    }

    public bool IsEncrypted(string value) =>
        value.Length > 3 && value[0] == 'v' && char.IsAsciiDigit(value[1]) && value.Contains('.');
}
