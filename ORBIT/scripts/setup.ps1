$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $projectRoot '.venv/Scripts/python.exe'
Push-Location $projectRoot
try {
    if (-not (Test-Path -LiteralPath $pythonExe)) {
        & python -m venv .venv
        if ($LASTEXITCODE -ne 0) { throw 'Creating the Python environment failed. Python 3.11+ is required.' }
    }
    & $pythonExe -m pip install -r backend/requirements-lock.txt
    if ($LASTEXITCODE -ne 0) { throw 'Installing Python dependencies failed.' }
    & $pythonExe -m pip install --no-deps -e backend
    if ($LASTEXITCODE -ne 0) { throw 'Installing the ORBIT package failed.' }
    & $pythonExe scripts/fetch_ephemeris.py
    if ($LASTEXITCODE -ne 0) { throw 'Preparing the local planetary ephemeris failed.' }
    Push-Location (Join-Path $projectRoot 'frontend')
    try {
        & npm ci
        if ($LASTEXITCODE -ne 0) { throw 'Installing frontend dependencies failed. Node.js 22.13+ is recommended.' }
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Building the frontend failed.' }
    } finally { Pop-Location }
    Write-Host 'ORBIT is ready. Run scripts/start.ps1, then open http://127.0.0.1:8765.'
} finally { Pop-Location }
