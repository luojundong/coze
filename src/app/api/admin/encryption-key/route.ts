import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-guard';
import { createAuditLog } from '@/lib/audit-log';
import { decrypt, encrypt } from '@/lib/crypto';
import { query, execute } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { error } = await verifyAdminAuth(req);
  if (error) return error;

  const secret = process.env.ENCRYPTION_SECRET || '';
  const hasKey = secret.length > 0;
  const isDefault = secret === 'default-encryption-secret-change-in-prod';
  const keyPreview = hasKey ? secret.slice(0, 4) + '****' + secret.slice(-4) : '';
  const keyLength = secret.length;

  return NextResponse.json({
    has_key: hasKey, is_default: isDefault, key_preview: keyPreview, key_length: keyLength,
    recommendation: isDefault ? '当前使用默认密钥，生产环境务必更换！' : keyLength < 32 ? '密钥长度不足32字符' : '密钥配置合规',
  });
}

export async function POST(req: NextRequest) {
  const { userId: adminId, error } = await verifyAdminAuth(req);
  if (error) return error;

  let body: { new_secret?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '请求格式错误' }, { status: 400 }); }

  if (!body.new_secret || body.new_secret.length < 32) {
    return NextResponse.json({ error: '新密钥长度不能少于32个字符' }, { status: 400 });
  }

  const tokens = await query<{ id: string; encrypted_access_token: string; encrypted_refresh_token: string | null }>(
    'SELECT id, encrypted_access_token, encrypted_refresh_token FROM coze_tokens'
  );

  if (!tokens || tokens.length === 0) {
    return NextResponse.json({ success: true, re_encrypted: 0, message: '无需重新加密' });
  }

  const oldSecret = process.env.ENCRYPTION_SECRET;
  let reEncrypted = 0;
  let failed = 0;

  for (const token of tokens) {
    try {
      const oldAccessToken = decrypt(token.encrypted_access_token);
      const oldRefreshToken = token.encrypted_refresh_token ? decrypt(token.encrypted_refresh_token) : null;

      process.env.ENCRYPTION_SECRET = body.new_secret;
      const newAccessEncrypted = encrypt(oldAccessToken);
      const newRefreshEncrypted = oldRefreshToken ? encrypt(oldRefreshToken) : null;

      await execute(
        'UPDATE coze_tokens SET encrypted_access_token = ?, encrypted_refresh_token = ?, updated_at = NOW() WHERE id = ?',
        [newAccessEncrypted, newRefreshEncrypted, token.id]
      );
      reEncrypted++;
    } catch (e) {
      failed++;
      if (reEncrypted === 0) {
        if (oldSecret) process.env.ENCRYPTION_SECRET = oldSecret;
        return NextResponse.json({ error: '重新加密失败，已恢复旧密钥', detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
      }
    }
  }

  await createAuditLog({ userId: adminId, action: 'admin_rotate_encryption_key', resourceType: 'system_config', details: { re_encrypted: reEncrypted, failed } });
  return NextResponse.json({ success: true, re_encrypted: reEncrypted, failed });
}
