# Restart the Stratum backend on :8642 (dev helper). Usage: powershell -File scripts/restart-backend.ps1 [-Home D:\stratum\test-data]
param([string]$DataHome = "D:\stratum\test-data", [string]$Compose = "")

$root = Split-Path $PSScriptRoot -Parent
$listener = Get-NetTCPConnection -State Listen -LocalPort 8642 -ErrorAction SilentlyContinue
if ($listener) { Stop-Process -Id $listener.OwningProcess -Force; Start-Sleep 1 }

$env:STRATUM_HOME = $DataHome
$env:HF_HOME = "D:\stratum\hf"
$env:UV_CACHE_DIR = "D:\stratum\uv-cache"
if ($Compose) { $env:STRATUM_COMPOSE = $Compose }
New-Item -ItemType Directory -Force "D:\stratum\logs" | Out-Null
Start-Process -FilePath "D:\stratum\venv\Scripts\python.exe" `
  -ArgumentList "-m", "uvicorn", "stratum.api:app", "--host", "127.0.0.1", "--port", "8642" `
  -WorkingDirectory (Join-Path $root "backend") `
  -RedirectStandardOutput "D:\stratum\logs\backend.out.log" -RedirectStandardError "D:\stratum\logs\backend.err.log" -WindowStyle Hidden

for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try { $h = Invoke-RestMethod http://127.0.0.1:8642/v1/health -TimeoutSec 2; "backend up: $($h.documents) docs, $($h.facts.total) facts"; exit 0 } catch {}
}
"backend did not come up - see D:\stratum\logs\backend.err.log"; exit 1
