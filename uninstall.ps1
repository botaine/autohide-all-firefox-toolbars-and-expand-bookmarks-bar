# ============================================================
# Firefox Auto-Hide Toolbar Mod - Uninstaller
#
# Reverses install.ps1's changes as safely as possible. Since install.ps1
# doesn't keep a record of exactly what it created versus what already
# existed, this script uses the same signals install.ps1 itself left
# behind to make that distinction correctly:
#   - firefox.cfg: install.ps1 only creates a .backup-<timestamp> copy
#     when firefox.cfg ALREADY existed before merging into it. So: if a
#     backup exists, RESTORE it (safe - undoes only our merge). If no
#     backup exists, firefox.cfg was created fresh by install.ps1, so
#     it's safe to delete entirely.
#   - autoconfig.js: install.ps1 never modifies a pre-existing one at
#     all, only creates one from scratch (with fully predictable content)
#     when none existed. If its content matches exactly what install.ps1
#     would have written, it's safe to remove; otherwise it's left alone.
#   - userChrome.css, the .uc.js scripts, and the fx-autoconfig loader
#     files are all uniquely named and always safe to remove outright.
#   - The userChrome.css enable pref and the sandbox-disable pref are
#     just turned back off / removed, the same closed-Firefox-required
#     way install.ps1 turned them on.
#
# This always asks for the install and profile paths directly (no
# auto-detection), so it's always clear exactly which Firefox copy is
# being cleaned up.
# ============================================================

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  OK: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  WARNING: $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "  ERROR: $msg" -ForegroundColor Red }

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    Write-Host "Relaunching as Administrator (a UAC prompt should appear)..."
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

Write-Step "Which installation to uninstall from"
$defaultLocation = Read-Host "  Did you install Firefox to the default location? The default location is C:\Program Files\Mozilla Firefox (Y/N)"

if ($defaultLocation -match "^[Yy]") {
    $installDir = "$env:ProgramFiles\Mozilla Firefox"
    if (-not (Test-Path (Join-Path $installDir "firefox.exe"))) {
        $installDir = "${env:ProgramFiles(x86)}\Mozilla Firefox"
    }
    Write-Host "  Default location: $installDir" -ForegroundColor Yellow
    if (-not (Test-Path (Join-Path $installDir "firefox.exe"))) {
        Write-Err "firefox.exe wasn't found in the default location after all. Re-run this and answer N instead, then provide the correct path."
        Read-Host "Press Enter to exit"
        exit 1
    }
} else {
    Write-Host "  Paste the full path to the Firefox installation folder (the one" -ForegroundColor Yellow
    Write-Host "  containing firefox.exe)" -ForegroundColor Yellow
    $installDir = Read-Host "  Path"
    if (-not (Test-Path (Join-Path $installDir "firefox.exe"))) {
        Write-Err "firefox.exe not found in that folder. Aborting."
        Read-Host "Press Enter to exit"
        exit 1
    }
}

Write-Host "`n  Paste the full path to the Firefox profile you used with this mod. " -ForegroundColor Yellow
Write-Host "  To find your Firefox profile location, open Firefox and in the" -ForegroundColor Yellow
Write-Host "  address bar type about:profiles. Then look for the root directory of" -ForegroundColor Yellow
Write-Host "  the profile in use. Copy that path, paste it here and press enter." -ForegroundColor Yellow
$profileDir = Read-Host "  Path"
if (-not (Test-Path $profileDir)) {
    Write-Err "That profile folder doesn't exist. Aborting."
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Step "Final confirmation before removing anything"
Write-Host "  Firefox installation to clean:  $installDir" -ForegroundColor Yellow
Write-Host "  Firefox profile to clean:       $profileDir" -ForegroundColor Yellow
Write-Host "`n  The about:config value for toolkit.legacyUserProfileCustomizations.stylesheets" -ForegroundColor Yellow
Write-Host "  will be changed to false during the uninstall. " -ForegroundColor Yellow
Write-Host "                                     " -ForegroundColor Yellow
Write-Host "  Make sure Firefox is closed.        " -ForegroundColor Yellow
Write-Host "                                     " -ForegroundColor Yellow
$finalConfirm = Read-Host "  Proceed? (Y/N)"
if ($finalConfirm -notmatch "^[Yy]") {
    Write-Host "Cancelled. Nothing was changed."
    exit
}

Write-Step "Checking that Firefox is closed"
Write-Host "  (Firefox sometimes keeps a background helper process running for a"
Write-Host "  moment after the window closes - this check waits briefly for that"
Write-Host "  to clear on its own before asking you to do anything.)"
$autoWaited = 0
while ((Get-Process -Name "firefox" -ErrorAction SilentlyContinue) -and $autoWaited -lt 10) {
    Start-Sleep -Seconds 1
    $autoWaited++
}
while (Get-Process -Name "firefox" -ErrorAction SilentlyContinue) {
    Write-Warn "Firefox still appears to be running."
    Write-Host "  Close it completely (including any background/tray icon), then press"
    Write-Host "  Enter to check again - or close this window to abort."
    Write-Host "  You may have to press enter 3 times."
    Read-Host
    Write-Host "  Rechecking..."
    Start-Sleep -Seconds 1
}
$firefoxClosed = -not (Get-Process -Name "firefox" -ErrorAction SilentlyContinue)
if ($firefoxClosed) { Write-Ok "Firefox is not running" }

Write-Step "Removing userChrome.css and the .uc.js scripts"
$chromeDir = Join-Path $profileDir "chrome"
$jsDir = Join-Path $chromeDir "JS"
$utilsDir = Join-Path $chromeDir "utils"

$cssPath = Join-Path $chromeDir "userChrome.css"
if (Test-Path $cssPath) {
    Remove-Item $cssPath -Force
    Write-Ok "Removed userChrome.css"
} else {
    Write-Warn "userChrome.css not found - already removed or never installed here"
}

foreach ($file in @("cross-window-drag.uc.js", "inline-bookmark-folders.uc.js", "download-forceopen.uc.js")) {
    $path = Join-Path $jsDir $file
    if (Test-Path $path) {
        Remove-Item $path -Force
        Write-Ok "Removed $file"
    } else {
        Write-Warn "$file not found - already removed or never installed here"
    }
}

Write-Step "Removing fx-autoconfig loader files"
foreach ($file in @("boot.sys.mjs", "chrome.manifest", "fs.sys.mjs", "module_loader.mjs", "uc_api.sys.mjs", "utils.sys.mjs")) {
    $path = Join-Path $utilsDir $file
    if (Test-Path $path) {
        Remove-Item $path -Force
        Write-Ok "Removed $file"
    } else {
        Write-Warn "$file not found - already removed or never installed here"
    }
}
# Clean up the JS/utils folders themselves if they're now empty
foreach ($dir in @($jsDir, $utilsDir)) {
    if ((Test-Path $dir) -and ((Get-ChildItem $dir -Force | Measure-Object).Count -eq 0)) {
        Remove-Item $dir -Force
        Write-Ok "Removed empty folder: $dir"
    }
}

Write-Step "Reversing the privileged-script loader setup"
$prefDir = Join-Path $installDir "defaults\pref"
$autoconfigPath = Join-Path $prefDir "autoconfig.js"
$targetCfgName = "firefox.cfg"

if (Test-Path $autoconfigPath) {
    $autoconfigContent = (Get-Content $autoconfigPath -Raw).Trim()
    if ($autoconfigContent -match 'general\.config\.filename["\s,]+["'']([^"'']+)["'']') {
        $targetCfgName = $matches[1]
    }
    # install.ps1's own fresh-creation content is fully predictable - only
    # remove autoconfig.js if it matches that exactly, meaning we almost
    # certainly created it ourselves rather than it pre-existing.
    $expectedContent = "pref(`"general.config.filename`", `"$targetCfgName`");`npref(`"general.config.obscure_value`", 0);"
    if ($autoconfigContent -eq $expectedContent.Trim()) {
        Remove-Item $autoconfigPath -Force
        Write-Ok "Removed autoconfig.js (matched install.ps1's own fresh-creation content exactly)"
    } else {
        Write-Warn "autoconfig.js exists but its content doesn't exactly match what install.ps1 would have created - leaving it alone, since it likely pre-existed or was customized. Manually review $autoconfigPath if needed."
    }
} else {
    Write-Warn "autoconfig.js not found - already removed or never installed here"
}

$targetCfgPath = Join-Path $installDir $targetCfgName
$backupFiles = Get-ChildItem -Path $installDir -Filter "$targetCfgName.backup-*" -ErrorAction SilentlyContinue | Sort-Object Name -Descending
if ($backupFiles -and $backupFiles.Count -gt 0) {
    $latestBackup = $backupFiles[0].FullName
    Copy-Item $latestBackup $targetCfgPath -Force
    Write-Ok "Restored $targetCfgName from backup: $($backupFiles[0].Name)"
    Write-Host "  (The backup file itself was left in place in case you want to keep it: $latestBackup)"
} elseif (Test-Path $targetCfgPath) {
    Remove-Item $targetCfgPath -Force
    Write-Ok "Removed $targetCfgName (no backup found, so install.ps1 almost certainly created this file fresh)"
} else {
    Write-Warn "$targetCfgName not found - already removed or never installed here"
}

Write-Step "Removing the sandbox-disable pref"
$sandboxPrefPath = Join-Path $prefDir "sandbox-prefs.js"
if (Test-Path $sandboxPrefPath) {
    Remove-Item $sandboxPrefPath -Force
    Write-Ok "Removed sandbox-prefs.js"
} else {
    Write-Warn "sandbox-prefs.js not found - already removed or never installed here"
}

Write-Step "Turning off userChrome.css support in this profile"
$prefsJsPath = Join-Path $profileDir "prefs.js"
if (-not $firefoxClosed) {
    Write-Warn "Firefox is running again - skipping this step to avoid Firefox overwriting the change on exit. Set toolkit.legacyUserProfileCustomizations.stylesheets to false manually in about:config instead, if desired."
} elseif (Test-Path $prefsJsPath) {
    $prefsContent = Get-Content $prefsJsPath
    if ($prefsContent -match 'toolkit\.legacyUserProfileCustomizations\.stylesheets') {
        $prefsContent = $prefsContent -replace '.*toolkit\.legacyUserProfileCustomizations\.stylesheets.*', 'user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", false);'
        Set-Content -Path $prefsJsPath -Value $prefsContent -Encoding UTF8
        Write-Ok "Set toolkit.legacyUserProfileCustomizations.stylesheets = false"
    } else {
        Write-Warn "Pref not found in prefs.js - nothing to change"
    }
} else {
    Write-Warn "prefs.js not found - nothing to change"
}

Write-Step "Done"
Write-Host "Fully restart this Firefox to complete the uninstall."
Write-Host "`nNote: any leftover .backup-* files in $installDir were intentionally left in place - delete them yourself once you're confident you don't need them."
Read-Host "`nPress Enter to close"
