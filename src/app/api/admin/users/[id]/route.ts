import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-guard';
import { deleteUserPermanently } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit-log';

/**
 * DELETE /api/admin/users/[id] - 永久删除用户及所有关联数据
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId: adminId, error } = await verifyAdminAuth(req);
  if (error) return error;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: '缺少用户 ID' }, { status: 400 });

  const result = await deleteUserPermanently(id);

  if (!result.success) {
    return NextResponse.json({ error: result.error || '删除用户失败' }, { status: 400 });
  }

  await createAuditLog({
    userId: adminId,
    action: 'admin_delete_user',
    resourceType: 'user',
    resourceId: id,
  });

  return NextResponse.json({ success: true, message: '用户已永久删除' });
}
