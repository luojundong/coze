import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-guard';
import { queryOne, execute } from '@/lib/db';

/**
 * GET  /api/admin/mini-config — 获取首页配置（按钮 + 内容）
 * PUT  /api/admin/mini-config — 更新首页配置
 */
export async function GET(req: NextRequest) {
  const { error } = await verifyAdminAuth(req);
  if (error) return error;

  const row = await queryOne<any>('SELECT * FROM mini_home_config WHERE id = 1') || {};
  return NextResponse.json({
    buttons: {
      contact_teacher: { text: row.contact_teacher_text || '联系老师', icon: row.contact_teacher_icon || '' },
      tutorial: { text: row.tutorial_text || '使用教程', icon: row.tutorial_icon || '' },
      share: { text: row.share_text || '分享', icon: row.share_icon || '' },
    },
    contact_teacher_content: row.contact_teacher_content || '',
  });
}

export async function PUT(req: NextRequest) {
  const { error } = await verifyAdminAuth(req);
  if (error) return error;

  const body = await req.json().catch(() => ({}));

  const fieldMap: Record<string, string> = {
    contact_teacher_text: 'contact_teacher_text',
    contact_teacher_icon: 'contact_teacher_icon',
    tutorial_text: 'tutorial_text',
    tutorial_icon: 'tutorial_icon',
    share_text: 'share_text',
    share_icon: 'share_icon',
    contact_teacher_content: 'contact_teacher_content',
  };

  const sets: string[] = [];
  const params: any[] = [];
  for (const key of Object.keys(fieldMap)) {
    if (body[key] !== undefined) {
      sets.push(`${fieldMap[key]} = ?`);
      params.push(String(body[key] ?? ''));
    }
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: '没有需要修改的字段' }, { status: 400 });
  }

  sets.push('updated_at = NOW()');
  params.push(1);

  await execute(`UPDATE mini_home_config SET ${sets.join(', ')} WHERE id = ?`, params);

  const row = await queryOne<any>('SELECT * FROM mini_home_config WHERE id = 1');
  return NextResponse.json({ success: true, config: row });
}
