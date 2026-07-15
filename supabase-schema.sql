-- ============================================
-- 扣子工作流平台 — Supabase 数据库建表脚本
-- 在 Supabase SQL Editor 中执行
-- ============================================

-- 启用 uuid-ossp 扩展（用于 gen_random_uuid()）
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 健康检查表
CREATE TABLE IF NOT EXISTS health_check (
    id SERIAL NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 激活码表
CREATE TABLE IF NOT EXISTS activation_codes (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(128),
    description TEXT,
    max_uses INT DEFAULT 1,
    used_count INT DEFAULT 0 NOT NULL,
    is_active BOOLEAN DEFAULT true NOT NULL,
    expires_at TIMESTAMPTZ,
    credit_amount INT DEFAULT 100,
    tool_id VARCHAR(36),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS activation_codes_code_idx ON activation_codes(code);
CREATE INDEX IF NOT EXISTS activation_codes_is_active_idx ON activation_codes(is_active);
CREATE INDEX IF NOT EXISTS idx_activation_codes_tool_id ON activation_codes(tool_id);

-- 工作流/智能体配置表
CREATE TABLE IF NOT EXISTS workflow_configs (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    coze_id VARCHAR(128) NOT NULL,
    name VARCHAR(128) NOT NULL,
    description TEXT,
    type VARCHAR(32) DEFAULT 'workflow' NOT NULL,
    icon_url TEXT,
    is_enabled BOOLEAN DEFAULT true NOT NULL,
    credit_cost INT DEFAULT 1 NOT NULL,
    parameters_schema JSONB,
    sort_order INT DEFAULT 0 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS workflow_configs_type_idx ON workflow_configs(type);
CREATE INDEX IF NOT EXISTS workflow_configs_is_enabled_idx ON workflow_configs(is_enabled);

-- 用户积分余额表
CREATE TABLE IF NOT EXISTS user_credits (
    user_id VARCHAR(36) PRIMARY KEY,
    balance INT DEFAULT 0 NOT NULL,
    total_granted INT DEFAULT 0 NOT NULL,
    total_consumed INT DEFAULT 0 NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 积分流水表
CREATE TABLE IF NOT EXISTS credit_transactions (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id VARCHAR(36) NOT NULL,
    amount INT NOT NULL,
    type VARCHAR(32) NOT NULL,
    workflow_config_id VARCHAR(36) REFERENCES workflow_configs(id),
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS credit_transactions_user_id_idx ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS credit_transactions_type_idx ON credit_transactions(type);
CREATE INDEX IF NOT EXISTS credit_transactions_created_at_idx ON credit_transactions(created_at);

-- 用户激活记录表
CREATE TABLE IF NOT EXISTS user_activations (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id VARCHAR(36) NOT NULL,
    activation_code_id VARCHAR(36) NOT NULL REFERENCES activation_codes(id),
    activated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true NOT NULL,
    tool_id VARCHAR(36),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS user_activations_user_id_idx ON user_activations(user_id);
CREATE INDEX IF NOT EXISTS user_activations_activation_code_id_idx ON user_activations(activation_code_id);
CREATE INDEX IF NOT EXISTS user_activations_is_active_idx ON user_activations(is_active);
CREATE INDEX IF NOT EXISTS idx_user_activations_user_tool ON user_activations(user_id, tool_id);

-- 用户 Coze OAuth Token 表（加密存储）
CREATE TABLE IF NOT EXISTS coze_tokens (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id VARCHAR(36) NOT NULL,
    encrypted_access_token TEXT NOT NULL,
    encrypted_refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    coze_user_id VARCHAR(128),
    scope TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS coze_tokens_user_id_idx ON coze_tokens(user_id);

-- 系统配置表（OAuth 配置等运行时可修改的配置项）
CREATE TABLE IF NOT EXISTS system_config (
    key VARCHAR(128) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 审计日志表
CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id VARCHAR(36) NOT NULL,
    action VARCHAR(64) NOT NULL,
    resource_type VARCHAR(64),
    resource_id VARCHAR(128),
    details JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    status VARCHAR(16) DEFAULT 'success' NOT NULL,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS audit_logs_resource_type_idx ON audit_logs(resource_type);

-- 限流记录表
CREATE TABLE IF NOT EXISTS rate_limits (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id VARCHAR(36) NOT NULL,
    action VARCHAR(64) NOT NULL,
    request_count INT DEFAULT 1 NOT NULL,
    window_start TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_user_action_idx ON rate_limits(user_id, action);
CREATE INDEX IF NOT EXISTS rate_limits_window_start_idx ON rate_limits(window_start);
