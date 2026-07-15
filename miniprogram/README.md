# AI工具平台 - 微信小程序

## 项目说明

本小程序是「AI工具平台」的移动端前端，连接后端 API 实现以下功能：

- 用户注册/登录
- 激活码激活
- AI工具列表浏览
- AI工具使用（消耗积分）
- 个人中心（积分、Coze连接管理）

## 开发准备

### 1. 注册微信小程序

1. 登录 [微信公众平台](https://mp.weixin.qq.com/) 注册小程序账号
2. 获取 AppID
3. 将 AppID 填入 `project.config.json` 的 `appid` 字段

### 2. 配置服务器域名

在微信公众平台 → 开发管理 → 开发设置 → 服务器域名中添加：

| 类型 | 域名 |
|------|------|
| request 合法域名 | `https://your-domain.com` |
| socket 合法域名 | （无需配置） |
| uploadFile 合法域名 | `https://your-domain.com` |
| downloadFile 合法域名 | `https://your-domain.com` |

同时还需要添加 Supabase 域名：

| 类型 | 域名 |
|------|------|
| request 合法域名 | `https://your-project.supabase.co` |

### 3. 使用微信开发者工具

1. 下载 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 打开项目，选择 `miniprogram` 目录
3. 填入 AppID
4. 编译运行

## 首次使用流程

1. 打开小程序，首次进入会跳转登录页
2. 点击「服务器配置」输入你的后端地址（如 `https://your-domain.com`）
3. 注册/登录账号
4. 输入激活码激活
5. 在「工具」Tab 浏览和使用的AI工具

## 项目结构

```
miniprogram/
├── app.js              # 小程序入口，封装请求方法
├── app.json            # 全局配置
├── app.wxss            # 全局样式
├── images/             # TabBar 图标
├── pages/
│   ├── index/          # 启动引导页
│   ├── login/          # 登录/注册页
│   ├── activate/       # 激活码页
│   ├── tools/          # 工具列表（TabBar）
│   ├── tool-detail/    # 工具使用页
│   └── profile/        # 个人中心（TabBar）
├── project.config.json # 开发者工具配置
└── sitemap.json        # 站点地图
```

## 注意事项

1. **Coze OAuth 授权**：小程序内无法直接打开 OAuth 页面，采用复制链接到浏览器的方式完成授权
2. **流式输出**：微信小程序不支持 SSE，流式执行会等待完整结果后返回
3. **服务器域名**：生产环境必须在微信公众平台配置合法域名，开发阶段可在开发者工具中勾选「不校验合法域名」
