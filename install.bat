@echo off
setlocal EnableDelayedExpansion

REM ============================================================
REM  Clipper - Vencord user plugin installer
REM
REM  Usage:  install.bat [path\to\Vencord]
REM
REM  Without an argument the script reads the patched Discord
REM  app.asar stub to find the Vencord repo Discord actually
REM  loads, then falls back to the Vencord folder Vesktop is
REM  pointed at, then to %USERPROFILE%\Vencord.
REM
REM  Vesktop is handled too: it ships its own Vencord and only
REM  loads another one when its "Vencord Location" points at a
REM  dist folder, so that setting is written for it.
REM ============================================================

set "PLUGIN_NAME=Clipper"
set "PLUGIN_SRC=%~dp0src\userplugins\%PLUGIN_NAME%"

echo.
echo === Clipper installer ===
echo.

if not exist "%PLUGIN_SRC%\index.tsx" (
    echo [ERROR] Plugin sources not found at:
    echo         %PLUGIN_SRC%
    goto :fail
)

REM ---- 1. Locate the Vencord repository -----------------------
set "VENCORD_DIR=%~1"

if not defined VENCORD_DIR (
    echo [1/5] Looking for the Vencord install Discord is patched with...
    for /f "usebackq delims=" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\find-vencord.ps1"`) do set "VENCORD_DIR=%%A"
)

if not defined VENCORD_DIR (
    if exist "%USERPROFILE%\Vencord\package.json" set "VENCORD_DIR=%USERPROFILE%\Vencord"
)

if not defined VENCORD_DIR (
    echo [ERROR] Could not find a Vencord repository.
    echo         Pass it manually:  install.bat "C:\path\to\Vencord"
    goto :fail
)

if not exist "%VENCORD_DIR%\package.json" (
    echo [ERROR] Not a Vencord repository: %VENCORD_DIR%
    goto :fail
)

echo       Found: %VENCORD_DIR%
echo.

REM ---- 2. Copy the plugin -------------------------------------
echo [2/5] Copying the plugin into src\userplugins\%PLUGIN_NAME% ...
set "DEST=%VENCORD_DIR%\src\userplugins\%PLUGIN_NAME%"
if not exist "%VENCORD_DIR%\src\userplugins" mkdir "%VENCORD_DIR%\src\userplugins"
xcopy "%PLUGIN_SRC%" "%DEST%\" /E /I /Y /Q >nul
if errorlevel 1 (
    echo [ERROR] Copy failed.
    goto :fail
)
echo       Installed to: %DEST%
echo.

REM ---- 3. Build Vencord ---------------------------------------
where pnpm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] pnpm is not on your PATH. Install it with:  npm i -g pnpm
    goto :fail
)

echo [3/5] Building Vencord (broken third-party plugins get quarantined)...
if not exist "%VENCORD_DIR%\node_modules" (
    echo       node_modules missing, running pnpm install first...
    pushd "%VENCORD_DIR%"
    call pnpm install --frozen-lockfile
    popd
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-vencord.ps1" -VencordDir "%VENCORD_DIR%" -KeepPlugin "%PLUGIN_NAME%"
set "BUILD_ERR=%errorlevel%"

if not "%BUILD_ERR%"=="0" (
    echo [ERROR] Build failed. Check the output above.
    goto :fail
)
echo.

REM ---- 4. Point Vesktop at this build -------------------------
echo [4/5] Pointing Vesktop at this build (skipped when Vesktop is not installed)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-vesktop.ps1" -VencordDir "%VENCORD_DIR%"
if not "%errorlevel%"=="0" (
    echo       [!] Vesktop was not pointed at this build. Set it by hand:
    echo           Vesktop Settings ^> Vencord Location ^> %VENCORD_DIR%\dist
)
echo.

REM ---- 5. Done ------------------------------------------------
echo [5/5] Done.
echo.
echo Restart Discord (and Vesktop), then enable "Clipper" in Settings ^> Vencord ^> Plugins.
echo Default keybinds:  Alt+F9 start/stop buffer, Alt+F10 save clip.
echo.
pause
exit /b 0

:fail
echo.
pause
exit /b 1
