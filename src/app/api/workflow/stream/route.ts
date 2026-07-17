import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyToolActivation } from '@/lib/auth-guard';
import { getValidCozeTokenData, getCozeToken, refreshCozeToken } from '@/lib/coze-token';
import { createAuditLog } from '@/lib/audit-log';
import { deductCredits } from '@/lib/credit';
import { collectMediaFromSSEEvent, collectMediaFromMessages, triggerBackgroundDownload } from '@/lib/media-downloader';
import { queryOne } from '@/lib/db';
import { getOAuthConfig } from '@/lib/oauth-config';
import { genId } from '@/lib/db';
import { buildMultimodalUserMessage } from '@/lib/image-inline';

/**
 * 获取调用 Coze API 所需的 Token
 * 优先级：用户 OAuth Token > 平台 Workload API Token (COZE_WORKLOAD_API_TOKEN)
 * 当用户未连接 Coze 时，使用平台 token 作为降级方案
 */
async function getWorkflowToken(userId: string): Promise<{ accessToken: string; cozeUserId?: string; isPlatformToken: boolean }> {
  // 1. 优先尝试获取用户自己的 Coze token
  try {
    const tokenData = await getValidCozeTokenData(userId);
    if (tokenData?.accessToken) {
      return { accessToken: tokenData.accessToken, cozeUserId: tokenData.cozeUserId, isPlatformToken: false };
    }
  } catch {
    // 用户未连接 Coze 或 token 已过期
    console.log(`[Stream] User ${userId} has no valid Coze token, trying platform token...`);
  }

  // 2. 降级：使用平台 Workload API Token
  const platformToken = process.env.COZE_WORKLOAD_API_TOKEN;
  if (platformToken) {
    console.log(`[Stream] Using platform token for user ${userId}`);
    return { accessToken: platformToken, isPlatformToken: true };
  }

  // 3. 都没有 → 抛出错误
  throw new Error('Coze account not connected. Please authorize your Coze account first.');
}

/**
 * 判断 Coze 返回的错误是否为图像流并发限制
 */
function isImageFlowConcurrencyError(errJson: any): boolean {
  if (!errJson) return false;
  const msg = (errJson.msg || errJson.message || '').toLowerCase();
  const code = errJson.error_code || errJson.code;
  if (code === 720712001) return true;
  if (msg.includes('图像流') && msg.includes('节点数量')) return true;
  if (msg.includes('image flow') && msg.includes('concurrency')) return true;
  return false;
}

/**
 * 带重试的 Coze API fetch
 * 遇到图像流并发限制时等待 4-6 秒后重试，最多重试 2 次
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 2,
  retryDelayMs: number = 4000
): Promise<{ response: Response; responseText: string; retried: boolean; bodyConsumed: boolean }> {
  let lastText: string = '';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type') || '';
    const isStream = contentType.includes('text/event-stream');

    // SSE 流式响应：只检查 HTTP 状态码和 response.ok，不消费 body
    if (isStream) {
      if (response.ok) {
        // SSE 成功响应，直接返回原始 response，body 完整保留
        return { response, responseText: '', retried: attempt > 0, bodyConsumed: false };
      }
      // SSE 非 200 错误：读取 text 看是否是并发错误
      let errText = '';
      try { errText = await response.text(); } catch { /* ignore */ }
      lastText = errText;
      if (attempt < maxRetries) {
        let data: any = null;
        try { data = JSON.parse(errText); } catch { /* not JSON */ }
        if (isImageFlowConcurrencyError(data)) {
          console.warn(`[Stream] Image flow concurrency limit (HTTP ${response.status}, attempt ${attempt + 1}/${maxRetries + 1}), retrying...`);
          const jitter = Math.floor(Math.random() * 2000);
          await new Promise(resolve => setTimeout(resolve, retryDelayMs + jitter));
          continue;
        }
      }
      return { response, responseText: errText, retried: attempt > 0, bodyConsumed: true };
    }

    // 非 SSE 响应（JSON）：直接读 text 做错误检查
    const responseText = await response.text();

    if (response.ok) {
      let data: any = null;
      try { data = JSON.parse(responseText); } catch { /* not JSON, OK */ }
      if (data && data.code !== undefined && data.code !== 0) {
        if (isImageFlowConcurrencyError(data)) {
          console.warn(`[Stream] Image flow concurrency limit (attempt ${attempt + 1}/${maxRetries + 1}), retrying...`);
          lastText = responseText;
          if (attempt < maxRetries) {
            const jitter = Math.floor(Math.random() * 2000);
            await new Promise(resolve => setTimeout(resolve, retryDelayMs + jitter));
            continue;
          }
          return { response, responseText, retried: true, bodyConsumed: true };
        }
        return { response, responseText, retried: attempt > 0, bodyConsumed: true };
      }
      return { response, responseText, retried: attempt > 0, bodyConsumed: true };
    }

    if (attempt < maxRetries) {
      let data: any = null;
      try { data = JSON.parse(responseText); } catch { /* not JSON */ }
      if (isImageFlowConcurrencyError(data)) {
        console.warn(`[Stream] Image flow concurrency limit (HTTP ${response.status}, attempt ${attempt + 1}/${maxRetries + 1}), retrying...`);
        lastText = responseText;
        const jitter = Math.floor(Math.random() * 2000);
        await new Promise(resolve => setTimeout(resolve, retryDelayMs + jitter));
        continue;
      }
    }

    return { response, responseText, retried: attempt > 0, bodyConsumed: true };
  }

  // 所有重试耗尽
  return { response: null as any, responseText: lastText, retried: true, bodyConsumed: true };
}

// 设置路由最大执行时长为 300 秒（音频/视频生成需要更长时间）
export const maxDuration = 300;

/**
 * 混合架构：SSE 流式推送 + 异步任务兜底
 *
 * 1. 优先 SSE 透传给前端（Web ReadableStream / 小程序 enableChunked）
 * 2. 同步将累积结果写入 taskStore（供轮询降级）
 * 3. 扣积分 + 多轮对话历史截断
 */

// 任务存储（与 task/run 共享同一个 Map）
// 由于 Next.js 模块缓存机制，同一模块只加载一次，export 后其他路由可 import
const taskStore = new Map<string, {
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: { output: string; conversation_id?: string };
  error?: string;
  chunk?: string;          // 流式增量片段（供轮询端获取部分内容）
  createdAt: number;
  userId: string;
}>();

// 全局活跃任务引用：防止 fire-and-forget Promise 被 GC 回收
const activeTasks = new Map<string, Promise<void>>();

// 定期清理过期任务（超过 10 分钟）
const TASK_TTL = 10 * 60 * 1000;
function cleanupTasks() {
  const now = Date.now();
  for (const [id, task] of taskStore) {
    if (now - task.createdAt > TASK_TTL) {
      taskStore.delete(id);
      activeTasks.delete(id);
    }
  }
}
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupTasks, 2 * 60 * 1000);
}

export { taskStore };

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
    const { accessToken, cozeUserId, isPlatformToken } = await getWorkflowToken(userId);
    const oauthConfig = await getOAuthConfig();
    const apiBaseUrl = oauthConfig.apiBaseUrl || 'https://api.coze.cn';

    // 扣减积分：credit_cost 为 0 表示免费，不扣除；仅当未设置时默认 1
    const creditCost = typeof config.credit_cost === 'number' ? Math.max(0, config.credit_cost) : 1;
    if (creditCost > 0) {
      const deducted = await deductCredits(userId, creditCost, `使用工具: ${config.name}`, undefined, tool_id, idempotencyKey);
      if (deducted.duplicated) {
        console.log(`[Stream] Idempotency key ${idempotencyKey} already used, skipping credit deduction`);
      }
      if (!deducted.success) {
        return NextResponse.json({ error: deducted.error || '积分不足，请充值' }, { status: 402 });
      }
    } else {
      console.log(`[Stream] Tool ${config.name} is free, skipping credit deduction`);
    }

    // Workflow 类型保持同步（不支持流式），但统一返回 SSE 格式
    // 避免前端因 content-type 不匹配而报 "无法读取响应流"
    if (config.type !== 'bot') {
      let wfOutput = '未收到回复';
      let wfConversationId = '';

      try {
        const wfRes = await fetch(`${apiBaseUrl}/v1/workflow/run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            workflow_id: config.coze_id,
            parameters: parameters ?? {},
          }),
        });

        const wfText = await wfRes.text();
        console.log(`[Stream ${config.coze_id}] Workflow response (first 1000 chars):`, wfText.slice(0, 1000));

        if (wfRes.ok) {
          let wfData: any;
          try { wfData = JSON.parse(wfText); } catch { wfData = wfText; }

          // 尝试解析 Coze workflow 标准响应
          if (wfData && typeof wfData === 'object') {
            // 标准格式: { code: 0, data: "..." } 或 { code: 0, msg: "..." }
            const wfCode = wfData.code;
            if (wfCode !== undefined && wfCode !== 0) {
              wfOutput = wfData.msg || wfData.message || `工作流执行失败 (code: ${wfCode})`;
            } else if (typeof wfData.data === 'string') {
              wfOutput = wfData.data;
            } else if (wfData.data && typeof wfData.data === 'object') {
              // { code: 0, data: { output: "..." } }
              wfOutput = wfData.data.output || wfData.data.content || JSON.stringify(wfData.data);
            } else if (wfData.msg) {
              wfOutput = wfData.msg;
            } else if (wfData.output) {
              wfOutput = wfData.output;
            } else if (wfData.content) {
              wfOutput = wfData.content;
            } else {
              wfOutput = JSON.stringify(wfData);
            }
          } else {
            wfOutput = String(wfData || '未收到回复');
          }
        } else {
          // HTTP 错误
          let errMsg = `工作流调用失败 (HTTP ${wfRes.status})`;
          try {
            const errJson = JSON.parse(wfText);
            errMsg = errJson.msg || errJson.message || errMsg;
          } catch { /* keep default */ }
          wfOutput = errMsg;
        }
      } catch (e: any) {
        console.error(`[Stream ${config.coze_id}] Workflow fetch error:`, e.message);
        wfOutput = `工作流调用异常: ${e.message}`;
      }

      await createAuditLog({
        userId, action: 'workflow_stream', resourceType: config.type, resourceId: config.coze_id,
        details: { tool_name: config.name }, req,
      });

      // 统一返回 SSE 格式，前端可以正确解析
      const sseBody = `event: conversation.message.completed\ndata: ${JSON.stringify({ type: 'answer', content: wfOutput, conversation_id: wfConversationId })}\n\nevent: done\ndata: [DONE]\n\n`;
      return new Response(sseBody, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // ===================== Bot 类型：SSE 流式 + 异步兜底 =====================
    const taskId = genId();
    let conversationIdForBody = bodyConversationId || (parameters?.conversation_id as string | undefined);
    const rawUserMessage = typeof parameters?.input === 'string' ? parameters.input : JSON.stringify(parameters ?? {});
    const protocol = req.headers.get('x-forwarded-proto') || 'https';
    const host = req.headers.get('host') || '';
    const publicBaseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.PUBLIC_BASE_URL || `${protocol}://${host}`;

    // 初始化任务
    taskStore.set(taskId, {
      status: 'running',
      chunk: '',
      createdAt: Date.now(),
      userId,
    });

    // 多轮对话历史截断（同步获取一次，SSE 主路径和后台 taskPromise 共用）
    let truncatedHistory: Array<{ role: string; content: string; content_type: string }> = [];
    const MAX_HISTORY_ROUNDS = 4;

    if (conversationIdForBody) {
      try {
        const histUrl = `${apiBaseUrl}/v3/chat/message/list?chat_id=&conversation_id=${encodeURIComponent(conversationIdForBody)}`;
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
            const msgs = histData.data.filter((m: any) =>
              (m.role === 'user' || m.role === 'assistant') && (m.type === 'answer' || m.type === 'input_text')
            );
            const maxMsgs = MAX_HISTORY_ROUNDS * 2;
            truncatedHistory = msgs.slice(-maxMsgs).map((m: any) => ({
              role: m.role,
              content: m.content || '',
              content_type: m.content_type || 'text',
            }));
          } else {
            // conversation 已失效/不存在（history 接口返回非 0 code）→ 丢弃该 id，新建 conversation
            console.warn(`[Stream ${taskId}] conversation_id ${conversationIdForBody} invalid on history fetch (code=${histData?.code}), will create a new conversation instead`);
            conversationIdForBody = '';
          }
        } else {
          // HTTP 错误（404/400 等）→ conversation 不存在/失效 → 丢弃该 id，新建 conversation
          console.warn(`[Stream ${taskId}] conversation_id ${conversationIdForBody} history fetch HTTP ${histRes.status}, will create a new conversation instead`);
          conversationIdForBody = '';
        }
      } catch (e: any) {
        console.warn(`[Stream ${taskId}] History fetch error for ${conversationIdForBody}:`, e.message, '-> creating new conversation');
        conversationIdForBody = '';
      }
    }

    const userMessageObj = buildMultimodalUserMessage(rawUserMessage, publicBaseUrl);
    // 关键修复：开启 auto_save_history 且传入 conversation_id（Coze 用自身保存的历史）时，
    // additional_messages 只能包含「当前这一轮用户消息」，不能再塞历史（含 assistant 消息），
    // 否则 Coze 会报 "Request parameter error"。仅在无 conversation_id 的新对话才把历史一起带上。
    const additionalMessages = conversationIdForBody
      ? [userMessageObj]
      : [...truncatedHistory, userMessageObj];

    const requestBody: Record<string, unknown> = {
      bot_id: config.coze_id,
      user_id: cozeUserId || userId,
      stream: true,
      auto_save_history: true,
      additional_messages: additionalMessages,
    };

    // 只要前端提供了 conversation_id，就始终传给 Coze，确保多轮上下文连续
    if (conversationIdForBody) {
      requestBody.conversation_id = conversationIdForBody;
    }

    console.log(`[Stream ${taskId}] Calling Coze /v3/chat, bot_id: ${config.coze_id}, apiBaseUrl: ${apiBaseUrl}`);
    console.log(`[Stream ${taskId}] Request body:`, JSON.stringify(requestBody).slice(0, 500));

    // ===== 关键：只发起一次 Coze 请求（Token 失效时自动刷新并重试一次）=====
    let { response: cozeResponse, responseText: cozeText, retried, bodyConsumed } = await fetchWithRetry(`${apiBaseUrl}/v3/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(requestBody),
    });

    // 非平台 token 且 Coze 返回 401/令牌无效：强制刷新一次并重试，避免用户被要求重新连接账户
    if (!isPlatformToken && cozeResponse && !cozeResponse.ok) {
      let errData: any = null;
      try { errData = JSON.parse(cozeText); } catch { /* 忽略 */ }
      const errCode = errData?.error_code || errData?.code;
      const errMsg = (errData?.msg || errData?.message || '').toLowerCase();
      const tokenRejected = cozeResponse.status === 401 || errCode === 401 || errCode === 4010 ||
        errMsg.includes('token') || errMsg.includes('authentication') || errMsg.includes('incorrect') || errMsg.includes('unauthorized');
      if (tokenRejected) {
        try {
          const fresh = await refreshCozeToken(userId);
          console.log(`[Stream ${taskId}] Token rejected, refreshed & retrying`);
          const retryRes = await fetchWithRetry(`${apiBaseUrl}/v3/chat`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${fresh.accessToken}`,
            },
            body: JSON.stringify(requestBody),
          });
          cozeResponse = retryRes.response;
          cozeText = retryRes.responseText;
          retried = retried || retryRes.retried;
          bodyConsumed = retryRes.bodyConsumed;
        } catch (refreshErr) {
          console.error(`[Stream ${taskId}] Token refresh on 401 failed:`, (refreshErr as Error)?.message);
        }
      }
    }

    // 所有重试耗尽，cozeResponse 为 null
    if (!cozeResponse) {
      console.error(`[Stream ${taskId}] All retries exhausted`);
      taskStore.set(taskId, {
        status: 'failed',
        error: '当前使用人数较多，智能体中的图像处理节点排队拥挤，请稍后重试',
        createdAt: Date.now(),
        userId,
      });
      return NextResponse.json({ error: '当前使用人数较多，智能体中的图像处理节点排队拥挤，请稍后重试', retryable: true }, { status: 503 });
    }

    if (retried) {
      console.log(`[Stream ${taskId}] Request succeeded after retry`);
    }

    const cozeContentType = cozeResponse.headers.get('content-type') || '';
    console.log(`[Stream ${taskId}] Coze response status: ${cozeResponse.status}, content-type: ${cozeContentType}, body: ${!!cozeResponse.body}, bodyUsed: ${cozeResponse.bodyUsed}, bodyLocked: ${(cozeResponse.body as any)?.locked}`);

    if (!cozeResponse.ok) {
      console.error(`[Stream ${taskId}] Coze error response body:`, cozeText.slice(0, 1000));
      let errorMessage = '工具流式调用失败';
      let needCozeAuth = false;
      let isConcurrencyError = false;
      try {
        const errJson = JSON.parse(cozeText);
        const code = errJson.error_code || errJson.code;
        const msg = errJson.msg || errJson.message || '';
        isConcurrencyError = isImageFlowConcurrencyError(errJson);
        // Token 无效或过期 → 需要重新授权
        if (cozeResponse.status === 401 || code === 401 || code === 4010 ||
            msg.toLowerCase().includes('token') || msg.includes('authentication') || msg.includes('incorrect')) {
          needCozeAuth = true;
          // 区分平台 Token 和用户 Token 的错误提示
          if (isPlatformToken) {
            errorMessage = '平台 Coze Token 配置异常，请联系管理员检查服务端配置';
            console.error(`[Stream ${taskId}] Platform token rejected by Coze. Please check COZE_WORKLOAD_API_TOKEN env var.`);
          } else {
            errorMessage = 'Coze Token 已失效，请重新连接 Coze 账户';
          }
        } else if (code === 4101 || code === 403) errorMessage = '该智能体暂未发布或无法访问';
        else if (code === 4000) errorMessage = `智能体参数错误${errJson.param ? ` (${errJson.param})` : ''}`;
        else if (isConcurrencyError) errorMessage = '当前使用人数较多，智能体中的图像处理节点排队拥挤，请稍后重试';
      } catch { /* keep default */ }

      // 更新 taskStore 为失败
      taskStore.set(taskId, {
        status: 'failed',
        error: errorMessage,
        createdAt: Date.now(),
        userId,
      });

      await createAuditLog({
        userId, action: 'workflow_stream', resourceType: config.type, resourceId: config.coze_id,
        status: 'failure', errorMessage: `Coze API error: ${cozeResponse.status}`,
        details: { tool_name: config.name, parameters, retried }, req,
      });

      if (needCozeAuth) {
        return NextResponse.json({ error: errorMessage, needCozeAuth: true }, { status: cozeResponse.status });
      }
      if (isConcurrencyError) {
        return NextResponse.json({ error: errorMessage, retryable: true }, { status: 503 });
      }
      return NextResponse.json({ error: errorMessage, details: cozeText, needCozeAuth }, { status: cozeResponse.status });
    }

    // ===================== 非 SSE 响应（application/json）处理 =====================
    if (cozeContentType.includes('application/json') && !cozeContentType.includes('text/event-stream')) {
      // bodyConsumed=true 表示 fetchWithRetry 已读过 body，使用 cozeText
      // bodyConsumed=false 表示 body 完整，需要手动读取
      const jsonText = bodyConsumed ? cozeText : await cozeResponse.text();
      console.log(`[Stream ${taskId}] Non-stream JSON response (first 2000 chars):`, jsonText.slice(0, 2000));

      let output = '未收到回复';
      let conversationId = '';
      let needCozeAuth = false;
      let isConcurrencyError = false;

      try {
        const jsonData = JSON.parse(jsonText);
        console.log(`[Stream ${taskId}] Parsed JSON keys:`, Object.keys(jsonData));

        // Coze 错误响应：code !== 0
        if (jsonData.code !== undefined && jsonData.code !== 0) {
          const errMsg = jsonData.msg || jsonData.message || `错误码: ${jsonData.code}`;
          // 检测 token/auth 相关错误
          const lcMsg = String(errMsg).toLowerCase();
          if (lcMsg.includes('token') || lcMsg.includes('incorrect') ||
              lcMsg.includes('authentication') || lcMsg.includes('unauthorized') ||
              jsonData.code === 401 || jsonData.code === 4010) {
            needCozeAuth = true;
            if (isPlatformToken) {
              output = '平台 Coze Token 配置异常，请联系管理员检查服务端配置';
              console.error(`[Stream ${taskId}] Platform token rejected by Coze. Please check COZE_WORKLOAD_API_TOKEN env var.`);
            } else {
              output = 'Coze Token 已失效，请重新连接 Coze 账户';
            }
          } else if (isImageFlowConcurrencyError(jsonData)) {
            isConcurrencyError = true;
            output = '当前使用人数较多，智能体中的图像处理节点排队拥挤，请稍后重试';
          } else {
            output = `智能体调用失败: ${errMsg}`;
          }
        } else if (jsonData.code === 0 && jsonData.data) {
          conversationId = jsonData.data.conversation_id || '';
          const messages = jsonData.data.messages || [];
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === 'assistant' && msg.type === 'answer' && msg.content) {
              output = msg.content;
              break;
            }
          }
          if (output === '未收到回复') {
            for (let i = messages.length - 1; i >= 0; i--) {
              const msg = messages[i];
              if (msg.role === 'assistant' && msg.content) {
                output = msg.content;
                break;
              }
            }
          }

          // 收集媒体URL，后台下载到 /public/download/（不影响文本回复）
          if (messages.length > 0) {
            const mediaUrls = collectMediaFromMessages(messages);
            if (mediaUrls.length > 0) {
              triggerBackgroundDownload(taskId, mediaUrls, config.name);
            }
          }
        } else if (jsonData.msg) {
          output = `智能体返回: ${jsonData.msg}`;
        } else {
          output = JSON.stringify(jsonData);
        }
      } catch (parseErr: any) {
        console.error(`[Stream ${taskId}] JSON parse error:`, parseErr.message);
        output = jsonText.slice(0, 5000);
      }

      console.log(`[Stream ${taskId}] Non-stream result: ${output.length} chars, convId: ${conversationId}`);

      // 更新 taskStore
      taskStore.set(taskId, {
        status: needCozeAuth ? 'failed' : (isConcurrencyError ? 'failed' : 'completed'),
        result: { output, conversation_id: conversationId },
        chunk: output,
        error: (needCozeAuth || isConcurrencyError) ? output : undefined,
        createdAt: Date.now(),
        userId,
      });

      await createAuditLog({
        userId, action: 'workflow_stream', resourceType: config.type, resourceId: config.coze_id,
        status: (needCozeAuth || isConcurrencyError) ? 'failure' : 'success',
        errorMessage: (needCozeAuth || isConcurrencyError) ? output : undefined,
        details: { tool_name: config.name, needCozeAuth, isConcurrencyError }, req,
      });

      const sseBody = `event: conversation.message.completed\ndata: ${JSON.stringify({ type: 'answer', content: output, conversation_id: conversationId })}\n\nevent: done\ndata: [DONE]\n\n`;
      return new Response(sseBody, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // ===================== SSE 流式响应处理 =====================
    // 不使用 clone()！Node.js fetch (undici) 在某些情况下 clone 会失败
    // 改为单一流管道：从 cozeResponse.body 读取 → 透传给前端 + 同步累积到 taskStore

    // 安全检查：如果 body 已在 fetchWithRetry 中被消费，无法进行 SSE 流式传输
    if (bodyConsumed) {
      console.error(`[Stream ${taskId}] Body was consumed in fetchWithRetry, cannot stream. Falling back to text response.`);
      // 尝试用 cozeText 中的内容作为兜底
      let fallbackOutput = '智能体响应异常，请稍后重试';
      try {
        const data = JSON.parse(cozeText);
        if (data.msg) fallbackOutput = data.msg;
        else if (data.message) fallbackOutput = data.message;
      } catch { /* keep default */ }
      taskStore.set(taskId, { status: 'failed', error: fallbackOutput, createdAt: Date.now(), userId });
      const sseBody = `event: conversation.message.completed\ndata: ${JSON.stringify({ type: 'answer', content: fallbackOutput })}\n\nevent: done\ndata: [DONE]\n\n`;
      return new Response(sseBody, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
      });
    }

    await createAuditLog({
      userId, action: 'workflow_stream', resourceType: config.type, resourceId: config.coze_id,
      details: { tool_name: config.name }, req,
    });

    const cozeReader = cozeResponse.body?.getReader();
    if (!cozeReader) {
      taskStore.set(taskId, { status: 'failed', error: '智能体响应异常', createdAt: Date.now(), userId });
      return NextResponse.json({ error: '智能体响应异常' }, { status: 502 });
    }

    // 使用 ReadableStream 构造 SSE 输出：同时透传数据 + 解析 SSE 事件更新 taskStore
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';
    let convId = '';
    let taskIdInjected = false;

    // 注册后台任务引用，防止 GC
    const bgPromise = (async () => {
      // 等待流结束再清理
    })();
    activeTasks.set(taskId, bgPromise);

    const readable = new ReadableStream({
      async start(controller) {
        try {
          // 注入 task_id 事件，供小程序轮询降级
          const taskIdEvent = `event: task_id\ndata: ${JSON.stringify({ task_id: taskId })}\n\n`;
          controller.enqueue(encoder.encode(taskIdEvent));
          taskIdInjected = true;
          console.log(`[Stream ${taskId}] Injected task_id event for fallback polling`);

          const SSE_READ_TIMEOUT = 60000;  // 60 秒（音频/视频生成间隔更长）
          let consecutiveEmptyReads = 0;
          const MAX_EMPTY_READS = 10;  // 10 × 60s = 600s，给音频+视频+图片复合生成足够时间
          const collectedMediaUrls: string[] = [];  // 收集 SSE 事件中的媒体 URL

          while (true) {
            let readResult: ReadableStreamReadResult<Uint8Array>;
            try {
              const readPromise = cozeReader.read();
              const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('read_timeout')), SSE_READ_TIMEOUT)
              );
              readResult = await Promise.race([readPromise, timeoutPromise]);
            } catch (e: any) {
              if (e.message === 'read_timeout') {
                consecutiveEmptyReads++;
                console.warn(`[Stream ${taskId}] Coze SSE read timeout (${consecutiveEmptyReads}/${MAX_EMPTY_READS})`);
                if (consecutiveEmptyReads >= MAX_EMPTY_READS) {
                  console.error(`[Stream ${taskId}] Coze SSE no data for too long, aborting`);
                  taskStore.set(taskId, {
                    status: 'failed',
                    error: '智能体响应超时，请稍后重试',
                    chunk: accumulated || '',
                    createdAt: Date.now(),
                    userId,
                  });
                  controller.error(new Error('Coze SSE timeout'));
                  return;
                }
                continue;
              }
              throw e;
            }

            if (readResult.done) {
              consecutiveEmptyReads = 0;
              taskStore.set(taskId, {
                status: 'completed',
                result: { output: accumulated || '未收到回复', conversation_id: convId },
                chunk: accumulated || '未收到回复',
                createdAt: Date.now(),
                userId,
              });
              console.log(`[Stream ${taskId}] Stream completed: ${accumulated.length} chars, convId: ${convId}`);
              // 后台下载收集到的媒体文件到 /public/download/
              if (collectedMediaUrls.length > 0) {
                triggerBackgroundDownload(taskId, collectedMediaUrls, config.name);
              }
              // 显式发送 done 事件再关闭流，帮助小程序/前端在 success 回调不可靠时也能识别结束
              try {
                const doneEvent = `event: done\ndata: [DONE]\n\n`;
                controller.enqueue(encoder.encode(doneEvent));
              } catch { /* ignore if controller already closed */ }
              controller.close();
              return;
            }

            consecutiveEmptyReads = 0;
            // 透传原始数据给前端
            controller.enqueue(readResult.value);

            // 解析 SSE 事件，同步更新 taskStore
            const text = decoder.decode(readResult.value, { stream: true });
            buffer += text;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            let currentEvent = '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('event:')) {
                currentEvent = trimmed.slice(6).trim();
              } else if (trimmed.startsWith('data:')) {
                const dataStr = trimmed.slice(5).trim();
                if (!dataStr) continue;
                try {
                  const data = JSON.parse(dataStr);
                  // 收集媒体URL（后台下载，不阻塞SSE流式推送）
                  collectMediaFromSSEEvent(data, collectedMediaUrls);
                  if (currentEvent === 'conversation.message.delta' && data.type === 'answer' && data.content) {
                    accumulated += data.content;
                    const t = taskStore.get(taskId);
                    if (t) t.chunk = accumulated;
                  }
                  if (data.conversation_id && !convId) convId = data.conversation_id;
                  if (currentEvent === 'conversation.chat.failed') {
                    const le = data.last_error || {};
                    const leCode = le.code ?? le.error_code ?? '';
                    const leParam = le.param ?? '';
                    const leMsg = le.msg ?? le.message ?? '智能体执行失败';
                    console.error(`[Stream ${taskId}] Chat failed. code=${leCode} param=${leParam} msg=${leMsg}`);
                    console.error(`[Stream ${taskId}] Request was:`, JSON.stringify({
                      bot_id: config.coze_id,
                      user_id: cozeUserId || userId,
                      conversation_id: conversationIdForBody || '(new)',
                      auto_save_history: true,
                      additional_messages: additionalMessages,
                    }));
                    taskStore.set(taskId, {
                      status: 'failed',
                      error: leCode ? `智能体执行失败 [${leCode}${leParam ? ':' + leParam : ''}]: ${leMsg}` : leMsg,
                      createdAt: Date.now(),
                      userId,
                    });
                  }
                  if (currentEvent === 'conversation.message.completed' && data.type === 'answer' && data.content) {
                    if (!accumulated) {
                      accumulated = data.content;
                      const t = taskStore.get(taskId);
                      if (t) t.chunk = accumulated;
                    }
                  }
                } catch { /* skip */ }
              }
            }
          }
        } catch (err: any) {
          console.error(`[Stream ${taskId}] Stream error:`, err.message);
          taskStore.set(taskId, {
            status: 'failed',
            error: err.message || '流式传输中断',
            createdAt: Date.now(),
            userId,
          });
          try { controller.error(err); } catch { /* ignore */ }
        } finally {
          activeTasks.delete(taskId);
          // 确保 cozeReader 被释放
          try { cozeReader.releaseLock(); } catch { /* ignore */ }
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    await createAuditLog({
      userId, action: 'workflow_stream', resourceType: config.type, resourceId: config.coze_id,
      status: 'failure', errorMessage: message, details: { tool_name: config.name, parameters }, req,
    });
    if (message.includes('Coze account not connected') || message.includes('No refresh token')) {
      return NextResponse.json({ error: '请先连接您的 Coze 账户', needCozeAuth: true }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
