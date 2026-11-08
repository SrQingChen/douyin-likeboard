@echo off
rem ============================================================
rem  Open the standalone board window (ASCII content + CRLF only!)
rem  Electron transparent frameless desktop window.
rem ============================================================
setlocal
set "ROOT=%~dp0"
set "URL=http://127.0.0.1:17730/board"
set "ELECTRON=%ROOT%desktop\node_modules\electron\dist\electron.exe"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

if exist "%ELECTRON%" (
  start "" "%ELECTRON%" "%ROOT%desktop"
) else if exist "%CHROME%" (
  start "" "%CHROME%" --app=%URL% --window-size=560,960
) else (
  start msedge --app=%URL% --window-size=560,960
)
