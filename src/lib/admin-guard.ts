import { verifyToken } from './auth';
import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from './db';

interface AdminAuthResult {
  userId: string;
  email: string;
  error?: NextResponse;
}

// 内存缓存
let cachedAdminIds: string[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 60_000;

async function getAdminIds(): Promise<string[]> {
  const now = Date.now();
  if (cachedAdminIds && now - cacheTime < CACHE_TTL) {
    return cachedAdminIds;
  }

  // 合并数据库和环境变量的管理员 ID（取并集）
  const idSet = new Set<string>();

  // 1. 从环境变量读取
  const envIds = (process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  envIds.forEach(id => idSet.add(id));

  // 2. 从数据库 system_config 读取并合并
  try {
    const row = await queryOne<{ value: string }>(
      `SELECT \`value\` FROM system_config WHERE \`key\` = 'admin_user_ids'`
    );
    if (row?.value) {
      row.value
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .forEach(id => idSet.add(id));
    }
  } catch {
    // fallback
  }

  const ids = Array.from(idSet);
  cachedAdminIds = ids.length > 0 ? ids : null;
  cacheTime = now;
  return ids;
}

async function isAdmin(userId: string): Promise<boolean> {
  const adminIds = await getAdminIds();
  if (adminIds.length === 0) {
    return process.env.COZE_PROJECT_ENV !== 'PROD';
  }
  return adminIds.includes(userId);
}

export async function verifyAdminAuth(req: NextRequest): Promise<AdminAuthResult> {
  const token = req.headers.get('x-session');
  if (!token) {
    return {
      userId: '',
      email: '',
      error: NextResponse.json({ error: '请先登录' }, { status: 401 }),
    };
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return {
      userId: '',
      email: '',
      error: NextResponse.json({ error: '认证失败，请重新登录' }, { status: 401 }),
    };
  }

  if (!(await isAdmin(decoded.userId))) {
    return {
      userId: decoded.userId,
      email: decoded.email,
      error: NextResponse.json({ error: '无管理员权限' }, { status: 403 }),
    };
  }

  return { userId: decoded.userId, email: decoded.email };
}

export function clearAdminCache(): void {
  cachedAdminIds = null;
  cacheTime = 0;
}
