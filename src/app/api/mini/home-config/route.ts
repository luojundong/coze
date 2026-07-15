import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { queryOne } from '@/lib/db';

/**
 * GET /api/mini/home-config
 * 返回小程序首页可配置项：三个快捷按钮（文字/图标）与「联系老师」「使用教程」内容。
 * 所有已登录用户可访问（首页需登录后展示）。
 */
const DEFAULTS = {
  contact_teacher: { text: '联系老师', icon: '' },
  tutorial: { text: '使用教程', icon: '' },
  share: { text: '分享', icon: '' },
};

export async function GET(req: NextRequest) {
  const { error } = await verifyAuth(req);
  if (error) return error;

  const row = await queryOne<any>('SELECT * FROM mini_home_config WHERE id = 1');

  const buttons = {
    contact_teacher: {
      text: row?.contact_teacher_text || DEFAULTS.contact_teacher.text,
      icon: row?.contact_teacher_icon || '',
    },
    tutorial: {
      text: row?.tutorial_text || DEFAULTS.tutorial.text,
      icon: row?.tutorial_icon || '',
    },
    share: {
      text: row?.share_text || DEFAULTS.share.text,
      icon: row?.share_icon || '',
    },
  };

  return NextResponse.json({
    buttons,
    contact_teacher_content: row?.contact_teacher_content || '',
  });
}
