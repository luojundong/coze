-- ============================================================
-- Coze 工作流平台 - 数据库迁移脚本
-- 版本: v2 - 支持多工具激活码
-- ============================================================

-- 1. activation_codes: tool_id 改为 tool_ids (支持逗号分隔多工具ID)
ALTER TABLE `activation_codes` 
  ADD COLUMN `tool_ids` TEXT NULL COMMENT '逗号分隔的工具ID列表，NULL表示全部工具' AFTER `tool_id`;

-- 迁移已有数据：将 tool_id 复制到 tool_ids
UPDATE `activation_codes` SET `tool_ids` = `tool_id` WHERE `tool_id` IS NOT NULL;

-- 删除旧索引
ALTER TABLE `activation_codes` DROP INDEX `idx_activation_codes_tool_id`;

-- 删除旧字段（可选，建议先保留验证后再删除）
-- ALTER TABLE `activation_codes` DROP COLUMN `tool_id`;

-- 添加新索引
ALTER TABLE `activation_codes` ADD INDEX `idx_activation_codes_tool_ids` (`tool_ids`(255));

-- 2. user_activations: 确保支持多条记录（user_id + tool_id 联合唯一）
-- 注意：如果已存在 idx_user_activations_user_tool 索引则跳过
-- ALTER TABLE `user_activations` DROP INDEX `idx_user_activations_user_tool`;
-- ALTER TABLE `user_activations` ADD UNIQUE INDEX `idx_user_activations_user_tool_unique` (`user_id`, `tool_id`);

-- 3. 可选：为 tool_id=NULL 的全局激活记录保持唯一
-- 每个用户只能有一条 tool_id IS NULL 的全局激活记录

-- ============================================================
-- v4: 分销系统 + 会员制
-- ============================================================

-- 4.1 user_activations 增加 referrer_user_id 字段
ALTER TABLE `user_activations` ADD COLUMN `referrer_user_id` VARCHAR(36) NULL COMMENT '推荐人用户ID' AFTER `tool_id`;
ALTER TABLE `user_activations` ADD INDEX `idx_user_activations_referrer` (`referrer_user_id`);

-- 4.2 会员表
CREATE TABLE IF NOT EXISTS `user_memberships` (
  `id` VARCHAR(36) NOT NULL DEFAULT (UUID()),
  `user_id` VARCHAR(36) NOT NULL,
  `is_member` TINYINT(1) NOT NULL DEFAULT 1,
  `activated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `idx_user_memberships_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4.3 分销关系表
CREATE TABLE IF NOT EXISTS `referral_relations` (
  `id` VARCHAR(36) NOT NULL DEFAULT (UUID()),
  `referrer_user_id` VARCHAR(36) NOT NULL COMMENT '上级（推荐人）',
  `referred_user_id` VARCHAR(36) NOT NULL COMMENT '下级（被推荐人）',
  `status` VARCHAR(16) NOT NULL DEFAULT 'active',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_referral_referrer` (`referrer_user_id`),
  INDEX `idx_referral_referred` (`referred_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4.4 分销佣金记录表
CREATE TABLE IF NOT EXISTS `referral_commissions` (
  `id` VARCHAR(36) NOT NULL DEFAULT (UUID()),
  `referrer_user_id` VARCHAR(36) NOT NULL,
  `referred_user_id` VARCHAR(36) NOT NULL,
  `amount` INT NOT NULL DEFAULT 0,
  `type` VARCHAR(32) NOT NULL DEFAULT 'activation',
  `description` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_ref_comm_referrer` (`referrer_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
