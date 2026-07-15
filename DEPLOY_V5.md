# cozeZnt V5 部署说明

## 修复内容
1. **修复 `TypeError: Cannot read properties of undefined (reading 'map')`** — dashboard 页面 referral 模块空值保护
2. **加固 referral API** — `stats` 和 `link` 接口对数据库表不存在的情况做了 try-catch 兜底
3. **前端数据校验** — `referralStats.referrals` 确保始终为数组

## 部署步骤

### 1. 上传部署包
将 `coze-deploy-v5.tar` 上传到服务器 `/www/wwwroot/cozeZnt/`

### 2. 解压覆盖
```bash
cd /www/wwwroot/cozeZnt/
tar -xzf coze-deploy-v5.tar
```

### 3. 停止旧服务
```bash
pm2 stop cozeZnt
pm2 delete cozeZnt
```

### 4. 安装依赖（如 node_modules 不完整）
```bash
pnpm install --production
```

### 5. 启动服务
```bash
pm2 start dist/server.js --name cozeZnt
```

### 6. 检查状态
```bash
pm2 status
curl http://localhost:5000/login
```

## 重要提醒
- 服务监听端口是 **5000**（不是 3000），Nginx 代理需要指向 5000
- 确保 `.env.production` 中的 MySQL 连接信息正确
- 如果数据库中没有 `user_memberships`、`referral_relations`、`referral_commissions` 表，referral 功能会自动降级（不影响主页面访问）
