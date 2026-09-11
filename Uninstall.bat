@echo off
REM Double-clickable launcher for uninstall.ps1 - see Install.bat for why
REM this wrapper exists (Windows doesn't run .ps1 files directly).
REM uninstall.ps1 has its own "Press Enter to close" prompts at the end of
REM each path (success or error) - no extra pause here.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
