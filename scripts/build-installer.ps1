# Builds the standalone Windows installer distributed with a Clipper release.
$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
$project = Join-Path $repo "installer\ClipperInstaller.csproj"
$output = Join-Path $repo "release\installer"

if (Test-Path $output) { Remove-Item $output -Recurse -Force }
New-Item -ItemType Directory -Force $output | Out-Null

dotnet publish $project -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
    -o $output

$exe = Join-Path $output "ClipperInstaller.exe"
if (-not (Test-Path $exe)) { throw "Installer build did not produce $exe" }
Write-Host "Installer built: $exe"
