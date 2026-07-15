import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth, clearAdminCache } from '@/lib/admin-guard';
import { queryOne, execute } from '@/lib/db';
import { getUserById } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const { error } = await verifyAdminAuth(req);
  if (error) return error;

  const row = await queryOne<{ value: string }>(
    "SELECT `value` FROM system_config WHERE `key` = 'admin_user_ids'"
  );

  const adminIds = (row?.value || '').split(',').filter(Boolean);

  // Get admin emails from our users table
  const adminUsers: { id: string; email: string }[] = [];
  for (const id of adminIds) {
    const user = await getUserById(id);
    adminUsers.push({ id, email: user?.email || '未知邮箱' });
  }

  return NextResponse.json({
    admin_users: adminUsers,
    env_admin_ids: process.env.ADMIN_USER_IDS || '',
  });
}

export async function PUT(req: NextRequest) {
  const { error } = await verifyAdminAuth(req);
  if (error) return error;

  let body: { admin_user_ids?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '请求格式错误' }, { status: 400 }); }
  if (!body.admin_user_ids) return NextResponse.json({ error: 'admin_user_ids 不能为空' }, { status: 400 });

  const ids = body.admin_user_ids.split(',').map(s => s.trim()).filter(Boolean);

  await execute(
    "INSERT INTO system_config (`key`, `value`) VALUES ('admin_user_ids', ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), updated_at = NOW()",
    [ids.join(',')]
  );

  clearAdminCache();
  return NextResponse.json({ success: true, admin_user_ids: ids });
}
