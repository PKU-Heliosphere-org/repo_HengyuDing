param([int]$Port = 8765, [switch]$OpenBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $projectRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) { throw 'Run scripts/setup.ps1 first to create the ORBIT environment.' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'frontend/dist/index.html'))) { throw 'Frontend is not built. Run scripts/setup.ps1 or npm run build in frontend.' }
Push-Location $projectRoot
try {
    Write-Host "ORBIT: http://127.0.0.1:$Port (Ctrl+C to stop)"
    if ($OpenBrowser) { Start-Process "http://127.0.0.1:$Port" }
    & $pythonExe -m uvicorn orbit.app:app --host 127.0.0.1 --port $Port
    if ($LASTEXITCODE -ne 0) { throw 'ORBIT server exited with an error.' }
} finally { Pop-Location }
