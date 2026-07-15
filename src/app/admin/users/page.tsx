'use client';

import { useState, useEffect, useCallback } from 'react';
import { getToken } from '@/lib/api-client';
import { Search, UserX, RefreshCw, CheckCircle, XCircle, Link2, Pencil, X, KeyRound, Trash2 } from 'lucide-react';

interface UserItem {
  user_id: string;
  email: string;
  phone: string | null;
  is_active: boolean;
  activated_at: string;
  expires_at: string | null;
  activation_code: string | null;
  activation_code_name: string | null;
  coze_connected: boolean;
  coze_user_id: string | null;
  credit_balance: number;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<{ access_token: string } | null>(null);
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [editExpiresAt, setEditExpiresAt] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetPasswordUser, setResetPasswordUser] = useState<UserItem | null>(null);
  const [resetPwdLoading, setResetPwdLoading] = useState(false);
  const [deleteUserTarget, setDeleteUserTarget] = useState<UserItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const pageSize = 10;

  const init = useCallback(async () => {
    const token = getToken();
    if (token) setSession({ access_token: token } as any);
  }, []);

  const fetchUsers = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search) params.set('search', search);
    const res = await fetch(`/api/admin/users?${params}`, {
      headers: { 'x-session': session.access_token },
    });
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users ?? []);
      setTotal(data.total ?? 0);
    }
    setLoading(false);
  }, [session, page, search]);

  useEffect(() => { init(); }, [init]);
  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleDeactivate = async (userId: string) => {
    if (!session) return;
    if (!confirm('确定要停用此用户吗？将同时删除其 Coze Token。')) return;
    const res = await fetch('/api/admin/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-session': session.access_token },
      body: JSON.stringify({ user_id: userId }),
    });
    if (res.ok) {
      fetchUsers();
    } else {
      const data = await res.json();
      alert(data.error || '操作失败');
    }
  };

  const openEditModal = (user: UserItem) => {
    setEditingUser(user);
    setEditIsActive(user.is_active);
    setEditExpiresAt(user.expires_at ? user.expires_at.slice(0, 16) : '');
  };

  const handleSaveEdit = async () => {
    if (!session || !editingUser) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { user_id: editingUser.user_id };
      if (editIsActive !== editingUser.is_active) body.is_active = editIsActive;
      if (editExpiresAt !== (editingUser.expires_at?.slice(0, 16) || '')) {
        body.expires_at = editExpiresAt ? new Date(editExpiresAt).toISOString() : null;
      }

      if (Object.keys(body).length <= 1) {
        setEditingUser(null);
        return;
      }

      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-session': session.access_token },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setEditingUser(null);
        fetchUsers();
      } else {
        const data = await res.json();
        alert(data.error || '修改失败');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async () => {
    if (!session || !resetPasswordUser) return;
    setResetPwdLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${resetPasswordUser.user_id}/password`, {
        method: 'PUT',
        headers: { 'x-session': session.access_token },
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || '密码已重置为 123456');
        setResetPasswordUser(null);
      } else {
        alert(data.error || '重置密码失败');
      }
    } finally {
      setResetPwdLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!session || !deleteUserTarget) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${deleteUserTarget.user_id}`, {
        method: 'DELETE',
        headers: { 'x-session': session.access_token },
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || '用户已删除');
        setDeleteUserTarget(null);
        fetchUsers();
      } else {
        alert(data.error || '删除失败');
      }
    } finally {
      setDeleteLoading(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">用户管理</h1>

      {/* Search */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索用户账户（手机号/邮箱/ID）..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <button
          onClick={fetchUsers}
          className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          刷新
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">账号</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">用户 ID</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">状态</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">积分</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">激活码</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">激活时间</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">过期时间</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Coze</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-8 text-gray-400">加载中...</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-gray-400">暂无用户</td></tr>
              ) : (
                users.map((u) => (
                  <tr key={u.user_id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm">
                      {u.email && <div>{u.email}</div>}
                      {u.phone && <div className="text-xs text-gray-500">{u.phone}</div>}
                      {!u.email && !u.phone && '-'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs max-w-[200px] break-all">{u.user_id}</td>
                    <td className="px-4 py-3">
                      {u.is_active ? (
                        <span className="inline-flex items-center gap-1 text-green-700 bg-green-50 px-2 py-0.5 rounded-full text-xs">
                          <CheckCircle className="w-3 h-3" /> 已激活
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-700 bg-red-50 px-2 py-0.5 rounded-full text-xs">
                          <XCircle className="w-3 h-3" /> 已停用
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">{u.credit_balance}</td>
                    <td className="px-4 py-3 text-xs">
                      {u.activation_code_name || u.activation_code || '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {u.activated_at ? new Date(u.activated_at).toLocaleString('zh-CN') : '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {u.expires_at ? new Date(u.expires_at).toLocaleString('zh-CN') : '永久'}
                    </td>
                    <td className="px-4 py-3">
                      {u.coze_connected ? (
                        <span className="inline-flex items-center gap-1 text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full text-xs">
                          <Link2 className="w-3 h-3" /> 已连接
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">未连接</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => openEditModal(u)}
                          className="flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          修改
                        </button>
                        {u.is_active && (
                          <button
                            onClick={() => handleDeactivate(u.user_id)}
                            className="flex items-center gap-1 text-red-600 hover:text-red-800 text-xs"
                          >
                            <UserX className="w-3.5 h-3.5" />
                            停用
                          </button>
                        )}
                        <button
                          onClick={() => setResetPasswordUser(u)}
                          className="flex items-center gap-1 text-amber-600 hover:text-amber-800 text-xs"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          重置密码
                        </button>
                        <button
                          onClick={() => setDeleteUserTarget(u)}
                          className="flex items-center gap-1 text-gray-500 hover:text-red-600 text-xs"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
            <span className="text-xs text-gray-500">共 {total} 条</span>
            <div className="flex gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="px-3 py-1 text-xs border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-100"
              >上一页</button>
              <span className="px-3 py-1 text-xs text-gray-600">{page}/{totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                className="px-3 py-1 text-xs border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-100"
              >下一页</button>
            </div>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="text-base font-semibold text-gray-900">修改用户</h3>
              <button onClick={() => setEditingUser(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <span className="text-sm text-gray-500">账号:</span>
                <span className="text-sm text-gray-900 ml-2">
                  {editingUser.email || editingUser.phone || '-'}
                </span>
              </div>
              <div>
                <span className="text-sm text-gray-500">用户 ID:</span>
                <span className="text-sm font-mono text-gray-900 ml-2 break-all">{editingUser.user_id}</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">状态</label>
                <select
                  value={editIsActive ? 'active' : 'inactive'}
                  onChange={(e) => setEditIsActive(e.target.value === 'active')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="active">已激活</option>
                  <option value="inactive">已停用</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">过期时间</label>
                <input
                  type="datetime-local"
                  value={editExpiresAt}
                  onChange={(e) => setEditExpiresAt(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">清空表示永久有效</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200">
              <button
                onClick={() => setEditingUser(null)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Confirm Modal */}
      {resetPasswordUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="text-base font-semibold text-gray-900">重置密码</h3>
              <button onClick={() => setResetPasswordUser(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-600 mb-2">
                确定要重置该用户的密码吗？
              </p>
              <p className="text-sm text-gray-800">
                账号: <span className="font-medium">{resetPasswordUser.email || resetPasswordUser.phone || '-'}</span>
              </p>
              <p className="text-sm text-amber-600 mt-3 bg-amber-50 px-3 py-2 rounded">
                重置后密码将变为: <strong>123456</strong>
              </p>
            </div>
            <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200">
              <button
                onClick={() => setResetPasswordUser(null)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleResetPassword}
                disabled={resetPwdLoading}
                className="px-4 py-2 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50"
              >
                {resetPwdLoading ? '重置中...' : '确认重置'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete User Confirm Modal */}
      {deleteUserTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="text-base font-semibold text-red-600">删除用户</h3>
              <button onClick={() => setDeleteUserTarget(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-600 mb-2">
                确定要永久删除该用户吗？此操作不可撤销！
              </p>
              <p className="text-sm text-gray-800 mb-3">
                账号: <span className="font-medium">{deleteUserTarget.email || deleteUserTarget.phone || '-'}</span>
              </p>
              <div className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded">
                将删除该用户的所有数据，包括：账户信息、激活记录、积分余额、Coze Token、会员状态、分销关系等
              </div>
            </div>
            <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200">
              <button
                onClick={() => setDeleteUserTarget(null)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleDeleteUser}
                disabled={deleteLoading}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                {deleteLoading ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
