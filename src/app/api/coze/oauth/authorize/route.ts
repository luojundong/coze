import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { checkRateLimit } from '@/lib/rate-limit';
import { getOAuthConfig } from '@/lib/oauth-config';

export async function GET(req: NextRequest) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  // Rate limit
  const rateResult = await checkRateLimit(userId, 'coze_oauth');
  if (!rateResult.allowed) {
    return NextResponse.json(
      { error: '操作过于频繁，请稍后再试' },
      { status: 429 }
    );
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from') || ''; // 'miniprogram' 表示来自小程序

  const config = await getOAuthConfig();

  if (!config.clientId) {
    return NextResponse.json({ error: 'Coze OAuth 未配置，请在管理后台配置 Client ID 和 Client Secret' }, { status: 500 });
  }

  // Generate a random state for CSRF protection (包含来源标记)
  const state = Buffer.from(JSON.stringify({ userId, nonce: Date.now(), from }), 'utf8').toString('base64url');

  // Coze OAuth 授权端点在 www.coze.cn（不是 api.coze.cn）
  // 参考: https://www.coze.cn/open/docs/developer_guides/oauth_code
  const authBase = config.apiBaseUrl
    .replace('api.coze.cn', 'www.coze.cn')
    .replace('api.coze.com', 'www.coze.com');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    // 请求离线访问，确保 Coze 下发 refresh_token，使授权可长期自动续期，
    // 避免 access token 过期后用户被迫频繁重新连接账户。
    access_type: 'offline',
  });

  const authUrl = `${authBase}/api/permission/oauth2/authorize?${params.toString()}`;

  return NextResponse.json({ authUrl, state });
}
