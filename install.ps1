# ============================================================
# Firefox Auto-Hide Toolbar Mod - Installer
#
# Asks a prerequisite question about how Firefox is installed, then asks
# for the profile folder directly (using about:profiles), so it's always
# clear exactly which Firefox copy is being modified.
#
# What this does:
#   1. Copies userChrome.css and all three .uc.js scripts into the
#      target profile's chrome folder.
#   2. Downloads fx-autoconfig's 6 loader files (MrOtherGuy/fx-autoconfig,
#      MPL 2.0) fresh from GitHub into chrome/utils/.
#   3. Sets up the privileged-script loader in the target Firefox
#      INSTALLATION folder - merging into an existing autoconfig setup
#      if one already exists, rather than overwriting it blindly.
#   4. Creates the sandbox-disable pref needed for the loader to work.
#   5. Sets toolkit.legacyUserProfileCustomizations.stylesheets to true
#      directly in the target profile's prefs.js, so userChrome.css
#      actually loads - Firefox must be fully closed for this step,
#      since it rewrites prefs.js from its own in-memory state on every
#      exit and would otherwise silently overwrite this change.
#
# Requires: Windows, an internet connection, and administrator rights
# (you'll be prompted to elevate automatically).
# ============================================================

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  OK: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  WARNING: $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "  ERROR: $msg" -ForegroundColor Red }

# --- Self-elevate if not already running as Administrator ---
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    Write-Host "Relaunching as Administrator (a UAC prompt should appear)..."
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Step "Determining Install Location"
$defaultLocation = Read-Host "  Is the main version of Firefox installed in the default location (C:\Program Files\Mozilla Firefox), downloaded `n from firefox.com (not the Microsoft Store), and you are using the installed, non-portable version? (Y/N) "

if ($defaultLocation -match "^[Yy]") {
    $installDir = "$env:ProgramFiles\Mozilla Firefox"
    if (-not (Test-Path (Join-Path $installDir "firefox.exe"))) {
        $installDir = "${env:ProgramFiles(x86)}\Mozilla Firefox"
    }
    if (-not (Test-Path (Join-Path $installDir "firefox.exe"))) {
        Write-Err "firefox.exe wasn't found in the default location after all. Re-run this installer and answer N instead, then provide the correct path."
        Read-Host "Press Enter to exit"
        exit 1
    }
} else {
    Write-Host "  Enter the path to the folder with your firefox.exe file in it."
    $installDir = Read-Host "  Path"
    if (-not (Test-Path (Join-Path $installDir "firefox.exe"))) {
        Write-Err "firefox.exe not found in that folder. Aborting."
        Read-Host "Press Enter to exit"
        exit 1
    }
}
Write-Ok "Targeting: $installDir"

Write-Step "Firefox profile folder"
Write-Host "  To find your Firefox profile location, open Firefox and in the address"
Write-Host "  bar type about:profiles. Then look for the root directory of the"
Write-Host "  profile in use. Copy that path, paste it here, close Firefox then press enter."
$profileDir = Read-Host "  Path"
if (-not (Test-Path $profileDir)) {
    Write-Err "That profile folder doesn't exist. Aborting."
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Ok "Targeting: $profileDir"

Write-Step "Checking that Firefox is closed"
Write-Host "  Firefox must be fully closed before this script edits its preferences"
Write-Host "  file (prefs.js) - if Firefox is running, it will overwrite our change"
Write-Host "  with its own in-memory settings the next time it exits."
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

Write-Step "Final confirmation before making any changes"
Write-Host "  Firefox installation to modify: $installDir" -ForegroundColor Yellow
Write-Host "  Firefox profile to modify:      $profileDir" -ForegroundColor Yellow
Write-Host "`n  This will write files into both locations above. Any existing" -ForegroundColor Yellow
Write-Host "  userChrome.css in that profile may be overwritten - move or rename it" -ForegroundColor Yellow
Write-Host "  first if you want to keep it." -ForegroundColor Yellow
Write-Host "`n  The about:config value for toolkit.legacyUserProfileCustomizations.stylesheets" -ForegroundColor Yellow
Write-Host "  will be changed to true during the install and to false during the" -ForegroundColor Yellow
Write-Host "  uninstall. Changing this setting to true is required for the" -ForegroundColor Yellow
Write-Host "  userChrome.css file to work." -ForegroundColor Yellow
$finalConfirm = Read-Host "  Proceed? (Y/N)"
if ($finalConfirm -notmatch "^[Yy]") {
    Write-Host "Cancelled. Nothing was changed."
    exit
}

Write-Step "Setting up chrome/JS and chrome/utils folders"
$chromeDir = Join-Path $profileDir "chrome"
$jsDir = Join-Path $chromeDir "JS"
$utilsDir = Join-Path $chromeDir "utils"
New-Item -ItemType Directory -Force -Path $jsDir | Out-Null
New-Item -ItemType Directory -Force -Path $utilsDir | Out-Null
Write-Ok "Folders ready"

Write-Step "Copying userChrome.css and .uc.js scripts"
$cssSource = Join-Path $scriptDir "userChrome.css"
$scriptFiles = @("cross-window-drag.uc.js", "inline-bookmark-folders.uc.js", "download-forceopen.uc.js")
if (-not (Test-Path $cssSource)) {
    Write-Err "userChrome.css not found next to this installer. Make sure you extracted the whole folder, not just this script."
    Read-Host "Press Enter to exit"
    exit 1
}
foreach ($file in $scriptFiles) {
    $src = Join-Path $scriptDir $file
    if (-not (Test-Path $src)) {
        Write-Err "$file not found next to this installer. Make sure you extracted the whole folder, not just this script."
        Read-Host "Press Enter to exit"
        exit 1
    }
}
Copy-Item $cssSource (Join-Path $chromeDir "userChrome.css") -Force
foreach ($file in $scriptFiles) {
    Copy-Item (Join-Path $scriptDir $file) (Join-Path $jsDir $file) -Force
    Write-Ok "$file"
}

Write-Step "Downloading fx-autoconfig loader files (MrOtherGuy/fx-autoconfig, MPL 2.0)"
$utilsFiles = @("boot.sys.mjs", "chrome.manifest", "fs.sys.mjs", "module_loader.mjs", "uc_api.sys.mjs", "utils.sys.mjs")
$baseUrl = "https://raw.githubusercontent.com/MrOtherGuy/fx-autoconfig/master/profile/chrome/utils/"
foreach ($file in $utilsFiles) {
    try {
        Invoke-WebRequest -Uri "$baseUrl$file" -OutFile (Join-Path $utilsDir $file) -UseBasicParsing
        Write-Ok "$file"
    } catch {
        Write-Err "Failed to download $file - check your internet connection and try again. ($($_.Exception.Message))"
        Read-Host "Press Enter to exit"
        exit 1
    }
}

Write-Step "Fetching the loader snippet (program/config.js) to merge into your config"
try {
    $loaderSnippet = (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/MrOtherGuy/fx-autoconfig/master/program/config.js" -UseBasicParsing).Content
    Write-Ok "Fetched"
} catch {
    Write-Err "Failed to fetch the loader snippet. Aborting. ($($_.Exception.Message))"
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Step "Setting up the privileged-script loader in the Firefox installation folder"
$prefDir = Join-Path $installDir "defaults\pref"
New-Item -ItemType Directory -Force -Path $prefDir | Out-Null

$existingAutoconfig = Join-Path $prefDir "autoconfig.js"
$targetCfgName = "firefox.cfg"

if (Test-Path $existingAutoconfig) {
    $existingContent = Get-Content $existingAutoconfig -Raw
    if ($existingContent -match 'general\.config\.filename["\s,]+["'']([^"'']+)["'']') {
        $targetCfgName = $matches[1]
        Write-Warn "Found an existing autoconfig.js pointing to '$targetCfgName'. Merging into it instead of creating a new one, to avoid breaking whatever already uses it."
    }
} else {
    Write-Ok "No existing autoconfig.js found - doing a fresh setup."
    "pref(`"general.config.filename`", `"$targetCfgName`");`npref(`"general.config.obscure_value`", 0);" | Set-Content -Path $existingAutoconfig -Encoding ASCII
}

$targetCfgPath = Join-Path $installDir $targetCfgName
if (Test-Path $targetCfgPath) {
    $cfgContent = Get-Content $targetCfgPath -Raw
    if ($cfgContent -match "chrome\.manifest") {
        Write-Warn "$targetCfgName already appears to contain the fx-autoconfig loader - leaving it as-is to avoid duplicating it."
    } else {
        $backupPath = "$targetCfgPath.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        Copy-Item $targetCfgPath $backupPath
        Write-Warn "Backed up your existing $targetCfgName to: $backupPath"
        Add-Content -Path $targetCfgPath -Value "`n$loaderSnippet"
        Write-Ok "Merged the loader into your existing $targetCfgName"
    }
} else {
    "// IMPORTANT: Start your code on the second line`n$loaderSnippet" | Set-Content -Path $targetCfgPath -Encoding ASCII
    Write-Ok "Created $targetCfgName with the loader"
}

Write-Step "Ensuring the sandbox is disabled for config scripts"
$sandboxPrefPath = Join-Path $prefDir "sandbox-prefs.js"
if ((Test-Path $sandboxPrefPath) -and (Get-Content $sandboxPrefPath -Raw) -match "sandbox_enabled") {
    Write-Ok "Already present"
} else {
    'pref("general.config.sandbox_enabled", false);' | Set-Content -Path $sandboxPrefPath -Encoding ASCII
    Write-Ok "Created sandbox-prefs.js"
}

Write-Step "Enabling userChrome.css support in this profile"
$prefsJsPath = Join-Path $profileDir "prefs.js"
if (-not $firefoxClosed) {
    Write-Warn "Firefox is running again - skipping this step to avoid Firefox overwriting the change on exit. Set toolkit.legacyUserProfileCustomizations.stylesheets to true manually in about:config instead."
} else {
    $prefLine = 'user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);'
    if (Test-Path $prefsJsPath) {
        $prefsContent = Get-Content $prefsJsPath
        if ($prefsContent -match 'toolkit\.legacyUserProfileCustomizations\.stylesheets') {
            $prefsContent = $prefsContent -replace '.*toolkit\.legacyUserProfileCustomizations\.stylesheets.*', $prefLine
            Set-Content -Path $prefsJsPath -Value $prefsContent -Encoding UTF8
        } else {
            Add-Content -Path $prefsJsPath -Value $prefLine -Encoding UTF8
        }
    } else {
        Set-Content -Path $prefsJsPath -Value $prefLine -Encoding UTF8
    }
    Write-Ok "Set toolkit.legacyUserProfileCustomizations.stylesheets = true in prefs.js"
}

Write-Step "Done"
Write-Host "Fully restart Firefox (quit completely, not just close the window), then test:"
Write-Host "  1. Hover the very top of the window - tabs/address bar/bookmarks should reveal."
Write-Host "  2. Click a bookmarks-toolbar folder - it should expand inline into the row"
Write-Host "     (not a dropdown), with an outline while open. Nested folders work the same way."
Write-Host "  3. Open two Firefox windows and drag a tab from one toward the other to test"
Write-Host "     the cross-window reveal."
Write-Host "  4. Start a download - the toolbar and the native download popup should both"
Write-Host "     appear for a few seconds, on both start and completion."
Read-Host "`nPress Enter to close"
