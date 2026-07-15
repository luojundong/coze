'use client';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
}

export function setToken(token: string): void {
  localStorage.setItem('auth_token', token);
}

export function removeToken(): void {
  localStorage.removeItem('auth_token');
}

/**
 * 默认超时时间（毫秒）
 * 普通 API: 30s, 文件上传: 120s, SSE 流式: 不设超时
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * 带超时控制的认证 API 调用
 * @param path API 路径
 * @param options fetch 选项，可额外传入 timeout 控制超时（毫秒）
 */
export async function callAuthenticatedApi(
  path: string,
  options?: RequestInit & { timeout?: number }
) {
  const token = getToken();

  if (!token) {
    window.location.href = '/login';
    return;
  }

  // Verify token is still valid
  try {
    const res = await fetch('/api/auth/session', {
      headers: { 'x-session': token },
    });
    const data = await res.json();
    if (!data.user) {
      removeToken();
      window.location.href = '/login';
      return;
    }
  } catch {
    // Continue anyway
  }

  // 合并 headers：保留 options 中的 headers，追加 x-session
  // 注意：对于 FormData body，不手动设置 Content-Type，让浏览器自动生成 boundary
  const mergedHeaders: Record<string, string> = {};
  if (options?.headers) {
    const optsHeaders = options.headers as Record<string, string>;
    for (const key of Object.keys(optsHeaders)) {
      mergedHeaders[key.toLowerCase()] = optsHeaders[key];
    }
  }
  mergedHeaders['x-session'] = token;

  // 提取自定义 timeout 参数（不传给 fetch）
  const { timeout, ...fetchOptions } = (options || {}) as RequestInit & { timeout?: number };
  const effectiveTimeout = timeout ?? DEFAULT_TIMEOUT;

  // 使用 AbortController 实现超时控制
  // SSE 流式场景：timeout=0 表示不设超时
  if (effectiveTimeout > 0) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

    try {
      const response = await fetch(path, {
        ...fetchOptions,
        headers: mergedHeaders,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error(`请求超时 (${Math.round(effectiveTimeout / 1000)}s)`);
      }
      throw err;
    }
  }

  // 无超时限制（用于 SSE 流式连接）
  return fetch(path, {
    ...fetchOptions,
    headers: mergedHeaders,
  });
}
