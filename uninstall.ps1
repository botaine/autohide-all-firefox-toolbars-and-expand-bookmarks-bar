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

# Discards anything sitting in the console's input buffer - if the script
# wasn't actively waiting on a prompt when you pressed a key (e.g. during
# a Start-Sleep pause), that keypress doesn't vanish, it queues up and
# gets silently consumed by whichever prompt runs next, even if that's a
# different, later question entirely. Called right before every prompt
# below so a stray leftover keypress can never leak into the wrong one.
function Clear-InputBuffer {
    try { $Host.UI.RawUI.FlushInputBuffer() } catch {}
}

# Loops until a valid Y/N answer is given (also accepts the full words
# "yes"/"no", case-insensitive). Returns $true for yes, $false for no.
function Read-YesNo($promptText) {
    while ($true) {
        Clear-InputBuffer
        $response = (Read-Host $promptText).Trim()
        if ($response -match '^(?i:y|yes)$') { return $true }
        if ($response -match '^(?i:n|no)$') { return $false }
        Write-Err "Invalid input. Enter Y for yes or N for no."
    }
}

# Loops until a path is entered that actually exists as a folder.
function Read-ExistingFolderPath($promptText) {
    while ($true) {
        Clear-InputBuffer
        $response = (Read-Host $promptText).Trim('"', ' ')
        if ($response -and (Test-Path -LiteralPath $response -PathType Container)) {
            return $response
        }
        Write-Err "Invalid input. Enter the folder path requested."
    }
}

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    Write-Host "Relaunching as Administrator (a UAC prompt should appear)..."
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

Write-Step "Which installation to uninstall from"
$isDefaultLocation = Read-YesNo "  Did you install Firefox to the default location? The default location is C:\Program Files\Mozilla Firefox (Y/N)"

if ($isDefaultLocation) {
    $installDir = "$env:ProgramFiles\Mozilla Firefox"
    if (-not (Test-Path (Join-Path $installDir "firefox.exe"))) {
        $installDir = "${env:ProgramFiles(x86)}\Mozilla Firefox"
    }
    Write-Host "  Default location: $installDir" -ForegroundColor Yellow
    if (-not (Test-Path (Join-Path $installDir "firefox.exe"))) {
        Write-Err "firefox.exe wasn't found in the default location after all. Re-run this and answer N instead, then provide the correct path."
        Clear-InputBuffer
        Read-Host "Press Enter to exit"
        exit 1
    }
} else {
    Write-Host "  Paste the full path to the Firefox installation folder (the one" -ForegroundColor Yellow
    Write-Host "  containing firefox.exe)" -ForegroundColor Yellow
    while ($true) {
        $installDir = Read-ExistingFolderPath "  Path"
        if (Test-Path (Join-Path $installDir "firefox.exe")) { break }
        Write-Err "firefox.exe not found in that folder. Enter the folder path requested."
    }
}

Write-Host "`n  Paste the full path to the Firefox profile you used with this mod. " -ForegroundColor Yellow
Write-Host "  To find your Firefox profile location, open Firefox and in the" -ForegroundColor Yellow
Write-Host "  address bar type about:profiles. Then look for the root directory of" -ForegroundColor Yellow
Write-Host "  the profile in use. Copy that path, paste it here and press enter." -ForegroundColor Yellow
$profileDir = Read-ExistingFolderPath "  Path"

Write-Step "Checking that Firefox is closed"
do {
    Write-Host "  Close all instances of Firefox, wait 5 seconds then press enter to proceed."
    Read-Host
    # Firefox uses several background processes (one per tab, plus GPU,
    # extensions, networking, etc.) that can take a moment to fully exit
    # after the window closes - this brief pause gives them a real chance
    # to finish before rechecking, instead of depending on how quickly
    # you happen to press Enter again.
    Start-Sleep -Seconds 3
} while (Get-Process -Name "firefox" -ErrorAction SilentlyContinue)
$firefoxClosed = $true
if ($firefoxClosed) { Write-Ok "Firefox is not running" }

Write-Step "Final confirmation before removing anything"
Write-Host "  Firefox installation to clean:  $installDir" -ForegroundColor Yellow
Write-Host "  Firefox profile to clean:       $profileDir" -ForegroundColor Yellow
Write-Host "`n  The following about:config settings will be reverted:" -ForegroundColor Yellow
Write-Host "`n  toolkit.legacyUserProfileCustomizations.stylesheets -> false" -ForegroundColor Yellow
Write-Host "    Turns userChrome.css support back off, since this mod's own" -ForegroundColor Yellow
Write-Host "    userChrome.css file is being removed too." -ForegroundColor Yellow
Write-Host "`n  general.config.sandbox_enabled  (Firefox installation folder, removed" -ForegroundColor Yellow
Write-Host "  only if this mod created it)" -ForegroundColor Yellow
Write-Host "    This pref disabled Firefox's sandbox specifically for config" -ForegroundColor Yellow
Write-Host "    scripts, needed to let this mod's .uc.js scripts run - removing it" -ForegroundColor Yellow
Write-Host "    restores the sandbox to Firefox's default (enabled)." -ForegroundColor Yellow
Write-Host "`n  general.config.filename / general.config.obscure_value" -ForegroundColor Yellow
Write-Host "    These pointed Firefox at the loader's config file used to run this" -ForegroundColor Yellow
Write-Host "    mod's scripts in the first place." -ForegroundColor Yellow
Write-Host "`n  browser.fullscreen.autohide -> true" -ForegroundColor Yellow
Write-Host "    Restores Firefox's own native fullscreen toolbar auto-hide (its" -ForegroundColor Yellow
Write-Host "    default), which install.ps1 had turned off so it wouldn't conflict" -ForegroundColor Yellow
Write-Host "    with this mod's own fullscreen toolbar behavior." -ForegroundColor Yellow
Write-Host "                                     " -ForegroundColor Yellow
Write-Host "  Make sure Firefox is closed.        " -ForegroundColor Yellow
Write-Host "                                     " -ForegroundColor Yellow
$proceed = Read-YesNo "  Proceed? (Y/N)"
if (-not $proceed) {
    Write-Host "Cancelled. Nothing was changed."
    exit
}

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

foreach ($file in @("cross-window-drag.uc.js", "inline-bookmark-folders.uc.js", "download-forceopen.uc.js", "fake-fullscreen.uc.js", "no-newtab-urlbar-focus.uc.js")) {
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

Write-Step "Restoring Firefox's own native fullscreen toolbar auto-hide"
if (-not $firefoxClosed) {
    Write-Warn "Firefox is running again - skipping this step to avoid Firefox overwriting the change on exit. Set browser.fullscreen.autohide to true manually in about:config instead, if desired."
} elseif (Test-Path $prefsJsPath) {
    $prefsContent = Get-Content $prefsJsPath
    if ($prefsContent -match 'browser\.fullscreen\.autohide') {
        $prefsContent = $prefsContent -replace '.*browser\.fullscreen\.autohide.*', 'user_pref("browser.fullscreen.autohide", true);'
        Set-Content -Path $prefsJsPath -Value $prefsContent -Encoding UTF8
        Write-Ok "Set browser.fullscreen.autohide = true (Firefox's own default)"
    } else {
        Write-Warn "Pref not found in prefs.js - nothing to change"
    }
} else {
    Write-Warn "prefs.js not found - nothing to change"
}

Write-Step "Done"
Write-Host "Fully restart this Firefox to complete the uninstall."
Write-Host "`nNote: any leftover .backup-* files in $installDir were intentionally left in place - delete them yourself once you're confident you don't need them."
Clear-InputBuffer
Read-Host "`nPress Enter to close"
