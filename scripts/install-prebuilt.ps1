# Installs the prebuilt Vencord+Clipper bundle without any build toolchain.
#
# Nothing here needs node, pnpm or a Vencord checkout: the bundle in
# <repo>\prebuilt\dist is a finished Vencord build with Clipper compiled in.
#
# What it does:
#   1. copies the bundle to %APPDATA%\Vencord\clipper\dist (a stable path, so
#      moving or deleting this repo afterwards does not break the install)
#   2. patches every Discord flavour found: the real app.asar is renamed to
#      _app.asar and replaced by a stub asar that requires dist\patcher.js,
#      which is exactly what the Vencord installer does
#   3. points every Vesktop / Equibop install at the same dist folder
#
# Exit codes: 0 = at least one client set up, 1 = nothing was set up.

param(
    [string] $DistSource = (Join-Path (Split-Path $PSScriptRoot -Parent) "prebuilt\dist"),
    [string] $InstallDir = (Join-Path $env:APPDATA "Vencord\clipper"),
    # copies the bundle and stops, leaving every client untouched
    [switch] $BundleOnly
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------- asar stub --
# asar layout: uint32 4, uint32 headerSize, uint32 headerStringSize+4,
# uint32 jsonLength, the JSON header, then the file contents back to back.
function New-AsarStub([string] $path, [string] $patcher) {
    $index = 'require("' + $patcher.Replace('\', '\\') + '")'
    $pkg = "{`n`t`"name`": `"discord`",`n`t`"main`": `"index.js`"`n}"

    $indexBytes = [Text.Encoding]::UTF8.GetBytes($index)
    $pkgBytes = [Text.Encoding]::UTF8.GetBytes($pkg)

    $json = '{"files":{"index.js":{"size":' + $indexBytes.Length + ',"offset":"0"},' +
            '"package.json":{"size":' + $pkgBytes.Length + ',"offset":"' + $indexBytes.Length + '"}}}'

    # every pickle field is 4-byte aligned; pad the JSON with spaces, which it tolerates
    $jsonBytes = [Text.Encoding]::UTF8.GetBytes($json)
    while ($jsonBytes.Length % 4 -ne 0) {
        $json += " "
        $jsonBytes = [Text.Encoding]::UTF8.GetBytes($json)
    }

    $stream = [IO.File]::Create($path)
    try {
        $writer = [IO.BinaryWriter]::new($stream)
        $writer.Write([uint32] 4)
        $writer.Write([uint32] ($jsonBytes.Length + 8))
        $writer.Write([uint32] ($jsonBytes.Length + 4))
        $writer.Write([uint32] $jsonBytes.Length)
        $writer.Write($jsonBytes)
        $writer.Write($indexBytes)
        $writer.Write($pkgBytes)
        $writer.Flush()
    } finally {
        $stream.Dispose()
    }
}

# Reads the patcher path out of a stub asar, or $null when the file is a real asar.
function Get-StubTarget([string] $asar) {
    if ((Get-Item $asar).Length -ge 4096) { return $null }

    $text = [IO.File]::ReadAllText($asar)
    $match = [regex]::Match($text, 'require\("(.+?)"\)')
    if (-not $match.Success) { return $null }

    return $match.Groups[1].Value -replace '\\\\', '\'
}

# ------------------------------------------------------------- copy bundle --
if (-not (Test-Path (Join-Path $DistSource "patcher.js"))) {
    Write-Host "[ERROR] No prebuilt bundle at $DistSource"
    Write-Host "        Regenerate it with scripts\build-prebuilt.ps1, or run install.bat --source."
    exit 1
}

$dist = Join-Path $InstallDir "dist"
New-Item -ItemType Directory -Force $dist | Out-Null
Copy-Item (Join-Path $DistSource "*") $dist -Recurse -Force

# find-vencord.ps1 and Vesktop both expect a repo-shaped folder next to dist
$marker = Join-Path $InstallDir "package.json"
if (-not (Test-Path $marker)) {
    '{ "name": "vencord", "private": "true", "main": "dist/patcher.js" }' |
        Set-Content $marker -Encoding UTF8
}

Write-Host "      Bundle installed to $dist"

if ($BundleOnly) { exit 0 }

# ------------------------------------------------------------ patch Discord --
$patcher = Join-Path $dist "patcher.js"
$patched = 0
$skipped = @()

$discordRoots = @(
    "$env:LOCALAPPDATA\Discord",
    "$env:LOCALAPPDATA\DiscordPTB",
    "$env:LOCALAPPDATA\DiscordCanary",
    "$env:LOCALAPPDATA\DiscordDevelopment"
) | Where-Object { Test-Path $_ }

foreach ($root in $discordRoots) {
    $name = Split-Path $root -Leaf

    $running = Get-Process | Where-Object { $_.Path -like "$root\*" }
    if ($running) {
        Write-Host "      [!] $name is running - close it (check the tray) and run this again."
        $skipped += $name
        continue
    }

    # only the newest app-x.y.z matters; older ones are leftovers Discord no longer starts
    $resources = Get-ChildItem $root -Directory -Filter "app-*" |
        Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName "resources" } |
        Where-Object { Test-Path $_ } |
        Select-Object -First 1

    if (-not $resources) { continue }

    $asar = Join-Path $resources "app.asar"
    $original = Join-Path $resources "_app.asar"

    if (-not (Test-Path $asar) -and -not (Test-Path $original)) { continue }

    if (Test-Path $asar) {
        $target = Get-StubTarget $asar

        if ($target) {
            # already patched: keep the untouched original, just retarget the stub
            if ($target -eq $patcher) {
                Write-Host "      $name already points at this build."
                $patched++
                continue
            }
            Write-Host "      $name was pointed at $target - retargeting."
        } elseif (Test-Path $original) {
            # a real app.asar next to a leftover _app.asar: Discord updated itself
            Remove-Item $original -Force
            Move-Item $asar $original -Force
        } else {
            Move-Item $asar $original -Force
        }
    }

    if (-not (Test-Path $original)) {
        Write-Host "      [!] $name has no app.asar to patch, skipping."
        $skipped += $name
        continue
    }

    try {
        New-AsarStub $asar $patcher
        Write-Host "      $name patched (original kept as _app.asar)"
        $patched++
    } catch {
        Write-Host "      [!] $name could not be patched - $($_.Exception.Message)"
        if (-not (Test-Path $asar)) { Move-Item $original $asar -Force }
        $skipped += $name
    }
}

# ------------------------------------------------------------ point Vesktop --
# install-vesktop.ps1 also exits 0 when no Vesktop is installed, so only count it
# as a client when one actually exists.
$hasVesktop = @("vesktop", "Vesktop", "equibop", "Equibop") |
    ForEach-Object { Join-Path $env:APPDATA $_ } |
    Where-Object { Test-Path $_ }

& (Join-Path $PSScriptRoot "install-vesktop.ps1") -VencordDir $InstallDir
if ($LASTEXITCODE -eq 0 -and $hasVesktop) { $patched++ }
if ($LASTEXITCODE -ne 0 -and $hasVesktop) { $skipped += "Vesktop" }

if ($skipped.Count -gt 0) {
    Write-Host "      [!] Not set up: $($skipped -join ', ') - close them and run this again."
}

if ($patched -eq 0) {
    Write-Host "[ERROR] No Discord or Vesktop install was set up."
    exit 1
}

exit 0
