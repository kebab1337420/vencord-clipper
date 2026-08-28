# Runs the plugin's unit tests.
#
# The tests cover the pure byte-level readers - `boxes.ts` and `mp4.ts` - which
# are the part of the plugin whose bugs produce no message at all, only an
# unreadable file. Everything else in the plugin needs a browser, a canvas or
# Discord's own modules and is not reachable from here.
#
# Node runs the TypeScript directly: nothing here imports from Vencord, so no
# build step and no test framework are involved. Node 22.6 or newer is needed
# for that, and 24 or newer for it to run without a flag.
#
#     .\scripts\test.ps1

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

Push-Location $root
try {
    node --test "tests/*.test.ts"
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
