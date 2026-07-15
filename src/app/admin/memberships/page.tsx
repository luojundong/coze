'use client';

import { useState, useEffect, useCallback } from 'react';
import { getToken } from '@/lib/api-client';
import { Search, RefreshCw, Crown, Ban, CheckCircle, XCircle, ChevronLeft, ChevronRight } from 'lucide-react';

interface MembershipItem {
  id: string;
  user_id: string;
  is_member: number | boolean;
  activated_at: string | null;
  expires_at: string | null;
  phone: string | null;
  email: string | null;
}

export default function AdminMembershipsPage() {
  const [memberships, setMemberships] = useState<MembershipItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [session, setSession] = useState<{ access_token: string } | null>(null);
  const pageSize = 10;

  const init = useCallback(async () => {
    const token = getToken();
    if (token) setSession({ access_token: token } as any);
  }, []);

  const fetchMemberships = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search) params.set('search', search);
      const res = await fetch(`/api/admin/memberships?${params}`, {
        headers: { 'x-session': session.access_token },
      });
      if (res.ok) {
        const data = await res.json();
        setMemberships(data.memberships || []);
        setTotal(data.total || 0);
      }
    } catch {
      // silently fail
    }
    setLoading(false);
  }, [session, search, page]);

  useEffect(() => { init(); }, [init]);
  useEffect(() => { fetchMemberships(); }, [fetchMemberships]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleToggleMembership = async (item: MembershipItem) => {
    if (!session) return;
    const newStatus = !item.is_member;
    const action = newStatus ? '设为会员' : '取消会员';
    if (!confirm(`确定要${action}吗？`)) return;

    try {
      const res = await fetch('/api/admin/memberships', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session': session.access_token,
        },
        body: JSON.stringify({ targetUserId: item.user_id, isMember: newStatus }),
      });
      if (res.ok) {
        fetchMemberships();
      } else {
        const data = await res.json();
        alert(data.error || '操作失败');
      }
    } catch {
      alert('操作失败');
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">会员管理</h1>

      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索用户手机号、邮箱..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <button
          onClick={fetchMemberships}
          className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          刷新
        </button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">账号</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">用户 ID</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">会员状态</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">激活时间</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">过期时间</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">加载中...</td></tr>
              ) : memberships.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">
                  {search ? `未找到匹配"${search}"的用户` : '暂无会员数据'}
                </td></tr>
              ) : (
                memberships.map((m) => {
                  const isMember = Boolean(m.is_member);
                  return (
                  <tr key={m.user_id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm">
                      {m.email && <div>{m.email}</div>}
                      {m.phone && <div className="text-xs text-gray-500">{m.phone}</div>}
                      {!m.email && !m.phone && '-'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs max-w-[200px] break-all">{m.user_id}</td>
                    <td className="px-4 py-3">
                      {isMember ? (
                        <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full text-xs">
                          <Crown className="w-3 h-3" /> 会员
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full text-xs">
                          <XCircle className="w-3 h-3" /> 非会员
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {m.activated_at ? new Date(m.activated_at).toLocaleString('zh-CN') : '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {m.expires_at ? new Date(m.expires_at).toLocaleString('zh-CN') : '永久'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleMembership(m)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                          isMember
                            ? 'text-red-600 bg-red-50 hover:bg-red-100'
                            : 'text-amber-600 bg-amber-50 hover:bg-amber-100'
                        }`}
                      >
                        {isMember ? (
                          <>
                            <Ban className="w-3.5 h-3.5" />
                            取消会员
                          </>
                        ) : (
                          <>
                            <Crown className="w-3.5 h-3.5" />
                            设为会员
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
            <span className="text-xs text-gray-500">共 {total} 条</span>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 text-xs border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-100">上一页</button>
              <span className="px-3 py-1 text-xs text-gray-600">{page}/{totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 text-xs border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-100">下一页</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
