import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-guard';
import { query, queryOne, execute } from '@/lib/db';
import { createAuditLog } from '@/lib/audit-log';

/**
 * GET /api/admin/conversations
 * 获取所有对话记录列表（管理后台），支持搜索、分页
 * Query: search, page, pageSize
 */
export async function GET(req: NextRequest) {
  const { userId: adminId, error } = await verifyAdminAuth(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
  const search = searchParams.get('search') || '';
  const offset = (page - 1) * pageSize;

  const likePattern = search ? `%${search}%` : '';
  let whereClause = '';
  let countWhereClause = '';
  const params: any[] = [];

  if (search) {
    whereClause = `WHERE (u.email LIKE ? OR wc.name LIKE ? OR c.title LIKE ?)`;
    countWhereClause = `WHERE (u.email LIKE ? OR wc.name LIKE ? OR c.title LIKE ?)`;
    params.push(likePattern, likePattern, likePattern);
  }

  const [conversations, countRow] = await Promise.all([
    query(
      `SELECT c.id, c.user_id, c.tool_id, c.coze_conversation_id, c.title,
              c.is_deleted, c.created_at, c.updated_at,
              u.email as user_email,
              wc.name as tool_name
       FROM conversations c
       LEFT JOIN users u ON c.user_id = u.id
       LEFT JOIN workflow_configs wc ON c.tool_id = wc.id
       ${whereClause}
       ORDER BY c.updated_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    ),
    queryOne<{ total: number }>(
      `SELECT COUNT(*) as total
       FROM conversations c
       LEFT JOIN users u ON c.user_id = u.id
       LEFT JOIN workflow_configs wc ON c.tool_id = wc.id
       ${countWhereClause}`,
      search ? [likePattern, likePattern, likePattern] : []
    ),
  ]);

  // 统计每条对话的消息数
  const convIds = (conversations as any[]).map((c) => c.id);
  let messageCounts: Record<string, number> = {};
  if (convIds.length > 0) {
    const rows = await query<{ conversation_id: string; cnt: number }>(
      `SELECT conversation_id, COUNT(*) as cnt
       FROM conversation_messages
       WHERE conversation_id IN (${convIds.map(() => '?').join(',')})
       GROUP BY conversation_id`,
      convIds
    );
    for (const r of rows) messageCounts[r.conversation_id] = r.cnt;
  }

  const list = (conversations as any[]).map((c) => ({
    ...c,
    message_count: messageCounts[c.id] || 0,
  }));

  await createAuditLog({
    userId: adminId,
    action: 'admin_list_conversations',
    resourceType: 'conversation',
  });

  return NextResponse.json({
    conversations: list,
    total: countRow?.total ?? 0,
    page,
    pageSize,
  });
}
