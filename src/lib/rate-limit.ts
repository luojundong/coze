import { query, queryOne, execute, genId } from './db';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date | null;
}

const WINDOW_MINUTES = 1;
const MAX_REQUESTS_PER_WINDOW: Record<string, number> = {
  'workflow_run': 10,
  'activate': 5,
  'coze_oauth': 3,
  'default': 30,
};

export async function checkRateLimit(
  userId: string,
  action: string,
): Promise<RateLimitResult> {
  const maxRequests = MAX_REQUESTS_PER_WINDOW[action] ?? MAX_REQUESTS_PER_WINDOW['default'];
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);

  // Clean up old windows
  await execute(
    'DELETE FROM rate_limits WHERE window_start < ? AND user_id = ? AND action = ?',
    [windowStart, userId, action]
  );

  // Find current window
  const existing = await queryOne<{ id: string; request_count: number; window_start: string }>(
    `SELECT id, request_count, window_start FROM rate_limits 
     WHERE user_id = ? AND action = ? AND window_start >= ?
     ORDER BY window_start DESC LIMIT 1`,
    [userId, action, windowStart]
  );

  if (existing) {
    if (existing.request_count >= maxRequests) {
      const resetAt = new Date(
        new Date(existing.window_start).getTime() + WINDOW_MINUTES * 60 * 1000
      );
      return { allowed: false, remaining: 0, resetAt };
    }

    await execute(
      'UPDATE rate_limits SET request_count = request_count + 1 WHERE id = ?',
      [existing.id]
    );

    return {
      allowed: true,
      remaining: maxRequests - existing.request_count - 1,
      resetAt: null,
    };
  }

  // Create new window
  await execute(
    `INSERT INTO rate_limits (id, user_id, action, request_count, window_start)
     VALUES (?, ?, ?, 1, NOW())`,
    [genId(), userId, action]
  );

  return { allowed: true, remaining: maxRequests - 1, resetAt: null };
}
