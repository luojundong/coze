# 项目记忆

## 项目信息
- **项目名称**: 扣子工作流平台（小程序 + Web 端）
- **域名**: `coze.mooibi.com`（后端）/ `coze.mooibi.com`（小程序请求地址）
- **技术栈**: Next.js 16 (App Router) + uni-app 小程序 + Supabase
- **包管理**: pnpm（仅允许 pnpm）

## 重要约定
- 后端域名 = 小程序 apiBase: `https://coze.mooibi.com`
- TOS/CDN 签名 URL 有 24 小时有效期，小程序需通过后端 `/api/workflow/refresh-url` 刷新签名
- 打包脚本: `powershell -ExecutionPolicy Bypass -File scripts/package-v27-style.ps1 -Version vXX`
- 部署命令: `rm -rf .next dist && unzip -o coze-deploy-vXX.zip && pm2 reload cozeZnt`

## 小程序关键状态说明
- `running` 控制输入框禁用和发送按钮状态，必须确保所有完成/异常路径都重置为 `false`
- 已添加多层守护防止 `running` 卡死：5 分钟绝对超时、30 秒 SSE 无数据安全网、`onShow` stuck 检测
- 视频生成工具容易出现 SSE 收到链接后连接不关闭，导致 `running` 长期为 true

## 分销/推广系统关键约定
- 分销码格式：`userId前8位_随机4位`（如 `abc12345_x7k2`）
- 核心表：`referral_relations`（分销关系）、`referral_commissions`（佣金）、`user_activations.referrer_user_id`（关联字段）
- 小程序码扫码入口（`getwxacodeunlimit`）：scene 参数可能在 `options.scene` 或 `options.query.scene`，两处都要检查
- 分销绑定路径（优先级顺序）：login.js handleSubmit → activate.js handleActivate
- 分销码留存：`app.globalData.pendingRef` + 页面 `data.refCode` 双保险
- 分享方式：
  - 海报小程序码（优先）：小程序码 → scene → 小程序 login 页
  - 海报降级二维码（wxacode 失败时）：web 链接 → /login?ref=xxx → web 页面注册绑定
  - 微信原生分享（onShareAppMessage）：`path: /pages/login/login?ref=xxx`
  - 复制链接：web 链接，需在 web 页面完成注册才能绑定
- 绑定 API：`POST /api/referral/link` 需 JWT 认证，校验推荐人会员身份
- 统计 API：`GET /api/referral/stats` 查询 referral_relations JOIN users

## Web 端对话记录系统
- 数据库表：`conversations`（对话元数据）+ `conversation_messages`（消息记录）
- 软删除机制：`is_deleted` 字段标记，不物理删除
- 消息保存时机：每次 SSE 完成后自动保存（成功/失败均保存），`replace=true` 全量替换模式
- 标题生成：自动取第一条 user 消息前50字
- 前端侧边栏：可收起/展开，hover 显示删除按钮
- 注意：部署前需要手动执行 SQL 迁移脚本，不匹配 Drizzle ORM（实际使用 MySQL）
