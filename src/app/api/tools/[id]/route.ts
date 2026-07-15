import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { getCozeToken, refreshCozeToken } from '@/lib/coze-token';
import { queryOne, query, execute } from '@/lib/db';
import { getOAuthConfig } from '@/lib/oauth-config';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId, error: authError } = await verifyAuth(request);
  if (authError) return authError;

  const { id } = await params;

  const config = await queryOne<any>(
    `SELECT id, coze_id, name, description, type, icon_url, credit_cost, parameters_schema, tutorial,
            opening_statement, suggested_questions
     FROM workflow_configs WHERE id = ? AND is_enabled = 1`,
    [id]
  );

  if (!config) {
    return NextResponse.json({ error: '工具不存在或已禁用' }, { status: 404 });
  }

  // Check if this tool is activated
  const activations = await query<{ tool_id: string | null }>(
    'SELECT tool_id FROM user_activations WHERE user_id = ? AND is_active = 1',
    [userId]
  );

  console.log('[DEBUG tools/[id]] userId:', userId, 'toolId:', id, 'activations:', JSON.stringify(activations));

  const globalActivation = activations?.find(a => a.tool_id === null);
  const isFullyActivated = !!globalActivation;
  const isToolActivated = isFullyActivated || (activations?.some(a => a.tool_id === config.id) ?? false);

  console.log('[DEBUG tools/[id]] isFullyActivated:', isFullyActivated, 'isToolActivated:', isToolActivated, 'config.id:', config.id);

  let cozeConnected = false;
  let userToken: string | null = null;

  try {
    let tokenData = await getCozeToken(userId);
    if (tokenData?.accessToken) {
      const expiresAt = tokenData.expiresAt ? new Date(tokenData.expiresAt) : null;
      // 统一使用 5 分钟缓冲，与 getValidCozeToken 保持一致
      const isExpired = expiresAt ? expiresAt.getTime() - Date.now() < 5 * 60 * 1000 : false;

      if (isExpired && tokenData.refreshToken) {
        // Token 即将过期，尝试自动刷新
        try {
          const refreshed = await refreshCozeToken(userId);
          tokenData = refreshed;
        } catch (refreshErr) {
          console.warn(`[tools/${id}] Auto-refresh failed:`, refreshErr instanceof Error ? refreshErr.message : refreshErr);
          // 刷新失败，标记为未连接
          tokenData = null;
        }
      } else if (isExpired && !tokenData.refreshToken) {
        // 已过期且无 refreshToken
        tokenData = null;
      }

      if (tokenData?.accessToken) {
        userToken = tokenData.accessToken;
        // 先假设有效，后续通过实际 API 调用验证
        cozeConnected = true;
      }
    }
  } catch {
    cozeConnected = false;
  }

  // Bot info fetching + Token 有效性验证
  // 优先级：数据库配置 > Coze API 动态获取
  // 关键：无论数据库是否有预设内容，都用用户 token 实际调一次 Coze API 来验证 token 是否有效
  let openingStatement: string | null = null;
  let promptInfo: string | null = null;
  let suggestedQuestions: string[] | null = null;
  let botAvailable = true;

  if (config.type === 'bot' && isToolActivated) {
    // Step 1: 优先从数据库读取管理员预设的内容
    const dbOpening = config.opening_statement || null;
    const dbQuestions = config.suggested_questions;

    if (dbOpening) {
      openingStatement = dbOpening;
      console.log(`[tools/${id}] Using DB opening_statement`);
    }
    if (Array.isArray(dbQuestions) && dbQuestions.length > 0) {
      suggestedQuestions = dbQuestions;
      console.log(`[tools/${id}] Using DB suggested_questions (${dbQuestions.length} items)`);
    }

    // Step 2: 用 token 实际调用 Coze API — 既验证 token 有效性，又获取缺失字段
    // 始终发起请求验证 token（即使数据库有完整预设内容）
    const hasAllDbFields = !!dbOpening && Array.isArray(dbQuestions) && dbQuestions.length > 0;
    const platformToken = process.env.COZE_WORKLOAD_API_TOKEN;
    // 验证 token 时优先使用用户 token（确保验证的是用户的 token 状态）
    const verifyToken = userToken || platformToken;

    if (verifyToken) {
      console.log(`[tools/${id}] Verifying token — hasUserToken:`, !!userToken, 'hasPlatformToken:', !!platformToken, 'dbComplete:', hasAllDbFields);
      try {
        const oauthConfig = await getOAuthConfig();
        const apiBaseUrl = oauthConfig.apiBaseUrl || 'https://api.coze.cn';

        const botController = new AbortController();
        const botTimeoutId = setTimeout(() => botController.abort(), 8000);
        try {
          const botRes = await fetch(`${apiBaseUrl}/v1/bots/${config.coze_id}?is_published=true`, {
            headers: { Authorization: `Bearer ${verifyToken}` },
            signal: botController.signal,
          });
          clearTimeout(botTimeoutId);

          console.log(`[tools/${id}] Bot API response — status:`, botRes.status, 'usedUserToken:', !!userToken);

          if (botRes.status === 401) {
            // 401 = token 无效 → 标记为未连接，同时更新数据库让所有接口感知
            console.warn(`[tools/${id}] Token invalid (401) — marking as not connected`);
            if (userToken) {
              cozeConnected = false;
              // 将 token_expires_at 设为过去时间，确保后续所有接口（dashboard、工具列表等）都显示未连接
              try {
                await execute(
                  'UPDATE coze_tokens SET token_expires_at = ?, updated_at = NOW() WHERE user_id = ?',
                  [new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' '), userId]
                );
                console.log(`[tools/${id}] Marked user ${userId} token as expired in DB`);
              } catch (dbErr) {
                console.warn(`[tools/${id}] Failed to mark token as expired:`, dbErr);
              }
            }
            botAvailable = false;
          } else if (botRes.status === 403) {
            // 403 = 权限不足（token 可能有效但无权访问此 bot）
            console.warn(`[tools/${id}] Forbidden (403) — bot may not be accessible`);
            botAvailable = false;
            // 403 不算 token 无效，cozeConnected 保持原值
          } else if (botRes.ok) {
            const botData = await botRes.json();
            console.log(`[tools/${id}] Bot API data — code:`, botData.code, 'hasData:', !!botData.data);
            const data = botData.data;
            if (botData.code === 0 && data) {
              // Token 验证通过（200 + code=0）
              if (userToken) {
                cozeConnected = true;
              }
              // 仅在数据库未配置时使用 Coze API 的值
              if (!dbOpening) {
                openingStatement = data?.onboarding_info?.prologue || null;
              }
              promptInfo = data?.prompt_info?.prompt || null;
              if (!Array.isArray(dbQuestions) || dbQuestions.length === 0) {
                suggestedQuestions = data?.onboarding_info?.suggested_questions || null;
              }
              console.log(`[tools/${id}] Bot info loaded — opening:`, !!openingStatement, 'prompt:', !!promptInfo, 'questions:', suggestedQuestions?.length ?? 0);
            } else if (botData.code === 4101) {
              botAvailable = false;
              console.warn(`[tools/${id}] Bot not available (code 4101)`);
            } else {
              console.warn(`[tools/${id}] Bot API returned unexpected code:`, botData.code, 'msg:', botData.msg);
            }
          } else {
            console.warn(`[tools/${id}] Bot API HTTP error — status:`, botRes.status);
            if (botRes.status === 404) {
              botAvailable = false;
            }
          }
        } catch (botErr: any) {
          clearTimeout(botTimeoutId);
          // 超时/网络错误不改变 cozeConnected 状态
          console.warn(`[tools/${id}] Bot API request failed:`, botErr?.message || botErr);
        }
      } catch (err) {
        console.warn(`[tools/${id}] Bot info outer error:`, err instanceof Error ? err.message : err);
      }
    } else {
      console.warn(`[tools/${id}] No token available — cozeConnected:`, cozeConnected);
      cozeConnected = false;
    }
  }

  return NextResponse.json({
    tool: {
      ...config,
      type: config.type as 'bot' | 'workflow',
      is_enabled: true,
      opening_statement: openingStatement,
      prompt_info: promptInfo,
      suggested_questions: suggestedQuestions,
      bot_available: botAvailable,
      is_activated: isToolActivated,
    },
    coze_connected: cozeConnected,
    is_full_access: isFullyActivated,
  });
}
