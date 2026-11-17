param(
  [string]$Dest = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$skill = Split-Path -Parent $PSScriptRoot
if (-not $Dest) {
  $repo = Split-Path -Parent (Split-Path -Parent $skill)
  $Dest = Join-Path $repo ".trae\skills"
}

$target = Join-Path $Dest "e2e-flow-author"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null

if (Test-Path $target) {
  if (-not $Force) { throw "Target exists: $target (use -Force to overwrite)" }
  Remove-Item -Recurse -Force $target
}

Copy-Item -Recurse -Force $skill $target
Write-Host "installed -> $target"
