-- ============================================
-- 对话记录表：支持网页端 Bot 工具多轮对话历史持久化
-- 运行方式：在宝塔面板 / MySQL CLI 中执行
-- 兼容 MySQL 5.7+
-- ============================================

-- 1. 对话表
CREATE TABLE IF NOT EXISTS `conversations` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `tool_id` VARCHAR(36) NOT NULL,
  `coze_conversation_id` VARCHAR(128) NULL COMMENT 'Coze 平台侧 conversation_id',
  `title` VARCHAR(255) NULL COMMENT '对话标题（取第一条用户消息前50字）',
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '软删除标记',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_conv_user_id` (`user_id`),
  INDEX `idx_conv_tool_id` (`tool_id`),
  INDEX `idx_conv_user_tool` (`user_id`, `tool_id`),
  INDEX `idx_conv_user_tool_not_deleted` (`user_id`, `tool_id`, `is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. 消息表
CREATE TABLE IF NOT EXISTS `conversation_messages` (
  `id` VARCHAR(36) NOT NULL,
  `conversation_id` VARCHAR(36) NOT NULL,
  `role` VARCHAR(16) NOT NULL COMMENT 'user / assistant',
  `content` TEXT NOT NULL,
  `content_type` VARCHAR(32) NULL DEFAULT 'text' COMMENT 'text / image / workflow_result',
  `metadata` JSON NULL COMMENT '附加元数据',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_msg_conv_id` (`conversation_id`),
  INDEX `idx_msg_created_at` (`created_at`),
  FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
