import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { queryOne, query, execute, genId } from './db';

const JWT_SECRET = process.env.JWT_SECRET || 'coze-workflow-platform-secret-key-2026';
const JWT_EXPIRES_IN = '7d';
const SALT_ROUNDS = 10;

export interface AuthUser {
  id: string;
  email: string;
  phone: string | null;
  is_admin: number;
  is_active: number;
}

// ========== 密码工具 ==========

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ========== JWT 工具 ==========

export function generateToken(user: AuthUser): string {
  return jwt.sign(
    { sub: user.id, email: user.email, phone: user.phone, is_admin: user.is_admin },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function verifyToken(token: string): { userId: string; email: string; phone: string | null; isAdmin: boolean } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    return {
      userId: payload.sub,
      email: payload.email || '',
      phone: payload.phone || null,
      isAdmin: !!payload.is_admin,
    };
  } catch {
    return null;
  }
}

// ========== 用户 Auth ==========

// 判断是否为手机号格式
function isPhoneNumber(input: string): boolean {
  return /^1[3-9]\d{9}$/.test(input.trim());
}

export async function createUser(email: string, password: string): Promise<{ user: AuthUser; token: string } | { error: string }> {
  const isPhone = isPhoneNumber(email);
  const trimmedInput = isPhone ? email.trim() : email.toLowerCase().trim();

  // 检查用户是否已存在
  let existing: AuthUser | null = null;
  if (isPhone) {
    existing = await queryOne<AuthUser>(
      'SELECT id, email, phone, is_admin, is_active FROM users WHERE phone = ?',
      [trimmedInput]
    );
  } else {
    existing = await queryOne<AuthUser>(
      'SELECT id, email, phone, is_admin, is_active FROM users WHERE email = ?',
      [trimmedInput]
    );
  }

  if (existing) {
    return { error: isPhone ? '该手机号已注册' : '该邮箱已注册' };
  }

  const id = genId();
  const passwordHash = await hashPassword(password);

  if (isPhone) {
    await execute(
      'INSERT INTO users (id, phone, password_hash, is_admin, is_active) VALUES (?, ?, ?, 0, 1)',
      [id, trimmedInput, passwordHash]
    );
  } else {
    await execute(
      'INSERT INTO users (id, email, password_hash, is_admin, is_active) VALUES (?, ?, ?, 0, 1)',
      [id, trimmedInput, passwordHash]
    );
  }

  const user: AuthUser = {
    id,
    email: isPhone ? '' : trimmedInput,
    phone: isPhone ? trimmedInput : null,
    is_admin: 0,
    is_active: 1,
  };

  const token = generateToken(user);
  return { user, token };
}

export async function loginUser(email: string, password: string): Promise<{ user: AuthUser; token: string } | { error: string }> {
  const isPhone = isPhoneNumber(email);
  const trimmedInput = isPhone ? email.trim() : email.toLowerCase().trim();

  let row: (AuthUser & { password_hash: string }) | null = null;

  if (isPhone) {
    row = await queryOne<AuthUser & { password_hash: string }>(
      'SELECT id, email, phone, password_hash, is_admin, is_active FROM users WHERE phone = ?',
      [trimmedInput]
    );
  } else {
    row = await queryOne<AuthUser & { password_hash: string }>(
      'SELECT id, email, phone, password_hash, is_admin, is_active FROM users WHERE email = ?',
      [trimmedInput]
    );
  }

  if (!row) {
    return { error: isPhone ? '手机号或密码错误' : '邮箱或密码错误' };
  }

  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) {
    return { error: isPhone ? '手机号或密码错误' : '邮箱或密码错误' };
  }

  const user: AuthUser = {
    id: row.id,
    email: row.email || '',
    phone: row.phone || null,
    is_admin: row.is_admin,
    is_active: row.is_active,
  };

  const token = generateToken(user);
  return { user, token };
}

export async function getUserById(userId: string): Promise<AuthUser | null> {
  return queryOne<AuthUser>(
    'SELECT id, email, phone, is_admin, is_active FROM users WHERE id = ?',
    [userId]
  );
}

export async function getUserByEmail(email: string): Promise<AuthUser | null> {
  return queryOne<AuthUser>(
    'SELECT id, email, phone, is_admin, is_active FROM users WHERE email = ?',
    [email.toLowerCase().trim()]
  );
}

export async function getUserByPhone(phone: string): Promise<AuthUser | null> {
  return queryOne<AuthUser>(
    'SELECT id, email, phone, is_admin, is_active FROM users WHERE phone = ?',
    [phone.trim()]
  );
}

// ========== 管理员相关 ==========

export async function listUsers(page: number = 1, pageSize: number = 20) {
  const offset = (page - 1) * pageSize;
  const [users, countResult] = await Promise.all([
    query<AuthUser & { created_at: string }>(
      'SELECT id, email, phone, is_admin, is_active, created_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [pageSize, offset]
    ),
    queryOne<{ total: number }>('SELECT COUNT(*) as total FROM users'),
  ]);

  return {
    users,
    total: countResult?.total || 0,
    page,
    pageSize,
  };
}

/**
 * 重置用户密码（管理员操作）
 */
export async function resetUserPassword(userId: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getUserById(userId);
    if (!user) return { success: false, error: '用户不存在' };

    const passwordHash = await hashPassword(newPassword);
    await execute(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [passwordHash, userId]
    );
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * 用户自助修改密码
 */
export async function changePassword(
  userId: string,
  oldPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // 验证旧密码
    const row = await queryOne<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = ?',
      [userId]
    );
    if (!row) return { success: false, error: '用户不存在' };

    const valid = await verifyPassword(oldPassword, row.password_hash);
    if (!valid) return { success: false, error: '当前密码不正确' };

    // 新密码不能为空或太短
    if (!newPassword || newPassword.length < 6) {
      return { success: false, error: '新密码至少需要6位' };
    }

    const passwordHash = await hashPassword(newPassword);
    await execute(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [passwordHash, userId]
    );
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * 永久删除用户及其所有关联数据（管理员操作）
 */
export async function deleteUserPermanently(userId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getUserById(userId);
    if (!user) return { success: false, error: '用户不存在' };

    // 按外键依赖顺序删除
    const tables = [
      'referral_commissions WHERE referrer_user_id = ? OR referred_user_id = ?',
      'referral_relations WHERE referrer_user_id = ? OR referred_user_id = ?',
      'user_memberships WHERE user_id = ?',
      'user_favorites WHERE user_id = ?',
      'credit_transactions WHERE user_id = ?',
      'user_credits WHERE user_id = ?',
      'coze_tokens WHERE user_id = ?',
      'user_activations WHERE user_id = ?',
    ];

    for (const table of tables) {
      if (table.startsWith('referral_commissions') || table.startsWith('referral_relations')) {
        const [clause, ...rest] = table.split(' WHERE ');
        await execute(
          `DELETE FROM ${clause} WHERE ${rest.join(' WHERE ')}`,
          [userId, userId]
        );
      } else {
        await execute(`DELETE FROM ${table}`, [userId]);
      }
    }

    // 最后删除用户本体
    await execute('DELETE FROM users WHERE id = ?', [userId]);

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
