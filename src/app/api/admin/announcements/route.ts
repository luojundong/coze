import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-guard';
import { query, queryOne, execute, genId } from '@/lib/db';

/**
 * GET /api/admin/announcements — 管理后台获取公告列表
 */
export async function GET(req: NextRequest) {
  const { error } = await verifyAdminAuth(req);
  if (error) return error;

  const announcements = await query<any>(
    `SELECT * FROM announcements ORDER BY is_pinned DESC, created_at DESC`
  );

  return NextResponse.json({ announcements: announcements || [] });
}

/**
 * POST /api/admin/announcements — 创建公告
 */
export async function POST(req: NextRequest) {
  const { error } = await verifyAdminAuth(req);
  if (error) return error;

  let body: { title?: string; content?: string; is_pinned?: boolean; is_published?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '请求格式错误' }, { status: 400 }); }

  if (!body.title?.trim() || !body.content?.trim()) {
    return NextResponse.json({ error: '标题和内容不能为空' }, { status: 400 });
  }

  const id = genId();
  await execute(
    `INSERT INTO announcements (id, title, content, is_pinned, is_published)
     VALUES (?, ?, ?, ?, ?)`,
    [id, body.title.trim(), body.content.trim(), body.is_pinned ? 1 : 0, body.is_published ? 1 : 0]
  );

  const data = await queryOne<any>('SELECT * FROM announcements WHERE id = ?', [id]);
  return NextResponse.json({ announcement: data }, { status: 201 });
}

/**
 * PUT /api/admin/announcements — 更新公告
 */
export async function PUT(req: NextRequest) {
  const { error } = await verifyAdminAuth(req);
  if (error) return error;

  let body: { id?: string; title?: string; content?: string; is_pinned?: boolean; is_published?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '请求格式错误' }, { status: 400 }); }

  if (!body.id) return NextResponse.json({ error: '缺少 id 参数' }, { status: 400 });

  const fields: string[] = [];
  const params: any[] = [];
  if (body.title !== undefined) { fields.push('title = ?'); params.push(body.title); }
  if (body.content !== undefined) { fields.push('content = ?'); params.push(body.content); }
  if (body.is_pinned !== undefined) { fields.push('is_pinned = ?'); params.push(body.is_pinned ? 1 : 0); }
  if (body.is_published !== undefined) { fields.push('is_published = ?'); params.push(body.is_published ? 1 : 0); }

  if (fields.length === 0) return NextResponse.json({ error: '没有需要修改的字段' }, { status: 400 });

  fields.push('updated_at = NOW()');
  params.push(body.id);

  await execute(`UPDATE announcements SET ${fields.join(', ')} WHERE id = ?`, params);
  const data = await queryOne<any>('SELECT * FROM announcements WHERE id = ?', [body.id]);
  return NextResponse.json({ announcement: data });
}

/**
 * DELETE /api/admin/announcements — 删除公告
 */
export async function DELETE(req: NextRequest) {
  const { error } = await verifyAdminAuth(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: '缺少 id 参数' }, { status: 400 });

  await execute('DELETE FROM announcements WHERE id = ?', [id]);
  return NextResponse.json({ message: '删除成功' });
}
