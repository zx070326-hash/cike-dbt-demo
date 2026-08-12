param(
  [int]$Port = 3100
)

$ErrorActionPreference = "Stop"
$runtimeDir = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "CikeDbtDemo"
$statusPath = Join-Path $runtimeDir "tunnel-status.json"

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

$stopped = @(
  Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -match "\btunnel\b" -and
      $_.CommandLine -match "localhost:$Port"
    } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      $_.ProcessId
    }
)

[ordered]@{
  state = "stopped"
  port = $Port
  stoppedProcessIds = $stopped
  updatedAt = [DateTimeOffset]::Now.ToString("o")
} | ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding utf8
