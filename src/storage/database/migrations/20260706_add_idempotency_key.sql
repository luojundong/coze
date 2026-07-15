-- ============================================
-- 为 credit_transactions 表添加幂等键字段
-- 防止 SSE 流式 + 兜底轮询重复扣费
-- 运行方式：在宝塔面板 / MySQL CLI 中执行
-- ============================================

-- 1. 添加幂等键字段（允许 NULL，兼容历史数据；仅当不存在时添加）
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_transactions' AND COLUMN_NAME = 'idempotency_key');

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `credit_transactions` ADD COLUMN `idempotency_key` VARCHAR(64) NULL',
  'SELECT "列 idempotency_key 已存在，跳过" AS msg');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. 添加索引加速查询（仅当不存在时添加）
SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_transactions' AND INDEX_NAME = 'idx_credit_idempotency_key');

SET @sql2 = IF(@idx_exists = 0,
  'ALTER TABLE `credit_transactions` ADD INDEX `idx_credit_idempotency_key` (`idempotency_key`)',
  'SELECT "索引 idx_credit_idempotency_key 已存在，跳过" AS msg');
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

-- 3. 添加唯一约束（MySQL 中 NULL 值不受唯一约束限制，允许多个 NULL；仅当不存在时添加）
SET @uniq_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_transactions' AND INDEX_NAME = 'uniq_credit_idempotency_key');

SET @sql3 = IF(@uniq_exists = 0,
  'ALTER TABLE `credit_transactions` ADD UNIQUE INDEX `uniq_credit_idempotency_key` (`idempotency_key`)',
  'SELECT "唯一索引 uniq_credit_idempotency_key 已存在，跳过" AS msg');
PREPARE stmt3 FROM @sql3;
EXECUTE stmt3;
DEALLOCATE PREPARE stmt3;
