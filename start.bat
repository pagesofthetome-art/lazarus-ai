@echo off
setlocal
pushd "%~dp0"

set "DEV_URL=http://127.0.0.1:5273/"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is required to run Lazarus. Install Node.js 22 or newer, then run setup.bat.
    pause
    popd
    exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
    echo Lazarus requires Node.js 22 or newer. Upgrade Node.js, then run setup.bat again.
    pause
    popd
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo npm was not found. Repair or reinstall Node.js, then run setup.bat.
    pause
    popd
    exit /b 1
)

if not exist "node_modules\.bin\vite.cmd" (
    echo Lazarus dependencies are missing. Run setup.bat first.
    pause
    popd
    exit /b 1
)

:: Reuse Lazarus if its Vite dev server is already responding.
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; try { $r=Invoke-WebRequest -Uri '%DEV_URL%' -TimeoutSec 1 -UseBasicParsing; if ($r.Content -match '@vite/client') { exit 0 } else { exit 2 } } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 goto open_app

:: Keep the server console visible so startup errors are easy to diagnose.
start "Lazarus Dev Server" /D "%CD%" cmd /k npm run dev

:: Vite, Tauri, and Playwright share port 5273. Wait until this project is served.
for /l %%I in (1,1,30) do (
    powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; try { $r=Invoke-WebRequest -Uri '%DEV_URL%' -TimeoutSec 1 -UseBasicParsing; if ($r.Content -match '@vite/client') { exit 0 } else { exit 2 } } catch { exit 1 }" >nul 2>nul
    if not errorlevel 1 goto open_app
    timeout /t 1 /nobreak >nul
)

echo Lazarus did not start on port 5273. Check the Lazarus Dev Server window for errors.
popd
exit /b 1

:open_app
start "" "%DEV_URL%"
popd
exit /b 0
