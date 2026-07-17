import { queryOne, execute, genId } from './db';
import { encrypt, decrypt } from './crypto';

/**
 * 检查 Coze Token 是否因服务重启而过期
 * 如果 token 的更新时间早于 server_startup_at，说明是重启前的旧 token，
 * 需要用户重新连接 Coze
 */
export async function isCozeTokenStale(userId: string): Promise<boolean> {
  try {
    const serverStartup = await queryOne<{ value: string }>(
      "SELECT value FROM system_config WHERE `key` = 'server_startup_at'"
    );
    if (!serverStartup?.value) return false; // 没有记录则不做限制

    const tokenInfo = await queryOne<{ updated_at: string; created_at: string }>(
      'SELECT updated_at, created_at FROM coze_tokens WHERE user_id = ?',
      [userId]
    );
    if (!tokenInfo) return false; // 没有 token 记录

    // 优先使用 updated_at，兜底使用 created_at
    const tokenTime = tokenInfo.updated_at || tokenInfo.created_at;
    if (!tokenTime) return false;

    // 如果 token 时间早于服务器启动时间，说明是重启前的旧 token
    const tokenTimeMs = new Date(tokenTime).getTime();
    const serverStarted = new Date(serverStartup.value).getTime();
    return tokenTimeMs < serverStarted;
  } catch {
    // 查询失败不阻塞正常流程
    return false;
  }
}

/** 将时间戳转为 MySQL DATETIME 兼容格式 (YYYY-MM-DD HH:mm:ss) */
function formatMysqlDatetime(timestampMs: number): string {
  return new Date(timestampMs)
    .toISOString()
    .replace('T', ' ')
    .replace('Z', '')
    .substring(0, 19);
}

interface CozeTokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  cozeUserId?: string;
  scope?: string;
}

export async function saveCozeToken(userId: string, tokenData: CozeTokenData): Promise<void> {
  const encryptedAccess = encrypt(tokenData.accessToken);
  const encryptedRefresh = tokenData.refreshToken ? encrypt(tokenData.refreshToken) : null;

  // Check if user already has a token
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM coze_tokens WHERE user_id = ?',
    [userId]
  );

  if (existing) {
    await execute(
      `UPDATE coze_tokens SET encrypted_access_token = ?, encrypted_refresh_token = ?, 
       token_expires_at = ?, coze_user_id = ?, scope = ?, updated_at = NOW()
       WHERE id = ?`,
      [encryptedAccess, encryptedRefresh, tokenData.expiresAt ?? null, tokenData.cozeUserId ?? null, tokenData.scope ?? null, existing.id]
    );
  } else {
    await execute(
      `INSERT INTO coze_tokens (id, user_id, encrypted_access_token, encrypted_refresh_token, 
       token_expires_at, coze_user_id, scope, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [genId(), userId, encryptedAccess, encryptedRefresh, tokenData.expiresAt ?? null, tokenData.cozeUserId ?? null, tokenData.scope ?? null]
    );
  }
}

export async function getCozeToken(userId: string): Promise<CozeTokenData | null> {
  const data = await queryOne<{
    encrypted_access_token: string;
    encrypted_refresh_token: string | null;
    token_expires_at: string | null;
    coze_user_id: string | null;
    scope: string | null;
  }>(
    'SELECT encrypted_access_token, encrypted_refresh_token, token_expires_at, coze_user_id, scope FROM coze_tokens WHERE user_id = ?',
    [userId]
  );

  if (!data) return null;

  return {
    accessToken: decrypt(data.encrypted_access_token),
    refreshToken: data.encrypted_refresh_token ? decrypt(data.encrypted_refresh_token) : undefined,
    expiresAt: data.token_expires_at ?? undefined,
    cozeUserId: data.coze_user_id ?? undefined,
    scope: data.scope ?? undefined,
  };
}

export async function refreshCozeToken(userId: string): Promise<CozeTokenData> {
  const currentToken = await getCozeToken(userId);
  if (!currentToken?.refreshToken) {
    throw new Error('No refresh token available. Please re-authorize your Coze account.');
  }

  const { getOAuthConfig } = await import('./oauth-config');
  const config = await getOAuthConfig();

  if (!config.clientId || !config.clientSecret) {
    throw new Error('Coze OAuth not configured. Please set COZE_CLIENT_ID and COZE_CLIENT_SECRET.');
  }

  // 刷新带重试：网络抖动/超时为瞬时错误，重试一次可避免误判用户需重新授权
  let response: Response | null = null;
  let lastError: any = null;
  const MAX_REFRESH_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_REFRESH_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);  // 10 秒超时
    try {
      response = await fetch(`${config.apiBaseUrl}/api/permission/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.clientSecret}`,
        },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: currentToken.refreshToken,
          client_id: config.clientId,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      break; // 拿到响应（无论 HTTP 状态）即跳出重试循环
    } catch (e: any) {
      clearTimeout(timeoutId);
      lastError = e;
      if (e.name === 'AbortError') {
        console.error(`[CozeToken] Refresh timed out (attempt ${attempt}/${MAX_REFRESH_ATTEMPTS})`);
      } else {
        console.error(`[CozeToken] Refresh network error (attempt ${attempt}/${MAX_REFRESH_ATTEMPTS}):`, e.message);
      }
      if (attempt < MAX_REFRESH_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, 800)); // 短暂退避后重试
      }
    }
  }

  if (!response) {
    // 两次均网络失败：保留原 refresh_token 不被清除，下次请求仍可重试刷新
    console.error('[CozeToken] Refresh failed after retries, keeping existing token');
    throw new Error('Coze Token 刷新失败（网络异常），请稍后重试');
  }

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[CozeToken] Refresh failed (${response.status}):`, errText.slice(0, 500));
    // 刷新失败，将 token 标记为已过期（设置 expires_at 为过去时间），
    // 避免反复尝试，同时保留 token 数据供后续分析
    try {
      await execute(
        'UPDATE coze_tokens SET token_expires_at = ?, updated_at = NOW() WHERE user_id = ?',
        [formatMysqlDatetime(Date.now() - 86400000), userId]  // 设置为 24 小时前
      );
    } catch (e) {
      console.error('[CozeToken] Failed to mark token as expired:', e);
    }
    throw new Error(`Coze Token 刷新失败，请重新连接 Coze 账户 (HTTP ${response.status})`);
  }

  const tokenData = await response.json();
  // 关键修复：当刷新接口未返回新 refresh_token（Coze 默认不轮换）时，
  // 必须沿用旧的 refresh_token，否则下次 access token 过期后将无法再刷新，
  // 导致用户频繁被要求重新连接 Coze 账户。
  const newToken: CozeTokenData = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || currentToken.refreshToken,
    expiresAt: formatMysqlDatetime(Date.now() + Math.min(tokenData.expires_in || 86400, 10 * 365 * 24 * 3600) * 1000),
    cozeUserId: tokenData.coze_user_id,
    scope: tokenData.scope,
  };

  await saveCozeToken(userId, newToken);
  return newToken;
}

export async function getValidCozeToken(userId: string): Promise<string> {
  const tokenData = await getValidCozeTokenData(userId);
  return tokenData.accessToken;
}

export async function getValidCozeTokenData(userId: string): Promise<CozeTokenData> {
  const tokenData = await getCozeToken(userId);
  if (!tokenData) {
    throw new Error('Coze account not connected. Please authorize your Coze account first.');
  }

  const expiresAt = tokenData.expiresAt ? new Date(tokenData.expiresAt) : null;
  const isExpired = expiresAt ? expiresAt.getTime() - Date.now() < 5 * 60 * 1000 : false;

  if (isExpired && tokenData.refreshToken) {
    return await refreshCozeToken(userId);
  }

  if (isExpired) {
    throw new Error('Coze token expired. Please re-authorize your Coze account.');
  }

  return tokenData;
}
