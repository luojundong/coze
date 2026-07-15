USE cozemooibi;

-- V7 Migration: Bot 预设内容（数据库配置优先于 Coze API）
-- 适用数据库: MySQL

-- 1. workflow_configs 新增 opening_statement 字段（Bot 开场白）
ALTER TABLE workflow_configs ADD COLUMN opening_statement TEXT COMMENT 'Bot开场白（数据库配置优先于Coze API，留空则动态获取）';

-- 2. workflow_configs 新增 suggested_questions 字段（Bot 推荐问题，JSON 数组）
ALTER TABLE workflow_configs ADD COLUMN suggested_questions JSON COMMENT 'Bot推荐问题列表（数据库配置优先于Coze API，留空则动态获取）';
