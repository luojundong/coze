import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';

/**
 * POST /api/wechat/wxacode
 * 生成「无限量」微信小程序码（getwxacodeunlimit），扫码后直达小程序指定页面并携带 scene 参数。
 * 前端分享海报优先使用小程序码；若未配置微信密钥或微信接口异常，返回 needFallback=true，由前端降级为网页链接二维码。
 *
 * body:
 *   referralCode: string  (分销码，作为 scene 透传给小程序，最大 32 字符)
 *   scene?: string        (可选，覆盖 scene；默认等于 referralCode)
 *   page?: string         (小程序页面，默认 pages/login/login)
 *   width?: number        (码宽，默认 430)
 *   envVersion?: string   (release/trial/develop，默认 release)
 */

// 单进程内存缓存 access_token（常规 Node 部署有效；serverless 每次重新获取也可接受，分享生成频率低）
let cachedToken: { token: string; expireAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const appid = process.env.WECHAT_APPID;
  const secret = process.env.WECHAT_APPSECRET;
  if (!appid || !secret) {
    throw new Error('未配置微信小程序密钥（WECHAT_APPID / WECHAT_APPSECRET）');
  }

  const now = Date.now();
  if (cachedToken && cachedToken.expireAt > now + 60_000) {
    const remainSec = Math.floor((cachedToken.expireAt - now) / 1000);
    console.log(`[wxacode:token] 使用缓存 token appid=${appid.slice(0, 4)}***${appid.slice(-4)} 剩余=${remainSec}s`);
    return cachedToken.token;
  }

  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`;
  const res = await fetch(url, { method: 'GET' });
  const data = await res.json();
  if (data.errcode) {
    throw new Error(`微信获取 access_token 失败: ${data.errcode} ${data.errmsg}`);
  }
  const tokenStr: string = data.access_token;
  console.log(`[wxacode:token] 新获取 token appid=${appid.slice(0, 4)}***${appid.slice(-4)} len=${tokenStr.length} expires_in=${data.expires_in}`);

  cachedToken = {
    token: tokenStr,
    expireAt: now + (data.expires_in || 7200) * 1000,
  };
  return tokenStr;
}

/** 单次 wxacode 请求结果 */
interface WxacodeResult {
  success: boolean;
  imageBase64?: string;
  errcode?: number;
  errmsg?: string;
}

/**
 * 调用微信 getwxacodeunlimit 生成小程序码（一次请求）
 */
async function requestWxacode(
  token: string, sceneStr: string, page: string, width: number, envVersion: string
): Promise<WxacodeResult> {
  const wxRes = await fetch(`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scene: sceneStr,
      page,
      width,
      env_version: envVersion,
      check_path: false,
    }),
  });

  const contentType = wxRes.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    // 成功返回图片
    const buf = Buffer.from(await wxRes.arrayBuffer());
    console.log(`[wxacode] 成功 env=${envVersion} size=${buf.length} bytes page=${page} scene=${sceneStr}`);
    return { success: true, imageBase64: `data:image/jpeg;base64,${buf.toString('base64')}` };
  }

  // 返回了 JSON 错误
  const data = await wxRes.json();
  console.warn(`[wxacode] env=${envVersion} 失败: errcode=${data.errcode} errmsg=${data.errmsg} | token前缀=${token.substring(0, 12)}...`);
  return { success: false, errcode: data.errcode, errmsg: data.errmsg };
}

export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await verifyAuth(req);
    if (error) return error;
    void userId;

    const body = await req.json().catch(() => ({}));
    const {
      referralCode,
      scene,
      page = 'pages/login/login',
      width = 430,
      // 允许客户端指定 envVersion，后端自动降级（release → trial → develop）
      envVersion: clientEnv = 'release',
    } = body as any;

    const sceneStr = String(scene ?? referralCode ?? '');
    if (!sceneStr) {
      console.warn('[wxacode] 缺少 scene 或 referralCode 参数');
      return NextResponse.json({ error: '缺少 scene 或 referralCode 参数' }, { status: 400 });
    }
    if (sceneStr.length > 32) {
      console.warn('[wxacode] scene 过长:', sceneStr.length);
      return NextResponse.json({ error: 'scene 参数过长（最大 32 字符）' }, { status: 400 });
    }

    if (!process.env.WECHAT_APPID || !process.env.WECHAT_APPSECRET) {
      console.warn('[wxacode] WECHAT_APPID / WECHAT_APPSECRET 未配置');
      return NextResponse.json(
        { error: '未配置微信小程序密钥', needFallback: true },
        { status: 400 }
      );
    }

    let token: string;
    try {
      token = await getAccessToken();
    } catch (e: any) {
      console.error('[wxacode] 获取 access_token 失败:', e.message);
      return NextResponse.json({ error: e.message, needFallback: true }, { status: 400 });
    }

    // 自动降级：release → trial → develop
    // 个人小程序可能尚未发布正式版，trial / develop 扫码仅对开发者/体验者有效
    const envVersions = ['release', 'trial', 'develop'];
    const startIndex = Math.max(0, envVersions.indexOf(clientEnv));
    const envVersionsToTry = envVersions.slice(startIndex);

    /**
     * 用指定 token 遍历 envVersions 生成小程序码
     * - 成功：返回 { success: true, imageBase64, envVersion }
     * - 遇到 41001：返回 { tokenExpired: true }
     * - 其他错误：返回 { success: false, attempts, error }
     */
    const tryAllEnvVersions = async (tokenToUse: string) => {
      const attempts: Array<{ env: string; errcode?: number; errmsg?: string }> = [];
      for (const ver of envVersionsToTry) {
        console.log(`[wxacode] 尝试 env=${ver} page=${page} scene=${sceneStr}`);
        const result = await requestWxacode(tokenToUse, sceneStr, page, width, ver);
        if (result.success) {
          return { success: true as const, imageBase64: result.imageBase64!, envVersion: ver };
        }
        attempts.push({ env: ver, errcode: result.errcode, errmsg: result.errmsg });
        // 41001 = access_token 无效/过期，需要刷新 token 后重试
        if (result.errcode === 41001) {
          console.warn(`[wxacode] env=${ver} access_token 过期 (41001)，将刷新重试`);
          return { tokenExpired: true as const };
        }
      }
      return { success: false as const, attempts };
    };

    // 第一轮：用初始 token
    let currentToken = token;
    let attempt1 = await tryAllEnvVersions(currentToken);

    // 如果第一轮遇到 41001，刷新 token 再试一轮
    if (attempt1.tokenExpired) {
      cachedToken = null;
      try {
        currentToken = await getAccessToken();
        console.log('[wxacode] 已刷新 access_token，重试生成小程序码');
      } catch (e: any) {
        console.error('[wxacode] 刷新 access_token 失败:', e.message);
        return NextResponse.json({ error: `获取微信 access_token 失败: ${e.message}`, needFallback: true }, { status: 400 });
      }
      attempt1 = await tryAllEnvVersions(currentToken);
    }

    // 判断最终结果
    if (attempt1.success) {
      return NextResponse.json({
        success: true,
        imageBase64: attempt1.imageBase64!,
        scene: sceneStr,
        envVersion: attempt1.envVersion,
      });
    }

    console.error(`[wxacode] 所有 envVersion 均失败:`, JSON.stringify(attempt1.attempts));
    return NextResponse.json(
      {
        error: `生成小程序码失败: ${attempt1.attempts!.map(a => `${a.env}(${a.errcode}:${a.errmsg})`).join(', ')}`,
        needFallback: true,
        attempts: attempt1.attempts,
      },
      { status: 400 }
    );
  } catch (err: any) {
    console.error('[wechat/wxacode] error:', err);
    return NextResponse.json(
      { error: err?.message || '生成小程序码失败', needFallback: true },
      { status: 400 }
    );
  }
}
