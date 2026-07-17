import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { query, queryOne, execute, genId } from '@/lib/db';

/**
 * GET /api/conversations?tool_id=xxx
 * 获取用户在该工具下的对话列表（24小时内，最近50条）
 */
export async function GET(req: NextRequest) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const toolId = searchParams.get('tool_id');

  if (!toolId) {
    return NextResponse.json(
      { error: '缺少 tool_id 参数' },
      { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  try {
    const conversations = await query(
      `SELECT id, user_id, tool_id, coze_conversation_id, title, created_at, updated_at
       FROM conversations
       WHERE user_id = ? AND tool_id = ? AND is_deleted = 0
         AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
       ORDER BY updated_at DESC
       LIMIT 50`,
      [userId, toolId]
    );
    return NextResponse.json({ conversations });
  } catch (err: any) {
    console.error('[Conversations] GET error:', err);
    return NextResponse.json(
      { error: '获取对话列表失败', conversations: [] },
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }
}

/**
 * POST /api/conversations
 * 创建新对话
 * Body: { tool_id, coze_conversation_id?, title? }
 */
export async function POST(req: NextRequest) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  const body = await req.json().catch(() => null);
  if (!body || !body.tool_id) {
    return NextResponse.json(
      { error: '缺少 tool_id' },
      { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  try {
    const id = genId();
    const { tool_id, coze_conversation_id, title } = body;

    await execute(
      `INSERT INTO conversations (id, user_id, tool_id, coze_conversation_id, title)
       VALUES (?, ?, ?, ?, ?)`,
      [id, userId, tool_id, coze_conversation_id || null, title || null]
    );

    const conv = await queryOne(
      `SELECT id, user_id, tool_id, coze_conversation_id, title, created_at, updated_at
       FROM conversations WHERE id = ?`,
      [id]
    );

    return NextResponse.json({ conversation: conv });
  } catch (err: any) {
    console.error('[Conversations] POST error:', err);
    return NextResponse.json(
      { error: '创建对话失败' },
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }
}

/**
 * PATCH /api/conversations
 * 更新对话的 coze_conversation_id / title
 * Body: { id, coze_conversation_id?, title? }
 */
export async function PATCH(req: NextRequest) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  const body = await req.json().catch(() => null);
  if (!body || !body.id) {
    return NextResponse.json(
      { error: '缺少 id' },
      { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  try {
    const setClauses: string[] = [];
    const values: any[] = [];

    if (body.coze_conversation_id !== undefined) {
      setClauses.push('coze_conversation_id = ?');
      values.push(body.coze_conversation_id);
    }
    if (body.title !== undefined) {
      setClauses.push('title = ?');
      values.push(body.title);
    }

    if (setClauses.length === 0) {
      return NextResponse.json(
        { error: '没有需要更新的字段' },
        { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    values.push(body.id, userId);
    await execute(
      `UPDATE conversations SET ${setClauses.join(', ')}
       WHERE id = ? AND user_id = ? AND is_deleted = 0
         AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
      values
    );

    const conv = await queryOne(
      `SELECT id, user_id, tool_id, coze_conversation_id, title, created_at, updated_at
       FROM conversations WHERE id = ?`,
      [body.id]
    );

    if (!conv) {
      return NextResponse.json(
        { error: '对话不存在或已过期' },
        { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }
    return NextResponse.json({ conversation: conv });
  } catch (err: any) {
    console.error('[Conversations] PATCH error:', err);
    return NextResponse.json(
      { error: '更新对话失败' },
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }
}
