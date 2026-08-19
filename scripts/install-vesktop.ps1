# Points every Vesktop install at a Vencord build, so a userplugin built into
# that repo is actually loaded.
#
# Vesktop ships its own prebuilt Vencord and only loads another one when its
# "Vencord Location" is set. That lives in state.json next to its settings, under
# the "vencordDir" key, and must point at the repo's dist folder.
#
# Exit codes: 0 = pointed at least one install (or nothing to do), 1 = failed.

param(
    [Parameter(Mandatory = $true)][string] $VencordDir
)

$ErrorActionPreference = "Stop"

$dist = Join-Path $VencordDir "dist"
$mainFile = Join-Path $dist "vencordDesktopMain.js"

if (-not (Test-Path $mainFile)) {
    Write-Host "[ERROR] $mainFile is missing - build Vencord first."
    exit 1
}

# Vesktop and its forks each keep their own data directory.
$dataDirs = @(
    (Join-Path $env:APPDATA "vesktop"),
    (Join-Path $env:APPDATA "Vesktop"),
    (Join-Path $env:APPDATA "equibop"),
    (Join-Path $env:APPDATA "Equibop")
) | Where-Object { Test-Path $_ } | Sort-Object -Unique

if ($dataDirs.Count -eq 0) {
    Write-Host "      No Vesktop install found, skipping."
    exit 0
}

# Vesktop rewrites state.json when it exits, which would undo the change.
$running = Get-Process -Name "Vesktop", "Equibop" -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "[ERROR] Vesktop is running. Close it completely (check the tray) and run this again,"
    Write-Host "        otherwise it overwrites the setting when it exits."
    exit 1
}

$pointed = 0

foreach ($dir in $dataDirs) {
    $stateFile = Join-Path $dir "state.json"

    $state = [ordered] @{}
    if (Test-Path $stateFile) {
        try {
            $raw = Get-Content $stateFile -Raw
            if ($raw.Trim()) {
                $parsed = $raw | ConvertFrom-Json
                foreach ($prop in $parsed.PSObject.Properties) { $state[$prop.Name] = $prop.Value }
            }
        } catch {
            Write-Host "      [!] $stateFile is not readable JSON, it will be replaced (backup kept)."
        }

        Copy-Item $stateFile "$stateFile.bak" -Force
    }

    if ($state["vencordDir"] -eq $dist) {
        Write-Host "      Already pointed at $dist ($dir)"
        $pointed++
        continue
    }

    $state["vencordDir"] = $dist

    try {
        $json = [PSCustomObject] $state | ConvertTo-Json -Depth 20
        Set-Content -Path $stateFile -Value $json -Encoding UTF8
        Write-Host "      Vencord Location set to $dist ($dir)"
        $pointed++
    } catch {
        Write-Host "[ERROR] Could not write $stateFile - $($_.Exception.Message)"
    }
}

if ($pointed -eq 0) { exit 1 }
exit 0
