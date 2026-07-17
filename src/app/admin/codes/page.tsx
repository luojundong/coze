'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/api-client';
import { Plus, RefreshCw, Copy, CheckCircle, Eye } from 'lucide-react';

interface BatchItem {
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

export default function AdminCodesPage() {
  const router = useRouter();
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [tools, setTools] = useState<ToolItem[]>([]);

  // Create form
  const [formName, setFormName] = useState('管理员创建');
  const [formMaxUses, setFormMaxUses] = useState('1');
  const [formDurationType, setFormDurationType] = useState('permanent');
  const [formCount, setFormCount] = useState('1');
  const [formCustomCode, setFormCustomCode] = useState('');
  const [formToolIds, setFormToolIds] = useState<string[]>([]);  // 多选工具
  const [formSelectAll, setFormSelectAll] = useState(false);  // 全选/全部工具
  const [showToolSelector, setShowToolSelector] = useState(false);
  const [createdCodes, setCreatedCodes] = useState<string[]>([]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [formGrantMembership, setFormGrantMembership] = useState(false);  // 激活时授予会员身份

  const pageSize = 10;

  useEffect(() => {
    const t = getToken();
    if (t) setToken(t);
  }, []);

  const fetchBatches = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        groupBy: 'batch',
      });
      const res = await fetch(`/api/admin/activation-codes?${params}`, {
        headers: { 'x-session': token },
      });
      if (res.ok) {
        const data = await res.json();
        setBatches(data.batches ?? []);
        setTotal(data.total ?? 0);
      }
    } catch (e: any) {
      console.error('fetchBatches error:', e);
    }
    setLoading(false);
  }, [token, page]);

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

  useEffect(() => {
    if (token) {
      fetchBatches();
      fetchTools();
    }
  }, [token, fetchBatches, fetchTools]);

  const handleCreate = async () => {
    if (!token) return;
    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        name: formName,
        max_uses: parseInt(formMaxUses, 10),
        duration_type: formDurationType,
        count: parseInt(formCount, 10),
        grant_membership: formGrantMembership,
      };
      if (formCustomCode.trim()) {
        body.code = formCustomCode.trim();
        body.count = 1;
      }
      // 全选或未选任何工具 = 全部工具
      if (!formSelectAll && formToolIds.length > 0) {
        body.tool_ids = formToolIds;
      }
      // formSelectAll=true 或 formToolIds 为空 → tool_ids=null（全部工具）
      const res = await fetch('/api/admin/activation-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session': token },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setCreatedCodes(data.codes ?? []);
        setShowCreate(false);
        fetchBatches();
      } else {
        const data = await res.json();
        alert(data.error || '创建失败');
      }
    } finally {
      setCreating(false);
    }
  };

  const copyCode = (code: string, idx: number) => {
    navigator.clipboard.writeText(code);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
  };

  const showBatchDetail = (batch: BatchItem) => {
    router.push(`/admin/codes/${encodeURIComponent(batch.batch_id)}`);
  };

  const getToolNames = (batch: BatchItem) => {
    if (!batch.tool_infos || batch.tool_infos.length === 0) return '全部工具';
    const names = batch.tool_infos.map(t => t.name);
    if (names.length <= 3) return names.join('、');
    return `${names.slice(0, 3).join('、')} 等${names.length}个`;
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
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
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">激活码管理</h1>
        <div className="flex gap-2">
          <button
            onClick={fetchBatches}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-600 hover:bg-gray-50"
          >
            <RefreshCw className="w-3.5 h-3.5" /> 刷新
          </button>
          <button
            onClick={() => { setShowCreate(true); setCreatedCodes([]); setFormToolIds([]); setFormSelectAll(false); setFormGrantMembership(false); setFormDurationType('permanent'); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
          >
            <Plus className="w-3.5 h-3.5" /> 创建激活码
          </button>
        </div>
      </div>

      {/* Created codes display */}
      {createdCodes.length > 0 && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-800 mb-2 font-medium">激活码创建成功！共 {createdCodes.length} 个</p>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {createdCodes.map((code, idx) => (
              <div key={code} className="flex items-center gap-2">
                <code className="text-sm bg-white px-2 py-0.5 rounded border border-green-300 font-mono">{code}</code>
                <button
                  onClick={() => copyCode(code, idx)}
                  className="text-green-700 hover:text-green-900"
                >
                  {copiedIdx === idx ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create Dialog */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">创建激活码</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">名称</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">适用工具</label>
                {/* 全部工具开关 */}
                <label className="flex items-center gap-2 mb-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={formSelectAll}
                    onChange={(e) => {
                      setFormSelectAll(e.target.checked);
                      if (e.target.checked) setFormToolIds([]);
                    }}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-900 font-medium">全部工具</span>
                  <span className="text-xs text-gray-400">（激活后可使用所有工具）</span>
                </label>

                {/* 工具多选列表 */}
                {!formSelectAll && (
                  <div className="border border-gray-200 rounded-md overflow-hidden">
                    <div className="max-h-48 overflow-y-auto p-2 space-y-1">
                      {tools.map((t) => (
                        <label key={t.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={formToolIds.includes(t.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFormToolIds([...formToolIds, t.id]);
                              } else {
                                setFormToolIds(formToolIds.filter(id => id !== t.id));
                              }
                            }}
                            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-700">{t.name}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${t.type === 'bot' ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-600'}`}>
                            {t.type === 'bot' ? '智能体' : '工作流'}
                          </span>
                        </label>
                      ))}
                    </div>
                    {/* 快捷操作 */}
                    <div className="flex gap-2 px-3 py-2 border-t border-gray-100 bg-gray-50">
                      <button
                        type="button"
                        onClick={() => setFormToolIds(tools.map(t => t.id))}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        全选
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormToolIds([])}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        取消
                      </button>
                      <span className="text-xs text-gray-400 ml-auto">
                        已选 {formToolIds.length}/{tools.length}
                      </span>
                    </div>
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-1">
                  {formSelectAll ? '激活码可用于所有工具' : formToolIds.length > 0 ? `已选择 ${formToolIds.length} 个工具` : '未选择任何工具（等同于全部工具）'}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">自定义码（留空自动生成）</label>
                <input
                  type="text"
                  value={formCustomCode}
                  onChange={(e) => setFormCustomCode(e.target.value)}
                  placeholder="如: VIP-2024-SPECIAL"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">最大使用次数</label>
                  <input
                    type="number"
                    min="1"
                    value={formMaxUses}
                    onChange={(e) => setFormMaxUses(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">批量数量</label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={formCount}
                    onChange={(e) => setFormCount(e.target.value)}
                    disabled={!!formCustomCode.trim()}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">用户有效期（从激活日开始计算）</label>
                <div className="flex gap-1.5 flex-wrap">
                  {[
                    { value: '1day', label: '1天' },
                    { value: '7days', label: '7天' },
                    { value: 'month', label: '月卡' },
                    { value: 'year', label: '年卡' },
                    { value: 'permanent', label: '永久卡' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setFormDurationType(opt.value)}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        formDurationType === opt.value
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1.5">激活码本身永久有效，此设置控制用户激活后的使用期限</p>
              </div>
            </div>
              {/* 授予会员身份 */}
              <div className="pt-2 border-t border-gray-100">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={formGrantMembership}
                    onChange={(e) => setFormGrantMembership(e.target.checked)}
                    className="w-4 h-4 text-amber-600 border-gray-300 rounded focus:ring-amber-500"
                  />
                  <span className="text-sm font-medium text-gray-700">授予会员身份</span>
                  <span className="text-xs text-gray-400">（用户使用此激活码激活后将自动成为会员）</span>
                </label>
              </div>
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-600 hover:bg-gray-50"
              >取消</button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
              >{creating ? '创建中...' : '确认创建'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Table (分组视图) */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">序号</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">名称</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">适用工具</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">生成/已用</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">创建时间</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">用户有效期</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400">加载中...</td></tr>
              ) : batches.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400">暂无激活码</td></tr>
              ) : (
                batches.map((b, idx) => {
                  const expired = isExpired(b.batch_expires_at);
                  return (
                    <tr key={`${b.name}-${b.batch_created_at}`} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 text-xs text-gray-500">{(page - 1) * pageSize + idx + 1}</td>
                      <td className="px-4 py-3 text-xs font-medium">{b.name || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${b.tool_ids ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'}`}>
                          {getToolNames(b)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">{b.total_count}/{b.total_used ?? 0}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDate(b.batch_created_at)}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {getDurationLabel(b.duration_type)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => showBatchDetail(b)}
                            className="flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs"
                          >
                            <Eye className="w-3.5 h-3.5" /> 详情
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
            <span className="text-xs text-gray-500">共 {total} 批</span>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1 text-xs border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-100">上一页</button>
              <span className="px-3 py-1 text-xs text-gray-600">{page}/{totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="px-3 py-1 text-xs border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-100">下一页</button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
