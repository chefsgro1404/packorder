# ShipScan — Kiosk Printing Setup
# Run once after installing the PWA in Chrome.
# Patches the PWA shortcut to add --kiosk-printing so labels print
# directly to the default printer without a dialog.

$flag = "--kiosk-printing"

$shortcutDirs = @(
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Chrome Apps",
    "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Web Applications",
    "$env:USERPROFILE\Desktop"
)

$patched = 0
$skipped = 0

foreach ($dir in $shortcutDirs) {
    if (-not (Test-Path $dir)) { continue }

    Get-ChildItem -Path $dir -Filter "*.lnk" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
        $shell = New-Object -ComObject WScript.Shell
        $lnk = $shell.CreateShortcut($_.FullName)

        # Only touch shortcuts that launch Chrome
        if ($lnk.TargetPath -notmatch "chrome\.exe") { return }

        if ($lnk.Arguments -like "*$flag*") {
            Write-Host "  [skip] already patched: $($_.Name)"
            $skipped++
            return
        }

        $lnk.Arguments = "$($lnk.Arguments) $flag".Trim()
        $lnk.Save()
        Write-Host "  [ok]   patched: $($_.Name)"
        $patched++
    }
}

Write-Host ""
if ($patched -eq 0 -and $skipped -eq 0) {
    Write-Host "No Chrome shortcuts found."
    Write-Host "Install the PWA first (Chrome menu -> Save and share -> Install page as app),"
    Write-Host "then run this script again."
} elseif ($patched -eq 0) {
    Write-Host "All shortcuts already have --kiosk-printing. Nothing to do."
} else {
    Write-Host "$patched shortcut(s) patched. Relaunch the PWA for the change to take effect."
}
