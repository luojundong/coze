import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyToolActivation } from '@/lib/auth-guard';
import { getValidCozeTokenData, refreshCozeToken } from '@/lib/coze-token';
import { createAuditLog } from '@/lib/audit-log';
import { deductCredits } from '@/lib/credit';
import { collectMediaFromMessages, triggerBackgroundDownload } from '@/lib/media-downloader';
import { queryOne } from '@/lib/db';
import { getOAuthConfig } from '@/lib/oauth-config';
import { buildMultimodalUserMessage } from '@/lib/image-inline';

/**
 * 获取调用 Coze API 所需的 Token
 * 优先级：用户 OAuth Token > 平台 Workload API Token (COZE_WORKLOAD_API_TOKEN)
 */
async function getWorkflowToken(userId: string): Promise<{ accessToken: string; cozeUserId?: string; isPlatformToken: boolean }> {
  try {
    const tokenData = await getValidCozeTokenData(userId);
    if (tokenData?.accessToken) {
      return { accessToken: tokenData.accessToken, cozeUserId: tokenData.cozeUserId, isPlatformToken: false };
    }
  } catch {
    console.log(`[Run] User ${userId} has no valid Coze token, trying platform token...`);
  }

  const platformToken = process.env.COZE_WORKLOAD_API_TOKEN;
  if (platformToken) {
    console.log(`[Run] Using platform token for user ${userId}`);
    return { accessToken: platformToken, isPlatformToken: true };
  }

  throw new Error('Coze account not connected. Please authorize your Coze account first.');
}

/**
 * 判断 Coze 返回的错误是否为图像流并发限制
 * 错误特征：
 *   - msg 包含 "图像流同一节点数量" 或 "节点数量超过功能限制"
 *   - 错误码 720712001
 */
function isImageFlowConcurrencyError(errJson: any): boolean {
  if (!errJson) return false;
  const msg = (errJson.msg || errJson.message || '').toLowerCase();
  const code = errJson.error_code || errJson.code;
  // 错误码匹配
  if (code === 720712001) return true;
  // 消息关键词匹配
  if (msg.includes('图像流') && msg.includes('节点数量')) return true;
  if (msg.includes('image flow') && msg.includes('concurrency')) return true;
  return false;
}

/**
 * 带重试的 Coze API fetch
 * 当遇到图像流并发限制错误时，等待随机延迟后重试（最多 2 次）
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 2,
  retryDelayMs: number = 4000
): Promise<{ response: Response; responseText: string; retried: boolean }> {
  let lastResponse: Response | null = null;
  let lastText: string = '';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);
    const responseText = await response.text();

    if (response.ok) {
      // 尝试解析 JSON 看是否有业务错误码
      let data: any = null;
      try { data = JSON.parse(responseText); } catch { /* not JSON, OK */ }

      // HTTP 200 但业务错误
      if (data && data.code !== undefined && data.code !== 0) {
        if (isImageFlowConcurrencyError(data)) {
          console.warn(`[Coze Run] Image flow concurrency limit (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${retryDelayMs}ms...`);
          lastResponse = response;
          lastText = responseText;
          if (attempt < maxRetries) {
            // 随机延迟 4-6 秒，错开并发请求
            const jitter = Math.floor(Math.random() * 2000);
            await new Promise(resolve => setTimeout(resolve, retryDelayMs + jitter));
            continue;
          }
          // 最后一次尝试也失败了
          console.error(`[Coze Run] Image flow concurrency limit exhausted after ${maxRetries + 1} attempts`);
          return { response, responseText, retried: true };
        }
        // 非并发错误，不重试
        return { response, responseText, retried: attempt > 0 };
      }

      // 成功
      return { response, responseText, retried: attempt > 0 };
    }

    // HTTP 错误
    if (attempt < maxRetries) {
      let data: any = null;
      try { data = JSON.parse(responseText); } catch { /* not JSON */ }
      if (isImageFlowConcurrencyError(data)) {
        console.warn(`[Coze Run] Image flow concurrency limit (HTTP ${response.status}, attempt ${attempt + 1}/${maxRetries + 1}), retrying...`);
        lastResponse = response;
        lastText = responseText;
        const jitter = Math.floor(Math.random() * 2000);
        await new Promise(resolve => setTimeout(resolve, retryDelayMs + jitter));
        continue;
      }
    }

    // 非可重试错误，直接返回
    return { response, responseText, retried: attempt > 0 };
  }

  return { response: lastResponse!, responseText: lastText!, retried: true };
}

// 设置路由最大执行时长为 120 秒
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  let body: { tool_id?: string; parameters?: Record<string, unknown>; conversation_id?: string; idempotency_key?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  const { tool_id, parameters, conversation_id: bodyConversationId, idempotency_key: idempotencyKey } = body;
  if (!tool_id) {
    return NextResponse.json({ error: '缺少 tool_id 参数' }, { status: 400 });
  }

  const { activated, error: activationError } = await verifyToolActivation(userId, tool_id);
  if (!activated) {
    return NextResponse.json({ error: activationError, needActivation: true }, { status: 403 });
  }

  const config = await queryOne<any>(
    'SELECT * FROM workflow_configs WHERE id = ? AND is_enabled = 1',
    [tool_id]
  );

  if (!config) {
    return NextResponse.json({ error: '工具不存在或已禁用' }, { status: 404 });
  }

  try {
    // 扣减积分：credit_cost 为 0 表示免费，不扣除；仅当未设置时默认 1
    const creditCost = typeof config.credit_cost === 'number' ? Math.max(0, config.credit_cost) : 1;
    if (creditCost > 0) {
      const deducted = await deductCredits(userId, creditCost, `使用工具: ${config.name}`, undefined, tool_id, idempotencyKey);
      if (deducted.duplicated) {
        console.log(`[Run] Idempotency key ${idempotencyKey} already used, skipping credit deduction`);
      }
      if (!deducted.success) {
        return NextResponse.json({ error: deducted.error || '积分不足，请充值' }, { status: 402 });
      }
    } else {
      console.log(`[Run] Tool ${config.name} is free, skipping credit deduction`);
    }

    const { accessToken, cozeUserId, isPlatformToken } = await getWorkflowToken(userId);
    const oauthConfig = await getOAuthConfig();
    const apiBaseUrl = oauthConfig.apiBaseUrl || 'https://api.coze.cn';

    let endpoint: string;
    let requestBody: Record<string, unknown>;

    if (config.type === 'bot') {
      const conversationId = bodyConversationId || (parameters?.conversation_id as string | undefined);
      const rawUserMessage = typeof parameters?.input === 'string' ? parameters.input : JSON.stringify(parameters ?? {});
      const protocol = req.headers.get('x-forwarded-proto') || 'https';
      const host = req.headers.get('host') || '';
      const publicBaseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.PUBLIC_BASE_URL || `${protocol}://${host}`;
      endpoint = `${apiBaseUrl}/v3/chat`;

      // 多轮对话上下文截断：只保留最近 4 轮（8 条消息），避免历史过长导致推理超时
      const MAX_HISTORY_ROUNDS = 4;
      let truncatedHistory: Array<{ role: string; content: string; content_type: string }> = [];

      if (conversationId) {
        try {
          const histUrl = `${apiBaseUrl}/v3/chat/message/list?chat_id=&conversation_id=${encodeURIComponent(conversationId)}`;
          const histController = new AbortController();
          const histTimeoutId = setTimeout(() => histController.abort(), 8000);
          const histRes = await fetch(histUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${accessToken}` },
            signal: histController.signal,
          });
          clearTimeout(histTimeoutId);

          if (histRes.ok) {
            const histData = await histRes.json();
            if (histData.code === 0 && Array.isArray(histData.data)) {
              // 只保留 user + assistant 消息
              const msgs = histData.data.filter((m: any) =>
                (m.role === 'user' || m.role === 'assistant') && (m.type === 'answer' || m.type === 'input_text')
              );
              // 从末尾截取最近 N 轮（每轮 user + assistant 共 2 条）
              const maxMsgs = MAX_HISTORY_ROUNDS * 2;
              const recentMsgs = msgs.slice(-maxMsgs);
              truncatedHistory = recentMsgs.map((m: any) => ({
                role: m.role,
                content: m.content || '',
                content_type: m.content_type || 'text',
              }));
              console.log(`[Coze Run] History truncated: ${msgs.length} msgs → ${truncatedHistory.length} msgs (${MAX_HISTORY_ROUNDS} rounds max)`);
            }
          } else {
            console.warn(`[Coze Run] Failed to fetch history, starting fresh conversation`);
          }
        } catch (histErr: any) {
          console.warn(`[Coze Run] History fetch error, starting fresh:`, histErr.message);
          // 获取历史失败，直接用新对话（不传 conversation_id）
        }
      }

      // 构建 additional_messages：截断的历史 + 当前多模态用户消息（文本/图片）
      const userMessageObj = buildMultimodalUserMessage(rawUserMessage, publicBaseUrl);
      // 关键修复：开启 auto_save_history 且传入 conversation_id（Coze 用自身保存的历史）时，
      // additional_messages 只能包含「当前这一轮用户消息」，不能再塞历史（含 assistant 消息），
      // 否则 Coze 会报 "Request parameter error"。仅在无 conversation_id 的新对话才把历史一起带上。
      const additionalMessages = conversationId
        ? [userMessageObj]
        : [...truncatedHistory, userMessageObj];

      requestBody = {
        bot_id: config.coze_id,
        user_id: cozeUserId || userId,
        stream: false,
        auto_save_history: true,
        // 有 conversation_id 就始终传递，保证多轮上下文连续（不依赖本地是否成功拉到历史）
        ...(conversationId ? { conversation_id: conversationId } : {}),
        additional_messages: additionalMessages,
      };

      console.log(`[Coze Run] Sending ${additionalMessages.length} messages (history: ${truncatedHistory.length}, new: 1), conversation_id: ${conversationId || 'new'}`);
    } else {
      endpoint = `${apiBaseUrl}/v1/workflow/run`;
      requestBody = {
        workflow_id: config.coze_id,
        parameters: parameters ?? {},
      };
    }

    let { response, responseText, retried } = await fetchWithRetry(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(requestBody),
    });

    // Token 过期兜底：非平台 token 且 Coze 返回 401/令牌无效时，
    // 强制刷新一次并自动重试，避免用户被要求重新连接账户。
    if (!isPlatformToken) {
      let errData: any = null;
      try { errData = JSON.parse(responseText); } catch { /* 非 JSON 忽略 */ }
      const errCode = errData?.error_code || errData?.code;
      const errMsg = (errData?.msg || errData?.message || '').toLowerCase();
      const tokenRejected = response.status === 401 || errCode === 401 || errCode === 4010 ||
        errMsg.includes('token') || errMsg.includes('incorrect') || errMsg.includes('unauthorized');
      if (tokenRejected && !response.ok) {
        try {
          const fresh = await refreshCozeToken(userId);
          console.log(`[Coze Run] Token rejected by Coze, refreshed & retrying for ${config.name}`);
          const retryRes = await fetchWithRetry(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${fresh.accessToken}`,
            },
            body: JSON.stringify(requestBody),
          });
          response = retryRes.response;
          responseText = retryRes.responseText;
          retried = retried || retryRes.retried;
        } catch (refreshErr) {
          console.error('[Coze Run] Token refresh on 401 failed:', (refreshErr as Error)?.message);
        }
      }
    }

    if (retried) {
      console.log(`[Coze Run] Request succeeded after retry for ${config.name}`);
    }

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = null;
    }

    if (!response.ok || (data && data.code !== undefined && data.code !== 0)) {
      const errJson = data || {};
      const code = errJson.error_code || errJson.code;
      let errorMessage = '工具调用失败';
      let needCozeAuth = false;
      let isConcurrencyError = isImageFlowConcurrencyError(errJson);
      
      // Coze token 过期或无效
      if (response.status === 401 || code === 401 || code === 4010 ||
          (errJson.msg || '').toLowerCase().includes('token') || (errJson.msg || '').includes('incorrect')) {
        if (isPlatformToken) {
          errorMessage = '平台 Coze Token 配置异常，请联系管理员检查服务端配置';
          console.error('[Coze Run] Platform token rejected by Coze. Please check COZE_WORKLOAD_API_TOKEN env var.');
        } else {
          errorMessage = 'Coze 授权已过期，请重新连接 Coze 账户';
        }
        needCozeAuth = true;
      } else if (code === 4101 || code === 403) {
        errorMessage = '该智能体暂未发布或无法访问';
      } else if (code === 4000) {
        errorMessage = '智能体参数错误';
      } else if (isConcurrencyError) {
        // 图像流并发限制（重试后仍然失败）
        errorMessage = '当前使用人数较多，智能体中的图像处理节点排队拥挤，请稍后重试';
      } else if (errJson.msg || errJson.message) {
        errorMessage = errJson.msg || errJson.message;
      }

      console.error('[Coze Run] API error:', { status: response.status, code, isConcurrencyError, body: responseText.slice(0, 1000) });

      await createAuditLog({
        userId, action: 'workflow_run', resourceType: config.type, resourceId: config.coze_id,
        status: 'failure', errorMessage: `Coze API error: ${response.status}, code: ${code}, body: ${responseText.slice(0, 500)}`,
        details: { tool_name: config.name, parameters, retried }, req,
      });

      // Coze token 过期用 403 + needCozeAuth，避免被小程序当成 JWT 登录过期
      if (needCozeAuth) {
        return NextResponse.json({ error: errorMessage, needCozeAuth: true }, { status: 403 });
      }
      // 图像流并发限制 → 返回 503，前端可以提示用户重试
      if (isConcurrencyError) {
        return NextResponse.json({ error: errorMessage, retryable: true }, { status: 503 });
      }
      return NextResponse.json({ error: errorMessage }, { status: response.status >= 400 ? response.status : 500 });
    }

    // 解析响应
    let result;
    try {
      if (config.type === 'bot') {
        // Coze v3/chat 非流式返回：{ code: 0, data: { id, conversation_id, status } }
        // 步骤 1: 提取 chat_id 和 conversation_id
        const chatData = data?.data || data || {};
        const chatId = chatData.id || chatData.chat_id || data?.id || data?.chat_id;
        const conversationId = chatData.conversation_id || data?.conversation_id || '';
        const chatStatus = chatData.status || data?.status || '';

        console.log('[Coze Run] Chat initiated:', { chatId, conversationId, chatStatus, raw: JSON.stringify(data).slice(0, 500) });

        if (!chatId) {
          console.error('[Coze Run] No chat_id in response:', JSON.stringify(data).slice(0, 1000));
          return NextResponse.json({ error: '智能体调用失败，请稍后重试' }, { status: 500 });
        }

        if (chatStatus === 'failed') {
          console.error('[Coze Run] Chat failed immediately:', JSON.stringify(data).slice(0, 1000));
          return NextResponse.json({ error: '智能体调用失败，请稍后重试' }, { status: 500 });
        }

        // 步骤 2: 轮询等待智能体处理完成
        // 使用 GET /v3/chat/retrieve（官方标准），间隔 2s 避免 429 限流
        let finalConversationId = conversationId;
        let currentStatus = chatStatus;
        const MAX_LOOP = 40;          // 最大轮询 40 次
        const POLL_INTERVAL = 2000;   // 间隔 2 秒（总时长 ≈ 80 秒，覆盖图片/音视频处理场景）

        for (let i = 0; i < MAX_LOOP; i++) {
          // 第一次不 sleep（chat 刚返回时可能已是 completed）
          if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
          }

          // 带超时的 fetch（单次请求 10 秒）
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);

          let retrieveRes: Response;
          try {
            const retrieveUrl = `${apiBaseUrl}/v3/chat/retrieve?chat_id=${encodeURIComponent(chatId)}&conversation_id=${encodeURIComponent(finalConversationId)}`;
            retrieveRes = await fetch(retrieveUrl, {
              method: 'GET',
              headers: { 'Authorization': `Bearer ${accessToken}` },
              signal: controller.signal,
            });
          } catch (fetchErr: any) {
            clearTimeout(timeoutId);
            console.error(`[Coze Run] Poll ${i + 1} retrieve fetch error:`, fetchErr.message);
            // 网络错误重试，不直接放弃
            continue;
          }
          clearTimeout(timeoutId);

          if (!retrieveRes.ok) {
            const retrieveErrText = await retrieveRes.text().catch(() => '');
            console.error(`[Coze Run] Poll ${i + 1} retrieve failed:`, retrieveRes.status, retrieveErrText.slice(0, 500));
            // HTTP 错误也重试
            continue;
          }

          const retrieveData = await retrieveRes.json();
          const retrieveResult = retrieveData?.data || retrieveData || {};
          currentStatus = retrieveResult.status || retrieveData?.status || '';
          finalConversationId = retrieveResult.conversation_id || finalConversationId;

          console.log(`[Coze Run] Poll ${i + 1}/${MAX_LOOP}: status=${currentStatus}`);

          if (currentStatus === 'completed') {
            break;
          }
          if (currentStatus === 'failed' || currentStatus === 'cancelled') {
            console.error(`[Coze Run] Chat ${currentStatus}:`, JSON.stringify(retrieveResult).slice(0, 500));
            return NextResponse.json({ error: '智能体执行失败，请稍后重试' }, { status: 500 });
          }
          // created / in_progress → 继续轮询
        }

        if (currentStatus !== 'completed') {
          console.error(`[Coze Run] Poll exhausted after ${MAX_LOOP} retries, last status: ${currentStatus}`);
          return NextResponse.json({ error: '智能体响应超时，请稍后重试' }, { status: 500 });
        }

        // 步骤 3: GET /v3/chat/message/list 获取消息
        console.log(`[Coze Run] Fetching messages: chat_id=${chatId}, conversation_id=${finalConversationId}`);
        const msgUrl = `${apiBaseUrl}/v3/chat/message/list?chat_id=${encodeURIComponent(chatId)}&conversation_id=${encodeURIComponent(finalConversationId)}`;
        const msgController = new AbortController();
        const msgTimeoutId = setTimeout(() => msgController.abort(), 15000);

        let msgRes: Response;
        try {
          msgRes = await fetch(msgUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${accessToken}` },
            signal: msgController.signal,
          });
        } catch (msgFetchErr: any) {
          clearTimeout(msgTimeoutId);
          console.error(`[Coze Run] message/list fetch error:`, msgFetchErr.message);
          return NextResponse.json({ error: '获取智能体回复超时，请稍后重试' }, { status: 500 });
        }
        clearTimeout(msgTimeoutId);

        if (!msgRes.ok) {
          const msgErrText = await msgRes.text().catch(() => '');
          console.error(`[Coze Run] message/list failed:`, msgRes.status, msgErrText.slice(0, 500));
          return NextResponse.json({ error: '获取智能体回复失败，请稍后重试' }, { status: 500 });
        }

        const msgData = await msgRes.json();
        console.log(`[Coze Run] message/list raw (first 2000 chars):`, JSON.stringify(msgData).slice(0, 2000));

        if (msgData.code !== 0) {
          console.error(`[Coze Run] message/list API error: code=${msgData.code}, msg=${msgData.msg}`);
          return NextResponse.json({ error: msgData.msg || '获取智能体回复失败' }, { status: 500 });
        }

        // data 直接就是消息数组: { code: 0, msg: "success", data: [...] }
        const msgArr: any[] = Array.isArray(msgData.data) ? msgData.data : [];
        console.log(`[Coze Run] Messages count:`, msgArr.length);

        let content = '';
        if (msgArr.length > 0) {
          msgArr.forEach((m: any, idx: number) => {
            console.log(`[Coze Run]   msg[${idx}]: type=${m.type}, role=${m.role}, content_type=${m.content_type}, content=${(m.content || '').slice(0, 200)}`);
          });

          // 找 role === 'assistant' 且 type === 'answer'
          const answerItem = msgArr.find((m: any) => m.role === 'assistant' && m.type === 'answer');
          content = answerItem?.content?.trim() || '';

          // 兜底：只按 type === 'answer'
          if (!content) {
            const answerOnly = msgArr.find((m: any) => m.type === 'answer');
            content = answerOnly?.content?.trim() || '';
          }
        }

        console.log(`[Coze Run] Got content (${content.length} chars):`, content.slice(0, 500));

        if (!content) {
          return NextResponse.json({ error: '智能体未返回有效回复，请稍后重试' }, { status: 500 });
        }

        result = { output: content, conversation_id: finalConversationId };

        // 收集媒体URL，后台下载到 /public/download/
        if (msgArr.length > 0) {
          const mediaUrls = collectMediaFromMessages(msgArr);
          if (mediaUrls.length > 0) {
            const downloadTaskId = `${userId.slice(0, 8)}_${finalConversationId || 'bot'}_${Date.now()}`;
            triggerBackgroundDownload(downloadTaskId, mediaUrls, config.name);
          }
        }
      } else {
        // Workflow run 非流式返回
        // 从 data 中提取实际输出，可能嵌套在 JSON 字符串里
        let output = data;
        const rawData = data?.data ?? data;
        if (rawData && typeof rawData === 'string') {
          try { output = JSON.parse(rawData); } catch { output = rawData; }
        }
        result = { output: typeof output === 'string' ? output : JSON.stringify(output) };
      }
    } catch (parseErr) {
      // 如果不是 JSON，可能是文本
      console.error('[Coze Run] Parse error:', parseErr);
      result = { output: responseText };
    }

    await createAuditLog({
      userId, action: 'workflow_run', resourceType: config.type, resourceId: config.coze_id,
      details: { tool_name: config.name }, req,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    await createAuditLog({
      userId, action: 'workflow_run', resourceType: config.type, resourceId: config.coze_id,
      status: 'failure', errorMessage: message, details: { tool_name: config.name, parameters }, req,
    });
    if (message.includes('Coze account not connected') || message.includes('No refresh token') || message.includes('Coze token expired')) {
      return NextResponse.json({ error: '请先连接您的 Coze 账户', needCozeAuth: true }, { status: 403 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
