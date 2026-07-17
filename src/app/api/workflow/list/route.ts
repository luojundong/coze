import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyActivation } from '@/lib/auth-guard';
import { getValidCozeToken } from '@/lib/coze-token';
import { createAuditLog } from '@/lib/audit-log';

const COZE_API_BASE_URL = process.env.COZE_API_BASE_URL || 'https://api.coze.cn';

export async function GET(req: NextRequest) {
  try {
    const { userId, error } = await verifyAuth(req);
    if (error) return error;

    // Verify activation
    const { activated, error: activationError } = await verifyActivation(userId);
    if (!activated) {
      return NextResponse.json({ error: activationError }, { status: 403 });
    }

    // 获取 Coze Token：用户 Token 优先；用户未连接 Coze 时降级到平台 Workload Token；
    // 两者都无 → 返回友好 403（避免 500），提示用户连接 Coze 账户。
    let accessToken: string;
    try {
      accessToken = await getValidCozeToken(userId);
    } catch {
      const platformToken = process.env.COZE_WORKLOAD_API_TOKEN;
      if (platformToken) {
        accessToken = platformToken;
      } else {
        return NextResponse.json(
          { error: '请先连接 Coze 账户', needCozeAuth: true },
          { status: 403, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
        );
      }
    }
    const workspaceId = process.env.COZE_PROJECT_SPACE_ID;

    const url = new URL(`${COZE_API_BASE_URL}/v1/workflows`);
    if (workspaceId) {
      url.searchParams.set('workspace_id', workspaceId);
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Workflow List] Coze /v1/workflows failed:', response.status, errText.slice(0, 500));
      return NextResponse.json(
        { error: '获取工作流列表失败', details: errText },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    console.error('[Workflow List] GET failed:', message);
    return NextResponse.json({ error: `获取工具列表失败：${message}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // Get workflow info by ID
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  const { activated, error: activationError } = await verifyActivation(userId);
  if (!activated) {
    return NextResponse.json({ error: activationError }, { status: 403 });
  }

  let body: { workflow_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  if (!body.workflow_id) {
    return NextResponse.json({ error: '缺少 workflow_id' }, { status: 400 });
  }

  try {
    const accessToken = await getValidCozeToken(userId);
    const response = await fetch(`${COZE_API_BASE_URL}/v1/workflows/${body.workflow_id}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: '获取工作流详情失败', details: errText },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
