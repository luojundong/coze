import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-guard';
import { query, queryOne, execute, genId } from '@/lib/db';

/**
 * GET  /api/admin/memberships — 获取所有会员列表
 * POST /api/admin/memberships — 设置用户会员状态
 */
export async function GET(req: NextRequest) {
  const { userId, error } = await verifyAdminAuth(req);
  if (error) return error;

  const url = new URL(req.url);
  const search = url.searchParams.get('search') || '';
  const page = parseInt(url.searchParams.get('page') || '1');
  const pageSize = parseInt(url.searchParams.get('pageSize') || '10');
  const offset = (page - 1) * pageSize;

  let memberships;
  let total = 0;

  if (search) {
    // 从 users 表出发搜索，即使没有 membership 记录也能显示用户
    const countRow = await queryOne<{ total: number }>(
      `SELECT COUNT(*) as total FROM users u WHERE u.phone LIKE ? OR u.email LIKE ?`,
      [`%${search}%`, `%${search}%`]
    );
    total = countRow?.total ?? 0;

    memberships = await query<any>(
      `SELECT u.id as user_id, u.phone, u.email,
              COALESCE(um.id, '') as id,
              COALESCE(um.is_member, 0) as is_member,
              um.activated_at,
              um.expires_at,
              um.created_at
       FROM users u
       LEFT JOIN user_memberships um ON um.user_id COLLATE utf8mb4_general_ci = u.id COLLATE utf8mb4_general_ci
       WHERE u.phone LIKE ? OR u.email LIKE ?
       ORDER BY um.is_member DESC, u.id DESC
       LIMIT ? OFFSET ?`,
      [`%${search}%`, `%${search}%`, pageSize, offset]
    );
  } else {
    const countRow = await queryOne<{ total: number }>(
      `SELECT COUNT(*) as total FROM user_memberships um`
    );
    total = countRow?.total ?? 0;

    memberships = await query<any>(
      `SELECT um.id, um.user_id, um.is_member, um.activated_at, um.expires_at, um.created_at,
              u.phone, u.email
       FROM user_memberships um
       LEFT JOIN users u ON u.id COLLATE utf8mb4_general_ci = um.user_id COLLATE utf8mb4_general_ci
       ORDER BY um.is_member DESC, um.id DESC
       LIMIT ? OFFSET ?`,
      [pageSize, offset]
    );
  }

  return NextResponse.json({ memberships, total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { userId, error } = await verifyAdminAuth(req);
  if (error) return error;

  const body = await req.json();
  const { targetUserId, isMember } = body;

  if (!targetUserId) {
    return NextResponse.json({ error: '缺少用户ID' }, { status: 400 });
  }

  if (isMember) {
    // 激活会员
    const existing = await queryOne<any>(
      'SELECT id FROM user_memberships WHERE user_id = ?',
      [targetUserId]
    );
    if (existing) {
      await execute(
        'UPDATE user_memberships SET is_member = 1, updated_at = NOW() WHERE user_id = ?',
        [targetUserId]
      );
    } else {
      await execute(
        'INSERT INTO user_memberships (id, user_id, is_member) VALUES (?, ?, 1)',
        [genId(), targetUserId]
      );
    }
  } else {
    // 取消会员
    await execute(
      'UPDATE user_memberships SET is_member = 0, updated_at = NOW() WHERE user_id = ?',
      [targetUserId]
    );
  }

  return NextResponse.json({ success: true, message: isMember ? '已设为会员' : '已取消会员' });
}
