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
#   6. Sets browser.fullscreen.autohide to false the same way, so
#      Firefox's own native fullscreen toolbar auto-hide doesn't run
#      alongside this mod's own - userChrome.css handles all three
#      toolbars' visibility itself, in fullscreen and windowed mode
#      alike.
#
# Requires: Windows, an internet connection, and administrator rights
# (you'll be prompted to elevate automatically).
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

# --- Self-elevate if not already running as Administrator ---
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    Write-Host "Relaunching as Administrator (a UAC prompt should appear)..."
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Step "Determining Install Location"
$isDefaultLocation = Read-YesNo "  Is the main version of Firefox installed in the default location (C:\Program Files\Mozilla Firefox), downloaded `n from firefox.com (not the Microsoft Store), and you are using the installed, non-portable version? (Y/N) "

if ($isDefaultLocation) {
    $installDir = "$env:ProgramFiles\Mozilla Firefox"
    if (-not (Test-Path (Join-Path $installDir "firefox.exe"))) {
        $installDir = "${env:ProgramFiles(x86)}\Mozilla Firefox"
    }
    if (-not (Test-Path (Join-Path $installDir "firefox.exe"))) {
        Write-Err "firefox.exe wasn't found in the default location after all. Re-run this installer and answer N instead, then provide the correct path."
        Clear-InputBuffer
        Read-Host "Press Enter to exit"
        exit 1
    }
} else {
    Write-Host "  Enter the path to the folder with your firefox.exe file in it."
    while ($true) {
        $installDir = Read-ExistingFolderPath "  Path"
        if (Test-Path (Join-Path $installDir "firefox.exe")) { break }
        Write-Err "firefox.exe not found in that folder. Enter the folder path requested."
    }
}
Write-Ok "Targeting: $installDir"

Write-Step "Firefox profile folder"
Write-Host "  To find your Firefox profile location, open Firefox and in the address"
Write-Host "  bar type about:profiles. Then look for the root directory of the"
Write-Host "  profile in use. Copy that path, paste it here, close Firefox then press enter."
$profileDir = Read-ExistingFolderPath "  Path"
Write-Ok "Targeting: $profileDir"

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

Write-Step "Final confirmation before making any changes"
Write-Host "  Firefox installation to modify: $installDir" -ForegroundColor Yellow
Write-Host "  Firefox profile to modify:      $profileDir" -ForegroundColor Yellow
Write-Host "`n  This will write files into both locations above. Any existing" -ForegroundColor Yellow
Write-Host "  userChrome.css in that profile may be overwritten - move or rename it" -ForegroundColor Yellow
Write-Host "  first if you want to keep it." -ForegroundColor Yellow
Write-Host "`n  The following about:config settings will be changed:" -ForegroundColor Yellow
Write-Host "`n  toolkit.legacyUserProfileCustomizations.stylesheets -> true" -ForegroundColor Yellow
Write-Host "    Required for Firefox to load userChrome.css at all - it's off by" -ForegroundColor Yellow
Write-Host "    default, so without this the whole mod would do nothing." -ForegroundColor Yellow
Write-Host "`n  general.config.sandbox_enabled -> false" -ForegroundColor Yellow
Write-Host "    Set in the Firefox installation folder, only if not already present." -ForegroundColor Yellow
Write-Host "    Required for the privileged-script loader (fx-autoconfig) that lets" -ForegroundColor Yellow
Write-Host "    this mod's .uc.js scripts run with elevated permissions - without" -ForegroundColor Yellow
Write-Host "    it, Firefox's sandbox blocks config scripts from loading at all." -ForegroundColor Yellow
Write-Host "`n  general.config.filename / general.config.obscure_value" -ForegroundColor Yellow
Write-Host "    Points Firefox at the loader's config file (firefox.cfg, or an" -ForegroundColor Yellow
Write-Host "    existing one already in use there) and turns off the legacy" -ForegroundColor Yellow
Write-Host "    obfuscation option for it, which the loader doesn't use." -ForegroundColor Yellow
Write-Host "`n  browser.fullscreen.autohide -> false" -ForegroundColor Yellow
Write-Host "    Firefox's own native fullscreen toolbar auto-hide runs its own" -ForegroundColor Yellow
Write-Host "    separate mouse-tracking and timing alongside this mod's - left on," -ForegroundColor Yellow
Write-Host "    it makes the tab strip reveal/hide at a different point than the" -ForegroundColor Yellow
Write-Host "    address bar and bookmarks bar below it in fullscreen mode." -ForegroundColor Yellow
$proceed = Read-YesNo "  Proceed? (Y/N)"
if (-not $proceed) {
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
$scriptFiles = @("cross-window-drag.uc.js", "inline-bookmark-folders.uc.js", "download-forceopen.uc.js", "fake-fullscreen.uc.js")
if (-not (Test-Path $cssSource)) {
    Write-Err "userChrome.css not found next to this installer. Make sure you extracted the whole folder, not just this script."
    Clear-InputBuffer
    Read-Host "Press Enter to exit"
    exit 1
}
foreach ($file in $scriptFiles) {
    $src = Join-Path $scriptDir $file
    if (-not (Test-Path $src)) {
        Write-Err "$file not found next to this installer. Make sure you extracted the whole folder, not just this script."
        Clear-InputBuffer
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
        Clear-InputBuffer
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
    Clear-InputBuffer
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

Write-Step "Disabling Firefox's own native fullscreen toolbar auto-hide"
if (-not $firefoxClosed) {
    Write-Warn "Firefox is running again - skipping this step to avoid Firefox overwriting the change on exit. Set browser.fullscreen.autohide to false manually in about:config instead."
} else {
    # Native fullscreen auto-hide independently slides the tab strip
    # using its own separate mouse-position detection and timing,
    # regardless of this mod's own hover-based auto-hide CSS - running
    # both at once made the tab strip reveal/hide at a different
    # trigger point than the address bar and bookmarks bar below it.
    # Turning this pref off leaves toolbar visibility in fullscreen
    # entirely up to this mod's own CSS, matching windowed mode.
    $prefLine = 'user_pref("browser.fullscreen.autohide", false);'
    if (Test-Path $prefsJsPath) {
        $prefsContent = Get-Content $prefsJsPath
        if ($prefsContent -match 'browser\.fullscreen\.autohide') {
            $prefsContent = $prefsContent -replace '.*browser\.fullscreen\.autohide.*', $prefLine
            Set-Content -Path $prefsJsPath -Value $prefsContent -Encoding UTF8
        } else {
            Add-Content -Path $prefsJsPath -Value $prefLine -Encoding UTF8
        }
    } else {
        Set-Content -Path $prefsJsPath -Value $prefLine -Encoding UTF8
    }
    Write-Ok "Set browser.fullscreen.autohide = false in prefs.js"
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
Clear-InputBuffer
Read-Host "`nPress Enter to close"
