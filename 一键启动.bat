@echo off
rem ============================================================
rem  Like stats assistant root launcher  (ASCII content + CRLF only!)
rem  1st choice: Electron setup splash (progress UI + foolproof)
rem  fallback  : headless start via portable/system Node.js
rem  Never put non-ASCII literals in a .bat body: cmd decodes the
rem  file with the OEM codepage (GBK) and UTF-8 bytes get mangled.
rem ============================================================
setlocal
set "ROOT=%~dp0"
set "ELECTRON=%ROOT%desktop\node_modules\electron\dist\electron.exe"

if exist "%ELECTRON%" (
  start "" "%ELECTRON%" "%ROOT%desktop" --setup
  exit /b 0
)

rem ---- fallback: no Electron, start core directly ----
set "PATH=C:\Windows\System32;C:\Windows;C:\Windows\System32\Wbem;%ROOT%runtime;%PATH%"
set "NODE_CMD=%ROOT%runtime\node.exe"
if not exist "%NODE_CMD%" (
  where node >nul 2>nul && set "NODE_CMD=node" || (
    echo Node.js not found and no runtime folder - package is broken.
    pause
    exit /b 1
  )
)
curl -s -o nul -m 2 http://127.0.0.1:17730/api/status
if %errorlevel%==0 (
  echo Already running - opening console ...
  start "" "http://127.0.0.1:17730/"
  exit /b 0
)
echo Starting core ...
cd /d "%ROOT%server"
start "likes-stats-core" /min cmd /c ""%NODE_CMD%" --import tsx src/index.ts >> "..\data\core.log" 2>&1"
set /a tries=0
:wait_ready
ping -n 3 127.0.0.1 >nul
curl -s -o nul -m 2 http://127.0.0.1:17730/api/status
if %errorlevel%==0 goto ready
set /a tries+=1
if %tries% lss 20 goto wait_ready
echo Startup timeout - check data\core.log
pause
exit /b 1
:ready
echo Started OK - opening console ...
start "" "http://127.0.0.1:17730/"
exit /b 0
