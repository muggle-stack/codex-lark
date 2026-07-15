@echo off
REM Windows helper: validate lark-cli auth, codex, and config before running.
setlocal
cd /d "%~dp0.."
node src\bridge.mjs --check
endlocal
