'use client';

import { useState, useEffect, useCallback } from 'react';
import { getToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Coins, Plus, Loader2, X, Search, Mail, User, List, ChevronLeft, ChevronRight, Calendar, Send,
} from 'lucide-react';

interface UserCredit {
  user_id: string;
  balance: number;
  total_granted: number;
  total_consumed: number;
  updated_at: string;
  email: string | null;
}

interface Transaction {
  id: string;
  amount: number;
  type: string;
  description: string | null;
  workflow_config_id: string | null;
  workflow_name: string | null;
  created_at: string;
}

export default function AdminCreditsPage() {
  const [credits, setCredits] = useState<UserCredit[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showGrant, setShowGrant] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [token, setToken] = useState<string | null>(null);

  // Grant form
  const [grantUserId, setGrantUserId] = useState('');
  const [grantAmount, setGrantAmount] = useState('');
  const [grantDesc, setGrantDesc] = useState('');

  // Batch grant
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [isSelectAllUsers, setIsSelectAllUsers] = useState(false);  // 是否全选所有用户（非当前页）
  const [allUserIds, setAllUserIds] = useState<string[]>([]);        // 全选所有用户时的ID列表
  const [selectAllLoading, setSelectAllLoading] = useState(false);
  const [showBatchGrant, setShowBatchGrant] = useState(false);
  const [batchAmount, setBatchAmount] = useState('');
  const [batchDesc, setBatchDesc] = useState('');
  const [batchSaving, setBatchSaving] = useState(false);

  // 积分明细弹窗
  const [showTransactions, setShowTransactions] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transLoading, setTransLoading] = useState(false);
  const [transUserId, setTransUserId] = useState('');
  const [transUserEmail, setTransUserEmail] = useState('');
  const [transPage, setTransPage] = useState(1);
  const [transTotal, setTransTotal] = useState(0);
  const [transStartDate, setTransStartDate] = useState('');
  const [transEndDate, setTransEndDate] = useState('');
  const pageSize = 10;

  useEffect(() => {
    const t = getToken();
    if (t) setToken(t);
  }, []);

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (searchQuery) params.set('search', searchQuery);
      const res = await fetch(`/api/admin/credits?${params}`, { headers: { 'x-session': token } });
      if (res.ok) {
        const data = await res.json();
        setCredits(Array.isArray(data.credits) ? data.credits : []);
        setTotal(data.total || 0);
      }
    } catch (e: any) {
      console.error('fetchData error:', e);
    }
    setLoading(false);
  }, [token, page, searchQuery]);

  useEffect(() => {
    if (token) fetchData();
  }, [token, fetchData]);

  const handleGrant = async () => {
    if (!grantUserId || !grantAmount || parseInt(grantAmount) <= 0) return;
    setSaving(true);
    if (!token) { alert('请先登录'); setSaving(false); return; }
    try {
      const res = await fetch('/api/admin/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session': token },
        body: JSON.stringify({
          user_id: grantUserId,
          amount: parseInt(grantAmount),
          description: grantDesc.trim() || '管理员充值',
        }),
      });
      if (res.ok) {
        setShowGrant(false);
        setGrantUserId('');
        setGrantAmount('');
        setGrantDesc('');
        fetchData();
      } else {
        const data = await res.json();
        alert(data.error || '充值失败');
      }
    } finally {
      setSaving(false);
    }
  };

  // 打开用户积分明细弹窗
  const openTransactions = (userId: string, email: string | null) => {
    setTransUserId(userId);
    setTransUserEmail(email || userId);
    setTransPage(1);
    setTransStartDate('');
    setTransEndDate('');
    setShowTransactions(true);
    fetchTransactions(userId, 1, '', '');
  };

  // 查询积分明细
  const fetchTransactions = async (userId: string, page: number, startDate: string, endDate: string) => {
    if (!token) return;
    setTransLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('userId', userId);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const res = await fetch(`/api/admin/credits?${params.toString()}`, {
        headers: { 'x-session': token },
      });
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions || []);
        setTransTotal(data.total || 0);
        setTransPage(page);
      }
    } catch (e) {
      console.error('fetchTransactions error:', e);
    }
    setTransLoading(false);
  };

  // 时间筛选查询
  const handleTransFilter = () => {
    fetchTransactions(transUserId, 1, transStartDate, transEndDate);
  };

  // 分页
  const transTotalPages = Math.ceil(transTotal / pageSize);

  // 格式化金额
  const formatAmount = (amount: number) => {
    return amount > 0 ? `+${amount}` : `${amount}`;
  };

  // 选择/取消选择
  const toggleSelect = (userId: string) => {
    setSelectedUserIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedUserIds.size === credits.length) {
      setSelectedUserIds(new Set());
    } else {
      setSelectedUserIds(new Set(credits.map(c => c.user_id)));
    }
    // 清除全选所有状态
    setIsSelectAllUsers(false);
    setAllUserIds([]);
  };

  // 全选所有用户（所有页面）
  const handleSelectAllUsers = async () => {
    if (isSelectAllUsers) {
      // 取消全选
      setIsSelectAllUsers(false);
      setAllUserIds([]);
      setSelectedUserIds(new Set());
      return;
    }
    if (!token) return;
    setSelectAllLoading(true);
    try {
      const searchParams = new URLSearchParams();
      if (searchQuery) searchParams.set('search', searchQuery);
      const res = await fetch(`/api/admin/credits?all_ids=true&${searchParams.toString()}`, {
        headers: { 'x-session': token },
      });
      if (res.ok) {
        const data = await res.json();
        const ids: string[] = data.user_ids || [];
        setAllUserIds(ids);
        setIsSelectAllUsers(true);
        // 同步选中当前页所有用户
        setSelectedUserIds(new Set(credits.map(c => c.user_id)));
      }
    } catch (e) {
      console.error('handleSelectAllUsers error:', e);
    }
    setSelectAllLoading(false);
  };

  // 批量充值
  const handleBatchGrant = async () => {
    const userIds = isSelectAllUsers ? allUserIds : Array.from(selectedUserIds);
    if (userIds.length === 0 || !batchAmount || parseInt(batchAmount) <= 0) return;
    const userCount = isSelectAllUsers ? allUserIds.length : selectedUserIds.size;
    if (!confirm(`确定要给已选的 ${userCount} 个用户各充值 ${batchAmount} 积分吗？`)) return;
    setBatchSaving(true);
    if (!token) { alert('请先登录'); setBatchSaving(false); return; }
    try {
      const res = await fetch('/api/admin/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session': token },
        body: JSON.stringify({
          user_ids: userIds,
          amount: parseInt(batchAmount),
          description: batchDesc.trim() || '管理员批量充值',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        alert(data.message || '批量充值完成');
        setShowBatchGrant(false);
        setBatchAmount('');
        setBatchDesc('');
        setSelectedUserIds(new Set());
        setIsSelectAllUsers(false);
        setAllUserIds([]);
        fetchData();
      } else {
        const data = await res.json();
        alert(data.error || '批量充值失败');
      }
    } finally {
      setBatchSaving(false);
    }
  };

  // 格式化类型
  const formatType = (type: string) => {
    const map: Record<string, string> = {
      'admin_grant': '管理员充值',
      'consumption': '工具消耗',
      'activation': '激活赠送',
      'referral': '推广奖励',
    };
    return map[type] || type;
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">积分管理</h1>
          <p className="text-sm text-gray-500 mt-1">管理用户积分余额，支持批量充值</p>
        </div>
        <div className="flex gap-2">
          {(selectedUserIds.size > 0 || isSelectAllUsers) && (
            <Button onClick={() => setShowBatchGrant(true)} className="bg-green-600 hover:bg-green-700">
              <Send className="w-4 h-4 mr-1" /> 批量充值 ({isSelectAllUsers ? allUserIds.length : selectedUserIds.size})
            </Button>
          )}
          <Button onClick={() => setShowGrant(true)} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-4 h-4 mr-1" /> 充值积分
          </Button>
        </div>
      </div>

      {/* Grant Dialog */}
      {showGrant && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">充值积分</CardTitle>
              <button onClick={() => setShowGrant(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm">用户 ID</Label>
              <Input value={grantUserId} onChange={(e) => setGrantUserId(e.target.value)} placeholder="输入用户 UUID" />
              <p className="text-xs text-gray-400">可在「用户管理」页面查看用户 ID</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">充值数量</Label>
              <Input type="number" min="1" value={grantAmount} onChange={(e) => setGrantAmount(e.target.value)} placeholder="正整数" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">备注（可选）</Label>
              <Input value={grantDesc} onChange={(e) => setGrantDesc(e.target.value)} placeholder="充值原因" />
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleGrant} disabled={saving || !grantUserId || !grantAmount} className="bg-blue-600 hover:bg-blue-700">
                {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Coins className="w-4 h-4 mr-1" />}
                确认充值
              </Button>
              <Button variant="outline" onClick={() => setShowGrant(false)}>取消</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setPage(1); setIsSelectAllUsers(false); setAllUserIds([]); }}
          placeholder="搜索用户账户（邮箱/ID）..."
          className="pl-9"
        />
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold text-gray-900">{total}</div>
            <div className="text-xs text-gray-500 mt-1">有积分用户</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold text-green-600">
              {credits.reduce((s, c) => s + c.total_granted, 0)}
            </div>
            <div className="text-xs text-gray-500 mt-1">累计发放</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold text-blue-600">
              {credits.reduce((s, c) => s + c.total_consumed, 0)}
            </div>
            <div className="text-xs text-gray-500 mt-1">累计消耗</div>
          </CardContent>
        </Card>
      </div>

      {/* Credits List */}
      {credits.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-500">暂无积分记录</CardContent>
        </Card>
      ) : (
        <>
          {/* Select All bar */}
          <div className="flex items-center gap-3 px-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={selectedUserIds.size === credits.length && credits.length > 0}
                onChange={toggleSelectAll}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-xs text-gray-600">全选当前页</span>
            </label>
            <span className="text-xs text-gray-400">
              已选 {selectedUserIds.size}/{credits.length}
            </span>
            <button
              onClick={handleSelectAllUsers}
              disabled={selectAllLoading}
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                isSelectAllUsers
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-blue-300 text-blue-600 hover:bg-blue-50'
              }`}
            >
              {selectAllLoading ? (
                <Loader2 className="w-3 h-3 animate-spin inline" />
              ) : isSelectAllUsers ? (
                `已全选所有用户 (${allUserIds.length})`
              ) : (
                `全选所有用户 (${total})`
              )}
            </button>
          </div>

          <div className="space-y-2">
            {credits.map((credit) => (
              <Card key={credit.user_id} className={selectedUserIds.has(credit.user_id) ? 'ring-2 ring-blue-400' : ''}>
                <CardContent className="py-3">
                  <div className="flex items-center gap-4">
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={selectedUserIds.has(credit.user_id)}
                      onChange={() => toggleSelect(credit.user_id)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 shrink-0"
                    />
                    <Coins className="w-5 h-5 text-yellow-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      {credit.email ? (
                        <div className="flex items-center gap-1.5 text-sm text-gray-700 font-medium mb-0.5">
                          <Mail className="w-3.5 h-3.5 text-gray-400" />
                          <span className="truncate">{credit.email}</span>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-400 mb-0.5 flex items-center gap-1">
                          <User className="w-3.5 h-3.5" />
                          <span className="font-mono text-xs truncate max-w-[180px]" title={credit.user_id}>{credit.user_id}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <User className="w-3 h-3" />
                        <span className="font-mono break-all">{credit.user_id}</span>
                      </div>
                    </div>
                    <div className="text-center px-4">
                      <div className="text-lg font-bold text-gray-900">{credit.balance}</div>
                      <div className="text-xs text-gray-500">当前余额</div>
                    </div>
                    <div className="text-center px-3">
                      <div className="text-sm text-green-600">+{credit.total_granted}</div>
                      <div className="text-xs text-gray-500">累计充值</div>
                    </div>
                    <div className="text-center px-3">
                      <div className="text-sm text-blue-600">-{credit.total_consumed}</div>
                      <div className="text-xs text-gray-500">累计消耗</div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openTransactions(credit.user_id, credit.email)}
                      >
                        <List className="w-3.5 h-3.5 mr-1" />明细
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setGrantUserId(credit.user_id);
                          setShowGrant(true);
                        }}
                      >
                        充值
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-gray-500">共 {total} 条，第 {page}/{totalPages} 页</span>
              <div className="flex gap-1">
                <Button
                  size="sm" variant="outline"
                  disabled={page <= 1}
                  onClick={() => { setPage(p => p - 1); setSelectedUserIds(new Set()); setIsSelectAllUsers(false); setAllUserIds([]); }}
                >
                  <ChevronLeft className="w-4 h-4" /> 上一页
                </Button>
                <Button
                  size="sm" variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => { setPage(p => p + 1); setSelectedUserIds(new Set()); setIsSelectAllUsers(false); setAllUserIds([]); }}
                >
                  下一页 <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* 批量充值弹窗 */}
      {showBatchGrant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowBatchGrant(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="text-base font-semibold text-gray-900">批量充值积分</h3>
              <button onClick={() => setShowBatchGrant(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="bg-blue-50 p-3 rounded-md text-sm text-blue-700">
                已选择 <strong>{isSelectAllUsers ? allUserIds.length : selectedUserIds.size}</strong> 个用户
                {isSelectAllUsers && <span className="text-xs text-blue-500 ml-1">（全选所有用户）</span>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">充值数量</Label>
                <Input type="number" min="1" value={batchAmount} onChange={(e) => setBatchAmount(e.target.value)} placeholder="正整数" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">备注（可选）</Label>
                <Input value={batchDesc} onChange={(e) => setBatchDesc(e.target.value)} placeholder="批量充值原因" />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200">
              <button onClick={() => setShowBatchGrant(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">取消</button>
              <button
                onClick={handleBatchGrant}
                disabled={batchSaving || !batchAmount || parseInt(batchAmount) <= 0}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                {batchSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin inline" /> : <Send className="w-4 h-4 mr-1 inline" />}
                确认批量充值
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 积分明细弹窗 */}
      {showTransactions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowTransactions(false)}>
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">积分明细</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  用户：{transUserEmail}
                </p>
              </div>
              <button onClick={() => setShowTransactions(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 时间筛选 */}
            <div className="flex items-center gap-3 px-6 py-3 bg-gray-50 border-b">
              <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
              <Input
                type="date"
                value={transStartDate}
                onChange={(e) => setTransStartDate(e.target.value)}
                className="w-40 h-8 text-sm"
                placeholder="开始日期"
              />
              <span className="text-gray-400 text-sm">至</span>
              <Input
                type="date"
                value={transEndDate}
                onChange={(e) => setTransEndDate(e.target.value)}
                className="w-40 h-8 text-sm"
                placeholder="结束日期"
              />
              <Button size="sm" variant="outline" onClick={handleTransFilter}>
                查询
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTransStartDate('');
                  setTransEndDate('');
                  fetchTransactions(transUserId, 1, '', '');
                }}
              >
                清除
              </Button>
            </div>

            {/* 明细列表 */}
            <div className="flex-1 overflow-y-auto px-6 py-3">
              {transLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : transactions.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">暂无积分记录</div>
              ) : (
                <div className="space-y-2">
                  {transactions.map((t) => (
                    <div key={t.id} className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant={t.amount > 0 ? 'default' : 'secondary'} className="text-xs">
                            {formatType(t.type)}
                          </Badge>
                          {t.workflow_name && (
                            <span className="text-xs text-gray-400 truncate">{t.workflow_name}</span>
                          )}
                        </div>
                        {t.description && (
                          <p className="text-xs text-gray-500 mt-1 truncate">{t.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-4 shrink-0 ml-4">
                        <span className={`text-sm font-semibold ${t.amount > 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {formatAmount(t.amount)}
                        </span>
                        <span className="text-xs text-gray-400 w-36 text-right">
                          {new Date(t.created_at).toLocaleString('zh-CN', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 分页 */}
            {transTotalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-3 border-t bg-gray-50">
                <span className="text-sm text-gray-500">
                  共 {transTotal} 条记录，第 {transPage}/{transTotalPages} 页
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={transPage <= 1}
                    onClick={() => fetchTransactions(transUserId, transPage - 1, transStartDate, transEndDate)}
                  >
                    <ChevronLeft className="w-4 h-4" /> 上一页
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={transPage >= transTotalPages}
                    onClick={() => fetchTransactions(transUserId, transPage + 1, transStartDate, transEndDate)}
                  >
                    下一页 <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
