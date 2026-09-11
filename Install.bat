@echo off
REM Double-clickable launcher for install.ps1.
REM Windows doesn't run .ps1 files directly when double-clicked (a security
REM default), so this small wrapper starts PowerShell pointed at the real
REM installer instead. install.ps1 handles its own admin elevation
REM internally, so this file itself doesn't need to run as administrator.
REM install.ps1 has its own "Press Enter to close" prompts at the end of
REM each path (success or error) - no extra pause here, so the window
REM closes right after that instead of needing a second keypress.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
