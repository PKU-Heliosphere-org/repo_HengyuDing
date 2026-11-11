param([ValidateRange(0,65535)][int]$Port = 0, [switch]$Browser, [switch]$OpenBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $projectRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) { throw 'Run scripts/setup.ps1 first to create the ORBIT environment.' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'frontend/dist/index.html'))) { throw 'Frontend is not built. Run scripts/setup.ps1 or npm run build in frontend.' }
Push-Location $projectRoot
try {
    if ($Browser -or $OpenBrowser) {
        if (-not $PSBoundParameters.ContainsKey('Port')) { $Port = 8765 }
        Write-Host "ORBIT browser mode: http://127.0.0.1:$Port (Ctrl+C to stop)"
        & $pythonExe -m orbit.desktop --browser --port $Port
    } else {
        Write-Host 'Opening ORBIT desktop window. Close the window to stop this session.'
        & $pythonExe -m orbit.desktop --port $Port
    }
    if ($LASTEXITCODE -ne 0) { throw 'ORBIT exited with an error. See the message above.' }
} finally { Pop-Location }
