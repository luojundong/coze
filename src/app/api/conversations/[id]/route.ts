import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { query, queryOne, execute } from '@/lib/db';

/**
 * GET /api/conversations/[id]
 * 获取对话详情，包含所有消息
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  const { id } = await params;

  const conv = await queryOne(
    `SELECT id, coze_conversation_id, title, created_at, updated_at
     FROM conversations
     WHERE id = ? AND user_id = ? AND is_deleted = 0`,
    [id, userId]
  );

  if (!conv) {
    return NextResponse.json(
      { error: '对话不存在' },
      { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  const messages = await query(
    `SELECT id, role, content, content_type, sort_order, created_at
     FROM conversation_messages
     WHERE conversation_id = ?
     ORDER BY sort_order ASC`,
    [id]
  );

  return NextResponse.json({
    conversation: { ...conv, messages },
  });
}

/**
 * DELETE /api/conversations/[id]
 * 软删除对话
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  const { id } = await params;

  const existing = await queryOne(
    `SELECT id FROM conversations WHERE id = ? AND user_id = ? AND is_deleted = 0`,
    [id, userId]
  );

  if (!existing) {
    return NextResponse.json(
      { error: '对话不存在' },
      { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  await execute(
    `UPDATE conversations SET is_deleted = 1, updated_at = NOW() WHERE id = ?`,
    [id]
  );

  return NextResponse.json({ success: true });
}
