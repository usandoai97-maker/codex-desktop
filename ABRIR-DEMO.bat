@echo off
cd /d "%~dp0"
set CODEX_DEMO_MODE=1
start "" "%~dp0node_modules\electron\dist\electron.exe" .
