import { verifyToken } from './auth';
import { NextRequest, NextResponse } from 'next/server';
import { query } from './db';

interface AuthResult {
  userId: string;
  error?: NextResponse;
}

export async function verifyAuth(req: NextRequest): Promise<AuthResult> {
  const token = req.headers.get('x-session');
  if (!token) {
    return {
      userId: '',
      error: NextResponse.json(
        { error: '请先登录' },
        { status: 401, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      ),
    };
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return {
      userId: '',
      error: NextResponse.json(
        { error: '认证失败，请重新登录' },
        { status: 401, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      ),
    };
  }

  return { userId: decoded.userId };
}

/**
 * Check if user has any activation (global or tool-specific)
 */
export async function verifyActivation(userId: string): Promise<{ activated: boolean; error?: string }> {
  const rows = await query(
    `SELECT id, is_active, expires_at FROM user_activations 
     WHERE user_id = ? AND is_active = 1`,
    [userId]
  );

  if (!rows || rows.length === 0) {
    return { activated: false, error: '请先激活您的账户' };
  }

  const validActivations = rows.filter(
    (a: any) => !a.expires_at || new Date(a.expires_at) >= new Date()
  );
  if (validActivations.length === 0) {
    return { activated: false, error: '您的激活已过期，请重新激活' };
  }

  return { activated: true };
}

/**
 * Check if user has activation for a specific tool
 */
export async function verifyToolActivation(userId: string, toolId: string): Promise<{ activated: boolean; error?: string }> {
  const rows = await query(
    `SELECT id, is_active, expires_at, tool_id FROM user_activations 
     WHERE user_id = ? AND is_active = 1`,
    [userId]
  );

  if (!rows || rows.length === 0) {
    return { activated: false, error: '请输入激活码以使用此工具' };
  }

  // Check for global activation (tool_id = null)
  const globalActivation = (rows as any[]).find((a) => a.tool_id === null);
  if (globalActivation) {
    if (globalActivation.expires_at && new Date(globalActivation.expires_at) < new Date()) {
      return { activated: false, error: '您的激活已过期，请重新激活' };
    }
    return { activated: true };
  }

  // Check for tool-specific activation
  const toolActivation = (rows as any[]).find((a) => a.tool_id === toolId);
  if (!toolActivation) {
    return { activated: false, error: '请输入激活码以使用此工具' };
  }

  if (toolActivation.expires_at && new Date(toolActivation.expires_at) < new Date()) {
    return { activated: false, error: '此工具的激活已过期，请重新激活' };
  }

  return { activated: true };
}
