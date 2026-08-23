# Undoes what install-prebuilt.ps1 did: unpatches Discord and unsets Vesktop's
# Vencord Location. The bundle in %APPDATA%\Vencord\clipper is removed too.
#
# Vencord settings (%APPDATA%\Vencord\settings) are left alone.

param(
    [string] $InstallDir = (Join-Path $env:APPDATA "Vencord\clipper"),
    [switch] $KeepBundle
)

$ErrorActionPreference = "Stop"

$restored = 0

# ---- Discord -----------------------------------------------------------------
$roots = @(
    "$env:LOCALAPPDATA\Discord",
    "$env:LOCALAPPDATA\DiscordPTB",
    "$env:LOCALAPPDATA\DiscordCanary",
    "$env:LOCALAPPDATA\DiscordDevelopment"
) | Where-Object { Test-Path $_ }

foreach ($root in $roots) {
    $name = Split-Path $root -Leaf

    if (Get-Process | Where-Object { $_.Path -like "$root\*" }) {
        Write-Host "      [!] $name is running - close it and run this again."
        continue
    }

    foreach ($appDir in (Get-ChildItem $root -Directory -Filter "app-*")) {
        $resources = Join-Path $appDir.FullName "resources"
        $asar = Join-Path $resources "app.asar"
        $original = Join-Path $resources "_app.asar"

        if (-not (Test-Path $original)) { continue }

        # Only remove app.asar when it is the patch stub, never a real bundle.
        if (Test-Path $asar) {
            if ((Get-Item $asar).Length -ge 4096) {
                Write-Host "      $name looks unpatched already, leaving it alone."
                continue
            }
            Remove-Item $asar -Force
        }

        Move-Item $original $asar -Force
        Write-Host "      $name unpatched."
        $restored++
    }
}

# ---- Vesktop -----------------------------------------------------------------
$dist = Join-Path $InstallDir "dist"

$dataDirs = @("vesktop", "Vesktop", "equibop", "Equibop") |
    ForEach-Object { Join-Path $env:APPDATA $_ } |
    Where-Object { Test-Path $_ } |
    Sort-Object -Unique

if ($dataDirs -and (Get-Process -Name "Vesktop", "Equibop" -ErrorAction SilentlyContinue)) {
    Write-Host "      [!] Vesktop is running - close it and run this again."
} else {
    foreach ($dir in $dataDirs) {
        $stateFile = Join-Path $dir "state.json"
        if (-not (Test-Path $stateFile)) { continue }

        try {
            $state = Get-Content $stateFile -Raw | ConvertFrom-Json
        } catch { continue }

        if ($state.vencordDir -ne $dist) { continue }

        $state.PSObject.Properties.Remove("vencordDir")
        $state | ConvertTo-Json -Depth 20 | Set-Content $stateFile -Encoding UTF8
        Write-Host "      Vencord Location cleared ($dir) - Vesktop falls back to its own Vencord."
        $restored++
    }
}

# ---- bundle ------------------------------------------------------------------
if (-not $KeepBundle -and (Test-Path $InstallDir)) {
    Remove-Item $InstallDir -Recurse -Force
    Write-Host "      Removed $InstallDir"
}

if ($restored -eq 0) {
    Write-Host "      Nothing to undo."
}

exit 0
