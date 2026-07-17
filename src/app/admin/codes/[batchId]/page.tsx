'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getToken } from '@/lib/api-client';
import { ArrowLeft, Trash2, Copy, CheckCircle, XCircle } from 'lucide-react';

interface CodeItem {
  id: string;
  code: string;
  name: string | null;
  max_uses: number | null;
  used_count: number;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
  tool_ids: string | null;
  duration_type: string | null;
  tool_infos?: { id: string; name: string }[] | null;
  credit_amount: number;
}

interface BatchInfo {
  batch_id: string;
  name: string;
  tool_ids: string | null;
  batch_created_at: string;
  total_count: number;
  total_used: number;
  batch_expires_at: string | null;
  all_active: number;
  batch_max_uses: number | null;
  duration_type: string | null;
  tool_infos?: { id: string; name: string }[] | null;
}

interface ToolItem {
  id: string;
  name: string;
  type: string;
}

export default function BatchDetailPage() {
  const params = useParams();
  const router = useRouter();
  const batchId = params.batchId as string;

  const [codes, setCodes] = useState<CodeItem[]>([]);
  const [batchInfo, setBatchInfo] = useState<BatchInfo | null>(null);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  useEffect(() => {
    const t = getToken();
    if (t) setToken(t);
  }, []);

  const fetchTools = useCallback(async () => {
    if (!token) return;
    const res = await fetch('/api/admin/workflow-configs', {
      headers: { 'x-session': token },
    });
    if (res.ok) {
      const data = await res.json();
      setTools(data.configs ?? []);
    }
  }, [token]);

  const fetchData = useCallback(async () => {
    if (!token || !batchId) return;
    setLoading(true);
    try {
      // 获取批次列表（用于获取批次信息）
      const batchParams = new URLSearchParams({ page: '1', pageSize: '1', groupBy: 'batch' });
      const batchRes = await fetch(`/api/admin/activation-codes?${batchParams}`, {
        headers: { 'x-session': token },
      });
      if (batchRes.ok) {
        const batchData = await batchRes.json();
        const found = (batchData.batches ?? []).find((b: BatchInfo) => b.batch_id === batchId);
        if (found) setBatchInfo(found);
      }

      // 获取该批次的激活码详情
      const params = new URLSearchParams({ batchId });
      const res = await fetch(`/api/admin/activation-codes?${params}`, {
        headers: { 'x-session': token },
      });
      if (res.ok) {
        const data = await res.json();
        setCodes(data.codes ?? []);
      }
    } catch (e: any) {
      console.error('fetchData error:', e);
    }
    setLoading(false);
  }, [token, batchId]);

  useEffect(() => {
    if (token) {
      fetchData();
      fetchTools();
    }
  }, [token, fetchData, fetchTools]);

  const handleToggleActive = async (codeId: string, currentActive: boolean) => {
    if (!token) return;
    const action = currentActive ? '禁用' : '启用';
    if (!confirm(`确定要${action}此激活码吗？`)) return;
    const res = await fetch('/api/admin/activation-codes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-session': token },
      body: JSON.stringify({ code_id: codeId, is_active: !currentActive }),
    });
    if (res.ok) {
      setCodes(prev =>
        prev.map(c => c.id === codeId ? { ...c, is_active: !currentActive } : c)
      );
    } else {
      const data = await res.json();
      alert(data.error || '操作失败');
    }
  };

  const handleDelete = async (codeId: string) => {
    if (!token) return;
    if (!confirm('确定要删除此激活码吗？')) return;
    const res = await fetch('/api/admin/activation-codes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-session': token },
      body: JSON.stringify({ code_id: codeId }),
    });
    if (res.ok) {
      setCodes(prev => prev.filter(c => c.id !== codeId));
    } else {
      const data = await res.json();
      alert(data.error || '删除失败');
    }
  };

  const copyCode = (code: string, idx: number) => {
    navigator.clipboard.writeText(code);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
  };

  const getToolNamesDisplay = (toolInfos: { id: string; name: string }[] | null | undefined, toolIds: string | null) => {
    if (!toolInfos || toolInfos.length === 0) return '全部工具';
    const names = toolInfos.map(t => t.name);
    if (names.length <= 3) return names.join('、');
    return `${names.slice(0, 3).join('、')} 等${names.length}个`;
  };

  const isExpired = (expiresAt: string | null) => expiresAt && new Date(expiresAt) < new Date();

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '永久';
    try {
      return new Date(dateStr).toLocaleString('zh-CN');
    } catch {
      return dateStr;
    }
  };

  const durationMap: Record<string, string> = {
    '1day': '1天',
    '7days': '7天',
    'month': '月卡',
    'year': '年卡',
    'permanent': '永久卡',
  };

  const getDurationLabel = (durationType: string | null) => {
    if (!durationType) return '-';
    return durationMap[durationType] || durationType;
  };

  if (!token) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-gray-400">请先登录管理后台</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 顶部导航 */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push('/admin/codes')}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          返回列表
        </button>
        <h1 className="text-2xl font-semibold text-gray-900">
          激活码详情
        </h1>
      </div>

      {/* 批次摘要卡片 */}
      {batchInfo && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">批次名称</p>
            <p className="text-sm font-medium text-gray-900">{batchInfo.name}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">适用工具</p>
            <p className="text-sm font-medium text-gray-900">
              {getToolNamesDisplay(batchInfo.tool_infos, batchInfo.tool_ids)}
            </p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">激活码数量</p>
            <p className="text-sm font-medium text-gray-900">{batchInfo.total_count} 个</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">已使用</p>
            <p className="text-sm font-medium text-gray-900">{batchInfo.total_used} 次</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">用户有效期</p>
            <p className="text-sm font-medium text-gray-900">
              {getDurationLabel(batchInfo.duration_type)}
            </p>
          </div>
        </div>
      )}

      {/* 激活码列表 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="text-center py-16 text-gray-400">加载中...</div>
        ) : codes.length === 0 ? (
          <div className="text-center py-16 text-gray-400">暂无数据</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap w-12">序号</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">激活码</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap w-20">名称</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap w-24">适用工具</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap w-16">使用量</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap w-20">积分</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap w-20">状态</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">创建时间</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">用户有效期</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap w-24">操作</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c, idx) => {
                  const expired = isExpired(c.expires_at);
                  const exhausted = c.max_uses !== null && c.used_count >= c.max_uses;
                  return (
                    <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 text-xs text-gray-500">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <code className="text-xs font-mono bg-gray-100 px-2 py-1 rounded whitespace-nowrap">
                            {c.code}
                          </code>
                          <button
                            onClick={() => copyCode(c.code, idx)}
                            className="text-gray-400 hover:text-gray-600 shrink-0"
                            title="复制"
                          >
                            {copiedIdx === idx ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">{c.name || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${c.tool_ids ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'}`}>
                          {getToolNamesDisplay(c.tool_infos, c.tool_ids)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {c.used_count}/{c.max_uses ?? '∞'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700 font-medium whitespace-nowrap">
                        {c.credit_amount ?? 0}
                      </td>
                      <td className="px-4 py-3">
                        {!c.is_active || expired || exhausted ? (
                          <span className="inline-flex items-center gap-1 text-red-700 bg-red-50 px-2 py-0.5 rounded-full text-xs whitespace-nowrap">
                            <XCircle className="w-3 h-3" />
                            {expired ? '已过期' : exhausted ? '已用完' : '已禁用'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-green-700 bg-green-50 px-2 py-0.5 rounded-full text-xs whitespace-nowrap">
                            <CheckCircle className="w-3 h-3" /> 可用
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(c.created_at)}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {getDurationLabel(c.duration_type)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <button
                            onClick={() => handleToggleActive(c.id, c.is_active)}
                            className={`text-xs ${c.is_active ? 'text-orange-600 hover:text-orange-800' : 'text-green-600 hover:text-green-800'}`}
                          >
                            {c.is_active ? '禁用' : '启用'}
                          </button>
                          <button
                            onClick={() => handleDelete(c.id)}
                            className="text-red-600 hover:text-red-800"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex justify-between items-center">
          <span className="text-xs text-gray-500">共 {codes.length} 个激活码</span>
          <button
            onClick={() => router.push('/admin/codes')}
            className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >返回列表</button>
        </div>
      </div>
    </div>
  );
}
