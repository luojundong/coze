'use client';

import { useEffect } from 'react';

/**
 * OAuth 中转页面
 * 小程序 web-view 不能直接加载 www.coze.cn（非业务域名），
 * 所以先加载本页面（coze.mooibi.com/oauth-proxy），再跳转到 Coze 授权页。
 * 页面内跳转不受 web-view 业务域名限制。
 */
export default function OAuthProxyPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authUrl = params.get('authUrl');
    if (authUrl) {
      window.location.replace(authUrl);
    }
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      background: '#f8fafc',
    }}>
      <div style={{ fontSize: 14, color: '#64748b' }}>正在跳转到 Coze 授权...</div>
    </div>
  );
}
