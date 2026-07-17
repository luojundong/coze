import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { queryOne, execute, genId } from '@/lib/db';

interface SaveMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  content_type?: string;
  sort_order?: number;
}

/**
 * POST /api/conversations/[id]/messages
 * 批量保存消息到对话
 * Body: { messages: Array<{ role, content, content_type? }>, replace?: boolean }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  const { id } = await params;
  const body = await req.json().catch(() => null);

  if (!body || !Array.isArray(body.messages)) {
    return NextResponse.json(
      { error: '缺少 messages 数组' },
      { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  try {
    // 验证对话属于当前用户且在24小时内
    const conv = await queryOne(
      `SELECT id FROM conversations
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

    const messages: SaveMessage[] = body.messages;
    const replaceAll = body.replace === true;

    // 如果是全量替换，先删除旧消息
    if (replaceAll) {
      await execute(
        `DELETE FROM conversation_messages WHERE conversation_id = ?`,
        [id]
      );
    }

    // 批量插入消息
    let insertCount = 0;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const msgId = genId();
      await execute(
        `INSERT INTO conversation_messages (id, conversation_id, role, content, content_type, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [msgId, id, m.role, m.content, m.content_type || 'text', m.sort_order ?? i]
      );
      insertCount++;
    }

    // 自动更新对话标题（取第一条用户消息的前50字）
    const firstUserMsg = messages.find(m => m.role === 'user');
    if (firstUserMsg) {
      const title = firstUserMsg.content.length > 50
        ? firstUserMsg.content.substring(0, 50) + '…'
        : firstUserMsg.content;
      await execute(
        `UPDATE conversations SET title = ? WHERE id = ? AND (title IS NULL OR title = '')`,
        [title, id]
      );
    }

    return NextResponse.json({ success: true, count: insertCount });
  } catch (err: any) {
    console.error('[Conversations/:id/messages] POST error:', err);
    return NextResponse.json(
      { error: err.message || '保存消息失败' },
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }
}
