using System.Diagnostics;
using System.Runtime.InteropServices;

Console.Title = "ShipScan Print Setup";
Console.WriteLine();
Console.WriteLine("  ShipScan Print Setup  v1.0");
Console.WriteLine("  ─────────────────────────────────────────────");
Console.WriteLine("  Configures Chrome for silent label printing.");
Console.WriteLine("  This tool modifies Chrome shortcuts on this PC.");
Console.WriteLine("  ─────────────────────────────────────────────");
Console.WriteLine();

if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
{
    Console.WriteLine("  This tool is for Windows only.");
    Pause();
    return;
}

const string Flag = "--kiosk-printing";

var shortcutDirs = new List<string>
{
    // User Start Menu programs — includes Google Chrome.lnk and Chrome Apps\ subfolder
    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        @"Microsoft\Windows\Start Menu\Programs"),
    Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory)),
    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        @"Microsoft\Windows\Start Menu\Programs"),
    // Taskbar-pinned shortcuts
    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        @"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"),
};

// Add Web Applications folder for every Chrome profile (Default, Profile 1, Profile 2, …)
var chromeUserData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
    @"Google\Chrome\User Data");
if (Directory.Exists(chromeUserData))
{
    foreach (var profileDir in Directory.GetDirectories(chromeUserData))
    {
        var webApps = Path.Combine(profileDir, "Web Applications");
        if (Directory.Exists(webApps))
            shortcutDirs.Add(webApps);
    }
}

int patched = 0, skipped = 0, failed = 0;

foreach (var dir in shortcutDirs)
{
    if (!Directory.Exists(dir)) continue;

    foreach (var lnkPath in Directory.GetFiles(dir, "*.lnk", SearchOption.AllDirectories))
    {
        try
        {
            var (target, currentArgs) = ReadShortcut(lnkPath);

            if (!target.Contains("chrome.exe", StringComparison.OrdinalIgnoreCase))
                continue;

            if (currentArgs.Contains(Flag, StringComparison.OrdinalIgnoreCase))
            {
                Console.WriteLine($"  Already configured : {Path.GetFileName(lnkPath)}");
                skipped++;
                continue;
            }

            var newArgs = (currentArgs.Trim() + " " + Flag).Trim();
            WriteShortcutArgs(lnkPath, newArgs);
            Console.WriteLine($"  Configured         : {Path.GetFileName(lnkPath)}");
            patched++;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  Could not update   : {Path.GetFileName(lnkPath)} ({ex.Message})");
            failed++;
        }
    }
}

Console.WriteLine();
Console.WriteLine("  ─────────────────────────────────────────────");
if (patched == 0 && skipped == 0)
{
    Console.WriteLine("  No Chrome shortcuts found on this PC.");
    Console.WriteLine();
    Console.WriteLine("  To install the PWA: open ShipScan in Chrome,");
    Console.WriteLine("  then go to Chrome menu → Save and share → Install page as app.");
    Console.WriteLine("  Run this tool again after installing.");
}
else if (patched == 0)
{
    Console.WriteLine("  All shortcuts are already configured. No changes needed.");
}
else
{
    Console.WriteLine($"  Done. {patched} shortcut(s) updated.{(failed > 0 ? $" {failed} could not be updated." : "")}");
    Console.WriteLine();
    Console.WriteLine("  Relaunch Chrome or the ShipScan app for the change to take effect.");
    Console.WriteLine("  Labels will now print directly to your default printer.");
    Console.WriteLine();
    Console.WriteLine("  Tip: if no printer is connected, Windows will save labels as PDF.");
}

Pause();

static void Pause()
{
    Console.WriteLine("  ─────────────────────────────────────────────");
    Console.Write("  Press any key to close...");
    Console.ReadKey(true);
    Console.WriteLine();
}

// ── Shell Link (.lnk) reader/writer ──────────────────────────────────────────
// Reads TargetPath and Arguments from a .lnk file by running a hidden PowerShell
// command — avoids COM interop so the binary cross-compiles from Linux.

static (string target, string arguments) ReadShortcut(string path)
{
    var result = RunPs($@"
$s = (New-Object -ComObject WScript.Shell).CreateShortcut('{Esc(path)}');
Write-Output $s.TargetPath;
Write-Output $s.Arguments;
");
    var lines = result.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    return (lines.Length > 0 ? lines[0] : "", lines.Length > 1 ? lines[1] : "");
}

static void WriteShortcutArgs(string path, string newArgs)
{
    RunPs($@"
$sh = New-Object -ComObject WScript.Shell;
$lnk = $sh.CreateShortcut('{Esc(path)}');
$lnk.Arguments = '{Esc(newArgs)}';
$lnk.Save();
");
}

static string RunPs(string script)
{
    var psi = new ProcessStartInfo
    {
        FileName = "powershell.exe",
        Arguments = $"-NoProfile -ExecutionPolicy Bypass -Command \"{script.Replace("\"", "\\\"")}\"",
        UseShellExecute = false,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        CreateNoWindow = true,
    };
    using var proc = Process.Start(psi) ?? throw new Exception("Could not start powershell.exe");
    var output = proc.StandardOutput.ReadToEnd();
    proc.WaitForExit();
    return output;
}

static string Esc(string s) => s.Replace("'", "''");
