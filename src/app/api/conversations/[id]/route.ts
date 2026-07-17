import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { query, queryOne, execute } from '@/lib/db';

/**
 * GET /api/conversations/[id]
 * 获取对话详情，包含所有消息（仅24小时内）
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  const { id } = await params;

  try {
    const conv = await queryOne(
      `SELECT id, user_id, tool_id, coze_conversation_id, title, created_at, updated_at
       FROM conversations
       WHERE id = ? AND user_id = ? AND is_deleted = 0
         AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
      [id, userId]
    );

    if (!conv) {
      return NextResponse.json(
        { error: '对话不存在或已过期' },
        { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    const messages = await query(
      `SELECT id, conversation_id, role, content, content_type, sort_order, created_at
       FROM conversation_messages
       WHERE conversation_id = ?
       ORDER BY sort_order ASC, created_at ASC`,
      [id]
    );

    return NextResponse.json({
      conversation: { ...conv, messages },
    });
  } catch (err: any) {
    console.error('[Conversations/:id] GET error:', err);
    return NextResponse.json(
      { error: '获取对话详情失败' },
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }
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

  try {
    const result = await execute(
      `UPDATE conversations SET is_deleted = 1
       WHERE id = ? AND user_id = ? AND is_deleted = 0
         AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
      [id, userId]
    );

    if ((result as any).affectedRows === 0) {
      return NextResponse.json(
        { error: '对话不存在或已过期' },
        { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[Conversations/:id] DELETE error:', err);
    return NextResponse.json(
      { error: '删除对话失败' },
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }
}
