import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { changePassword } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit-log';

/**
 * PUT /api/user/password - 用户自助修改密码
 * Body: { oldPassword: string, newPassword: string, confirmPassword: string }
 */
export async function PUT(req: NextRequest) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  let body: { oldPassword?: string; newPassword?: string; confirmPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  const { oldPassword, newPassword, confirmPassword } = body;

  if (!oldPassword) return NextResponse.json({ error: '请输入当前密码' }, { status: 400 });
  if (!newPassword) return NextResponse.json({ error: '请输入新密码' }, { status: 400 });
  if (!confirmPassword) return NextResponse.json({ error: '请确认新密码' }, { status: 400 });

  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: '两次输入的新密码不一致' }, { status: 400 });
  }

  if (newPassword.length < 6) {
    return NextResponse.json({ error: '新密码至少需要6位' }, { status: 400 });
  }

  if (oldPassword === newPassword) {
    return NextResponse.json({ error: '新密码不能与当前密码相同' }, { status: 400 });
  }

  const result = await changePassword(userId, oldPassword, newPassword);

  if (!result.success) {
    return NextResponse.json({ error: result.error || '修改密码失败' }, { status: 400 });
  }

  await createAuditLog({
    userId,
    action: 'user_change_password',
    resourceType: 'user',
    resourceId: userId,
  });

  return NextResponse.json({ success: true, message: '密码修改成功，请重新登录' });
}
