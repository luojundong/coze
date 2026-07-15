import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { query, queryOne } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
  const action = searchParams.get('action');
  const offset = (page - 1) * pageSize;

  let whereClause = 'WHERE user_id = ?';
  const params: any[] = [userId];
  if (action) {
    whereClause += ' AND action = ?';
    params.push(action);
  }

  const [logs, countRow] = await Promise.all([
    query<any>(
      `SELECT id, action, resource_type, resource_id, status, error_message, created_at, details 
       FROM audit_logs ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    ),
    queryOne<{ total: number }>(
      `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`,
      params
    ),
  ]);

  return NextResponse.json({
    logs: logs ?? [],
    total: countRow?.total ?? 0,
    page,
    pageSize,
  });
}
