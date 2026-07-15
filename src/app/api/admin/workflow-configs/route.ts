import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-guard';
import { query, queryOne, execute, genId } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { error } = await verifyAdminAuth(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = parseInt(searchParams.get('pageSize') || '10');
  const category = searchParams.get('category') || '';
  const offset = (page - 1) * pageSize;

  let whereClause = '';
  const params: any[] = [];
  if (category) {
    whereClause = 'WHERE category = ?';
    params.push(category);
  }

  const [data, countRow] = await Promise.all([
    query<any>(
      `SELECT * FROM workflow_configs ${whereClause} ORDER BY category ASC, sort_order ASC, created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    ),
    queryOne<{ total: number }>(
      `SELECT COUNT(*) as total FROM workflow_configs ${whereClause}`,
      params
    ),
  ]);

  // 同时返回所有分类列表，供前端Tab使用
  const categories = await query<{ category: string; cnt: number }>(
    `SELECT category, COUNT(*) as cnt FROM workflow_configs WHERE category != '' GROUP BY category ORDER BY category ASC`
  );

  return NextResponse.json({
    configs: data,
    total: countRow?.total ?? 0,
    page,
    pageSize,
    categories: categories || [],
    currentCategory: category || null,
  });
}

export async function POST(req: NextRequest) {
  const { error } = await verifyAdminAuth(req);
  if (error) return error;

  let body: { coze_id?: string; name?: string; description?: string; type?: string; category?: string; icon_url?: string; credit_cost?: number; parameters_schema?: any; tutorial?: string; sort_order?: number; opening_statement?: string; suggested_questions?: string[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '请求格式错误' }, { status: 400 }); }

  if (!body.coze_id || !body.name) return NextResponse.json({ error: '缺少必填字段: coze_id, name' }, { status: 400 });
  if (body.type && !['workflow', 'bot'].includes(body.type)) return NextResponse.json({ error: 'type 只支持 workflow 或 bot' }, { status: 400 });

  const id = genId();
  await execute(
    `INSERT INTO workflow_configs (id, coze_id, name, description, type, category, icon_url, credit_cost, parameters_schema, tutorial, opening_statement, suggested_questions, sort_order, is_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [id, body.coze_id, body.name, body.description || null, body.type || 'workflow', body.category || '', body.icon_url || null, body.credit_cost ?? 1, body.parameters_schema ? JSON.stringify(body.parameters_schema) : null, body.tutorial || null, body.opening_statement || null, body.suggested_questions?.length ? JSON.stringify(body.suggested_questions) : null, body.sort_order ?? 0]
  );

  const data = await queryOne<any>('SELECT * FROM workflow_configs WHERE id = ?', [id]);
  return NextResponse.json({ config: data }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const { error } = await verifyAdminAuth(req);
  if (error) return error;

  let body: { id?: string; coze_id?: string; name?: string; description?: string; type?: string; category?: string; icon_url?: string; is_enabled?: boolean; credit_cost?: number; parameters_schema?: any; tutorial?: string; sort_order?: number; opening_statement?: string; suggested_questions?: string[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '请求格式错误' }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: '缺少 id 参数' }, { status: 400 });

  const fields: string[] = [];
  const params: any[] = [];
  if (body.coze_id !== undefined) { fields.push('coze_id = ?'); params.push(body.coze_id); }
  if (body.name !== undefined) { fields.push('name = ?'); params.push(body.name); }
  if (body.description !== undefined) { fields.push('description = ?'); params.push(body.description); }
  if (body.type !== undefined) { fields.push('type = ?'); params.push(body.type); }
  if (body.category !== undefined) { fields.push('category = ?'); params.push(body.category); }
  if (body.icon_url !== undefined) { fields.push('icon_url = ?'); params.push(body.icon_url); }
  if (body.is_enabled !== undefined) { fields.push('is_enabled = ?'); params.push(body.is_enabled ? 1 : 0); }
  if (body.credit_cost !== undefined) { fields.push('credit_cost = ?'); params.push(body.credit_cost); }
  if (body.parameters_schema !== undefined) { fields.push('parameters_schema = ?'); params.push(JSON.stringify(body.parameters_schema)); }
  if (body.tutorial !== undefined) { fields.push('tutorial = ?'); params.push(body.tutorial); }
  if (body.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(body.sort_order); }
  if (body.opening_statement !== undefined) { fields.push('opening_statement = ?'); params.push(body.opening_statement || null); }
  if (body.suggested_questions !== undefined) { fields.push('suggested_questions = ?'); params.push(body.suggested_questions?.length ? JSON.stringify(body.suggested_questions) : null); }

  if (fields.length === 0) return NextResponse.json({ error: '没有需要修改的字段' }, { status: 400 });

  fields.push('updated_at = NOW()');
  params.push(body.id);

  await execute(`UPDATE workflow_configs SET ${fields.join(', ')} WHERE id = ?`, params);
  const data = await queryOne<any>('SELECT * FROM workflow_configs WHERE id = ?', [body.id]);
  return NextResponse.json({ config: data });
}

export async function DELETE(req: NextRequest) {
  const { error } = await verifyAdminAuth(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: '缺少 id 参数' }, { status: 400 });

  await execute('DELETE FROM workflow_configs WHERE id = ?', [id]);
  return NextResponse.json({ message: '删除成功' });
}
