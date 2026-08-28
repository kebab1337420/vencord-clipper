@echo off
setlocal

REM ============================================================
REM  Clipper - turns the SteamVR side on, or off again.
REM
REM  Usage:
REM    VRinstaller.bat                install the VR side
REM    VRinstaller.bat --uninstall    remove it and delete what it generated
REM    VRinstaller.bat --status       say what is set up, change nothing
REM    VRinstaller.bat --force        write anyway, with Discord still running
REM
REM  This file is both the batch front and the script it runs. Everything from
REM  the marker below is PowerShell, read back out of this file and run from
REM  memory: one file to hand somebody, double-clickable, and no execution
REM  policy to talk them through.
REM
REM  The work itself stays in PowerShell because settings.json has to be walked
REM  as text, character by character, to touch two keys without disturbing
REM  anybody else's - see the comments in the body. Batch has no honest way to
REM  do that.
REM
REM  Exit codes: 0 = done, 1 = nothing was changed.
REM ============================================================

set "PSARGS="

REM One option per pass, spelled whichever way the person reached for: the old
REM PowerShell -Uninstall, the --uninstall an installer script usually takes, or
REM the /uninstall somebody used to Windows tools will try.
:args
if "%~1"=="" goto run

set "OPT="
if /i "%~1"=="--uninstall" set "OPT=-Uninstall"
if /i "%~1"=="-uninstall"  set "OPT=-Uninstall"
if /i "%~1"=="/uninstall"  set "OPT=-Uninstall"
if /i "%~1"=="--status"    set "OPT=-Status"
if /i "%~1"=="-status"     set "OPT=-Status"
if /i "%~1"=="/status"     set "OPT=-Status"
if /i "%~1"=="--force"     set "OPT=-Force"
if /i "%~1"=="-force"      set "OPT=-Force"
if /i "%~1"=="/force"      set "OPT=-Force"
if not defined OPT goto badopt

REM /1, because a bare shift moves %0 along with the rest and the path to this
REM file is what the PowerShell half is about to read itself out of.
set "PSARGS=%PSARGS% %OPT%"
shift /1
goto args

:badopt
echo [ERROR] Unknown option: %~1
echo         Use --uninstall, --status or --force, or no option at all to install.
echo.
pause
exit /b 1

:run
echo.
echo === Clipper VR installer ===
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = [IO.File]::ReadAllText('%~f0'); & ([scriptblock]::Create($s.Substring($s.IndexOf('#' + ':PSBODY:')))) %PSARGS%"
set "RC=%errorlevel%"

echo.
pause
exit /b %RC%

#:PSBODY:
# The VR side is opt-in and starts switched off, because most people have no
# headset: nothing about it appears in the plugin settings, nothing attaches to
# SteamVR, and no PowerShell bridge is ever started. Running this is what makes
# it appear; running it again with --uninstall makes it go away.
#
# It only writes settings. The plugin itself is already installed by install.bat
# and is not touched here - there is one bundle, and this decides what of it runs.
#
# What it does:
#   1. looks for SteamVR, and says so plainly if it is not there
#   2. sets Clipper's vrInstalled and vrControls in every Vencord, Vesktop and
#      Equibop settings file it finds
#   3. tells you to restart Discord, because settings.json is read at startup
#
# Discord has to be closed while this runs. It keeps its whole settings file in
# memory and writes all of it back when anything changes, so a running client
# would overwrite these two keys within minutes and leave no sign of it.

param(
    # takes the VR side back out, and removes the files it generated
    [switch] $Uninstall,
    # reports and exits without writing anything
    [switch] $Status,
    # writes even with a client running, and accepts losing the change
    [switch] $Force
)

$ErrorActionPreference = "Stop"

# ------------------------------------------------------------------ SteamVR --
# The same lookup the plugin does at runtime: openvrpaths.vrpath is the runtime's
# own record of itself, and is the only way to find a SteamVR that is not under
# the default Steam folder.
function Find-SteamVR {
    $registry = Join-Path $env:LOCALAPPDATA "openvr\openvrpaths.vrpath"

    if (Test-Path $registry) {
        try {
            $listed = (Get-Content $registry -Raw | ConvertFrom-Json).runtime
            foreach ($path in $listed) {
                if ($path -and (Test-Path (Join-Path $path "bin\win64\openvr_api.dll"))) { return $path }
            }
        } catch {
            # Not JSON, or a shape this does not know. The default install below
            # is still worth looking at.
        }
    }

    $fallback = Join-Path ${env:ProgramFiles(x86)} "Steam\steamapps\common\SteamVR"
    if (Test-Path (Join-Path $fallback "bin\win64\openvr_api.dll")) { return $fallback }

    return $null
}

# ------------------------------------------------------------------ client --
# Which processes would overwrite one particular settings file.
#
# Asked per file rather than of the machine, because the clients do not share
# these: somebody with Vesktop installed and an unpatched Discord open is not in
# any danger, and being refused would have them closing something for nothing.
#
# The Vencord folder is the one every Vencord-patched Discord writes to, and
# which branch is patched cannot be told from here, so all four count for it.
function Get-Owners([string] $file) {
    $folder = Split-Path (Split-Path $file -Parent) -Parent | Split-Path -Leaf

    # Case-insensitive, which is what matches both spellings of the last two.
    switch ($folder) {
        "Vencord" { return @("Discord", "DiscordPTB", "DiscordCanary", "DiscordDevelopment") }
        "vesktop" { return @("Vesktop") }
        "equibop" { return @("Equibop") }
    }

    return @()
}

# Whatever is running that would overwrite one of the files about to be written.
#
# Every one of these keeps its settings in memory and writes the whole thing
# back when any setting changes, so a key added underneath a running client
# survives only until the next time somebody touches a toggle. Refusing is much
# kinder than a change that silently comes undone an hour later.
function Get-RunningClients([string[]] $files) {
    @($files | ForEach-Object { Get-Owners $_ }) |
        Sort-Object -Unique |
        ForEach-Object { if (Get-Process -Name $_ -ErrorAction SilentlyContinue) { $_ } }
}

# ----------------------------------------------------------------- settings --
# Every client that could be running the plugin keeps its Vencord settings in a
# folder of its own, and somebody with both Discord and Vesktop expects one run
# of this to cover both.
function Get-SettingsFiles {
    @("Vencord", "vesktop", "Vesktop", "equibop", "Equibop") |
        ForEach-Object { Join-Path $env:APPDATA "$_\settings\settings.json" } |
        Where-Object { Test-Path $_ } |
        Sort-Object -Unique
}

# settings.json is not read as JSON anywhere in this script, and that is
# deliberate. It belongs to Vencord and to every other plugin the user has, and
# both PowerShell versions damage it on the way through: 5.1 collapses two keys
# that differ only in case into one, 7 refuses the file outright for the same
# reason. Either way, writing the result back would quietly lose somebody else's
# settings. So the file is treated as text, walked rather than parsed, and only
# the few bytes that belong to this script are touched.

# The object starting at or after $from, as the offsets of its two braces.
function Get-Block([string] $text, [int] $from) {
    $open = -1

    for ($i = $from; $i -lt $text.Length; $i++) {
        if ([char]::IsWhiteSpace($text[$i])) { continue }
        if ($text[$i] -eq '{') { $open = $i }
        break
    }

    if ($open -lt 0) { return $null }

    $depth = 0
    $inString = $false
    $escaped = $false

    for ($i = $open; $i -lt $text.Length; $i++) {
        $c = $text[$i]

        if ($escaped) { $escaped = $false; continue }
        if ($inString -and $c -eq '\') { $escaped = $true; continue }
        if ($c -eq '"') { $inString = -not $inString; continue }
        if ($inString) { continue }

        if ($c -eq '{') {
            $depth++
        } elseif ($c -eq '}') {
            $depth--
            if ($depth -eq 0) { return @{ Start = $open; End = $i } }
        }
    }

    # An unclosed brace means the file is truncated, and nothing good comes of
    # writing to it.
    return $null
}

# Where the value of one member of one object starts, or -1.
#
# Reads strings properly rather than searching for the key, and only looks at
# the object's own members: a key name is a perfectly ordinary thing to find
# inside somebody else's string value, and acting on one would put these
# settings somewhere they do not belong.
function Find-Member([string] $text, [int] $open, [int] $close, [string] $name) {
    $depth = 0
    $i = $open + 1

    while ($i -lt $close) {
        $c = $text[$i]

        if ($c -eq '"') {
            $start = ++$i
            $escaped = $false

            while ($i -lt $close) {
                $d = $text[$i]
                if ($escaped) { $escaped = $false; $i++; continue }
                if ($d -eq '\') { $escaped = $true; $i++; continue }
                if ($d -eq '"') { break }
                $i++
            }

            $literal = $text.Substring($start, $i - $start)
            $i++

            if ($depth -eq 0 -and $literal -eq $name) {
                $j = $i
                while ($j -lt $close -and [char]::IsWhiteSpace($text[$j])) { $j++ }
                if ($j -lt $close -and $text[$j] -eq ':') { return $j + 1 }
            }

            continue
        }

        if ($c -eq '{' -or $c -eq '[') { $depth++ }
        elseif ($c -eq '}' -or $c -eq ']') { $depth-- }

        $i++
    }

    return -1
}

# The Clipper block, reached the only way it is safe to reach it: the root
# object, then its plugins member, then Clipper inside that.
function Get-ClipperBlock([string] $text) {
    $root = Get-Block $text 0
    if (-not $root) { return $null }

    $at = Find-Member $text $root.Start $root.End "plugins"
    if ($at -lt 0) { return $null }

    $plugins = Get-Block $text $at
    if (-not $plugins) { return $null }

    $at = Find-Member $text $plugins.Start $plugins.End "Clipper"
    if ($at -lt 0) { return $null }

    return Get-Block $text $at
}

function Set-ClipperSetting([string] $file, [hashtable] $values) {
    $text = [IO.File]::ReadAllText($file)
    $block = Get-ClipperBlock $text

    # Clipper has never been opened in this client. Writing a plugin block from
    # here would be guessing at a shape the plugin owns, so it is left for the
    # plugin to create on its first run.
    if (-not $block) { return $false }

    $body = $text.Substring($block.Start, $block.End - $block.Start + 1)

    # Whatever the file already uses, so an inserted line sits with the rest.
    $indent = "            "
    $first = [regex]::Match($body, '\r?\n([ \t]+)"')
    if ($first.Success) { $indent = $first.Groups[1].Value }

    $break = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }

    # Clipper has been opened but has nothing stored, so there is no member to
    # put a comma in front of. One gets written without, and the next one after
    # it goes in ahead of it and can have its comma back.
    $empty = $body.Substring(1, $body.Length - 2).Trim().Length -eq 0

    foreach ($key in $values.Keys) {
        $value = if ($values[$key]) { "true" } else { "false" }
        $pattern = '("' + [regex]::Escape($key) + '"\s*:\s*)(?:true|false)'
        $regex = [regex]::new($pattern)

        if ($regex.IsMatch($body)) {
            $body = $regex.Replace($body, ('${1}' + $value), 1)
        } else {
            $comma = if ($empty) { "" } else { "," }
            $body = $body.Insert(1, $break + $indent + '"' + $key + '": ' + $value + $comma)
            $empty = $false
        }
    }

    $patched = $text.Substring(0, $block.Start) + $body + $text.Substring($block.End + 1)

    # Written beside the original and moved over it: a settings.json half
    # rewritten because the disc filled up would take every other plugin's
    # settings with it. No BOM, because that is how Vencord writes it and a
    # BOM appearing from nowhere is the kind of thing that breaks a reader.
    $temp = "$file.clipper-vr"
    [IO.File]::WriteAllText($temp, $patched, [Text.UTF8Encoding]::new($false))
    Move-Item $temp $file -Force

    return $true
}

function Get-ClipperSetting([string] $file, [string] $key) {
    try {
        $text = [IO.File]::ReadAllText($file)
        $block = Get-ClipperBlock $text
        if (-not $block) { return $null }

        $body = $text.Substring($block.Start, $block.End - $block.Start + 1)
        $match = [regex]::Match($body, '"' + [regex]::Escape($key) + '"\s*:\s*(true|false)')

        if (-not $match.Success) { return $null }

        return $match.Groups[1].Value -eq "true"
    } catch {
        return $null
    }
}

# Whether Clipper has ever written anything to this client. Asked separately
# from any one setting, because a setting this script has never written is
# absent from a settings file that is otherwise full of Clipper's own.
function Test-ClipperPresent([string] $file) {
    try {
        return $null -ne (Get-ClipperBlock ([IO.File]::ReadAllText($file)))
    } catch {
        return $false
    }
}

# --------------------------------------------------------------------- run --
$files = @(Get-SettingsFiles)

if ($files.Count -eq 0) {
    Write-Host "[ERROR] No Vencord settings found."
    Write-Host "        Install the plugin with install.bat first, then start Discord once."
    exit 1
}

$steamVR = Find-SteamVR

# Asked before anything is written, and not before --status, which only reads.
if (-not $Status) {
    $open = @(Get-RunningClients $files)

    if ($open.Count -gt 0 -and -not $Force) {
        Write-Host "[ERROR] Close $($open -join ', ') first."
        Write-Host "        A running client writes its whole settings file back whenever anything"
        Write-Host "        changes, which would undo this without saying so. Nothing was changed."
        Write-Host "        Run with --force to write anyway."
        exit 1
    }

    if ($open.Count -gt 0) {
        Write-Host "      [!] $($open -join ', ') still running. This may be overwritten."
    }
}

if ($Status) {
    Write-Host "SteamVR: $(if ($steamVR) { $steamVR } else { 'not found' })"

    foreach ($file in $files) {
        $client = Split-Path (Split-Path $file -Parent) -Parent | Split-Path -Leaf
        $installed = Get-ClipperSetting $file "vrInstalled"
        $controls = Get-ClipperSetting $file "vrControls"

        if (-not (Test-ClipperPresent $file)) {
            Write-Host "      $client - Clipper has no settings here yet"
        } elseif ($installed -eq $true) {
            Write-Host "      $client - VR side installed, controls $(if ($controls -eq $true) { 'on' } else { 'off' })"
        } else {
            Write-Host "      $client - VR side not installed"
        }
    }

    exit 0
}

if ($Uninstall) {
    $done = 0

    foreach ($file in $files) {
        $client = Split-Path (Split-Path $file -Parent) -Parent | Split-Path -Leaf

        if (Set-ClipperSetting $file @{ vrInstalled = $false; vrControls = $false }) {
            Write-Host "      $client - VR side removed"
            $done++
        } else {
            Write-Host "      $client - Clipper has no settings here, nothing to remove"
        }
    }

    # The action manifest, the default bindings and the generated bridge script.
    # All of them are rewritten from scratch whenever the bridge starts, so
    # deleting them loses nothing - a rebound button lives in SteamVR's own
    # files, not in these.
    #
    # They sit next to the client's own data rather than next to Vencord's,
    # because the plugin writes them to Electron's userData path, and that
    # belongs to whichever Discord is being patched.
    $generated = @("discord", "discordptb", "discordcanary", "discorddevelopment", "vesktop", "equibop") |
        ForEach-Object { Join-Path $env:APPDATA "$_\clipper-vr" } |
        Where-Object { Test-Path $_ }

    foreach ($folder in $generated) {
        Remove-Item $folder -Recurse -Force
        Write-Host "      Removed $folder"
    }

    if ($done -eq 0) {
        Write-Host "[ERROR] Nothing was changed."
        exit 1
    }

    Write-Host ""
    Write-Host "Done. Start Discord again; the VR settings will be gone."
    Write-Host "SteamVR keeps whatever bindings you made; they are its files, not the plugin's."
    exit 0
}

# ---- install ----------------------------------------------------------------
if (-not $steamVR) {
    Write-Host "[ERROR] SteamVR was not found."
    Write-Host "        Install it from Steam, run it once, then run this again."
    Write-Host "        Nothing was changed."
    exit 1
}

Write-Host "      SteamVR found at $steamVR"

$done = 0

foreach ($file in $files) {
    $client = Split-Path (Split-Path $file -Parent) -Parent | Split-Path -Leaf

    if (Set-ClipperSetting $file @{ vrInstalled = $true; vrControls = $true }) {
        Write-Host "      $client - VR side installed"
        $done++
    } else {
        Write-Host "      [!] $client - Clipper has no settings here. Start it once, then run this again."
    }
}

if ($done -eq 0) {
    Write-Host "[ERROR] Nothing was changed."
    exit 1
}

Write-Host ""
Write-Host "Done. Start Discord, then:"
Write-Host "  - the plugin settings gain a VR section"
Write-Host "  - put the headset on and the controls attach by themselves"
Write-Host "  - two binds out of the box, both on the right controller: double-tap B to save"
Write-Host "    a clip, hold A to drop a marker. Nothing at all on the left hand."
Write-Host "  - starting the buffer and asking the call for their angle are there too, unbound."
Write-Host "    Add a button for either in SteamVR, under Settings, Controller Bindings,"
Write-Host "    Clipper, or from the button in the plugin's VR section"
Write-Host "  - what the plugin has to say is drawn in the headset for a few seconds,"
Write-Host "    a metre in front of you. Switch it off in the VR section if it is in the way"
exit 0
