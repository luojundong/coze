#!/bin/bash
# ==========================================
# 扣子智能体中转平台 - 自动部署脚本
# 目标服务器: 39.107.192.68
# ==========================================
set -e

SERVER_IP="39.107.192.68"
SERVER_USER="root"
SERVER_PASSWORD="zxcvbnm,./1"
REMOTE_DIR="/www/wwwroot/coze-workflow-platform"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=========================================="
echo " 扣子智能体中转平台 - 自动部署"
echo " 目标: ${SERVER_USER}@${SERVER_IP}"
echo "=========================================="

# Step 1: 检查 SSH 连接
echo ""
echo "[1/6] 测试 SSH 连接..."
sshpass -p "${SERVER_PASSWORD}" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${SERVER_USER}@${SERVER_IP} "echo 'SSH 连接成功'"

# Step 2: 安装环境依赖
echo ""
echo "[2/6] 检查并安装服务器环境..."

sshpass -p "${SERVER_PASSWORD}" ssh -o StrictHostKeyChecking=no ${SERVER_USER}@${SERVER_IP} << 'REMOTE_SETUP'
set -e

# 检测系统
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    OS="unknown"
fi
echo "系统: $OS"

# 安装 Node.js 20+ (如果未安装)
if ! command -v node &> /dev/null; then
    echo "安装 Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
else
    NODE_VERSION=$(node --version)
    echo "Node.js 已安装: $NODE_VERSION"
fi

# 安装 pnpm (如果未安装)
if ! command -v pnpm &> /dev/null; then
    echo "安装 pnpm..."
    npm install -g pnpm
else
    echo "pnpm 已安装: $(pnpm --version)"
fi

# 安装 PM2 (如果未安装)
if ! command -v pm2 &> /dev/null; then
    echo "安装 PM2..."
    npm install -g pm2
else
    echo "PM2 已安装: $(pm2 --version)"
fi

# 安装 Nginx (如果未安装)
if ! command -v nginx &> /dev/null; then
    echo "安装 Nginx..."
    apt-get update && apt-get install -y nginx
else
    echo "Nginx 已安装: $(nginx -v 2>&1)"
fi

# 创建项目目录
mkdir -p /www/wwwroot/coze-workflow-platform

echo "环境准备完成!"
REMOTE_SETUP

# Step 3: 上传项目代码
echo ""
echo "[3/6] 上传项目代码..."

# 排除不需要上传的文件/目录
rsync -avz --delete \
    --exclude 'node_modules' \
    --exclude '.next' \
    --exclude 'dist' \
    --exclude '.git' \
    --exclude '.codebuddy' \
    --exclude 'generated-images' \
    --exclude '.env.local' \
    --exclude '.env.development' \
    -e "sshpass -p '${SERVER_PASSWORD}' ssh -o StrictHostKeyChecking=no" \
    "${PROJECT_DIR}/" \
    ${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/

echo "代码上传完成!"

# Step 4: 安装依赖并构建
echo ""
echo "[4/6] 安装依赖并构建..."

sshpass -p "${SERVER_PASSWORD}" ssh -o StrictHostKeyChecking=no ${SERVER_USER}@${SERVER_IP} << REMOTE_BUILD
set -e
cd /www/wwwroot/coze-workflow-platform

echo "安装依赖..."
pnpm install --prefer-frozen-lockfile

echo "构建项目..."
pnpm build

echo "构建完成!"
REMOTE_BUILD

# Step 5: 配置环境变量和启动服务
echo ""
echo "[5/6] 配置环境变量并启动服务..."

sshpass -p "${SERVER_PASSWORD}" ssh -o StrictHostKeyChecking=no ${SERVER_USER}@${SERVER_IP} << REMOTE_START
set -e
cd /www/wwwroot/coze-workflow-platform

# 创建 .env.production (如果不存在)
if [ ! -f .env.production ]; then
    echo "创建 .env.production 配置文件..."
    cat > .env.production << 'EOF'
# ========== Supabase 配置 ==========
# 注意: 代码中使用的是 COZE_ 前缀的环境变量名
COZE_SUPABASE_URL=https://your-project.supabase.co
COZE_SUPABASE_ANON_KEY=your-anon-key
COZE_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# ========== Coze OAuth 配置 ==========
COZE_CLIENT_ID=your-coze-client-id
COZE_CLIENT_SECRET=your-coze-client-secret

# ========== 加密密钥 (生产环境务必更换！) ==========
ENCRYPTION_SECRET=your-production-encryption-secret-at-least-32-chars

# ========== 管理员配置 ==========
ADMIN_USER_IDS=

# ========== 域名配置 ==========
COZE_PROJECT_DOMAIN_DEFAULT=http://39.107.192.68

# ========== 环境 ==========
COZE_PROJECT_ENV=PROD

# ========== Coze API 配置 ==========
COZE_API_BASE_URL=https://api.coze.cn
COZE_WORKLOAD_API_TOKEN=

# ========== 服务配置 ==========
PORT=5000
EOF
    echo "请编辑 .env.production 填入实际的 Supabase 和 Coze 配置!"
    echo "文件路径: /www/wwwroot/coze-workflow-platform/.env.production"
else
    echo ".env.production 已存在，跳过创建"
fi

# 停止旧服务（如果存在）
pm2 delete coze-workflow 2>/dev/null || true

# 启动服务
echo "启动 PM2 服务..."
cd /www/wwwroot/coze-workflow-platform
NODE_ENV=production PORT=5000 pm2 start dist/server.js \
    --name "coze-workflow" \
    --env production \
    --log /www/wwwroot/coze-workflow-platform/logs/pm2.log

# 保存 PM2 配置
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo "服务启动完成!"
pm2 status
REMOTE_START

# Step 6: 配置 Nginx
echo ""
echo "[6/6] 配置 Nginx 反向代理..."

sshpass -p "${SERVER_PASSWORD}" ssh -o StrictHostKeyChecking=no ${SERVER_USER}@${SERVER_IP} << REMOTE_NGINX
set -e

cat > /etc/nginx/sites-available/coze-workflow << 'NGINX_CONF'
server {
    listen 80;
    server_name 39.107.192.68;

    # 反向代理到 Next.js
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        # SSE 支持（流式输出）
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;

        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }

    # 静态资源缓存
    location /_next/static/ {
        proxy_pass http://127.0.0.1:5000;
        expires 365d;
        add_header Cache-Control "public, immutable";
    }

    # 上传大小限制
    client_max_body_size 50m;
}
NGINX_CONF

# 启用站点
if [ -d /etc/nginx/sites-enabled ]; then
    ln -sf /etc/nginx/sites-available/coze-workflow /etc/nginx/sites-enabled/
    # 删除默认站点
    rm -f /etc/nginx/sites-enabled/default
else
    # CentOS/RHEL 使用 conf.d
    cp -f /etc/nginx/sites-available/coze-workflow /etc/nginx/conf.d/coze-workflow.conf
fi

# 测试并重载 Nginx
nginx -t && systemctl reload nginx

echo "Nginx 配置完成!"
REMOTE_NGINX

echo ""
echo "=========================================="
echo " 部署完成!"
echo " 访问地址: http://39.107.192.68"
echo ""
echo " 重要提示:"
echo " 1. 请编辑服务器上的 .env.production 填入实际配置"
echo "    路径: /www/wwwroot/coze-workflow-platform/.env.production"
echo " 2. 配置完成后重启服务:"
echo "    pm2 restart coze-workflow"
echo ""
echo " 常用命令:"
echo "   pm2 status          # 查看服务状态"
echo "   pm2 logs coze-workflow  # 查看日志"
echo "   pm2 restart coze-workflow  # 重启服务"
echo "=========================================="
