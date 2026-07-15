import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { query, execute, genId } from '@/lib/db';

// GET: 获取用户收藏的工具ID列表
export async function GET(req: NextRequest) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  const data = await query<{ tool_id: string }>(
    'SELECT tool_id FROM user_favorites WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC',
    [userId]
  );

  return NextResponse.json({ favorites: (data || []).map(f => f.tool_id) });
}

// POST: 添加收藏
export async function POST(req: NextRequest) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  let body: { tool_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '请求格式错误' }, { status: 400 }); }

  if (!body.tool_id) return NextResponse.json({ error: '缺少 tool_id' }, { status: 400 });

  // 检查是否已收藏
  const existing = await query<{ id: string }>(
    'SELECT id FROM user_favorites WHERE user_id = ? AND tool_id = ?',
    [userId, body.tool_id]
  );

  if (existing && existing.length > 0) {
    return NextResponse.json({ message: '已收藏', id: existing[0].id });
  }

  // 获取当前最大 sort_order
  const maxOrder = await query<{ max_order: number }>(
    'SELECT COALESCE(MAX(sort_order), -1) as max_order FROM user_favorites WHERE user_id = ?',
    [userId]
  );

  const id = genId();
  const nextOrder = (maxOrder && maxOrder.length > 0 ? maxOrder[0].max_order : -1) + 1;

  await execute(
    'INSERT INTO user_favorites (id, user_id, tool_id, sort_order) VALUES (?, ?, ?, ?)',
    [id, userId, body.tool_id, nextOrder]
  );

  return NextResponse.json({ message: '收藏成功', id }, { status: 201 });
}

// DELETE: 取消收藏
export async function DELETE(req: NextRequest) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const toolId = searchParams.get('tool_id');
  if (!toolId) return NextResponse.json({ error: '缺少 tool_id' }, { status: 400 });

  await execute(
    'DELETE FROM user_favorites WHERE user_id = ? AND tool_id = ?',
    [userId, toolId]
  );

  return NextResponse.json({ message: '已取消收藏' });
}
