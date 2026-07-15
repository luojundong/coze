# Package Web project in v27 style
# Output structure:
#   coze-deploy-vXX.zip
#   |-- .next/                 Next.js build (static + server, with source maps)
#   |-- dist/
#   |   `-- server.js          tsup bundled server.ts
#   |-- package.json
#   |-- pnpm-lock.yaml
#   |-- next.config.js
#   `-- .env.production

param(
    [string]$Version = "v32"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = "d:\wwwroot\CozeZnt\project_20260611_133006\projects"
Set-Location $ProjectRoot

$ZipName = "coze-deploy-$Version.zip"
$TmpDir = Join-Path $ProjectRoot "_tmp_deploy_$($Version -replace '[^0-9]','')"

# 1. Setup temp dir
if (Test-Path $TmpDir) {
    Remove-Item $TmpDir -Recurse -Force
}
New-Item -ItemType Directory -Path $TmpDir | Out-Null

# 2. Copy .next/ to temp dir first (keep original intact)
Write-Host "[1/5] Copying .next/ to temp dir ..." -ForegroundColor Cyan
Copy-Item -Path ".next" -Destination (Join-Path $TmpDir ".next") -Recurse -Force

# 3. Clean cache & diagnostics only (KEEP source maps, matching v34 behavior)
Write-Host "[2/5] Cleaning .next/ (cache, diagnostics only) ..." -ForegroundColor Cyan
$nextDir = Join-Path $TmpDir ".next"

# Remove cache & diagnostics dirs
foreach ($dirName in @("cache", "diagnostics")) {
    $dirPath = Join-Path $nextDir $dirName
    if (Test-Path $dirPath) { Remove-Item $dirPath -Recurse -Force }
}

Write-Host "  Source maps preserved (matching v34 approach)" -ForegroundColor Gray





# 4. Copy configs to temp dir (NOT dist/server.js — added separately after zip)
Write-Host "[3/5] Copying configs ..." -ForegroundColor Cyan
Copy-Item -Path "package.json" -Destination $TmpDir -Force
Copy-Item -Path "pnpm-lock.yaml" -Destination $TmpDir -Force
Copy-Item -Path "next.config.js" -Destination $TmpDir -Force
if (Test-Path ".env.production") {
    Copy-Item -Path ".env.production" -Destination $TmpDir -Force
} else {
    Write-Warning ".env.production not found"
}

# 5. Show temp dir size
Write-Host "[4/5] Calculating package size ..." -ForegroundColor Cyan
$tmpSize = (Get-ChildItem $TmpDir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("  Uncompressed size: {0:N2} MB" -f $tmpSize) -ForegroundColor Gray

# 6. Zip configs + .next first, then add dist/server.js separately
# (ZipFile::CreateFromDirectory + CreateEntry avoids a PowerShell Copy-Item race condition
#  that sometimes drops dist/server.js from the archive)
Write-Host "[5/5] Compressing to $ZipName ..." -ForegroundColor Cyan
if (Test-Path $ZipName) { Remove-Item $ZipName -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($TmpDir, $ZipName, [System.IO.Compression.CompressionLevel]::Optimal, $false)

# Add dist/server.js to the zip
$serverJsPath = Join-Path $ProjectRoot "dist\server.js"
if (Test-Path $serverJsPath) {
    $zip = [System.IO.Compression.ZipFile]::Open($ZipName, [System.IO.Compression.ZipArchiveMode]::Update)
    $entry = $zip.CreateEntry("dist/server.js", [System.IO.Compression.CompressionLevel]::Optimal)
    $fs = [System.IO.File]::OpenRead($serverJsPath)
    $es = $entry.Open()
    $fs.CopyTo($es)
    $es.Close()
    $fs.Close()
    $zip.Dispose()
    Write-Host "  + dist/server.js ($([math]::Round((Get-Item $serverJsPath).Length / 1KB, 2)) KB)" -ForegroundColor Gray
} else {
    Write-Error "dist/server.js not found at $serverJsPath"
}

# 7. Cleanup temp dir
Remove-Item $TmpDir -Recurse -Force

# 8. Show result
$Size = (Get-Item $ZipName).Length
$SizeMB = [math]::Round($Size / 1MB, 2)
Write-Host "Done: $ZipName ($SizeMB MB)" -ForegroundColor Green
Write-Host "Start command: PORT=5000 node dist/server.js" -ForegroundColor Yellow
