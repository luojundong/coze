#!/bin/bash
set -e

echo "========================================="
echo " 远程部署开始"
echo "========================================="

# 1. 解压代码
echo ""
echo ">>> [1/6] 解压项目代码..."
mkdir -p /www/wwwroot/coze-workflow-platform
cd /www/wwwroot/coze-workflow-platform
unzip -o /tmp/coze-deploy.zip -d /www/wwwroot/coze-workflow-platform/
rm -f /tmp/coze-deploy.zip
echo "解压完成"

# 2. 安装 Node.js
echo ""
echo ">>> [2/6] 检查 Node.js..."
if ! command -v node &> /dev/null; then
    echo "安装 Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
echo "Node.js: $(node --version)"

# 3. 安装 pnpm/PM2/Nginx
echo ""
echo ">>> [3/6] 检查工具链..."

if ! command -v pnpm &> /dev/null; then
    echo "安装 pnpm..."
    npm install -g pnpm
fi
echo "pnpm: $(pnpm --version)"

if ! command -v pm2 &> /dev/null; then
    echo "安装 PM2..."
    npm install -g pm2
fi
echo "PM2: $(pm2 --version)"

if ! command -v nginx &> /dev/null; then
    echo "安装 Nginx..."
    apt-get update && apt-get install -y nginx
fi
echo "Nginx: $(nginx -v 2>&1)"

# 4. 安装依赖 + 构建
echo ""
echo ">>> [4/6] 安装依赖并构建..."
cd /www/wwwroot/coze-workflow-platform
pnpm install --prefer-frozen-lockfile
pnpm build
echo "构建完成!"

# 5. 配置环境变量 + 启动 PM2
echo ""
echo ">>> [5/6] 配置环境变量并启动服务..."

cd /www/wwwroot/coze-workflow-platform
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
    echo ".env.production 已创建"
else
    echo ".env.production 已存在，跳过创建"
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
echo "PM2 状态:"
pm2 status

# 6. 配置 Nginx
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
echo " 部署完成!"
echo " 访问: http://39.107.192.68"
echo ""
echo " 重要提示:"
echo " 1. 编辑环境变量:"
echo "    vi /www/wwwroot/coze-workflow-platform/.env.production"
echo " 2. 重启服务:"
echo "    pm2 restart coze-workflow"
echo " 3. 查看日志:"
echo "    pm2 logs coze-workflow"
echo "========================================="
