# ============================================================
# 标准打包脚本 — 统一构建并打包 coze-deploy-vXX.zip
#
# v34/v36 结构（也是当前标准结构）：
#   coze-deploy-vXX.zip
#   |-- .env.production
#   |-- next.config.js
#   |-- package.json
#   |-- pnpm-lock.yaml
#   |-- dist/
#   |   `-- server.js
#   `-- .next/
#       |-- static/...           (静态资源)
#       |-- server/...           (服务端页面)
#       |-- build/...            (构建产物)
#       `-- ...                  (不含 cache/、diagnostics/)
#
# 部署命令：
#   rm -rf .next dist
#   unzip -o coze-deploy-vXX.zip
#   pnpm install --production
#   PORT=5000 node dist/server.js
#
# 用法：
#   .\scripts\package.ps1                # 仅打包（使用已有构建产物）
#   .\scripts\package.ps1 -Build         # 先构建再打包
#   .\scripts\package.ps1 -Version v37   # 指定版本号
#   .\scripts\package.ps1 -Build -Version v37 -SkipInstall
# ============================================================

param(
    [string]$Version = "v36",
    [switch]$Build,           # 是否执行构建步骤
    [switch]$SkipInstall      # 搭配 -Build 使用时跳过 pnpm install
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $ProjectRoot

$ZipName = "coze-deploy-$Version.zip"
$TmpDir = Join-Path $ProjectRoot "_tmp_deploy_pkg"

function Write-Step {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Cyan
}

# ============================================================
# Step 0: Build (if -Build flag is set)
# ============================================================
if ($Build) {
    if (-not $SkipInstall) {
        Write-Step "[0a/0c] Installing dependencies ..."
        $env:CI = "true"
        pnpm install --prefer-frozen-lockfile --prefer-offline
        if ($LASTEXITCODE -ne 0) { Write-Error "pnpm install failed"; exit 1 }
    }

    Write-Step "[0b/0c] Building Next.js ..."
    pnpm next build
    if ($LASTEXITCODE -ne 0) { Write-Error "next build failed"; exit 1 }

    Write-Step "[0c/0c] Building server.ts (tsup) ..."
    pnpm tsup src/server.ts --format cjs --platform node --target node20 --outDir dist --no-splitting --no-minify
    if ($LASTEXITCODE -ne 0) { Write-Error "tsup build failed"; exit 1 }

    Write-Host "  Build complete." -ForegroundColor Green
}

# ============================================================
# Step 1: Verify build artifacts exist
# ============================================================
$required = @(
    @{ Path = ".next"; Desc = ".next/ directory (Next.js build)" },
    @{ Path = "dist\server.js"; Desc = "dist/server.js (custom server)" },
    @{ Path = "package.json"; Desc = "package.json" },
    @{ Path = "pnpm-lock.yaml"; Desc = "pnpm-lock.yaml" },
    @{ Path = "next.config.js"; Desc = "next.config.js" }
)

foreach ($item in $required) {
    if (-not (Test-Path $item.Path)) {
        Write-Error "Missing: $($item.Desc) — run with -Build or build manually first."
        exit 1
    }
}

# ============================================================
# Step 2: Setup temp directory (不含 dist/ 子目录，dist/server.js 稍后直接注入 zip)
# ============================================================
Write-Step "[1/5] Preparing temp directory ..."
if (Test-Path $TmpDir) { Remove-Item $TmpDir -Recurse -Force }
New-Item -ItemType Directory -Path $TmpDir | Out-Null

# ============================================================
# Step 3: Copy files to temp dir
# ============================================================
Write-Step "[2/5] Copying project files ..."

# 根配置文件
$configFiles = @("package.json", "pnpm-lock.yaml", "next.config.js")
foreach ($f in $configFiles) {
    Copy-Item -Path $f -Destination $TmpDir -Force
    Write-Host "  + $f" -ForegroundColor Gray
}

if (Test-Path ".env.production") {
    Copy-Item -Path ".env.production" -Destination $TmpDir -Force
    Write-Host "  + .env.production" -ForegroundColor Gray
} else {
    Write-Warning "  .env.production not found (will be skipped)"
}

# .next/ (递归复制到临时目录)
Write-Host "  + .next/ (copying ...)" -ForegroundColor Gray
Copy-Item -Path ".next" -Destination (Join-Path $TmpDir ".next") -Recurse -Force

# 注意：dist/server.js 不复制到临时目录，而是稍后直接注入 zip
# 以此避免 .NET Copy-Item → CreateFromDirectory 的竞态条件导致文件丢失

# ============================================================
# Step 4: Clean temp .next/ (移除 cache、diagnostics，保留 source maps)
# ============================================================
Write-Step "[3/5] Cleaning temp .next/ ..."
$tempNext = Join-Path $TmpDir ".next"
foreach ($cleanDir in @("cache", "diagnostics")) {
    $dirPath = Join-Path $tempNext $cleanDir
    if (Test-Path $dirPath) {
        Remove-Item $dirPath -Recurse -Force
        Write-Host "  Removed: .next/$cleanDir/" -ForegroundColor Gray
    }
}
# 保留 source maps (.js.map)，与 v34/v36 一致

# ============================================================
# Step 5: Compress to zip（两步法：先打包 temp dir，再单独注入 dist/server.js）
# ============================================================
Write-Step "[4/5] Compressing main files to $ZipName ..."
$zipFullPath = Join-Path $ProjectRoot $ZipName
if (Test-Path $zipFullPath) { Remove-Item $zipFullPath -Force }

Add-Type -AssemblyName System.IO.Compression.FileSystem

# 第一步：从 temp dir 创建 zip（包含 .next/ + 根配置）
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $TmpDir,
    $zipFullPath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
)

# 第二步：用 Update 模式打开 zip，直接注入 dist/server.js
# （直接读写文件，不走临时目录，彻底避免 Copy-Item 竞态条件）
$serverJsPath = Join-Path $ProjectRoot "dist\server.js"
if (Test-Path $serverJsPath) {
    Write-Step "[5/5] Injecting dist/server.js into archive ..."
    $zip = [System.IO.Compression.ZipFile]::Open($zipFullPath, [System.IO.Compression.ZipArchiveMode]::Update)
    $entry = $zip.CreateEntry("dist/server.js", [System.IO.Compression.CompressionLevel]::Optimal)
    $fs = [System.IO.File]::OpenRead($serverJsPath)
    $es = $entry.Open()
    $fs.CopyTo($es)
    $es.Close()
    $fs.Close()
    $zip.Dispose()
    Write-Host "  + dist/server.js injected" -ForegroundColor Gray
} else {
    Write-Error "dist/server.js not found at $serverJsPath"
}

# ============================================================
# Step 6: Cleanup temp dir
# ============================================================
Remove-Item $TmpDir -Recurse -Force

# ============================================================
# Step 7: Verify & report
# ============================================================
$zipSize = [math]::Round((Get-Item $zipFullPath).Length / 1MB, 2)

# 验证 key files 都在 zip 中
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipFullPath)
$checkFiles = @("dist/server.js", "next.config.js", "package.json", "pnpm-lock.yaml", ".env.production")
$missing = @()
foreach ($f in $checkFiles) {
    if (-not ($zip.Entries | Where-Object { $_.FullName -eq $f })) {
        $missing += $f
    }
}
$totalEntries = $zip.Entries.Count
$zip.Dispose()

if ($missing.Count -gt 0) {
    Write-Warning "Missing files: $($missing -join ', ')"
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Package: $ZipName" -ForegroundColor Green
Write-Host "  Size:    $zipSize MB" -ForegroundColor Green
Write-Host "  Entries: $totalEntries files" -ForegroundColor Green
if ($missing.Count -eq 0) {
    Write-Host "  Status:  All key files verified OK" -ForegroundColor Green
}
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Deploy command:" -ForegroundColor Yellow
Write-Host "  rm -rf .next dist"
Write-Host "  unzip -o $ZipName"
Write-Host "  pnpm install --production"
Write-Host "  PORT=5000 node dist/server.js"
