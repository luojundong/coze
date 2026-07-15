import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-guard';
import { query, queryOne, execute } from '@/lib/db';
import { createAuditLog } from '@/lib/audit-log';
import { getUserByEmail } from '@/lib/auth';

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
    // 支持按邮箱、手机号、用户ID模糊搜索
    whereClause = `WHERE (ua.user_id LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)`;
    countWhereClause = `WHERE (ua.user_id LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)`;
    params.push(likePattern, likePattern, likePattern);
  }

  // Query activations (join with users table for search)
  const [activations, countRow] = await Promise.all([
    query<any>(
      `SELECT ua.user_id, ua.is_active, ua.activated_at, ua.expires_at,
              ac.name as code_name, ac.code as code_value
       FROM user_activations ua
       LEFT JOIN activation_codes ac ON ua.activation_code_id = ac.id
       LEFT JOIN users u ON ua.user_id = u.id
       ${whereClause}
       ORDER BY ua.activated_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    ),
    queryOne<{ total: number }>(
      `SELECT COUNT(*) as total FROM user_activations ua
       LEFT JOIN users u ON ua.user_id = u.id
       ${countWhereClause}`,
      search ? [likePattern, likePattern, likePattern] : []
    ),
  ]);

  const userIds = (activations ?? []).map((a: any) => a.user_id);

  // Get coze tokens
  let cozeMap: Record<string, any> = {};
  if (userIds.length > 0) {
    const tokens = await query<any>(
      `SELECT user_id, coze_user_id FROM coze_tokens WHERE user_id IN (${userIds.map(() => '?').join(',')})`,
      userIds
    );
    for (const t of tokens) cozeMap[t.user_id] = { connected: true, cozeUserId: t.coze_user_id };
  }

  // Get credits
  let creditsMap: Record<string, number> = {};
  if (userIds.length > 0) {
    const credits = await query<any>(
      `SELECT user_id, balance FROM user_credits WHERE user_id IN (${userIds.map(() => '?').join(',')})`,
      userIds
    );
    for (const c of credits) creditsMap[c.user_id] = c.balance;
  }

  // Get user info from our users table
  let userMap: Record<string, { email: string; phone: string | null }> = {};
  if (userIds.length > 0) {
    const users = await query<{ id: string; email: string; phone: string | null }>(
      `SELECT id, email, phone FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`,
      userIds
    );
    for (const u of users) userMap[u.id] = { email: u.email || '', phone: u.phone || null };
  }

  const users = (activations ?? []).map((a: any) => ({
    user_id: a.user_id,
    email: userMap[a.user_id]?.email || '',
    phone: userMap[a.user_id]?.phone || null,
    is_active: a.is_active,
    activated_at: a.activated_at,
    expires_at: a.expires_at,
    activation_code: a.code_value ?? null,
    activation_code_name: a.code_name ?? null,
    coze_connected: cozeMap[a.user_id]?.connected ?? false,
    coze_user_id: cozeMap[a.user_id]?.cozeUserId ?? null,
    credit_balance: creditsMap[a.user_id] ?? 0,
  }));

  return NextResponse.json({ users, total: countRow?.total ?? 0, page, pageSize });
}

export async function DELETE(req: NextRequest) {
  const { userId: adminId, error } = await verifyAdminAuth(req);
  if (error) return error;

  let body: { user_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '请求格式错误' }, { status: 400 }); }
  if (!body.user_id) return NextResponse.json({ error: '缺少 user_id' }, { status: 400 });

  await execute('UPDATE user_activations SET is_active = 0 WHERE user_id = ?', [body.user_id]);
  await execute('DELETE FROM coze_tokens WHERE user_id = ?', [body.user_id]);

  await createAuditLog({ userId: adminId, action: 'admin_deactivate_user', resourceType: 'user', resourceId: body.user_id });
  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest) {
  const { userId: adminId, error } = await verifyAdminAuth(req);
  if (error) return error;

  let body: { user_id?: string; is_active?: boolean; expires_at?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '请求格式错误' }, { status: 400 }); }
  if (!body.user_id) return NextResponse.json({ error: '缺少 user_id' }, { status: 400 });

  const fields: string[] = [];
  const params: any[] = [];
  if (body.is_active !== undefined) { fields.push('is_active = ?'); params.push(body.is_active ? 1 : 0); }
  if (body.expires_at !== undefined) { fields.push('expires_at = ?'); params.push(body.expires_at); }

  if (fields.length === 0) return NextResponse.json({ error: '没有需要修改的字段' }, { status: 400 });

  params.push(body.user_id);
  await execute(`UPDATE user_activations SET ${fields.join(', ')} WHERE user_id = ?`, params);

  await createAuditLog({ userId: adminId, action: 'admin_modify_user', resourceType: 'user', resourceId: body.user_id, details: body });
  return NextResponse.json({ success: true });
}
