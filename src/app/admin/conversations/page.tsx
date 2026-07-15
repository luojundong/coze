'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/api-client';
import {
  Search, RefreshCw, MessageSquare, Trash2, Eye, X, MessageCircle, Bot,
} from 'lucide-react';

interface ConversationItem {
  id: string;
  user_id: string;
  user_email: string | null;
  tool_id: string;
  tool_name: string | null;
  title: string | null;
  message_count: number;
  is_deleted: number;
  created_at: string;
  updated_at: string;
}

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  content_type: string;
  created_at: string;
}

interface ConversationDetail extends ConversationItem {
  messages: ConversationMessage[];
}

export default function AdminConversationsPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<{ access_token: string } | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConversationItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const pageSize = 10;

  const init = useCallback(async () => {
    const token = getToken();
    if (token) setSession({ access_token: token } as any);
  }, []);

  const fetchConversations = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search) params.set('search', search);
    const res = await fetch(`/api/admin/conversations?${params}`, {
      headers: { 'x-session': session.access_token },
    });
    if (res.ok) {
      const data = await res.json();
      setConversations(data.conversations ?? []);
      setTotal(data.total ?? 0);
    } else if (res.status === 401 || res.status === 403) {
      router.push('/dashboard');
    }
    setLoading(false);
  }, [session, page, search, router]);

  const fetchDetail = useCallback(async (id: string) => {
    if (!session) return;
    const res = await fetch(`/api/admin/conversations/${id}`, {
      headers: { 'x-session': session.access_token },
    });
    if (res.ok) {
      const data = await res.json();
      setDetail(data.conversation as ConversationDetail);
    }
  }, [session]);

  const handleDelete = async () => {
    if (!session || !deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/admin/conversations/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { 'x-session': session.access_token },
      });
      const data = await res.json();
      if (res.ok) {
        setDeleteTarget(null);
        fetchConversations();
      } else {
        alert(data.error || '删除失败');
      }
    } finally {
      setDeleteLoading(false);
    }
  };

  useEffect(() => { init(); }, [init]);
  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  const totalPages = Math.ceil(total / pageSize);

  const formatTime = (t: string | null) => {
    if (!t) return '-';
    return new Date(t).toLocaleString('zh-CN');
  };

  const truncate = (s: string | null, len = 30) => {
    if (!s) return '-';
    return s.length > len ? s.slice(0, len) + '...' : s;
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">对话记录管理</h1>

      {/* Search */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索用户邮箱、工具名、对话标题..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <button
          onClick={fetchConversations}
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
                <th className="text-left px-4 py-3 font-medium text-gray-600">用户</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">工具</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">标题</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">消息数</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">更新时间</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">加载中...</td></tr>
              ) : conversations.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">暂无对话记录</td></tr>
              ) : (
                conversations.map((c) => (
                  <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm">
                      <div>{c.user_email || '-'}</div>
                      <div className="text-xs text-gray-500 font-mono break-all">{c.user_id}</div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div>{c.tool_name || '-'}</div>
                      <div className="text-xs text-gray-500 font-mono break-all">{c.tool_id}</div>
                    </td>
                    <td className="px-4 py-3 text-sm max-w-xs" title={c.title || ''}>
                      {truncate(c.title, 40)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                        <MessageSquare className="w-3.5 h-3.5" />
                        {c.message_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {formatTime(c.updated_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => fetchDetail(c.id)}
                          className="flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          查看
                        </button>
                        <button
                          onClick={() => setDeleteTarget(c)}
                          className="flex items-center gap-1 text-red-600 hover:text-red-800 text-xs"
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

      {/* Detail Modal */}
      {detail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-base font-semibold text-gray-900">对话详情</h3>
                <p className="text-xs text-gray-500 mt-0.5">ID: {detail.id}</p>
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-4 border-b border-gray-200 bg-gray-50 text-sm space-y-1">
              <div className="flex gap-2">
                <span className="text-gray-500">用户:</span>
                <span className="text-gray-900">{detail.user_email || '-'}</span>
                <span className="text-xs text-gray-400 font-mono">({detail.user_id})</span>
              </div>
              <div className="flex gap-2">
                <span className="text-gray-500">工具:</span>
                <span className="text-gray-900">{detail.tool_name || '-'}</span>
                <span className="text-xs text-gray-400 font-mono">({detail.tool_id})</span>
              </div>
              <div className="flex gap-2">
                <span className="text-gray-500">时间:</span>
                <span className="text-gray-900">{formatTime(detail.created_at)} ~ {formatTime(detail.updated_at)}</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {detail.messages.length === 0 ? (
                <p className="text-center text-gray-400 py-8">暂无消息</p>
              ) : (
                detail.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`flex gap-2 max-w-[85%] ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                        m.role === 'user' ? 'bg-blue-600' : 'bg-gray-200'
                      }`}>
                        {m.role === 'user' ? (
                          <MessageCircle className="w-3.5 h-3.5 text-white" />
                        ) : (
                          <Bot className="w-3.5 h-3.5 text-gray-600" />
                        )}
                      </div>
                      <div className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                        m.role === 'user'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 border border-gray-200 text-gray-900'
                      }`}>
                        {m.content}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="text-base font-semibold text-red-600">删除对话</h3>
              <button onClick={() => setDeleteTarget(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-600 mb-2">
                确定要删除这条对话记录吗？删除后用户在前端将无法再查看该历史对话。
              </p>
              <p className="text-sm text-gray-800 mb-3">
                标题: <span className="font-medium">{truncate(deleteTarget.title, 50)}</span>
              </p>
              <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded">
                此操作会将对话标记为已删除，相关消息仍保留在数据库中。
              </p>
            </div>
            <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
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
