'use client';

import { useState, useEffect, useCallback } from 'react';
import { getToken } from '@/lib/api-client';
import { RefreshCw, ShieldCheck, ShieldAlert, RotateCw } from 'lucide-react';

interface EncKeyStatus {
  has_key: boolean;
  is_default: boolean;
  key_preview: string;
  key_length: number;
  recommendation: string;
}

export default function AdminEncryptionPage() {
  const [status, setStatus] = useState<EncKeyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<{ access_token: string } | null>(null);
  const [rotating, setRotating] = useState(false);
  const [showRotate, setShowRotate] = useState(false);
  const [newSecret, setNewSecret] = useState('');
  const [confirmSecret, setConfirmSecret] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const init = useCallback(async () => {
    const token = getToken();
    if (token) setSession({ access_token: token } as any);
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const res = await fetch('/api/admin/encryption-key', {
      headers: { 'x-session': session.access_token },
    });
    if (res.ok) {
      setStatus(await res.json());
    }
    setLoading(false);
  }, [session]);

  useEffect(() => { init(); }, [init]);
  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleRotate = async () => {
    if (!session) return;
    if (newSecret.length < 32) {
      setMessage({ type: 'error', text: '密钥长度不能少于32个字符' });
      return;
    }
    if (newSecret !== confirmSecret) {
      setMessage({ type: 'error', text: '两次输入的密钥不一致' });
      return;
    }
    setRotating(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/encryption-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session': session.access_token },
        body: JSON.stringify({ new_secret: newSecret }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: data.message || '密钥轮换成功' });
        setShowRotate(false);
        setNewSecret('');
        setConfirmSecret('');
        fetchStatus();
      } else {
        setMessage({ type: 'error', text: data.error || data.detail || '密钥轮换失败' });
      }
    } finally {
      setRotating(false);
    }
  };

  const generateRandomKey = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let key = '';
    for (let i = 0; i < 48; i++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewSecret(key);
  };

  if (loading) {
    return <div className="text-gray-500 py-8">加载中...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Token 加密密钥管理</h1>
        <button
          onClick={fetchStatus}
          className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className="w-3.5 h-3.5" /> 刷新
        </button>
      </div>

      {/* Current status */}
      <div className={`rounded-lg border p-5 mb-6 ${
        status?.is_default
          ? 'bg-red-50 border-red-200'
          : 'bg-green-50 border-green-200'
      }`}>
        <div className="flex items-center gap-3 mb-3">
          {status?.is_default ? (
            <ShieldAlert className="w-6 h-6 text-red-600" />
          ) : (
            <ShieldCheck className="w-6 h-6 text-green-600" />
          )}
          <h2 className={`text-lg font-medium ${status?.is_default ? 'text-red-800' : 'text-green-800'}`}>
            {status?.is_default ? '安全风险：使用默认密钥' : '密钥已配置'}
          </h2>
        </div>
        <div className="space-y-2">
          <div className="text-sm">
            <span className="font-medium">密钥预览:</span>{' '}
            <code className="px-1.5 py-0.5 bg-white rounded text-xs">
              {status?.key_preview || '未配置'}
            </code>
          </div>
          <div className="text-sm">
            <span className="font-medium">密钥长度:</span> {status?.key_length} 字符
          </div>
          <div className="text-sm">
            <span className="font-medium">评估:</span> {status?.recommendation}
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
        <h2 className="text-base font-medium text-gray-900 mb-3">加密机制说明</h2>
        <div className="space-y-2 text-sm text-gray-600">
          <p>用户的 Coze access_token 和 refresh_token 使用 <strong>AES-256-GCM</strong> 对称加密存储在数据库中。</p>
          <p>加密密钥通过 <code className="bg-gray-100 px-1 rounded">ENCRYPTION_SECRET</code> 环境变量配置，使用 scrypt 派生为 256 位密钥。</p>
          <p>每个 Token 有独立的 IV（初始化向量）和 Auth Tag，确保相同明文加密后密文不同。</p>
        </div>
      </div>

      {/* Rotate key */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-medium text-gray-900">密钥轮换</h2>
          <button
            onClick={() => setShowRotate(!showRotate)}
            className="flex items-center gap-1.5 px-3 py-2 border border-amber-300 rounded-md text-sm text-amber-700 hover:bg-amber-50"
          >
            <RotateCw className="w-3.5 h-3.5" /> 轮换密钥
          </button>
        </div>

        {showRotate && (
          <div className="space-y-4 border-t border-gray-200 pt-4">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800">
              警告：密钥轮换将使用新密钥重新加密所有已存储的 Token。此操作不可逆，请确保新密钥安全保存。
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">新密钥</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={newSecret}
                  onChange={(e) => setNewSecret(e.target.value)}
                  placeholder="至少 32 个字符"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={generateRandomKey}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-600 hover:bg-gray-50 whitespace-nowrap"
                >
                  随机生成
                </button>
              </div>
              {newSecret && (
                <p className="text-xs text-gray-500 mt-1">当前长度: {newSecret.length} 字符</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">确认新密钥</label>
              <input
                type="password"
                value={confirmSecret}
                onChange={(e) => setConfirmSecret(e.target.value)}
                placeholder="再次输入新密钥"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {message && (
              <div className={`p-3 rounded-md text-sm ${
                message.type === 'success'
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {message.text}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setShowRotate(false); setNewSecret(''); setConfirmSecret(''); setMessage(null); }}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-600 hover:bg-gray-50"
              >取消</button>
              <button
                onClick={handleRotate}
                disabled={rotating || !newSecret || !confirmSecret}
                className="px-4 py-2 bg-amber-600 text-white rounded-md text-sm hover:bg-amber-700 disabled:opacity-50"
              >{rotating ? '轮换中...' : '确认轮换'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
