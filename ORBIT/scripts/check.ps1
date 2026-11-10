param([switch]$Browser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $projectRoot '.venv/Scripts/python.exe'
Push-Location $projectRoot
try {
    & $pythonExe -m pytest backend/tests -q
    if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed.' }
    Push-Location (Join-Path $projectRoot 'frontend')
    try {
        & npm test
        if ($LASTEXITCODE -ne 0) { throw 'Frontend unit tests failed.' }
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
        if ($Browser) {
            # Start scripts/start.ps1 in another terminal before this check.
            $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $projectRoot '.cache/ms-playwright'
            & npx playwright install chromium
            if ($LASTEXITCODE -ne 0) { throw 'Browser installation failed.' }
            & npm run test:e2e
            if ($LASTEXITCODE -ne 0) { throw 'Browser tests failed.' }
        }
    } finally { Pop-Location }
} finally { Pop-Location }
