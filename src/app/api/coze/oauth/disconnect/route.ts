import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { execute } from '@/lib/db';
import { createAuditLog } from '@/lib/audit-log';

async function handleDisconnect(req: NextRequest) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  await execute('DELETE FROM coze_tokens WHERE user_id = ?', [userId]);

  await createAuditLog({
    userId,
    action: 'coze_oauth_disconnect',
    resourceType: 'coze_token',
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  return handleDisconnect(req);
}

export async function POST(req: NextRequest) {
  return handleDisconnect(req);
}
