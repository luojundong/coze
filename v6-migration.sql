USE cozemooibi;

-- V6 Migration: 使用教程 + 常用工具收藏
-- 适用数据库: MySQL

-- 1. workflow_configs 新增 tutorial 字段
ALTER TABLE workflow_configs ADD COLUMN tutorial TEXT COMMENT '使用教程内容';

-- 2. 新建 user_favorites 表
CREATE TABLE IF NOT EXISTS user_favorites (
    id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    tool_id VARCHAR(36) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_user_favorites_user_id (user_id),
    INDEX idx_user_favorites_tool_id (tool_id),
    CONSTRAINT fk_user_favorites_tool FOREIGN KEY (tool_id) REFERENCES workflow_configs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
