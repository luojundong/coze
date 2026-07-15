import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-guard';
import { query, execute } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

// GET: 获取所有分类
export async function GET(req: NextRequest) {
  const { error } = await verifyAdminAuth(req);
  if (error) return error;

  const categories = await query<{
    id: string; name: string; sort_order: number; created_at: string;
  }>(
    'SELECT id, name, sort_order, created_at FROM tool_categories ORDER BY sort_order ASC, created_at ASC'
  );

  return NextResponse.json({ categories: categories || [] });
}

// POST: 新增分类
export async function POST(req: NextRequest) {
  const { error } = await verifyAdminAuth(req);
  if (error) return error;

  let body: { name?: string; sort_order?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: '分类名称不能为空' }, { status: 400 });
  }
  if (name.length > 64) {
    return NextResponse.json({ error: '分类名称最多64个字符' }, { status: 400 });
  }

  // Check duplicate
  const existing = await query<{ id: string }>(
    'SELECT id FROM tool_categories WHERE name = ?',
    [name]
  );
  if (existing && existing.length > 0) {
    return NextResponse.json({ error: '该分类名称已存在' }, { status: 409 });
  }

  const id = uuidv4();
  await execute(
    'INSERT INTO tool_categories (id, name, sort_order) VALUES (?, ?, ?)',
    [id, name, body.sort_order ?? 0]
  );

  return NextResponse.json({ id, name, sort_order: body.sort_order ?? 0 });
}

// PUT: 修改分类
export async function PUT(req: NextRequest) {
  const { error } = await verifyAdminAuth(req);
  if (error) return error;

  let body: { id?: string; name?: string; sort_order?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ error: '缺少分类ID' }, { status: 400 });
  }

  const name = body.name?.trim();
  if (name !== undefined) {
    if (!name) {
      return NextResponse.json({ error: '分类名称不能为空' }, { status: 400 });
    }
    if (name.length > 64) {
      return NextResponse.json({ error: '分类名称最多64个字符' }, { status: 400 });
    }

    // Check duplicate (exclude self)
    const existing = await query<{ id: string }>(
      'SELECT id FROM tool_categories WHERE name = ? AND id != ?',
      [name, body.id]
    );
    if (existing && existing.length > 0) {
      return NextResponse.json({ error: '该分类名称已存在' }, { status: 409 });
    }
  }

  const fields: string[] = [];
  const params: any[] = [];
  if (name !== undefined) { fields.push('name = ?'); params.push(name); }
  if (body.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(body.sort_order); }

  if (fields.length === 0) {
    return NextResponse.json({ error: '没有需要修改的字段' }, { status: 400 });
  }

  params.push(body.id);
  await execute(
    `UPDATE tool_categories SET ${fields.join(', ')} WHERE id = ?`,
    params
  );

  return NextResponse.json({ success: true });
}

// DELETE: 删除分类
export async function DELETE(req: NextRequest) {
  const { error } = await verifyAdminAuth(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: '缺少分类ID' }, { status: 400 });
  }

  // 检查是否有工具正在使用此分类
  const cat = await query<{ name: string }>(
    'SELECT name FROM tool_categories WHERE id = ?',
    [id]
  );
  if (!cat || cat.length === 0) {
    return NextResponse.json({ error: '分类不存在' }, { status: 404 });
  }

  const toolCount = await query<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM workflow_configs WHERE category = ?',
    [cat[0].name]
  );

  await execute('DELETE FROM tool_categories WHERE id = ?', [id]);

  return NextResponse.json({
    success: true,
    affectedTools: toolCount?.[0]?.cnt || 0,
    categoryName: cat[0].name,
  });
}
