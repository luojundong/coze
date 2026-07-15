import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { query } from '@/lib/db';

/**
 * GET /api/announcements — 获取公告列表（所有已登录用户可访问）
 */
export async function GET(req: NextRequest) {
  const { error } = await verifyAuth(req);
  if (error) return error;

  const announcements = await query<any>(
    `SELECT id, title, content, is_pinned, created_at
     FROM announcements
     WHERE is_published = 1
     ORDER BY is_pinned DESC, created_at DESC
     LIMIT 20`
  );

  return NextResponse.json({ announcements: announcements || [] });
}
