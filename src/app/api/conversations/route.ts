import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { query, queryOne, execute, genId } from '@/lib/db';

/**
 * GET /api/conversations?tool_id=xxx
 * 获取用户在该工具下的对话列表（最近 50 条，未删除的）
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

  const rows = await query(
    `SELECT id, user_id, tool_id, coze_conversation_id, title, created_at, updated_at
     FROM conversations
     WHERE user_id = ? AND tool_id = ? AND is_deleted = 0
     ORDER BY updated_at DESC
     LIMIT 50`,
    [userId, toolId]
  );

  return NextResponse.json({ conversations: rows });
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

  const id = genId();
  const { tool_id, coze_conversation_id, title } = body;

  await execute(
    `INSERT INTO conversations (id, user_id, tool_id, coze_conversation_id, title)
     VALUES (?, ?, ?, ?, ?)`,
    [id, userId, tool_id, coze_conversation_id || null, title || null]
  );

  const conv = await queryOne(
    `SELECT id, coze_conversation_id, title, created_at, updated_at
     FROM conversations WHERE id = ?`,
    [id]
  );

  return NextResponse.json({ conversation: conv });
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

  // 校验所有权
  const existing = await queryOne(
    `SELECT id FROM conversations WHERE id = ? AND user_id = ? AND is_deleted = 0`,
    [body.id, userId]
  );
  if (!existing) {
    return NextResponse.json(
      { error: '对话不存在' },
      { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (body.title !== undefined) {
    updates.push('title = ?');
    values.push(body.title);
  }
  if (body.coze_conversation_id !== undefined) {
    updates.push('coze_conversation_id = ?');
    values.push(body.coze_conversation_id);
  }

  if (updates.length > 0) {
    updates.push('updated_at = NOW()');
    values.push(body.id);
    await execute(
      `UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
  }

  const conv = await queryOne(
    `SELECT id, coze_conversation_id, title, created_at, updated_at
     FROM conversations WHERE id = ?`,
    [body.id]
  );

  return NextResponse.json({ conversation: conv });
}
