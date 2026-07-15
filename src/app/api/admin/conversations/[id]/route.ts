import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-guard';
import { query, queryOne, execute } from '@/lib/db';
import { createAuditLog } from '@/lib/audit-log';

/**
 * GET /api/admin/conversations/[id]
 * 获取单条对话详情（含消息）
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId: adminId, error } = await verifyAdminAuth(req);
  if (error) return error;

  const { id } = await params;

  const conv = await queryOne(
    `SELECT c.id, c.user_id, c.tool_id, c.coze_conversation_id, c.title,
            c.is_deleted, c.created_at, c.updated_at,
            u.email as user_email,
            wc.name as tool_name
     FROM conversations c
     LEFT JOIN users u ON c.user_id = u.id
     LEFT JOIN workflow_configs wc ON c.tool_id = wc.id
     WHERE c.id = ?`,
    [id]
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
     ORDER BY sort_order ASC, created_at ASC`,
    [id]
  );

  await createAuditLog({
    userId: adminId,
    action: 'admin_view_conversation',
    resourceType: 'conversation',
    resourceId: id,
  });

  return NextResponse.json({ conversation: { ...conv, messages } });
}

/**
 * DELETE /api/admin/conversations/[id]
 * 软删除指定对话
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId: adminId, error } = await verifyAdminAuth(req);
  if (error) return error;

  const { id } = await params;

  const existing = await queryOne(
    `SELECT id FROM conversations WHERE id = ?`,
    [id]
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

  await createAuditLog({
    userId: adminId,
    action: 'admin_delete_conversation',
    resourceType: 'conversation',
    resourceId: id,
  });

  return NextResponse.json({ success: true });
}
