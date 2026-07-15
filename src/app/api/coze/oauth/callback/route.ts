import { NextRequest, NextResponse } from 'next/server';
import { saveCozeToken } from '@/lib/coze-token';
import { createAuditLog } from '@/lib/audit-log';
import { getOAuthConfig } from '@/lib/oauth-config';

/** 获取重定向的基础URL，优先使用环境变量中的域名 */
function getRedirectBase(): string {
  const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT;
  if (domain) {
    return domain.startsWith('http') ? domain : `https://${domain}`;
  }
  return `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
}

/** 返回小程序回调结果页面（HTML） */
function miniprogramResultPage(success: boolean, message: string): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Coze 授权${success ? '成功' : '失败'}</title>
  <script src="https://res.wx.qq.com/open/js/jweixin-1.6.0.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; background: #f8fafc; padding: 20px; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    .title { font-size: 18px; font-weight: 600; color: #1e293b; margin-bottom: 8px; }
    .msg { font-size: 14px; color: #64748b; text-align: center; }
    .btn { margin-top: 24px; padding: 10px 32px; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; }
  </style>
</head>
<body>
  <div class="icon">${success ? '✅' : '❌'}</div>
  <div class="title">${success ? '授权成功' : '授权失败'}</div>
  <div class="msg">${message}</div>
  ${success ? '<button class="btn" onclick="notifyMiniProgram()">返回小程序</button>' : ''}
  <script>
    function notifyMiniProgram() {
      // 通知小程序 web-view 授权完成
      wx.miniProgram.postMessage({ data: { coze_oauth: 'success' } });
      wx.miniProgram.navigateBack();
    }
    // 自动通知（兼容自动跳转场景）
    try {
      wx.miniProgram.postMessage({ data: { coze_oauth: '${success ? 'success' : 'error'}' } });
    } catch(e) {}
  </script>
</body>
</html>`;
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const errorParam = searchParams.get('error');
  const baseUrl = getRedirectBase();

  // Decode state to check if from miniprogram
  let fromMiniprogram = false;
  let userId = '';
  if (state) {
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
      userId = stateData.userId;
      fromMiniprogram = stateData.from === 'miniprogram';
    } catch { /* fall through */ }
  }

  if (errorParam) {
    if (fromMiniprogram) {
      return miniprogramResultPage(false, '用户取消了授权');
    }
    return NextResponse.redirect(new URL('/dashboard?coze_error=' + encodeURIComponent(errorParam), baseUrl));
  }

  if (!code || !state) {
    if (fromMiniprogram) {
      return miniprogramResultPage(false, '缺少授权参数');
    }
    return NextResponse.redirect(new URL('/dashboard?coze_error=no_code', baseUrl));
  }

  if (!userId) {
    if (fromMiniprogram) {
      return miniprogramResultPage(false, '授权状态无效，请重试');
    }
    return NextResponse.redirect(new URL('/dashboard?coze_error=invalid_state', baseUrl));
  }

  const config = await getOAuthConfig();

  if (!config.clientId || !config.clientSecret) {
    if (fromMiniprogram) {
      return miniprogramResultPage(false, 'OAuth 未配置，请联系管理员');
    }
    return NextResponse.redirect(new URL('/dashboard?coze_error=not_configured', baseUrl));
  }

  try {
    const tokenResponse = await fetch(`${config.apiBaseUrl}/api/permission/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.clientSecret}`,
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
      }),
    });

    const tokenResText = await tokenResponse.text();
    let tokenData: Record<string, unknown>;
    try {
      tokenData = JSON.parse(tokenResText);
    } catch {
      console.error('Token exchange response is not JSON:', tokenResText);
      if (fromMiniprogram) {
        return miniprogramResultPage(false, 'Token 交换失败，请重试');
      }
      return NextResponse.redirect(new URL('/dashboard?coze_error=token_exchange_invalid', baseUrl));
    }

    if (!tokenResponse.ok) {
      console.error('Token exchange failed:', JSON.stringify({ status: tokenResponse.status, body: tokenData }));
      const errCode = (tokenData as Record<string, string>)?.error_code || 'unknown';
      if (fromMiniprogram) {
        return miniprogramResultPage(false, `授权失败 (${errCode})`);
      }
      return NextResponse.redirect(new URL('/dashboard?coze_error=token_' + encodeURIComponent(errCode), baseUrl));
    }

    const td = tokenData as Record<string, string>;
    const expiresInSec = Math.min(Number(td.expires_in) || 86400, 10 * 365 * 24 * 3600);
    const expiresAt = new Date(Date.now() + expiresInSec * 1000)
      .toISOString()
      .replace('T', ' ')
      .replace('Z', '')
      .substring(0, 19);
    
    await saveCozeToken(userId, {
      accessToken: td.access_token || '',
      refreshToken: td.refresh_token || '',
      expiresAt,
      cozeUserId: td.coze_user_id,
      scope: td.scope,
    });

    await createAuditLog({
      userId,
      action: 'coze_oauth_connect',
      resourceType: 'coze_token',
      details: { coze_user_id: tokenData.coze_user_id, from: fromMiniprogram ? 'miniprogram' : 'web' },
    });

    if (fromMiniprogram) {
      return miniprogramResultPage(true, '您的 Coze 账户已成功连接，可以返回小程序使用 AI 工具了');
    }
    return NextResponse.redirect(new URL('/dashboard?coze_connected=1', baseUrl));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('OAuth callback error:', errMsg);
    if (fromMiniprogram) {
      return miniprogramResultPage(false, '授权过程出错，请重试');
    }
    return NextResponse.redirect(new URL('/dashboard?coze_error=' + encodeURIComponent('save_failed:' + errMsg.substring(0, 50)), baseUrl));
  }
}
