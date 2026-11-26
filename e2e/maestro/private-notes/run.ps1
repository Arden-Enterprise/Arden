<#
.SYNOPSIS
  Runs the Private Notes Maestro web flows against a local signed-in test stack.

.DESCRIPTION
  Sets JAVA_HOME and PATH for this process only (no system or user environment
  change) and runs `maestro test`. The web dev server must already be serving
  http://127.0.0.1:5180 (`pnpm dev:web`), with the API in local Mainflow 1 test
  mode on a disposable arden_test_* database. The synthetic account and its
  organization come from -Email/-Password/-Organization or ARDEN_E2E_EMAIL,
  ARDEN_E2E_PASSWORD and ARDEN_E2E_ORGANIZATION.

.EXAMPLE
  pwsh -File e2e/maestro/private-notes/run.ps1                 # all feature flows
  pwsh -File e2e/maestro/private-notes/run.ps1 -Target smoke   # harness smoke check
  pwsh -File e2e/maestro/private-notes/run.ps1 -Target 06-trash-and-restore.yaml
  pwsh -File e2e/maestro/private-notes/run.ps1 -CheckSyntax
#>
[CmdletBinding()]
param(
  # Flow file or directory, relative to this folder. Default: the whole folder.
  [string]$Target = ".",
  [switch]$CheckSyntax,
  [string]$MaestroPath = $(if ($env:MAESTRO_BIN) { $env:MAESTRO_BIN } else { "maestro" }),
  [string]$JavaHome = $env:MAESTRO_JAVA_HOME,
  [string]$BaseUrl = "http://127.0.0.1:5180",
  [string]$Email = $env:ARDEN_E2E_EMAIL,
  [string]$Password = $env:ARDEN_E2E_PASSWORD,
  [string]$Organization = $env:ARDEN_E2E_ORGANIZATION
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot

if ($JavaHome) {
  # Process scope only.
  $env:JAVA_HOME = $JavaHome
  $env:PATH = (Join-Path $JavaHome "bin") + [IO.Path]::PathSeparator + $env:PATH
}

if (-not (Get-Command $MaestroPath -ErrorAction SilentlyContinue)) {
  throw "Maestro CLI not found ('$MaestroPath'). Install Maestro 2.12+ or pass -MaestroPath / set MAESTRO_BIN."
}

if ($CheckSyntax) {
  $failed = 0
  Get-ChildItem -Path $here -Recurse -Filter *.yaml | Where-Object Name -ne "config.yaml" | ForEach-Object {
    & $MaestroPath check-syntax $_.FullName | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host "FAIL $($_.FullName)"; $failed++ } else { Write-Host "ok   $($_.Name)" }
  }
  exit $failed
}

try {
  Invoke-WebRequest -Uri $BaseUrl -UseBasicParsing -TimeoutSec 5 | Out-Null
} catch {
  throw "The web app is not reachable at $BaseUrl. Start it first: pnpm dev:web"
}

if (-not $Email -or -not $Password -or -not $Organization) {
  throw "Set ARDEN_E2E_EMAIL, ARDEN_E2E_PASSWORD and ARDEN_E2E_ORGANIZATION (or pass -Email, -Password, -Organization) for a synthetic local test account."
}

$path = Join-Path $here $Target
& $MaestroPath test -e "ARDEN_E2E_EMAIL=$Email" -e "ARDEN_E2E_PASSWORD=$Password" -e "ARDEN_E2E_ORGANIZATION=$Organization" $path
exit $LASTEXITCODE
