$ProjectDir = $PSScriptRoot
$ArchivePath = Join-Path $ProjectDir "next-build.zip"
$TempDir = Join-Path $ProjectDir "temp-next"

# Clean
if (Test-Path $ArchivePath) { Remove-Item $ArchivePath -Force }
if (Test-Path $TempDir) { Remove-Item $TempDir -Recurse -Force }

# Copy .next directory
Write-Host "Copying .next directory..."
robocopy (Join-Path $ProjectDir ".next") (Join-Path $TempDir ".next") /E /NFL /NDL /NJH /NJS /nc /ns /np

# Copy updated next.config.ts
Copy-Item (Join-Path $ProjectDir "next.config.ts") (Join-Path $TempDir "next.config.ts") -Force

# Copy public
robocopy (Join-Path $ProjectDir "public") (Join-Path $TempDir "public") /E /NFL /NDL /NJH /NJS /nc /ns /np

# Compress
Write-Host "Compressing..."
Compress-Archive -Path "$TempDir\*" -DestinationPath $ArchivePath -Force

# Clean
Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue

$size = [math]::Round((Get-Item $ArchivePath).Length / 1MB, 2)
Write-Host "Build package: $size MB"
Write-Host "Ready to upload: $ArchivePath"
