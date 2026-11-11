@echo off
rem ============================================================
rem  OBS / Douyin Live Companion compatible board window
rem  Normal window + solid green background; use Chroma Key in OBS.
rem  ASCII only + CRLF.
rem ============================================================
setlocal
set "ROOT=%~dp0"
set "ELECTRON=%ROOT%desktop\node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON%" (
  echo Electron not found. Use OBS browser source:
  echo http://127.0.0.1:17730/board?transparent=1
  pause
  exit /b 1
)
start "" "%ELECTRON%" "%ROOT%desktop" --chroma
