# Turns Clipper's SteamVR side on, or off again.
#
# Most people have no headset, so the VR side is opt-in and starts switched off:
# nothing about it appears in the plugin settings, nothing attaches to SteamVR,
# and no PowerShell bridge is ever started. Running this script is what makes it
# appear; running it again with -Uninstall makes it go away.
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
# Usage:
#   VRinstaller.ps1              install the VR side
#   VRinstaller.ps1 -Uninstall   remove it and delete what it generated
#   VRinstaller.ps1 -Status      say what is set up, change nothing
#
# Exit codes: 0 = done, 1 = nothing was changed.

param(
    # takes the VR side back out, and removes the files it generated
    [switch] $Uninstall,
    # reports and exits without writing anything
    [switch] $Status
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

# The Clipper block, found by walking the braces rather than by parsing the file.
#
# settings.json is not read as JSON anywhere in this script, and that is
# deliberate. It belongs to Vencord and to every other plugin the user has, and
# both PowerShell versions damage it on the way through: 5.1 collapses two keys
# that differ only in case into one, 7 refuses the file outright for the same
# reason. Either way, writing the result back would quietly lose somebody else's
# settings. So the file is treated as text and only the few bytes that belong to
# this script are touched.
function Get-ClipperBlock([string] $text) {
    $at = $text.IndexOf('"Clipper"')
    if ($at -lt 0) { return $null }

    $open = $text.IndexOf('{', $at)
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

    foreach ($key in $values.Keys) {
        $value = if ($values[$key]) { "true" } else { "false" }
        $pattern = '("' + [regex]::Escape($key) + '"\s*:\s*)(?:true|false)'
        $regex = [regex]::new($pattern)

        if ($regex.IsMatch($body)) {
            $body = $regex.Replace($body, ('${1}' + $value), 1)
        } else {
            $body = $body.Insert(1, $break + $indent + '"' + $key + '": ' + $value + ',')
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
    Write-Host "Done. Restart Discord for the VR settings to disappear."
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
Write-Host "Done. Restart Discord, then:"
Write-Host "  - the plugin settings gain a VR section"
Write-Host "  - put the headset on and the controls attach by themselves"
Write-Host "  - double-tap B on the right controller to save a clip, hold A to drop a marker,"
Write-Host "    double-tap the left one to start or stop the buffer, hold it to ask for angles"
Write-Host "  - rebind any of that in SteamVR, under Settings, Controller Bindings, Clipper,"
Write-Host "    or from the button in the plugin's VR section"
exit 0
