# Maintainer script: refreshes prebuilt\dist from a Vencord checkout.
#
# Users never run this. It builds Vencord with the plugin copied in, then copies
# the resulting bundle (without source maps, which are 14 MB of no use to anyone
# installing it) into prebuilt\dist, alongside a build-info.json describing what
# went in.
#
# Usage:  scripts\build-prebuilt.ps1 [-VencordDir <path>]

param(
    [string] $VencordDir = (Join-Path (Split-Path $PSScriptRoot -Parent) "Vencord"),
    [string] $PluginName = "Clipper"
)

$ErrorActionPreference = "Stop"

$repo = Split-Path $PSScriptRoot -Parent
$pluginSrc = Join-Path $repo "src\userplugins\$PluginName"
$prebuilt = Join-Path $repo "prebuilt\dist"

if (-not (Test-Path (Join-Path $VencordDir "package.json"))) {
    Write-Host "[ERROR] Not a Vencord repository: $VencordDir"
    exit 1
}

if (-not (Test-Path (Join-Path $pluginSrc "index.tsx"))) {
    Write-Host "[ERROR] Plugin sources not found at $pluginSrc"
    exit 1
}

# ---- plugin into the checkout ------------------------------------------------
$dest = Join-Path $VencordDir "src\userplugins\$PluginName"
New-Item -ItemType Directory -Force (Split-Path $dest -Parent) | Out-Null
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
Copy-Item $pluginSrc $dest -Recurse -Force
Write-Host "Plugin copied to $dest"

# ---- build -------------------------------------------------------------------
if (-not (Test-Path (Join-Path $VencordDir "node_modules"))) {
    Push-Location $VencordDir
    try { & cmd /c "pnpm install --frozen-lockfile" } finally { Pop-Location }
}

& (Join-Path $PSScriptRoot "build-vencord.ps1") -VencordDir $VencordDir -KeepPlugin $PluginName
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Vencord build failed."
    exit 1
}

# ---- copy the bundle ---------------------------------------------------------
$dist = Join-Path $VencordDir "dist"
if (-not (Test-Path (Join-Path $dist "patcher.js"))) {
    Write-Host "[ERROR] $dist has no patcher.js - the build produced nothing."
    exit 1
}

if (Test-Path $prebuilt) { Remove-Item $prebuilt -Recurse -Force }
New-Item -ItemType Directory -Force $prebuilt | Out-Null

Get-ChildItem $dist -File |
    Where-Object { $_.Extension -in ".js", ".css", ".txt" } |
    Copy-Item -Destination $prebuilt

# The renderer bundle must contain the plugin, otherwise the whole point is lost.
$renderer = Join-Path $prebuilt "renderer.js"
if (-not (Select-String -Path $renderer -SimpleMatch $PluginName -Quiet)) {
    Write-Host "[ERROR] $PluginName is not in the built renderer - was it quarantined?"
    exit 1
}

$version = (Get-Content (Join-Path $VencordDir "package.json") -Raw | ConvertFrom-Json).version

$commit = $null
Push-Location $VencordDir
try { $commit = (& git rev-parse --short HEAD 2>$null) } catch { }
finally { Pop-Location }

[ordered] @{
    vencordVersion = $version
    vencordCommit  = $commit
    plugin         = $PluginName
    builtAt        = (Get-Date).ToString("s")
} | ConvertTo-Json | Set-Content (Join-Path (Split-Path $prebuilt -Parent) "build-info.json") -Encoding UTF8

$size = "{0:N1} MB" -f ((Get-ChildItem $prebuilt -File | Measure-Object Length -Sum).Sum / 1MB)
Write-Host "prebuilt\dist refreshed from Vencord $version ($size)"
exit 0
