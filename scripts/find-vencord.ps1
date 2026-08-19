# Prints the path of the Vencord repository that the patched Discord loads.
# Falls back to %USERPROFILE%\Vencord. Prints nothing when no repo is found.

$ErrorActionPreference = "SilentlyContinue"

function Get-PatchedVencordPath {
    $roots = @(
        "$env:LOCALAPPDATA\Discord",
        "$env:LOCALAPPDATA\DiscordPTB",
        "$env:LOCALAPPDATA\DiscordCanary",
        "$env:LOCALAPPDATA\DiscordDevelopment",
        "$env:LOCALAPPDATA\Programs\Vesktop",
        "$env:LOCALAPPDATA\Programs\discordcanary"
    ) | Where-Object { Test-Path $_ }

    foreach ($root in $roots) {
        # The Vencord patch replaces app.asar with a tiny stub that requires dist\patcher.js
        $stubs = Get-ChildItem $root -Recurse -Filter "app.asar" -File |
            Where-Object { $_.Length -lt 4096 }

        foreach ($stub in $stubs) {
            $text = [System.IO.File]::ReadAllText($stub.FullName)
            $match = [regex]::Match($text, 'require\("(.+?)[\\/]+dist[\\/]+patcher\.js"\)')
            if ($match.Success) {
                $path = $match.Groups[1].Value -replace '\\\\', '\'
                if (Test-Path (Join-Path $path "package.json")) { return $path }
            }
        }
    }

    return $null
}

# Vesktop is not patched: it records the Vencord build it loads in state.json,
# as the repo's dist folder.
function Get-VesktopVencordPath {
    $dataDirs = @(
        (Join-Path $env:APPDATA "vesktop"),
        (Join-Path $env:APPDATA "Vesktop"),
        (Join-Path $env:APPDATA "equibop"),
        (Join-Path $env:APPDATA "Equibop")
    ) | Where-Object { Test-Path $_ }

    foreach ($dir in $dataDirs) {
        $stateFile = Join-Path $dir "state.json"
        if (-not (Test-Path $stateFile)) { continue }

        $dist = (Get-Content $stateFile -Raw | ConvertFrom-Json).vencordDir
        if (-not $dist) { continue }

        $repo = Split-Path $dist -Parent
        if (Test-Path (Join-Path $repo "package.json")) { return $repo }
    }

    return $null
}

$path = Get-PatchedVencordPath
if (-not $path) { $path = Get-VesktopVencordPath }
if (-not $path -and (Test-Path "$env:USERPROFILE\Vencord\package.json")) {
    $path = "$env:USERPROFILE\Vencord"
}

if ($path) { Write-Output $path }
