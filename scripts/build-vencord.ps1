# Builds Vencord, quarantining third-party userplugins that break the build.
#
# esbuild aborts the whole bundle on the first broken plugin, so a single stale
# plugin blocks every other one. Offenders named in the error output are moved
# to <Vencord>\userplugins-disabled (nothing is deleted) and the build retried.

param(
    [Parameter(Mandatory = $true)][string] $VencordDir,
    [string] $KeepPlugin = "Clipper",
    [int] $MaxAttempts = 5
)

# esbuild writes progress to stderr; do not let PowerShell turn that into a terminating error
$ErrorActionPreference = "Continue"

$userplugins = Join-Path $VencordDir "src\userplugins"
$quarantine = Join-Path $VencordDir "userplugins-disabled"

function Get-OffendingPlugins([string] $buildOutput) {
    $names = [System.Collections.Generic.HashSet[string]]::new()

    foreach ($m in [regex]::Matches($buildOutput, 'src[\\/]userplugins[\\/]([^\\/:\s]+)')) {
        $name = $m.Groups[1].Value
        if ($name -ne $KeepPlugin) { [void] $names.Add($name) }
    }

    return $names
}

Push-Location $VencordDir
try {
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        Write-Host "      build attempt $attempt..."
        $output = & cmd /c "pnpm build 2>&1" | Out-String
        Write-Host $output

        if ($LASTEXITCODE -eq 0) { exit 0 }

        $offenders = Get-OffendingPlugins $output
        if ($offenders.Count -eq 0) {
            Write-Host "[ERROR] Build failed, and no third-party userplugin is named in the errors."
            exit 1
        }

        New-Item -ItemType Directory -Force $quarantine | Out-Null
        foreach ($name in $offenders) {
            $src = Join-Path $userplugins $name
            if (-not (Test-Path $src)) { continue }

            $dest = Join-Path $quarantine $name
            if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
            Move-Item $src $dest -Force

            Write-Host "      [!] '$name' breaks the build - moved to userplugins-disabled\$name"
        }
    }

    Write-Host "[ERROR] Still failing after $MaxAttempts attempts."
    exit 1
} finally {
    Pop-Location
}
