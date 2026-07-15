# Package Web project in v35 standalone style
# Output structure:
#   coze-deploy-vXX.zip
#   |-- dist/
#   |   |-- server.js            (tsup bundled custom server)
#   |   |-- node_modules/        (traced minimal deps from standalone)
#   |   `-- .next/               (standalone build, no cache/maps)
#   |-- .env.production
#   |-- next.config.js
#   |-- package.json
#   `-- pnpm-lock.yaml
#
# Start command: PORT=5000 node dist/server.js

param(
    [string]$Version = "v35"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = "d:\wwwroot\CozeZnt\project_20260611_133006\projects"
Set-Location $ProjectRoot

$ZipName = "coze-deploy-$Version.zip"
$TmpDir = Join-Path $ProjectRoot "_tmp_deploy_standalone_$($Version -replace '[^0-9]','')"

# 1. Cleanup old temp dir
if (Test-Path $TmpDir) {
    Remove-Item $TmpDir -Recurse -Force
}

Write-Host "[1/6] Creating dist/ directory ..." -ForegroundColor Cyan
$distDir = Join-Path $TmpDir "dist"
New-Item -ItemType Directory -Path $distDir | Out-Null

# 2. Copy tsup server.js
Write-Host "[2/6] Copying custom server.js ..." -ForegroundColor Cyan
Copy-Item -Path (Join-Path $ProjectRoot "dist\server.js") -Destination $distDir -Force

# 3. Copy standalone node_modules (traced minimal deps)
Write-Host "[3/6] Copying standalone node_modules/ ..." -ForegroundColor Cyan
$standaloneModules = ".next\standalone\node_modules"
if (Test-Path $standaloneModules) {
    Copy-Item -Path $standaloneModules -Destination $distDir -Recurse -Force
} else {
    Write-Error "standalone node_modules not found at $standaloneModules"
    exit 1
}

# 4. Copy standalone .next/ (already cleaned by Next.js standalone mode)
Write-Host "[4/6] Copying standalone .next/ ..." -ForegroundColor Cyan
$standaloneNext = ".next\standalone\.next"
if (Test-Path $standaloneNext) {
    Copy-Item -Path $standaloneNext -Destination $distDir -Recurse -Force

    # Extra cleanup: remove any leftover source maps and cache
    $distNext = Join-Path $distDir ".next"
    Get-ChildItem $distNext -Recurse -Filter "*.js.map" -ErrorAction SilentlyContinue | Remove-Item -Force
    $cacheDir = Join-Path $distNext "cache"
    if (Test-Path $cacheDir) { Remove-Item $cacheDir -Recurse -Force }
    $diagDir = Join-Path $distNext "diagnostics"
    if (Test-Path $diagDir) { Remove-Item $diagDir -Recurse -Force }
} else {
    Write-Error "standalone .next not found at $standaloneNext"
    exit 1
}

# 5. Copy root configs (NOT .next/ from root!)
Write-Host "[5/6] Copying root configs ..." -ForegroundColor Cyan
Copy-Item -Path "package.json" -Destination $TmpDir -Force
Copy-Item -Path "pnpm-lock.yaml" -Destination $TmpDir -Force
Copy-Item -Path "next.config.js" -Destination $TmpDir -Force
if (Test-Path ".env.production") {
    Copy-Item -Path ".env.production" -Destination $TmpDir -Force
} else {
    Write-Warning ".env.production not found"
}

# 6. Zip
Write-Host "[6/6] Compressing to $ZipName ..." -ForegroundColor Cyan
if (Test-Path $ZipName) { Remove-Item $ZipName -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($TmpDir, $ZipName, [System.IO.Compression.CompressionLevel]::Optimal, $false)

# Cleanup temp dir
Remove-Item $TmpDir -Recurse -Force

# Show result
$Size = (Get-Item $ZipName).Length
$SizeMB = [math]::Round($Size / 1MB, 2)
Write-Host "Done: $ZipName ($SizeMB MB)" -ForegroundColor Green
Write-Host "Start command: PORT=5000 node dist/server.js" -ForegroundColor Yellow
