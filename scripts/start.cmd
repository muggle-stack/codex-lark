@echo off
REM Windows launcher for codex-lark (native equivalent of scripts/start.sh).
REM Runs the bridge in the foreground. Close the window or Ctrl+C to stop.
setlocal
cd /d "%~dp0.."
node src\bridge.mjs %*
endlocal
