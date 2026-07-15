# 宝塔面板部署指南

## 前置条件

- 宝塔面板已安装（推荐 7.9+）
- 服务器至少 2GB 内存
- 已安装 Node.js 18+（通过宝塔软件商店安装）
- 已安装 PM2 管理器（通过宝塔软件商店安装）
- 已安装 Nginx（通过宝塔软件商店安装）
- 域名已解析到服务器 IP

---

## 一、服务器环境准备

### 1. 安装 Node.js

在宝塔面板 → 软件商店 → 搜索 `Node.js版本管理器` → 安装 → 安装 Node.js 20+

### 2. 安装 PM2

在宝塔面板 → 软件商店 → 搜索 `PM2管理器` → 安装

### 3. 安装 Nginx

在宝塔面板 → 软件商店 → 搜索 `Nginx` → 安装

---

## 二、部署项目

### 1. 上传代码

```bash
# 方式一：从 Git 拉取
cd /www/wwwroot
git clone <你的仓库地址> coze-workflow-platform
cd coze-workflow-platform

# 方式二：宝塔文件管理器上传 ZIP 包
# 上传到 /www/wwwroot/coze-workflow-platform 后解压
```

### 2. 安装依赖并构建

```bash
cd /www/wwwroot/coze-workflow-platform

# 安装 pnpm
npm install -g pnpm

# 安装依赖
pnpm install

# 构建
pnpm build
```

### 3. 配置环境变量

```bash
# 创建 .env.production 文件
cat > .env.production << 'EOF'
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Coze OAuth（也可在管理后台配置，此处为默认值）
COZE_CLIENT_ID=your-coze-client-id
COZE_CLIENT_SECRET=your-coze-client-secret

# 加密密钥（生产环境务必更换！至少32字符）
ENCRYPTION_SECRET=your-production-encryption-secret-at-least-32-chars

# 管理员用户ID（逗号分隔，也可在管理后台修改）
ADMIN_USER_IDS=

# 域名
COZE_PROJECT_DOMAIN_DEFAULT=https://your-domain.com

# 环境
COZE_PROJECT_ENV=PROD
EOF
```

### 4. 使用 PM2 启动服务

```bash
cd /www/wwwroot/coze-workflow-platform

# 启动服务
NODE_ENV=production PORT=5000 pm2 start dist/server.js --name "coze-workflow"

# 保存 PM2 配置（开机自启）
pm2 save
pm2 startup
```

**PM2 常用命令：**
```bash
pm2 status          # 查看状态
pm2 logs coze-workflow  # 查看日志
pm2 restart coze-workflow  # 重启
pm2 stop coze-workflow     # 停止
```

---

## 三、Nginx 反向代理配置

### 1. 宝塔面板创建网站

宝塔面板 → 网站 → 添加站点：
- 域名：`your-domain.com`
- 根目录：`/www/wwwroot/coze-workflow-platform`
- PHP版本：纯静态

### 2. 配置 SSL 证书

宝塔面板 → 网站 → 你的站点 → SSL：
- 选择 Let's Encrypt 免费证书
- 或上传自有证书
- 开启强制 HTTPS

### 3. 修改 Nginx 配置

宝塔面板 → 网站 → 你的站点 → 设置 → 配置文件，替换为：

```nginx
server {
    listen 80;
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL 证书（宝塔会自动填充）
    ssl_certificate /www/server/panel/vhost/cert/your-domain.com/fullchain.pem;
    ssl_certificate_key /www/server/panel/vhost/cert/your-domain.com/privkey.pem;

    # HTTP 强制跳转 HTTPS
    if ($server_port !~ 443) {
        rewrite ^(/.*)$ https://$host$1 permanent;
    }

    # 反向代理到 Next.js
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
```

---

## 四、Coze OAuth 回调地址配置

在 [Coze 开放平台](https://www.coze.cn) → 你的 OAuth 应用：

- **回调地址**设置为：`https://your-domain.com/api/coze/oauth/callback`

---

## 五、更新部署

```bash
cd /www/wwwroot/coze-workflow-platform

# 拉取最新代码
git pull origin main

# 重新构建
pnpm install
pnpm build

# 重启服务
pm2 restart coze-workflow
```

---

## 六、数据库迁移

如果数据库 Schema 有变更，在 Supabase 控制台 SQL Editor 中执行对应迁移脚本。

---

## 七、常见问题

### 1. 端口被占用
```bash
# 查看 5000 端口占用
ss -tuln | grep :5000
# 或修改 .env.production 中的 PORT
```

### 2. PM2 启动失败
```bash
# 查看错误日志
pm2 logs coze-workflow --err
```

### 3. Nginx 502 Bad Gateway
- 检查 PM2 服务是否运行：`pm2 status`
- 检查端口是否监听：`ss -tuln | grep :5000`
- 检查 Nginx 配置语法：`nginx -t`
