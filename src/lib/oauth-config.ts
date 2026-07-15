import { query } from './db';

type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiBaseUrl: string;
};

export async function getOAuthConfig(): Promise<OAuthConfig> {
  const defaults = {
    clientId: process.env.COZE_CLIENT_ID || '',
    clientSecret: process.env.COZE_CLIENT_SECRET || '',
    redirectUri: `${process.env.COZE_PROJECT_DOMAIN_DEFAULT || 'http://localhost:5000'}/api/coze/oauth/callback`,
    apiBaseUrl: process.env.COZE_API_BASE_URL || 'https://api.coze.cn',
  };

  try {
    const rows = await query<{ key: string; value: string }>(
      "SELECT `key`, `value` FROM system_config WHERE `key` LIKE 'coze_%'"
    );

    if (rows && rows.length > 0) {
      const configMap = Object.fromEntries(rows.map(r => [r.key, r.value]));
      return {
        clientId: configMap['coze_client_id'] || defaults.clientId,
        clientSecret: configMap['coze_client_secret'] || defaults.clientSecret,
        redirectUri: configMap['coze_redirect_uri'] || defaults.redirectUri,
        apiBaseUrl: configMap['coze_api_base_url'] || defaults.apiBaseUrl,
      };
    }
  } catch {
    // Table might not exist, use defaults
  }

  return defaults;
}
