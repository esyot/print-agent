# scripts/pack-windows.ps1
# Usage:  $env:VERSION="1.0.0"; .\scripts\pack-windows.ps1
param(
  [string]$Version = $env:VERSION
)
if (-not $Version) { throw "Set `$env:VERSION or pass -Version" }

$dist = Join-Path $PSScriptRoot "..\dist"
$iss  = Join-Path $PSScriptRoot "..\installer\windows.iss"

if (-not (Test-Path "$dist\print-agent-$Version-win-x64.exe")) {
  Write-Error "Missing win-x64 binary in dist/. Run 'npm run build:win-x64' first."
}
if (-not (Test-Path "$dist\print-agent-$Version-win-x86.exe")) {
  Write-Warning "Missing win-x86 binary; installer will only cover 64-bit."
}

# Inno Setup must be in PATH or at the default location
$iscc = "iscc.exe"
if (-not (Get-Command $iscc -ErrorAction SilentlyContinue)) {
  $candidates = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
  )
  $found = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $found) { throw "Inno Setup (ISCC.exe) not found" }
  $iscc = $found
}

& $iscc $iss
Write-Host "✅ Installer written to installer\Output\"