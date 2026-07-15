import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-guard';
import { query, execute } from '@/lib/db';
import { createAuditLog } from '@/lib/audit-log';

export async function GET(req: NextRequest) {
  const { error } = await verifyAdminAuth(req);
  if (error) return error;

  let clientId = process.env.COZE_CLIENT_ID || '';
  let clientSecret = process.env.COZE_CLIENT_SECRET || '';
  let redirectUri = process.env.COZE_REDIRECT_URI || '';
  let apiBaseUrl = process.env.COZE_API_BASE_URL || 'https://api.coze.cn';

  try {
    const rows = await query<{ key: string; value: string }>(
      "SELECT `key`, `value` FROM system_config WHERE `key` LIKE 'coze_%'"
    );
    if (rows && rows.length > 0) {
      const configMap = Object.fromEntries(rows.map(r => [r.key, r.value]));
      if (configMap['coze_client_id']) clientId = configMap['coze_client_id'];
      if (configMap['coze_client_secret']) clientSecret = configMap['coze_client_secret'];
      if (configMap['coze_redirect_uri']) redirectUri = configMap['coze_redirect_uri'];
      if (configMap['coze_api_base_url']) apiBaseUrl = configMap['coze_api_base_url'];
    }
  } catch { /* use env vars */ }

  return NextResponse.json({
    client_id: clientId,
    client_id_set: clientId.length > 0,
    client_secret_set: clientSecret.length > 0,
    client_secret_mask: clientSecret ? clientSecret.slice(0, 4) + '****' + clientSecret.slice(-4) : '',
    redirect_uri: redirectUri,
    api_base_url: apiBaseUrl,
  });
}

export async function PUT(req: NextRequest) {
  const { userId: adminId, error } = await verifyAdminAuth(req);
  if (error) return error;

  let body: { client_id?: string; client_secret?: string; redirect_uri?: string; api_base_url?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '请求格式错误' }, { status: 400 }); }

  const configEntries = Object.entries(body).filter(([, v]) => v !== undefined && v !== '');

  for (const [key, value] of configEntries) {
    await execute(
      `INSERT INTO system_config (\`key\`, \`value\`) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = NOW()`,
      [`coze_${key}`, value as string]
    );
  }

  // OAuth 配置变更后，清除所有用户的 Coze Token，强制重新授权
  // 因为旧的 token 属于旧 Coze 账户，无法访问新账户下的工作流/智能体
  if (configEntries.some(([k]) => k === 'client_id' || k === 'client_secret')) {
    await execute('DELETE FROM coze_tokens');
    console.log('[OAuth Config] Cleared all user Coze tokens due to client_id/client_secret change');
  }

  await createAuditLog({
    userId: adminId, action: 'admin_update_oauth_config',
    resourceType: 'system_config', details: { keys: configEntries.map(([k]) => k) },
  });

  return NextResponse.json({ success: true, updated_keys: configEntries.map(([k]) => k) });
}
