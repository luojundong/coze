import { query, queryOne, execute, genId } from './db';

/**
 * 为用户充值积分（原子操作）
 */
export async function grantCredits(
  userId: string,
  amount: number,
  type: string,
  description?: string,
  workflowConfigId?: string
): Promise<{ success: boolean; balance: number; error?: string }> {
  if (amount <= 0) {
    return { success: false, balance: 0, error: '充值金额必须大于0' };
  }

  const pool = (await import('./db')).getPool();
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Upsert user_credits
    await conn.execute(
      `INSERT INTO user_credits (user_id, balance, total_granted, total_consumed)
       VALUES (?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE balance = balance + ?, total_granted = total_granted + ?`,
      [userId, amount, amount, amount, amount]
    );

    // Get updated balance
    const [rows] = await conn.execute(
      'SELECT balance FROM user_credits WHERE user_id = ?',
      [userId]
    );
    const balance = (rows as any[])[0]?.balance ?? 0;

    // Insert transaction
    await conn.execute(
      `INSERT INTO credit_transactions (id, user_id, amount, type, workflow_config_id, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [genId(), userId, amount, type, workflowConfigId || null, description || null]
    );

    await conn.commit();
    return { success: true, balance };
  } catch (error: any) {
    await conn.rollback();
    return { success: false, balance: 0, error: error.message };
  } finally {
    conn.release();
  }
}

/**
 * 扣除用户积分（原子操作，确保余额足够）
 * 如果传入 idempotencyKey，则同一 key 只会扣费一次，防止重复扣费
 */
export async function deductCredits(
  userId: string,
  amount: number,
  type: string,
  description?: string,
  workflowConfigId?: string,
  idempotencyKey?: string,
): Promise<{ success: boolean; balance: number; error?: string; duplicated?: boolean }> {
  if (amount <= 0) {
    return { success: false, balance: 0, error: '扣除金额必须大于0' };
  }

  const pool = (await import('./db')).getPool();
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // 如果存在幂等键，先检查是否已有扣费记录
    if (idempotencyKey) {
      try {
        const [existingRows] = await conn.execute(
          'SELECT id, amount FROM credit_transactions WHERE idempotency_key = ? AND user_id = ? LIMIT 1',
          [idempotencyKey, userId]
        );
        const existing = (existingRows as any[])[0];
        if (existing) {
          // 已有扣费记录，直接返回当前余额，不再扣费
          const [balRows] = await conn.execute(
            'SELECT balance FROM user_credits WHERE user_id = ?',
            [userId]
          );
          const balance = (balRows as any[])[0]?.balance ?? 0;
          await conn.commit();
          return { success: true, balance, duplicated: true };
        }
      } catch (e: any) {
        // 如果 idempotency_key 列不存在，跳过幂等检查，继续正常扣费
        // 这种情况发生在数据库迁移未执行时
        if (e.message?.includes("Unknown column 'idempotency_key'") ||
            e.message?.includes("doesn't exist") ||
            e.code === 'ER_BAD_FIELD_ERROR') {
          console.warn('[Credit] idempotency_key column not found in credit_transactions table. Please run migration 20260706_add_idempotency_key.sql. Skipping idempotent check for this request.');
        } else {
          throw e;
        }
      }
    }

    // Check and deduct atomically
    const [rows] = await conn.execute(
      `UPDATE user_credits SET balance = balance - ?, total_consumed = total_consumed + ?
       WHERE user_id = ? AND balance >= ?`,
      [amount, amount, userId, amount]
    );

    const affectedRows = (rows as any).affectedRows;
    if (affectedRows === 0) {
      // Check current balance
      const [balRows] = await conn.execute(
        'SELECT balance FROM user_credits WHERE user_id = ?',
        [userId]
      );
      const bal = (balRows as any[])[0]?.balance ?? 0;
      await conn.rollback();
      return { success: false, balance: bal, error: '积分余额不足' };
    }

    // Get updated balance
    const [updatedRows] = await conn.execute(
      'SELECT balance FROM user_credits WHERE user_id = ?',
      [userId]
    );
    const balance = (updatedRows as any[])[0]?.balance ?? 0;

    // Insert transaction
    try {
      await conn.execute(
        `INSERT INTO credit_transactions (id, user_id, amount, type, workflow_config_id, description, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [genId(), userId, -amount, type, workflowConfigId || null, description || null, idempotencyKey || null]
      );
    } catch (insertErr: any) {
      // 幂等键重复：说明已有同 key 的扣费记录，回滚本次扣费并返回成功
      if (insertErr && (insertErr.code === 'ER_DUP_ENTRY' || insertErr.errno === 1062 || insertErr.message?.includes('Duplicate entry'))) {
        await conn.rollback();
        const [balRows] = await conn.execute(
          'SELECT balance FROM user_credits WHERE user_id = ?',
          [userId]
        );
        const balance = (balRows as any[])[0]?.balance ?? 0;
        return { success: true, balance, duplicated: true };
      }
      // idempotency_key 列不存在 → 重试不带该列
      if (insertErr && (insertErr.message?.includes("Unknown column 'idempotency_key'") ||
          insertErr.code === 'ER_BAD_FIELD_ERROR')) {
        try {
          await conn.execute(
            `INSERT INTO credit_transactions (id, user_id, amount, type, workflow_config_id, description)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [genId(), userId, -amount, type, workflowConfigId || null, description || null]
          );
        } catch (retryErr: any) {
          throw retryErr;
        }
      } else {
        throw insertErr;
      }
    }

    await conn.commit();
    return { success: true, balance };
  } catch (error: any) {
    await conn.rollback();
    return { success: false, balance: 0, error: error.message };
  } finally {
    conn.release();
  }
}

/**
 * 查询用户积分余额
 */

export async function getUserCredits(userId: string): Promise<{ balance: number; totalGranted: number; totalConsumed: number }> {
  const row = await queryOne<{ balance: number; total_granted: number; total_consumed: number }>(
    'SELECT balance, total_granted, total_consumed FROM user_credits WHERE user_id = ?',
    [userId]
  );

  if (!row) {
    return { balance: 0, totalGranted: 0, totalConsumed: 0 };
  }
  return { balance: row.balance, totalGranted: row.total_granted, totalConsumed: row.total_consumed };
}
