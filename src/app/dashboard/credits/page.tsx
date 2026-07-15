'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, Coins, Loader2, Calendar, ChevronLeft, ChevronRight,
} from 'lucide-react';

interface Transaction {
  id: string;
  amount: number;
  type: string;
  description: string | null;
  workflow_config_id: string | null;
  workflow_name: string | null;
  created_at: string;
}

interface CreditSummary {
  balance: number;
  totalGranted: number;
  totalConsumed: number;
}

export default function UserCreditsPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [summary, setSummary] = useState<CreditSummary>({ balance: 0, totalGranted: 0, totalConsumed: 0 });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const pageSize = 20;

  useEffect(() => {
    const t = getToken();
    if (t) setToken(t);
  }, []);

  const fetchData = useCallback(async (p: number, sd: string, ed: string) => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(p));
      params.set('pageSize', String(pageSize));
      if (sd) params.set('startDate', sd);
      if (ed) params.set('endDate', ed);

      const res = await fetch(`/api/credits?${params.toString()}`, {
        headers: { 'x-session': token },
      });
      if (res.ok) {
        const data = await res.json();
        setSummary({
          balance: data.balance ?? 0,
          totalGranted: data.totalGranted ?? 0,
          totalConsumed: data.totalConsumed ?? 0,
        });
        setTransactions(data.transactions || []);
        setTotal(data.total || 0);
      }
    } catch (e) {
      console.error('fetchData error:', e);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    if (token) fetchData(1, '', '');
  }, [token, fetchData]);

  const handleFilter = () => {
    setPage(1);
    fetchData(1, startDate, endDate);
  };

  const handleClearFilter = () => {
    setStartDate('');
    setEndDate('');
    setPage(1);
    fetchData(1, '', '');
  };

  const totalPages = Math.ceil(total / pageSize);

  const formatAmount = (amount: number) => {
    return amount > 0 ? `+${amount}` : `${amount}`;
  };

  const formatType = (type: string) => {
    const map: Record<string, string> = {
      'admin_grant': '管理员充值',
      'consumption': '工具消耗',
      'activation': '激活赠送',
      'referral': '推广奖励',
    };
    return map[type] || type;
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* 顶部导航 */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard')}>
            <ArrowLeft className="w-4 h-4 mr-1" /> 返回
          </Button>
          <h1 className="text-xl font-semibold text-gray-900">积分明细</h1>
        </div>

        {/* 积分概览 */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="py-4 text-center">
              <div className="text-2xl font-bold text-yellow-600">{summary.balance}</div>
              <div className="text-xs text-gray-500 mt-1">当前余额</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <div className="text-2xl font-bold text-green-600">+{summary.totalGranted}</div>
              <div className="text-xs text-gray-500 mt-1">累计充值</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <div className="text-2xl font-bold text-red-500">-{summary.totalConsumed}</div>
              <div className="text-xs text-gray-500 mt-1">累计消耗</div>
            </CardContent>
          </Card>
        </div>

        {/* 时间筛选 */}
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-3 flex-wrap">
              <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-40 h-9 text-sm"
                placeholder="开始日期"
              />
              <span className="text-gray-400 text-sm">至</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-40 h-9 text-sm"
                placeholder="结束日期"
              />
              <Button size="sm" onClick={handleFilter}>
                查询
              </Button>
              <Button size="sm" variant="ghost" onClick={handleClearFilter}>
                清除筛选
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 交易明细列表 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Coins className="h-4 w-4 text-yellow-500" />
              积分流水
              {total > 0 && (
                <span className="text-xs text-gray-400 font-normal ml-2">共 {total} 条记录</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : transactions.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">暂无积分记录</div>
            ) : (
              <div className="space-y-1">
                {transactions.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between py-3 px-3 rounded-lg hover:bg-gray-50 transition-colors"
                  >
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
                      <span className="text-xs text-gray-400 w-40 text-right">
                        {formatTime(t.created_at)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-3 border-t bg-gray-50 rounded-b-xl">
              <span className="text-sm text-gray-500">
                第 {page}/{totalPages} 页
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => {
                    const newPage = page - 1;
                    setPage(newPage);
                    fetchData(newPage, startDate, endDate);
                  }}
                >
                  <ChevronLeft className="w-4 h-4" /> 上一页
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => {
                    const newPage = page + 1;
                    setPage(newPage);
                    fetchData(newPage, startDate, endDate);
                  }}
                >
                  下一页 <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
