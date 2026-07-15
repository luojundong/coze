'use client';

import { useState, useEffect, useCallback } from 'react';
import { getToken } from '@/lib/api-client';
import { Save, RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react';

interface OAuthConfig {
  client_id: string;
  client_id_set: boolean;
  client_secret_set: boolean;
  client_secret_mask: string;
  redirect_uri: string;
  api_base_url: string;
}

export default function AdminOAuthPage() {
  const [config, setConfig] = useState<OAuthConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [session, setSession] = useState<{ access_token: string } | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('https://api.coze.cn');

  const init = useCallback(async () => {
    const token = getToken();
    if (token) setSession({ access_token: token } as any);
  }, []);

  const fetchConfig = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const res = await fetch('/api/admin/oauth-config', {
      headers: { 'x-session': session.access_token },
    });
    if (res.ok) {
      const data = await res.json();
      setConfig(data);
      setClientId(data.client_id || '');
      setRedirectUri(data.redirect_uri || '');
      setApiBaseUrl(data.api_base_url || 'https://api.coze.cn');
    }
    setLoading(false);
  }, [session]);

  useEffect(() => { init(); }, [init]);
  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const handleSave = async () => {
    if (!session) return;
    setSaving(true);
    setMessage(null);
    try {
      const body: Record<string, string> = {};
      if (clientId) body.client_id = clientId;
      if (clientSecret) body.client_secret = clientSecret;
      if (redirectUri) body.redirect_uri = redirectUri;
      if (apiBaseUrl) body.api_base_url = apiBaseUrl;

      const res = await fetch('/api/admin/oauth-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-session': session.access_token },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        const msg = (clientId || clientSecret)
          ? '配置保存成功。Client ID/Secret 已变更，所有用户的 Coze 连接已重置，用户需要重新授权。'
          : '配置保存成功';
        setMessage({ type: 'success', text: msg });
        setClientSecret('');
        fetchConfig();
      } else {
        const data = await res.json();
        setMessage({ type: 'error', text: data.error || '保存失败' });
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-gray-500 py-8">加载中...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">OAuth 应用配置</h1>
        <button
          onClick={fetchConfig}
          className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className="w-3.5 h-3.5" /> 刷新
        </button>
      </div>

      {/* Current status */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
        <h2 className="text-base font-medium text-gray-900 mb-4">当前配置状态</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2">
            {config?.client_id_set ? (
              <CheckCircle className="w-5 h-5 text-green-500" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            )}
            <span className="text-sm">Client ID: {config?.client_id_set ? '已配置' : '未配置'}</span>
          </div>
          <div className="flex items-center gap-2">
            {config?.client_secret_set ? (
              <CheckCircle className="w-5 h-5 text-green-500" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            )}
            <span className="text-sm">Client Secret: {config?.client_secret_set ? `已配置 (${config.client_secret_mask})` : '未配置'}</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <span className="text-sm">API Base URL: {config?.api_base_url}</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <span className="text-sm">回调地址: {config?.redirect_uri || '使用默认'}</span>
          </div>
        </div>
      </div>

      {/* Edit form */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="text-base font-medium text-gray-900 mb-4">修改配置</h2>
        <div className="space-y-4 max-w-lg">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Coze Client ID
            </label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="格式如: 8173420653665306615182245269****.app.coze"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-red-500 mt-1">注意：不是应用ID（纯数字），而是带 .app.coze 后缀的 OAuth 客户端ID</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Coze Client Secret
            </label>
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={config?.client_secret_set ? '已配置，留空则不修改' : '格式如: czvSJMcRob40yQ04HmSyCbEw6h22r0LJwHcKyu13H2ic'}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-red-500 mt-1">注意：不是个人访问令牌(PAT，pat_开头)，而是 OAuth 应用的客户端密钥</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              回调地址 (Redirect URI)
            </label>
            <input
              type="text"
              value={redirectUri}
              onChange={(e) => setRedirectUri(e.target.value)}
              placeholder="https://your-domain/api/coze/oauth/callback"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">留空则使用默认回调地址: {'{域名}'}/api/coze/oauth/callback</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              API Base URL
            </label>
            <input
              type="text"
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">国内: https://api.coze.cn | 国际: https://api.coze.com</p>
          </div>
        </div>

        {message && (
          <div className={`mt-4 p-3 rounded-md text-sm ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {message.text}
          </div>
        )}

        <div className="mt-6">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" /> {saving ? '保存中...' : '保存配置'}
          </button>
        </div>
      </div>

      {/* Help */}
      <div className="mt-6 bg-blue-50 rounded-lg border border-blue-200 p-4">
        <h3 className="text-sm font-medium text-blue-800 mb-2">如何获取正确的 OAuth 配置</h3>
        <ol className="text-sm text-blue-700 space-y-1.5 list-decimal pl-4">
          <li>访问 <a href="https://www.coze.cn" target="_blank" rel="noopener" className="underline">扣子平台</a>，左侧菜单 → 「扣子API」→「授权」→「OAuth 应用」</li>
          <li>点击「创建新应用」
            <ul className="list-disc pl-4 mt-1 text-xs">
              <li>应用类型：<b>普通</b></li>
              <li>客户端类型：<b>Web 后端应用</b></li>
              <li>填写名称和描述</li>
            </ul>
          </li>
          <li>权限勾选：建议全选（Bot管理、会话管理、对话、工作流等）</li>
          <li>重定向 URL 填写：{'{你的域名}'}/api/coze/oauth/callback</li>
          <li>点击「生成客户端密钥」，获取 Client ID（格式：xxx.app.coze）和 Client Secret</li>
          <li>将正确的 Client ID 和 Client Secret 填入上方表单并保存</li>
        </ol>
        <div className="mt-3 p-2 bg-red-50 rounded border border-red-200">
          <p className="text-xs text-red-700"><b>常见错误：</b></p>
          <ul className="text-xs text-red-600 list-disc pl-4 mt-1">
            <li>Client ID 填成了纯数字的「应用ID」— 正确的格式应带 <code>.app.coze</code> 后缀</li>
            <li>Client Secret 填成了 <code>pat_</code> 开头的个人访问令牌 — 正确的是 OAuth 应用的客户端密钥</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
