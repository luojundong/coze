import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyToolActivation } from '@/lib/auth-guard';
import { getValidCozeTokenData, refreshCozeToken } from '@/lib/coze-token';
import { createAuditLog } from '@/lib/audit-log';
import { deductCredits } from '@/lib/credit';
import { collectMediaFromSSEEvent, triggerBackgroundDownload } from '@/lib/media-downloader';
import { queryOne } from '@/lib/db';
import { getOAuthConfig } from '@/lib/oauth-config';
import { genId } from '@/lib/db';
import { buildMultimodalUserMessage } from '@/lib/image-inline';
// 共享 taskStore（与 stream/route.ts 共用同一个 Map）
import { taskStore } from '../../stream/route';

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
    console.log(`[TaskRun] User ${userId} has no valid Coze token, trying platform token...`);
  }

  const platformToken = process.env.COZE_WORKLOAD_API_TOKEN;
  if (platformToken) {
    console.log(`[TaskRun] Using platform token for user ${userId}`);
    return { accessToken: platformToken, isPlatformToken: true };
  }

  throw new Error('Coze account not connected. Please authorize your Coze account first.');
}

// 设置路由最大执行时长为 300 秒（音频/视频生成需要更长时间，与 stream 路由一致）
export const maxDuration = 300;

// 全局活跃任务引用：防止 fire-and-forget Promise 被 GC 回收
const activeTasks = new Map<string, Promise<void>>();

// taskStore 统一由 stream/route.ts 导出，其他路由直接 import

/**
 * 异步执行 Coze Bot 调用（SSE 流式接收 + 写入 taskStore）
 * 不阻塞 HTTP 响应，作为小程序的异步任务兜底方案
 */
async function executeCozeTask(taskId: string, params: {
  userId: string;
  accessToken: string;
  apiBaseUrl: string;
  botId: string;
  cozeUserId: string;
  rawUserMessage: string;
  publicBaseUrl?: string;
  conversationId?: string;
  configName: string;
  configType: string;
  req: NextRequest;
}) {
  const { userId, accessToken, apiBaseUrl, botId, cozeUserId, rawUserMessage, publicBaseUrl, conversationId, configName, configType, req } = params;
  const taskStartTime = Date.now();

  try {
    taskStore.set(taskId, { status: 'running', chunk: '', createdAt: Date.now(), userId });

    // 多轮对话上下文截断
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
            const msgs = histData.data.filter((m: any) =>
              (m.role === 'user' || m.role === 'assistant') && (m.type === 'answer' || m.type === 'input_text')
            );
            const maxMsgs = MAX_HISTORY_ROUNDS * 2;
            truncatedHistory = msgs.slice(-maxMsgs).map((m: any) => ({
              role: m.role,
              content: m.content || '',
              content_type: m.content_type || 'text',
            }));
          }
        }
      } catch (e: any) {
        console.warn(`[Task ${taskId}] History fetch error:`, e.message);
      }
    }

    const userMessageObj = buildMultimodalUserMessage(rawUserMessage, publicBaseUrl);
    const additionalMessages = [
      ...truncatedHistory,
      userMessageObj,
    ];

    // 关键：使用 stream: true，通过 SSE 流式读取 Coze 响应
    const requestBody: any = {
      bot_id: botId,
      user_id: cozeUserId || userId,
      stream: true,
      auto_save_history: true,
      additional_messages: additionalMessages,
    };

    // 只要前端提供了 conversation_id，就始终传给 Coze，确保多轮上下文连续
    if (conversationId) {
      requestBody.conversation_id = conversationId;
    }

    console.log(`[Task ${taskId}] Starting SSE stream with ${additionalMessages.length} messages`);

    // 步骤 1: 发起流式对话（Token 失效时自动刷新并重试一次）
    const chatController = new AbortController();
    const chatTimeoutId = setTimeout(() => chatController.abort(), 30000);

    let chatRes: Response;
    try {
      chatRes = await fetch(`${apiBaseUrl}/v3/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify(requestBody),
        signal: chatController.signal,
      });

      // 非平台 token 且 Coze 返回 401/令牌无效：强制刷新并重试一次
      if (!isPlatformToken && !chatRes.ok) {
        let errData: any = null;
        try { errData = await chatRes.clone().json(); } catch { /* 忽略 */ }
        const errCode = errData?.error_code || errData?.code;
        const errMsg = (errData?.msg || errData?.message || '').toLowerCase();
        const tokenRejected = chatRes.status === 401 || errCode === 401 || errCode === 4010 ||
          errMsg.includes('token') || errMsg.includes('incorrect') || errMsg.includes('unauthorized');
        if (tokenRejected) {
          const fresh = await refreshCozeToken(userId);
          console.log(`[Task ${taskId}] Token rejected, refreshed & retrying chat init`);
          chatRes = await fetch(`${apiBaseUrl}/v3/chat`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${fresh.accessToken}`,
            },
            body: JSON.stringify(requestBody),
            signal: chatController.signal,
          });
        }
      }
    } catch (e: any) {
      clearTimeout(chatTimeoutId);
      console.error(`[Task ${taskId}] Chat init error:`, e.message);
      taskStore.set(taskId, { status: 'failed', error: '智能体连接超时，请稍后重试', createdAt: Date.now(), userId });
      return;
    }
    clearTimeout(chatTimeoutId);

    if (!chatRes.ok) {
      const errText = await chatRes.text();
      let errorMessage = '智能体调用失败';
      try {
        const errJson = JSON.parse(errText);
        if (errJson.msg || errJson.message) {
          errorMessage = errJson.msg || errJson.message;
        }
      } catch { /* keep default */ }
      taskStore.set(taskId, { status: 'failed', error: errorMessage, createdAt: Date.now(), userId });
      await createAuditLog({
        userId, action: 'workflow_run', resourceType: configType, resourceId: botId,
        status: 'failure', errorMessage, details: { tool_name: configName }, req,
      });
      return;
    }

    // 步骤 2: 读取 SSE 流，累积结果到 taskStore
    const reader = chatRes.body?.getReader();
    if (!reader) {
      taskStore.set(taskId, { status: 'failed', error: '智能体响应异常', createdAt: Date.now(), userId });
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedContent = '';
    let capturedConversationId = '';
    let streamEnded = false;
    let consecutiveEmptyPolls = 0;
    const MAX_EMPTY_POLLS = 90;  // 90 × 2s = 180s 无数据则判定超时（音频/视频生成需要更长时间）
    const collectedMediaUrls: string[] = [];  // 收集 SSE 事件中的媒体 URL

    while (!streamEnded) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        // 读取流式分片，带 60 秒超时
        const readPromise = reader.read();
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('read_timeout')), 60000)
        );
        chunk = await Promise.race([readPromise, timeoutPromise]);
      } catch (e: any) {
        if (e.message === 'read_timeout') {
          consecutiveEmptyPolls++;
          if (consecutiveEmptyPolls >= MAX_EMPTY_POLLS) {
            console.error(`[Task ${taskId}] No data for ${MAX_EMPTY_POLLS * 2}s, aborting`);
            taskStore.set(taskId, {
              status: 'failed',
              error: '智能体响应超时，请稍后重试',
              chunk: accumulatedContent,
              createdAt: Date.now(),
              userId,
            });
            try { reader.cancel(); } catch { /* ignore */ }
            return;
          }
          // 等待后继续读取
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        console.error(`[Task ${taskId}] Stream read error:`, e.message);
        taskStore.set(taskId, {
          status: 'failed',
          error: '流式传输中断',
          chunk: accumulatedContent,
          createdAt: Date.now(),
          userId,
        });
        return;
      }

      if (chunk.done) {
        streamEnded = true;
        break;
      }

      consecutiveEmptyPolls = 0;  // 收到数据，重置空轮询计数

      const text = decoder.decode(chunk.value, { stream: true });
      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let currentEvent = '';
      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith('event:')) {
          currentEvent = trimmed.slice(6).trim();
          continue;
        }

        if (trimmed.startsWith('data:')) {
          const dataStr = trimmed.slice(5).trim();
          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);
            // 收集媒体URL（后台下载）
            collectMediaFromSSEEvent(data, collectedMediaUrls);

            // 增量内容 → 写入 taskStore chunk
            if (currentEvent === 'conversation.message.delta' && data.type === 'answer' && data.content) {
              accumulatedContent += data.content;
              const t = taskStore.get(taskId);
              if (t) t.chunk = accumulatedContent;
            }

            // 完整消息
            if (currentEvent === 'conversation.message.completed' && data.type === 'answer' && data.content) {
              if (!accumulatedContent) {
                accumulatedContent = data.content;
                const t = taskStore.get(taskId);
                if (t) t.chunk = accumulatedContent;
              }
            }

            // 捕获 conversation_id
            if (data.conversation_id && !capturedConversationId) {
              capturedConversationId = data.conversation_id;
            }

            // 失败事件
            if (currentEvent === 'conversation.chat.failed') {
              const failMsg = data.last_error?.msg || '智能体执行失败';
              taskStore.set(taskId, {
                status: 'failed',
                error: failMsg,
                chunk: accumulatedContent,
                createdAt: Date.now(),
                userId,
              });
              await createAuditLog({
                userId, action: 'workflow_run', resourceType: configType, resourceId: botId,
                status: 'failure', errorMessage: failMsg,
                details: { tool_name: configName }, req,
              });
              return;
            }

            // 错误事件
            if (currentEvent === 'error' || data.error_code) {
              const errMsg = data.error_message || data.msg || data.last_error?.msg || '调用出错';
              taskStore.set(taskId, {
                status: 'failed',
                error: errMsg,
                chunk: accumulatedContent,
                createdAt: Date.now(),
                userId,
              });
              return;
            }
          } catch {
            // 非 JSON 行，跳过
          }
        }
      }
    }

    // 流式结束
    const finalContent = accumulatedContent || '未收到回复';
    taskStore.set(taskId, {
      status: 'completed',
      result: { output: finalContent, conversation_id: capturedConversationId },
      chunk: finalContent,
      createdAt: Date.now(),
      userId,
    });

    await createAuditLog({
      userId, action: 'workflow_run', resourceType: configType, resourceId: botId,
      details: { tool_name: configName }, req,
    });

    // 后台下载收集到的媒体文件到 /public/download/
    if (collectedMediaUrls.length > 0) {
      triggerBackgroundDownload(taskId, collectedMediaUrls, configName);
    }

    console.log(`[Task ${taskId}] Completed: ${finalContent.length} chars, elapsed: ${Date.now() - taskStartTime}ms`);
  } catch (err: any) {
    const elapsed = Date.now() - taskStartTime;
    console.error(`[Task ${taskId}] Fatal error after ${elapsed}ms:`, err.message);
    taskStore.set(taskId, {
      status: 'failed',
      error: err.message || '未知错误',
      createdAt: Date.now(),
      userId,
    });
    await createAuditLog({
      userId, action: 'workflow_run', resourceType: configType, resourceId: botId,
      status: 'failure', errorMessage: err.message, details: { tool_name: configName }, req,
    });
  }
}

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
        console.log(`[TaskRun] Idempotency key ${idempotencyKey} already used, skipping credit deduction`);
      }
      if (!deducted.success) {
        return NextResponse.json({ error: deducted.error || '积分不足，请充值' }, { status: 402 });
      }
    } else {
      console.log(`[TaskRun] Tool ${config.name} is free, skipping credit deduction`);
    }


    const { accessToken, cozeUserId } = await getWorkflowToken(userId);
    const oauthConfig = await getOAuthConfig();
    const apiBaseUrl = oauthConfig.apiBaseUrl || 'https://api.coze.cn';

    if (config.type !== 'bot') {
      // Workflow 类型保持同步（通常很快）
      const userMessage = JSON.stringify(parameters ?? {});
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
      let wfData: any;
      try { wfData = JSON.parse(wfText); } catch { wfData = wfText; }

      await createAuditLog({
        userId, action: 'workflow_run', resourceType: config.type, resourceId: config.coze_id,
        details: { tool_name: config.name }, req,
      });

      return NextResponse.json({
        taskId: null,
        syncResult: { output: typeof wfData === 'string' ? wfData : JSON.stringify(wfData) },
      });
    }

    // Bot 类型：异步任务模式（SSE 流式接收 + taskStore 双写）
    const taskId = genId();
    const conversationId = bodyConversationId || (parameters?.conversation_id as string | undefined);
    const rawUserMessage = typeof parameters?.input === 'string' ? parameters.input : JSON.stringify(parameters ?? {});
    const protocol = req.headers.get('x-forwarded-proto') || 'https';
    const host = req.headers.get('host') || '';
    const publicBaseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.PUBLIC_BASE_URL || `${protocol}://${host}`;

    taskStore.set(taskId, { status: 'pending', chunk: '', createdAt: Date.now(), userId });

    // 异步执行（不 await，让任务在后台运行）
    // 关键：将 Promise 存入 activeTasks Map 中保持引用，防止 GC 回收异步链
    const taskPromise = executeCozeTask(taskId, {
      userId,
      accessToken,
      apiBaseUrl,
      botId: config.coze_id,
      cozeUserId: cozeUserId || userId,
      rawUserMessage,
      publicBaseUrl,
      conversationId,
      configName: config.name,
      configType: config.type,
      req,
    }).catch(err => {
      console.error(`[Task ${taskId}] Unhandled error:`, err);
      taskStore.set(taskId, { status: 'failed', error: err.message || '未知错误', chunk: '', createdAt: Date.now(), userId });
    }).finally(() => {
      // 任务完成后从活跃列表移除
      activeTasks.delete(taskId);
    });

    activeTasks.set(taskId, taskPromise);

    console.log(`[Task ${taskId}] Created for user ${userId}, tool: ${config.name} (active tasks: ${activeTasks.size})`);

    return NextResponse.json({ taskId });
  } catch (err: any) {
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
