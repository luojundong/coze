import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-guard';

export async function GET(req: NextRequest) {
  const { userId, email, error } = await verifyAdminAuth(req);
  if (error) return error;

  return NextResponse.json({
    is_admin: true,
    user_id: userId,
    email,
  });
}
