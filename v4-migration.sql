-- ============================================================
-- Coze 工作流平台 - V4 数据库迁移（分销系统 + 会员制）
-- 直接在数据库管理工具中执行以下 SQL
-- ============================================================

USE `cozemooibi`;

-- 1. user_activations 增加 referrer_user_id 字段
ALTER TABLE `user_activations` ADD COLUMN `referrer_user_id` VARCHAR(36) NULL COMMENT '推荐人用户ID' AFTER `tool_id`;
ALTER TABLE `user_activations` ADD INDEX `idx_user_activations_referrer` (`referrer_user_id`);

-- 2. 会员表
CREATE TABLE IF NOT EXISTS `user_memberships` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `is_member` TINYINT(1) NOT NULL DEFAULT 1,
  `activated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `idx_user_memberships_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. 分销关系表
CREATE TABLE IF NOT EXISTS `referral_relations` (
  `id` VARCHAR(36) NOT NULL,
  `referrer_user_id` VARCHAR(36) NOT NULL COMMENT '上级（推荐人）',
  `referred_user_id` VARCHAR(36) NOT NULL COMMENT '下级（被推荐人）',
  `status` VARCHAR(16) NOT NULL DEFAULT 'active',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_referral_referrer` (`referrer_user_id`),
  INDEX `idx_referral_referred` (`referred_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. 分销佣金记录表
CREATE TABLE IF NOT EXISTS `referral_commissions` (
  `id` VARCHAR(36) NOT NULL,
  `referrer_user_id` VARCHAR(36) NOT NULL,
  `referred_user_id` VARCHAR(36) NOT NULL,
  `amount` INT NOT NULL DEFAULT 0,
  `type` VARCHAR(32) NOT NULL DEFAULT 'activation',
  `description` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_ref_comm_referrer` (`referrer_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
