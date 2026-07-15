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

  // 校验所有权
  const conv = await queryOne(
    `SELECT id FROM conversations WHERE id = ? AND user_id = ? AND is_deleted = 0`,
    [id, userId]
  );

  if (!conv) {
    return NextResponse.json(
      { error: '对话不存在' },
      { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  const messages: SaveMessage[] = body.messages;
  const replaceAll = body.replace === true;

  if (replaceAll) {
    // 全量替换模式：先删除旧消息
    await execute(
      `DELETE FROM conversation_messages WHERE conversation_id = ?`,
      [id]
    );
  }

  // 批量插入
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const sortOrder = replaceAll ? i : (msg.sort_order ?? 0);

    await execute(
      `INSERT INTO conversation_messages (id, conversation_id, role, content, content_type, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [genId(), id, msg.role, msg.content, msg.content_type || 'text', sortOrder]
    );
  }

  // 更新对话 updated_at 和 title（取第一条用户消息前50字作为标题）
  const firstUserMsg = messages.find((m: SaveMessage) => m.role === 'user');
  if (firstUserMsg) {
    const title = firstUserMsg.content.substring(0, 50);
    await execute(
      `UPDATE conversations SET title = ?, updated_at = NOW() WHERE id = ?`,
      [title, id]
    );
  } else {
    await execute(
      `UPDATE conversations SET updated_at = NOW() WHERE id = ?`,
      [id]
    );
  }

  return NextResponse.json({ success: true, count: messages.length });
}
