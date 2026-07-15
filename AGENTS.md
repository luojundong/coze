# 项目上下文

## 项目名称
扣子工作流平台 — 用户注册登录并输入激活码激活，激活后使用扣子工作流（平台积分制，每个工具独立扣费）

## 版本技术栈
- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4
- **Database**: Supabase (PostgreSQL + Auth)
- **Security**: AES-256-GCM 加密、限流、审计日志

## 目录结构
```
├── public/                 # 静态资源
├── scripts/                # 构建与启动脚本
├── src/
│   ├── app/                # 页面路由与布局
│   │   ├── api/            # API Routes
│   │   │   ├── activate/           # 激活码激活
│   │   │   ├── admin/              # 管理接口
│   │   │   │   ├── activation-codes/  # 激活码管理
│   │   │   │   ├── audit-logs/        # 审计日志查询
│   │   │   │   ├── credits/           # 积分管理
│   │   │   │   ├── encryption-key/    # 加密密钥管理
│   │   │   │   ├── init-demo/         # 初始化体验码
│   │   │   │   ├── oauth-config/      # OAuth 配置管理
│   │   │   │   ├── users/             # 用户管理
│   │   │   │   └── workflow-configs/  # 工作流/智能体配置管理
│   │   │   ├── audit-logs/         # 用户审计日志
│   │   │   ├── coze/oauth/         # Coze OAuth 流程
│   │   │   ├── credits/            # 用户积分查询
│   │   │   ├── supabase-config/    # Supabase 配置
│   │   │   ├── tools/              # AI 工具列表
│   │   │   ├── user/status/        # 用户状态
│   │   │   └── workflow/           # 工作流调用
│   │   ├── activate/       # 激活页
│   │   ├── admin/          # 管理后台
│   │   │   ├── codes/      # 激活码管理页
│   │   │   ├── credits/    # 积分管理页
│   │   │   ├── encryption/ # 加密密钥管理页
│   │   │   ├── logs/       # 审计日志页
│   │   │   ├── oauth/      # OAuth 配置页
│   │   │   ├── tools/      # 工作流/智能体配置页
│   │   │   └── users/      # 用户管理页
│   │   ├── dashboard/      # 工作台页面
│   │   ├── login/          # 登录/注册页
│   │   └── tools/          # AI 工具
│   │       ├── [id]/       # 工具使用页
│   ├── components/ui/      # Shadcn UI 组件库
│   ├── lib/                # 工具库
│   │   ├── admin-guard.ts         # 管理员权限守卫
│   │   ├── api-client.ts          # 前端 API 客户端
│   │   ├── audit-log.ts           # 审计日志工具
│   │   ├── auth-guard.ts          # 认证守卫
│   │   ├── coze-token.ts          # Coze Token 管理（加密/解密/刷新）
│   │   ├── credit.ts              # 积分管理（扣除/充值/查询）
│   │   ├── crypto.ts              # AES-256-GCM 加密
│   │   ├── oauth-config.ts        # OAuth 运行时配置（读取DB覆盖环境变量）
│   │   ├── rate-limit.ts          # 限流工具
│   │   ├── supabase-browser.ts    # 浏览器端 Supabase Client
│   │   └── supabase-config-inject.tsx  # 配置注入 Provider
│   └── storage/database/   # 数据库
│       ├── shared/schema.ts       # Drizzle 表结构（含 system_config）
│       └── supabase-client.ts     # 服务端 Supabase Client
├── next.config.ts
├── package.json
└── tsconfig.json
```

## 核心业务流程
1. 用户注册/登录 (Supabase Auth, 邮箱密码)
2. 输入激活码激活账户（同时赠送初始积分）
3. 连接 Coze 账户 (OAuth 授权)
4. 浏览 AI 工具列表
5. 使用 AI 工具（消耗平台积分，每个工具独立扣费）

## 安全机制
- Token 加密: AES-256-GCM 加密存储 access_token 和 refresh_token
- JWT: Supabase Auth 管理, 默认 7 天过期 + 自动刷新
- 限流: 基于数据库滑动窗口, workflow_run 10次/分钟
- 审计: 每次工作流调用记录审计日志
- Token 自动刷新: access_token 过期前自动使用 refresh_token 刷新

## 数据库表
- activation_codes: 激活码
- user_activations: 用户激活记录
- coze_tokens: 用户 Coze Token (加密)
- audit_logs: 审计日志
- rate_limits: 限流记录
- system_config: 系统运行时配置（OAuth 配置等）
- workflow_configs: 工作流/智能体配置（名称、类型、积分消耗、启停状态）
- user_credits: 用户积分余额
- credit_transactions: 积分流水记录

## 管理后台
- 访问路径: /admin
- 权限控制: ADMIN_USER_IDS 环境变量（逗号分隔的用户 ID），未配置时允许所有用户
- 功能模块: 概览、用户管理、激活码管理、工具管理（工作流/智能体）、积分管理、OAuth 配置、加密密钥管理、审计日志

## 包管理规范
仅允许使用 pnpm
