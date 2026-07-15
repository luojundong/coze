import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-guard';
import { resetUserPassword } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit-log';

/**
 * PUT /api/admin/users/[id]/password - 重置用户密码为 123456
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId: adminId, error } = await verifyAdminAuth(req);
  if (error) return error;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: '缺少用户 ID' }, { status: 400 });

  const DEFAULT_PASSWORD = '123456';
  const result = await resetUserPassword(id, DEFAULT_PASSWORD);

  if (!result.success) {
    return NextResponse.json({ error: result.error || '重置密码失败' }, { status: 400 });
  }

  await createAuditLog({
    userId: adminId,
    action: 'admin_reset_user_password',
    resourceType: 'user',
    resourceId: id,
  });

  return NextResponse.json({
    success: true,
    message: `密码已重置为 ${DEFAULT_PASSWORD}`,
  });
}
