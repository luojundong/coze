# ==========================================
# 扣子智能体中转平台 - 自动部署脚本 v2
# ==========================================

$ServerIP = "39.107.192.68"
$ServerUser = "root"
$ServerPassword = "zxcvbnm,./1"
$RemoteDir = "/www/wwwroot/coze-workflow-platform"
$ProjectDir = $PSScriptRoot

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " 扣子智能体中转平台 - 自动部署" -ForegroundColor Cyan
Write-Host " 目标: ${ServerUser}@${ServerIP}" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# ========== Step 1: 打包 ==========
Write-Host "`n[1/3] 打包项目代码..." -ForegroundColor Yellow

$ArchivePath = "$env:TEMP\coze-workflow-deploy.zip"
if (Test-Path $ArchivePath) { Remove-Item $ArchivePath -Force }

$TempDeployDir = "$env:TEMP\coze-deploy-temp"
if (Test-Path $TempDeployDir) { Remove-Item $TempDeployDir -Recurse -Force }
New-Item -ItemType Directory -Path $TempDeployDir -Force | Out-Null

Write-Host "  复制文件..." -ForegroundColor Gray
robocopy $ProjectDir $TempDeployDir /E /NFL /NDL /NJH /NJS /nc /ns /np `
    /XD node_modules .next dist .git .codebuddy generated-images > $null 2>&1

Write-Host "  压缩中..." -ForegroundColor Gray
Compress-Archive -Path "$TempDeployDir\*" -DestinationPath $ArchivePath -Force
Remove-Item $TempDeployDir -Recurse -Force -ErrorAction SilentlyContinue

$ArchiveSize = [math]::Round((Get-Item $ArchivePath).Length / 1MB, 2)
Write-Host "  打包完成: ${ArchiveSize}MB" -ForegroundColor Green

# ========== Step 2: 上传 ==========
Write-Host "`n[2/3] 上传到服务器..." -ForegroundColor Yellow
Write-Host "  密码: ${ServerPassword}" -ForegroundColor Gray
scp -o StrictHostKeyChecking=no $ArchivePath ${ServerUser}@${ServerIP}:/tmp/coze-workflow-deploy.zip
Write-Host "  上传完成!" -ForegroundColor Green

# ========== Step 3: 远程部署(合并所有步骤) ==========
Write-Host "`n[3/3] 远程部署（安装环境+构建+启动+配置Nginx）..." -ForegroundColor Yellow
Write-Host "  密码: ${ServerPassword}" -ForegroundColor Gray

# 生成远程执行脚本
$RemoteScript = @'
#!/bin/bash
set -e

echo "========================================="
echo " 远程部署开始"
echo "========================================="

# ---------- 1. 解压代码 ----------
echo ""
echo ">>> [1/6] 解压项目代码..."
mkdir -p /www/wwwroot/coze-workflow-platform
cd /www/wwwroot/coze-workflow-platform
unzip -o /tmp/coze-workflow-deploy.zip -d /www/wwwroot/coze-workflow-platform/ 2>&1 | tail -5
rm -f /tmp/coze-workflow-deploy.zip

# ---------- 2. 安装 Node.js ----------
echo ""
echo ">>> [2/6] 检查 Node.js..."
if ! command -v node &> /dev/null; then
    echo "安装 Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>&1 | tail -3
    apt-get install -y nodejs 2>&1 | tail -3
fi
echo "Node.js: $(node --version)"

# ---------- 3. 安装 pnpm/PM2/Nginx ----------
echo ""
echo ">>> [3/6] 检查工具链..."

if ! command -v pnpm &> /dev/null; then
    echo "安装 pnpm..."
    npm install -g pnpm 2>&1 | tail -3
fi
echo "pnpm: $(pnpm --version)"

if ! command -v pm2 &> /dev/null; then
    echo "安装 PM2..."
    npm install -g pm2 2>&1 | tail -3
fi
echo "PM2: $(pm2 --version)"

if ! command -v nginx &> /dev/null; then
    echo "安装 Nginx..."
    apt-get update -qq && apt-get install -y nginx 2>&1 | tail -3
fi
echo "Nginx: $(nginx -v 2>&1)"

# ---------- 4. 安装依赖 + 构建 ----------
echo ""
echo ">>> [4/6] 安装依赖并构建..."
cd /www/wwwroot/coze-workflow-platform
pnpm install --prefer-frozen-lockfile 2>&1 | tail -5
pnpm build 2>&1 | tail -10
echo "构建完成!"

# ---------- 5. 配置环境变量 + 启动 PM2 ----------
echo ""
echo ">>> [5/6] 配置环境变量并启动服务..."

cd /www/wwwroot/coze-workflow-platform

# 创建日志目录
mkdir -p logs

# 创建 .env.production（如果不存在）
if [ ! -f .env.production ]; then
    cat > .env.production << 'ENVEOF'
# ========== Supabase 配置 ==========
COZE_SUPABASE_URL=https://your-project.supabase.co
COZE_SUPABASE_ANON_KEY=your-anon-key
COZE_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# ========== Coze OAuth 配置 ==========
COZE_CLIENT_ID=your-coze-client-id
COZE_CLIENT_SECRET=your-coze-client-secret

# ========== 加密密钥 ==========
ENCRYPTION_SECRET=your-production-encryption-secret-at-least-32-chars

# ========== 管理员配置 ==========
ADMIN_USER_IDS=

# ========== 域名配置 ==========
COZE_PROJECT_DOMAIN_DEFAULT=http://39.107.192.68

# ========== 环境 ==========
COZE_PROJECT_ENV=PROD

# ========== Coze API ==========
COZE_API_BASE_URL=https://api.coze.cn
COZE_WORKLOAD_API_TOKEN=

# ========== 服务端口 ==========
PORT=5000
ENVEOF
    echo ".env.production 已创建（请编辑填入实际配置）"
else
    echo ".env.production 已存在，跳过"
fi

# 停止旧服务
pm2 delete coze-workflow 2>/dev/null || true

# 启动服务
echo "启动 PM2 服务..."
NODE_ENV=production PORT=5000 pm2 start dist/server.js \
    --name "coze-workflow" \
    --log /www/wwwroot/coze-workflow-platform/logs/pm2.log

pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo ""
echo "PM2 服务状态:"
pm2 status

# ---------- 6. 配置 Nginx ----------
echo ""
echo ">>> [6/6] 配置 Nginx 反向代理..."

cat > /etc/nginx/conf.d/coze-workflow.conf << 'NGXCONF'
server {
    listen 80;
    server_name 39.107.192.68;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }

    location /_next/static/ {
        proxy_pass http://127.0.0.1:5000;
        expires 365d;
        add_header Cache-Control "public, immutable";
    }

    client_max_body_size 50m;
}
NGXCONF

# 清理默认配置
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
rm -f /etc/nginx/conf.d/default.conf 2>/dev/null || true

nginx -t && systemctl reload nginx && echo "Nginx 配置完成!"

echo ""
echo "========================================="
echo " 远程部署完成!"
echo " 访问: http://39.107.192.68"
echo "========================================="
'@

# 保存远程脚本并上传执行
$RemoteScriptPath = "$env:TEMP\remote-deploy.sh"
$RemoteScript | Out-File -FilePath $RemoteScriptPath -Encoding ASCII -NoNewline

scp -o StrictHostKeyChecking=no $RemoteScriptPath ${ServerUser}@${ServerIP}:/tmp/remote-deploy.sh
ssh -o StrictHostKeyChecking=no ${ServerUser}@${ServerIP} "bash /tmp/remote-deploy.sh"

# ========== 清理 ==========
Remove-Item $ArchivePath -Force -ErrorAction SilentlyContinue
Remove-Item $RemoteScriptPath -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host " 部署完成! 访问: http://39.107.192.68" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "下一步:" -ForegroundColor Yellow
Write-Host " 1. 编辑环境变量:" -ForegroundColor White
Write-Host "    ssh root@39.107.192.68" -ForegroundColor Gray
Write-Host "    vi /www/wwwroot/coze-workflow-platform/.env.production" -ForegroundColor Gray
Write-Host " 2. 重启服务: pm2 restart coze-workflow" -ForegroundColor Gray
Write-Host " 3. 查看日志: pm2 logs coze-workflow" -ForegroundColor Gray
