import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { getValidCozeTokenData } from '@/lib/coze-token';
import { getOAuthConfig } from '@/lib/oauth-config';

/**
 * 获取调用 Coze API 所需的 Token
 * 优先级：用户 OAuth Token > 平台 Workload API Token
 */
async function getWorkflowToken(userId: string): Promise<{ accessToken: string }> {
  // 1. 优先尝试获取用户自己的 Coze token
  try {
    const tokenData = await getValidCozeTokenData(userId);
    if (tokenData?.accessToken) {
      return { accessToken: tokenData.accessToken };
    }
  } catch {
    console.log(`[RefreshURL] User ${userId} has no valid Coze token, trying platform token...`);
  }

  // 2. 降级：使用平台 Workload API Token
  const platformToken = process.env.COZE_WORKLOAD_API_TOKEN;
  if (platformToken) {
    return { accessToken: platformToken };
  }

  throw new Error('No valid Coze token available');
}

/**
 * POST /api/workflow/refresh-url
 * 刷新 TOS/CDN 签名 URL（签名 24 小时过期后重新获取）
 *
 * Body: { conversation_id: string, file_pattern: string }
 *   - conversation_id: Coze 会话 ID
 *   - file_pattern: TOS 文件基础路径（无签名参数），如 https://xxx.volces.com/abc.mp4
 *
 * Response: { url: string }  或  { error: string }
 */
export async function POST(req: NextRequest) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  let body: { conversation_id?: string; file_pattern?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  const { conversation_id, file_pattern } = body;
  if (!conversation_id) {
    return NextResponse.json({ error: '缺少 conversation_id 参数' }, { status: 400 });
  }
  if (!file_pattern) {
    return NextResponse.json({ error: '缺少 file_pattern 参数' }, { status: 400 });
  }

  try {
    const { accessToken } = await getWorkflowToken(userId);
    const oauthConfig = await getOAuthConfig();
    const apiBaseUrl = oauthConfig.apiBaseUrl || 'https://api.coze.cn';

    // 提取文件名（用于匹配，去掉协议和域名部分）
    const fileName = file_pattern.split('/').pop() || file_pattern;
    console.log(`[RefreshURL] Searching for file: "${fileName}" in conversation: ${conversation_id}`);

    // 调用 Coze 消息列表 API，重新获取消息（含新签名 URL）
    const listUrl = `${apiBaseUrl}/v3/chat/message/list?chat_id=&conversation_id=${encodeURIComponent(conversation_id)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const listRes = await fetch(listUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!listRes.ok) {
      const errText = await listRes.text().catch(() => '');
      console.error(`[RefreshURL] Coze API error (${listRes.status}):`, errText);
      return NextResponse.json({ error: `获取消息列表失败 (${listRes.status})` }, { status: 502 });
    }

    const listData = await listRes.json();
    if (listData.code !== 0 || !Array.isArray(listData.data)) {
      console.error('[RefreshURL] Unexpected Coze response:', JSON.stringify(listData).slice(0, 500));
      return NextResponse.json({ error: 'Coze 返回数据异常' }, { status: 502 });
    }

    // 正则模式：在文本内容里匹配
    const urlPattern = new RegExp(
      `(https?://[^\\s<>"'\\)]+${escapeRegex(fileName)}(?:\\?[^\\s<>"'\\)]*)?)`,
      'i'
    );

    // 收集所有候选 URL（按优先级：带签名 > 不带签名）
    let foundFileId: string | null = null;
    let bestUrl: string | null = null;
    let bestHasSignature = false;

    for (const msg of listData.data) {
      if (!msg.content) continue;

      // ===== 1. 处理 content 为字符串的情况（answer 类型） =====
      if (typeof msg.content === 'string') {
        // 1a. 直接匹配 TOS URL
        const match = msg.content.match(urlPattern);
        if (match) {
          const url = match[1];
          const hasSig = /[?&]X-Tos-(Algorithm|Signature|Credential)=/i.test(url);
          if (!bestUrl || (hasSig && !bestHasSignature)) {
            bestUrl = url;
            bestHasSignature = hasSig;
          }
        }
        // 1b. 提取 markdown 图片 / 链接中的 file_id 模式
        // 如：![](https://cdn.xxx.com/...)  但 file_id 一般在 object_string
        continue;
      }

      // ===== 2. 处理 content 为对象的情况（file/image/audio/voice 附件类型） =====
      if (typeof msg.content === 'object') {
        const c = msg.content as any;
        // 提取 file_id（用于备用：调用 /v1/files/{file_id}/content 重签）
        if (c.file_id && typeof c.file_id === 'string') {
          foundFileId = c.file_id;
          console.log(`[RefreshURL] Found file_id: ${c.file_id} in message type=${msg.type}`);
        }
        // 提取可能的 URL 字段
        const candidateUrls: string[] = [];
        if (typeof c.file_url === 'string') candidateUrls.push(c.file_url);
        if (typeof c.url === 'string') candidateUrls.push(c.url);
        if (typeof c.image_url === 'string') candidateUrls.push(c.image_url);
        if (c.image_url && typeof c.image_url === 'object' && typeof c.image_url.url === 'string') {
          candidateUrls.push(c.image_url.url);
        }
        // 递归到 object_string（有些版本是 JSON 字符串）
        if (typeof c.object_string === 'string') {
          try {
            const parsed = JSON.parse(c.object_string);
            if (parsed && typeof parsed === 'object') {
              if (typeof parsed.file_url === 'string') candidateUrls.push(parsed.file_url);
              if (typeof parsed.url === 'string') candidateUrls.push(parsed.url);
              if (parsed.file_id && typeof parsed.file_id === 'string') foundFileId = parsed.file_id;
            }
          } catch { /* not JSON */ }
        }

        for (const u of candidateUrls) {
          // 必须包含目标文件名
          if (!u.includes(fileName)) continue;
          const hasSig = /[?&]X-Tos-(Algorithm|Signature|Credential)=/i.test(u);
          if (!bestUrl || (hasSig && !bestHasSignature)) {
            bestUrl = u;
            bestHasSignature = hasSig;
          }
        }
        continue;
      }

      // ===== 3. 处理 content 为 JSON 字符串的情况 =====
      if (typeof msg.content === 'string' && (msg.content.startsWith('{') || msg.content.startsWith('['))) {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed && typeof parsed === 'object') {
            if (parsed.file_id && typeof parsed.file_id === 'string') foundFileId = parsed.file_id;
            const u = parsed.file_url || parsed.url;
            if (typeof u === 'string' && u.includes(fileName)) {
              const hasSig = /[?&]X-Tos-(Algorithm|Signature|Credential)=/i.test(u);
              if (!bestUrl || (hasSig && !bestHasSignature)) {
                bestUrl = u;
                bestHasSignature = hasSig;
              }
            }
          }
        } catch { /* not JSON */ }
      }
    }

    // ===== 找到了带签名的 URL → 直接返回 =====
    if (bestUrl && bestHasSignature) {
      console.log(`[RefreshURL] Found signed URL: ${bestUrl.slice(0, 100)}...`);
      return NextResponse.json({ url: bestUrl });
    }

    // ===== 有 file_id 但没拿到带签名 URL → 调用 v1/files/{file_id}/content 重签 =====
    if (foundFileId) {
      console.log(`[RefreshURL] Trying v1/files/${foundFileId}/content to refresh signed URL...`);
      try {
        const fileController = new AbortController();
        const fileTimeoutId = setTimeout(() => fileController.abort(), 8000);
        const fileRes = await fetch(`${apiBaseUrl}/v1/files/${encodeURIComponent(foundFileId)}/content`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${accessToken}` },
          signal: fileController.signal,
          redirect: 'follow',
        });
        clearTimeout(fileTimeoutId);

        if (fileRes.ok) {
          // Coze 通常返回 302 重定向到带签名的 URL，最终 URL 在 response.url
          // 或者直接返回 JSON { url: signedUrl }
          const finalUrl = fileRes.url || '';
          if (finalUrl && finalUrl !== `${apiBaseUrl}/v1/files/${foundFileId}/content` && /[?&]X-Tos-/i.test(finalUrl)) {
            console.log(`[RefreshURL] Got fresh signed URL via v1/files/.../content redirect`);
            return NextResponse.json({ url: finalUrl });
          }
          // 尝试解析 JSON 响应
          try {
            const json = await fileRes.json();
            const u = json?.url || json?.file_url || json?.data?.url;
            if (typeof u === 'string' && /[?&]X-Tos-/i.test(u)) {
              console.log(`[RefreshURL] Got fresh signed URL via v1/files/.../content JSON`);
              return NextResponse.json({ url: u });
            }
          } catch { /* not JSON */ }
        } else {
          console.warn(`[RefreshURL] v1/files/.../content failed: ${fileRes.status}`);
        }
      } catch (e: any) {
        console.warn(`[RefreshURL] v1/files/.../content error: ${e.message}`);
      }
    }

    // ===== 找到了不带签名的 URL（兜底返回，可能直接 403）=====
    if (bestUrl) {
      console.log(`[RefreshURL] Found URL without signature (may not work): ${bestUrl.slice(0, 100)}...`);
      return NextResponse.json({ url: bestUrl });
    }

    // ===== 都没找到 =====
    console.warn(`[RefreshURL] File "${fileName}" not found in conversation ${conversation_id}, fileId=${foundFileId}`);
    return NextResponse.json(
      { error: '未在该会话中找到对应文件，请重新发送指令生成' },
      { status: 404 }
    );

  } catch (err: any) {
    console.error('[RefreshURL] Unexpected error:', err);
    return NextResponse.json(
      { error: err.message || '刷新链接失败' },
      { status: 500 }
    );
  }
}

/** 转义正则表达式特殊字符 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
