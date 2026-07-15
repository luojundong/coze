import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-guard';
import { query, queryOne } from '@/lib/db';
import { grantCredits } from '@/lib/credit';

export async function GET(req: NextRequest) {
  const { error } = await verifyAdminAuth(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);

  // 获取所有用户ID（用于全选所有用户充值）
  if (searchParams.get('all_ids') === 'true') {
    const search = searchParams.get('search') || '';
    let sqlQuery = `SELECT uc.user_id FROM user_credits uc LEFT JOIN users u ON uc.user_id = u.id`;
    const params: any[] = [];
    if (search) {
      sqlQuery += ' WHERE (u.email LIKE ? OR uc.user_id LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like);
    }
    const rows = await query<{ user_id: string }>(sqlQuery, params);
    return NextResponse.json({ user_ids: (rows || []).map(r => r.user_id) });
  }

  // 查询指定用户的交易明细
  const userId = searchParams.get('userId');
  if (userId) {
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
         ${whereClause}
         ORDER BY ct.created_at DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
      ),
      queryOne<{ total: number }>(
        `SELECT COUNT(*) as total FROM credit_transactions ct ${whereClause}`,
        params
      ),
    ]);

    return NextResponse.json({
      transactions,
      total: countRow?.total ?? 0,
      page,
      pageSize,
    });
  }

  // 默认：查询所有用户积分概览（分页）
  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = parseInt(searchParams.get('pageSize') || '10');
  const offset = (page - 1) * pageSize;
  const search = searchParams.get('search') || '';

  let countQuery = 'SELECT COUNT(*) as total FROM user_credits uc LEFT JOIN users u ON uc.user_id = u.id';
  let dataQuery = `SELECT uc.*, u.email 
     FROM user_credits uc
     LEFT JOIN users u ON uc.user_id = u.id`;
  const searchParams2: any[] = [];

  if (search) {
    const whereClause = ' WHERE (u.email LIKE ? OR uc.user_id LIKE ?)';
    countQuery += whereClause;
    dataQuery += whereClause;
    dataQuery += ' ORDER BY uc.updated_at DESC LIMIT ? OFFSET ?';
    const likePattern = `%${search}%`;
    searchParams2.push(likePattern, likePattern, pageSize, offset);
  } else {
    dataQuery += ' ORDER BY uc.updated_at DESC LIMIT ? OFFSET ?';
    searchParams2.push(pageSize, offset);
  }

  const [data, countRow] = await Promise.all([
    query<any>(dataQuery, searchParams2),
    queryOne<{ total: number }>(countQuery, search ? [`%${search}%`, `%${search}%`] : []),
  ]);

  return NextResponse.json({
    credits: data,
    total: countRow?.total ?? 0,
    page,
    pageSize,
  });
}

export async function POST(req: NextRequest) {
  const { error } = await verifyAdminAuth(req);
  if (error) return error;

  let body: { user_id?: string; user_ids?: string[]; amount?: number; description?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '请求格式错误' }, { status: 400 }); }

  if (!body.amount || body.amount <= 0) {
    return NextResponse.json({ error: '缺少必填字段: amount(正整数)' }, { status: 400 });
  }

  // 批量充值
  if (body.user_ids && body.user_ids.length > 0) {
    const results: { user_id: string; success: boolean; balance?: number; error?: string }[] = [];
    for (const uid of body.user_ids) {
      const result = await grantCredits(uid, body.amount, 'admin_grant', body.description || '管理员批量充值');
      results.push({
        user_id: uid,
        success: result.success,
        balance: result.balance,
        error: result.error,
      });
    }
    const successCount = results.filter(r => r.success).length;
    return NextResponse.json({
      message: `批量充值完成：${successCount}/${results.length} 成功`,
      results,
    });
  }

  // 单个充值
  if (!body.user_id) {
    return NextResponse.json({ error: '缺少必填字段: user_id' }, { status: 400 });
  }

  const result = await grantCredits(body.user_id, body.amount, 'admin_grant', body.description || '管理员充值');
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ balance: result.balance });
}
