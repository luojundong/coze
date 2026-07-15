import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-guard';
import { query, queryOne, execute, genId } from '@/lib/db';
import { createAuditLog } from '@/lib/audit-log';

export async function GET(req: NextRequest) {
  const { error } = await verifyAdminAuth(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
  const action = searchParams.get('action') || '';
  const userId = searchParams.get('userId') || '';
  const account = searchParams.get('account') || '';
  const status = searchParams.get('status') || '';
  const startDate = searchParams.get('startDate') || '';
  const endDate = searchParams.get('endDate') || '';
  const offset = (page - 1) * pageSize;

  // 始终关联 users 表：带出账号(邮箱/手机)用于展示，也支持按账号搜索
  // 注意：必须始终 JOIN，否则 SELECT 中引用的 u.email/u.phone 在无搜索时会报“未知列”导致 500
  const joinClause = ' LEFT JOIN users u ON u.id = al.user_id';

  const whereParts: string[] = ['1=1'];
  const params: any[] = [];
  if (action) { whereParts.push('al.action = ?'); params.push(action); }
  if (userId) { whereParts.push('al.user_id = ?'); params.push(userId); }
  if (account) { whereParts.push('(u.email LIKE ? OR u.phone LIKE ?)'); params.push(`%${account}%`, `%${account}%`); }
  if (status) { whereParts.push('al.status = ?'); params.push(status); }
  if (startDate) { whereParts.push('al.created_at >= ?'); params.push(startDate); }
  if (endDate) { whereParts.push('al.created_at <= ?'); params.push(endDate); }
  const whereClause = `WHERE ${whereParts.join(' AND ')}`;

  const [logs, countRow, actions] = await Promise.all([
    query<any>(
      `SELECT al.*, u.email AS user_email, u.phone AS user_phone
       FROM audit_logs al ${joinClause}
       ${whereClause} ORDER BY al.created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    ),
    queryOne<{ total: number }>(
      `SELECT COUNT(*) as total FROM audit_logs al ${joinClause} ${whereClause}`,
      params
    ),
    query<{ action: string }>('SELECT DISTINCT action FROM audit_logs ORDER BY action'),
  ]);

  const distinctActions = (actions || []).map((a: any) => a.action);

  return NextResponse.json({
    logs,
    total: countRow?.total ?? 0,
    page,
    pageSize,
    distinctActions,
  });
}

export async function DELETE(req: NextRequest) {
  const { userId: adminId, error } = await verifyAdminAuth(req);
  if (error) return error;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // 清空全部日志：先写入一条清空动作记录，再删除其余所有日志（保留该记录作为审计留痕）
  if (body.clearAll) {
    const recordId = genId();
    try {
      await execute(
        `INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, details, status)
         VALUES (?, ?, 'admin_clear_audit_logs', 'audit_log', NULL, ?, 'success')`,
        [recordId, adminId, JSON.stringify({ cleared_by: adminId })]
      );
      await execute('DELETE FROM audit_logs WHERE id != ?', [recordId]);
    } catch (e: any) {
      console.error('[AuditLogs] clear all failed:', e);
      return NextResponse.json({ error: '清空日志失败：' + (e.message || '') }, { status: 500 });
    }
    return NextResponse.json({ success: true, cleared: true });
  }

  // 删除单条日志
  const id = body.id;
  if (!id) return NextResponse.json({ error: '缺少日志 id' }, { status: 400 });
  try {
    await execute('DELETE FROM audit_logs WHERE id = ?', [id]);
    await createAuditLog({
      userId: adminId,
      action: 'admin_delete_audit_log',
      resourceType: 'audit_log',
      resourceId: id,
    });
  } catch (e: any) {
    console.error('[AuditLogs] delete failed:', e);
    return NextResponse.json({ error: '删除日志失败：' + (e.message || '') }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
