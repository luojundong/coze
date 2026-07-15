import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { query, queryOne } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  // Get balance
  const creditData = await queryOne<{ balance: number; total_granted: number; total_consumed: number }>(
    'SELECT balance, total_granted, total_consumed FROM user_credits WHERE user_id = ?',
    [userId]
  );

  // Get recent transactions（支持时间筛选）
  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = parseInt(searchParams.get('pageSize') || '20');
  const offset = (page - 1) * pageSize;
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  let whereClause = 'WHERE ct.user_id = ?';
  const params: any[] = [userId];

  if (startDate) {
    whereClause += ' AND ct.created_at >= ?';
    params.push(startDate);
  }
  if (endDate) {
    whereClause += ' AND ct.created_at <= ?';
    params.push(endDate + ' 23:59:59');
  }

  const [transactions, countRow] = await Promise.all([
    query<any>(
      `SELECT ct.id, ct.amount, ct.type, ct.description, ct.workflow_config_id, ct.created_at,
              wc.name as workflow_name
       FROM credit_transactions ct
       LEFT JOIN workflow_configs wc ON ct.workflow_config_id = wc.id
       ${whereClause} ORDER BY ct.created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    ),
    queryOne<{ total: number }>(
      `SELECT COUNT(*) as total FROM credit_transactions ct ${whereClause}`,
      params
    ),
  ]);

  return NextResponse.json({
    balance: creditData?.balance ?? 0,
    totalGranted: creditData?.total_granted ?? 0,
    totalConsumed: creditData?.total_consumed ?? 0,
    transactions,
    total: countRow?.total ?? 0,
    page,
    pageSize,
  });
}
