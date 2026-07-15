import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute, genId } from '@/lib/db';

export async function POST(req: NextRequest) {
  // Check if demo code already exists
  const existing = await queryOne<{ code: string }>(
    'SELECT code FROM activation_codes WHERE code = ?',
    ['DEMO-ACTIVE-2024']
  );

  if (existing) {
    return NextResponse.json({ code: existing.code, message: 'Demo code already exists' });
  }

  await execute(
    `INSERT INTO activation_codes (id, code, name, description, max_uses, used_count, is_active)
     VALUES (?, ?, ?, ?, ?, 0, 1)`,
    [genId(), 'DEMO-ACTIVE-2024', '体验激活码', '用于测试的体验激活码', 100]
  );

  return NextResponse.json({ code: 'DEMO-ACTIVE-2024', message: 'Demo activation code created' });
}
