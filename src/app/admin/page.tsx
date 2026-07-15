'use client';

import { useState, useEffect, useCallback } from 'react';
import { getToken } from '@/lib/api-client';
import { Users, Key, Shield, FileText, Activity, CheckCircle, XCircle } from 'lucide-react';

interface Stats {
  totalUsers: number;
  activeUsers: number;
  totalCodes: number;
  usedCodes: number;
  oauthConnections: number;
  totalLogs: number;
  todayLogs: number;
  encryptionStatus: { has_key: boolean; is_default: boolean; recommendation: string };
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchStats = useCallback(async () => {
    const token = getToken();
    if (!token) return;

    const headers = { 'x-session': token };
    const [usersRes, codesRes, logsRes, encRes] = await Promise.all([
      fetch('/api/admin/users?page=1&pageSize=1', { headers }),
      fetch('/api/admin/activation-codes?page=1&pageSize=1', { headers }),
      fetch('/api/admin/audit-logs?page=1&pageSize=1', { headers }),
      fetch('/api/admin/encryption-key', { headers }),
    ]);

    const users = usersRes.ok ? await usersRes.json() : { total: 0 };
    const codes = codesRes.ok ? await codesRes.json() : { total: 0 };
    const logs = logsRes.ok ? await logsRes.json() : { total: 0 };
    const enc = encRes.ok ? await encRes.json() : { has_key: false, is_default: true, recommendation: '' };

    setStats({
      totalUsers: users.total ?? 0,
      activeUsers: users.users?.filter((u: { is_active: boolean }) => u.is_active).length ?? 0,
      totalCodes: codes.total ?? 0,
      usedCodes: codes.codes?.filter((c: { used_count: number }) => c.used_count > 0).length ?? 0,
      oauthConnections: users.users?.filter((u: { coze_connected: boolean }) => u.coze_connected).length ?? 0,
      totalLogs: logs.total ?? 0,
      todayLogs: 0,
      encryptionStatus: enc,
    });
    setLoading(false);
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  if (loading) {
    return <div className="text-gray-500 py-8">加载中...</div>;
  }

  const cards = [
    { label: '总用户数', value: stats?.totalUsers ?? 0, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: '激活码总数', value: stats?.totalCodes ?? 0, icon: Key, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'OAuth 连接', value: stats?.oauthConnections ?? 0, icon: Shield, color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: '审计日志', value: stats?.totalLogs ?? 0, icon: FileText, color: 'text-amber-600', bg: 'bg-amber-50' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">管理概览</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">{card.label}</span>
              <div className={`w-8 h-8 rounded-md ${card.bg} flex items-center justify-center`}>
                <card.icon className={`w-4 h-4 ${card.color}`} />
              </div>
            </div>
            <div className="text-2xl font-semibold text-gray-900">{card.value}</div>
          </div>
        ))}
      </div>

      {/* Security Status */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-600" />
          安全状态
        </h2>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            {stats?.encryptionStatus.is_default ? (
              <XCircle className="w-5 h-5 text-red-500" />
            ) : (
              <CheckCircle className="w-5 h-5 text-green-500" />
            )}
            <span className="text-sm text-gray-700">加密密钥</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              stats?.encryptionStatus.is_default
                ? 'bg-red-100 text-red-700'
                : 'bg-green-100 text-green-700'
            }`}>
              {stats?.encryptionStatus.is_default ? '使用默认密钥' : '已配置自定义密钥'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <span className="text-sm text-gray-700">限流保护 — 已启用</span>
          </div>
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <span className="text-sm text-gray-700">审计日志 — 已启用</span>
          </div>
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <span className="text-sm text-gray-700">Token 加密存储 (AES-256-GCM) — 已启用</span>
          </div>
        </div>
        {stats?.encryptionStatus.is_default && (
          <div className="mt-4 p-3 bg-red-50 rounded-md border border-red-200 text-sm text-red-700">
            {stats.encryptionStatus.recommendation}
            <a href="/admin/encryption" className="underline ml-1">前往更换密钥</a>
          </div>
        )}
      </div>
    </div>
  );
}
