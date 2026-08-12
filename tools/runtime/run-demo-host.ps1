param(
  [int]$Port = 3100,
  [DateTimeOffset]$ExpiresAt = [DateTimeOffset]::Parse("2026-08-15T14:10:00.000Z")
)

$ErrorActionPreference = "Stop"
$projectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$runtimeDir = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "CikeDbtDemo"
$statusPath = Join-Path $runtimeDir "host-status.json"
$healthUrl = "http://localhost:$Port/api/knowledge/status"

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

function Get-DemoListener {
  Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1
}

function Stop-ProcessTree([int]$ProcessId) {
  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
  foreach ($child in $children) {
    Stop-ProcessTree -ProcessId $child.ProcessId
  }

  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Write-HostStatus([string]$State, [string]$Detail = "") {
  [ordered]@{
    state = $State
    detail = $Detail
    port = $Port
    expiresAt = $ExpiresAt.ToUniversalTime().ToString("o")
    updatedAt = [DateTimeOffset]::Now.ToString("o")
  } | ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding utf8
}

function Test-DemoHealth {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 20
    return $response.StatusCode -eq 200
  }
  catch {
    return $false
  }
}

function Start-DemoServer {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $stdoutPath = Join-Path $runtimeDir "app-$stamp.out.log"
  $stderrPath = Join-Path $runtimeDir "app-$stamp.err.log"
  $npxPath = (Get-Command npx.cmd -ErrorAction Stop).Source

  $env:DEMO_EXPIRES_AT = $ExpiresAt.ToUniversalTime().ToString("o")
  Start-Process `
    -FilePath $npxPath `
    -ArgumentList @("vinext", "dev", "--port", $Port) `
    -WorkingDirectory $projectDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath | Out-Null

  Write-HostStatus -State "starting"

  $deadline = [DateTimeOffset]::Now.AddSeconds(45)
  while ([DateTimeOffset]::Now -lt $deadline) {
    if (Test-DemoHealth) {
      Write-HostStatus -State "healthy"
      return $true
    }
    Start-Sleep -Seconds 2
  }

  Write-HostStatus -State "unhealthy" -Detail "Startup health check timed out."
  return $false
}

Write-HostStatus -State "watching"

while ([DateTimeOffset]::UtcNow -lt $ExpiresAt.ToUniversalTime()) {
  $listener = Get-DemoListener

  if ($null -eq $listener) {
    Start-DemoServer | Out-Null
  }
  elseif (-not (Test-DemoHealth)) {
    Stop-ProcessTree -ProcessId $listener.OwningProcess
    Start-Sleep -Seconds 2
    Start-DemoServer | Out-Null
  }
  else {
    Write-HostStatus -State "healthy"
  }

  Start-Sleep -Seconds 20
}

$listener = Get-DemoListener
if ($null -ne $listener) {
  Stop-ProcessTree -ProcessId $listener.OwningProcess
}

Write-HostStatus -State "expired" -Detail "The three-day demo window has ended."
