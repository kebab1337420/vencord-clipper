@echo off
setlocal EnableDelayedExpansion

REM ============================================================
REM  Clipper - Vencord user plugin installer
REM
REM  Usage:
REM    install.bat                    prebuilt install (no tools needed)
REM    install.bat --uninstall        undo it
REM    install.bat --source [path]    build from a Vencord checkout instead
REM
REM  The default path ships a finished Vencord build with Clipper
REM  compiled in (prebuilt\dist): no node, no pnpm, no Vencord
REM  clone. Discord gets patched the same way the official Vencord
REM  installer patches it, and Vesktop gets pointed at the bundle.
REM
REM  --source keeps the old behaviour for anyone who wants to build
REM  the plugin themselves from a Vencord dev install.
REM ============================================================

set "PLUGIN_NAME=Clipper"
set "PLUGIN_SRC=%~dp0src\userplugins\%PLUGIN_NAME%"
set "MODE=prebuilt"
set "VENCORD_DIR="

if /i "%~1"=="--source" (
    set "MODE=source"
    set "VENCORD_DIR=%~2"
) else if /i "%~1"=="--uninstall" (
    set "MODE=uninstall"
) else if not "%~1"=="" (
    REM a bare path argument still means "build from this checkout"
    set "MODE=source"
    set "VENCORD_DIR=%~1"
)

echo.
echo === Clipper installer ===
echo.

if "%MODE%"=="uninstall" goto :uninstall
if "%MODE%"=="source" goto :source

REM ============================================================
REM  Prebuilt install
REM ============================================================

if not exist "%~dp0prebuilt\dist\patcher.js" (
    echo [ERROR] No prebuilt bundle in prebuilt\dist.
    echo         Use the source install instead:  install.bat --source
    goto :fail
)

echo [1/2] Installing the prebuilt Vencord + Clipper bundle...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-prebuilt.ps1"
if errorlevel 1 goto :fail
echo.

echo [2/2] Done.
echo.
echo Start Discord (or Vesktop), then enable "Clipper" in Settings ^> Vencord ^> Plugins.
echo Default keybinds:  Alt+F9 start/stop buffer, Alt+F10 save clip.
echo.
echo Undo with:  install.bat --uninstall
echo.
pause
exit /b 0

REM ============================================================
REM  Uninstall
REM ============================================================
:uninstall
echo Removing the Clipper build and unpatching Discord...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\uninstall.ps1"
echo.
echo Vencord settings were left untouched.
echo.
pause
exit /b 0

REM ============================================================
REM  Source install (needs a Vencord dev checkout + pnpm)
REM ============================================================
:source

if not exist "%PLUGIN_SRC%\index.tsx" (
    echo [ERROR] Plugin sources not found at:
    echo         %PLUGIN_SRC%
    goto :fail
)

REM ---- 1. Locate the Vencord repository -----------------------
if not defined VENCORD_DIR (
    echo [1/5] Looking for the Vencord install Discord is patched with...
    for /f "usebackq delims=" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\find-vencord.ps1"`) do set "VENCORD_DIR=%%A"
)

if not defined VENCORD_DIR (
    if exist "%USERPROFILE%\Vencord\package.json" set "VENCORD_DIR=%USERPROFILE%\Vencord"
)

if not defined VENCORD_DIR (
    echo [ERROR] Could not find a Vencord repository.
    echo         Pass it manually:  install.bat --source "C:\path\to\Vencord"
    echo         Or drop --source to install the prebuilt bundle instead.
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
    echo         Or drop --source to install the prebuilt bundle instead.
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
