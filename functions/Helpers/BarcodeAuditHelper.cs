namespace ShipScan.Functions.Helpers;

public static class BarcodeAuditHelper
{
    public static string ComputeAction(string? oldBarcode, string newBarcode)
    {
        return string.IsNullOrEmpty(oldBarcode) && !string.IsNullOrEmpty(newBarcode) ? "added"
            : !string.IsNullOrEmpty(oldBarcode) && string.IsNullOrEmpty(newBarcode) ? "removed"
            : !string.IsNullOrEmpty(oldBarcode) && string.Equals(oldBarcode, newBarcode, StringComparison.OrdinalIgnoreCase) ? "rescanned"
            : "changed";
    }
}
