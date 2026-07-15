'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { callAuthenticatedApi, getToken, removeToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  LogOut,
  KeyRound,
  Zap,
  History,
  User,
  ExternalLink,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Unplug,
  Play,
  RefreshCw,
  Shield,
  Coins,
  Workflow,
  Megaphone,
  Pin,
  ChevronDown,
  ChevronUp,
  Share2,
  Copy,
  Crown,
  UserPlus,
  Lock,
} from 'lucide-react';

interface ReferrerInfo {
  displayName: string;
  phone?: string;
  email?: string;
}

interface MembershipInfo {
  isMember: boolean;
  activatedAt: string;
}

interface ReferralStatsData {
  referralCount: number;
  totalCommission: number;
  referrals: Array<{
    userId: string;
    phone?: string;
    email?: string;
    status: string;
  }>;
}

interface UserStatus {
  user: { id: string; email: string; phone: string | null; createdAt: string };
  activation: { isActive: boolean; activatedAt: string; expiresAt: string | null } | null;
  cozeConnected: boolean;
  cozeUserId: string | null;
  credits: { balance: number; totalGranted: number; totalConsumed: number };
  referrer?: ReferrerInfo;
  membership?: MembershipInfo;
}

interface WorkflowItem {
  workflow_id: string;
  workflow_name?: string;
  description?: string;
}

interface AuditLogItem {
  id: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  details: Record<string, unknown> | null;
}

interface Announcement {
  id: string;
  title: string;
  content: string;
  is_pinned: number;
  created_at: string;
}

/** 剥离 HTML 标签，只保留纯文本 */
function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, '') // 移除所有 HTML 标签
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export default function DashboardPage() {
  const router = useRouter();
  const [status, setStatus] = useState<UserStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>('');
  const [workflowParams, setWorkflowParams] = useState<string>('');
  const [workflowResult, setWorkflowResult] = useState<string>('');
  const [streamResult, setStreamResult] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [cozeConnecting, setCozeConnecting] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementsExpanded, setAnnouncementsExpanded] = useState(true);
  const [announceDetail, setAnnounceDetail] = useState<Announcement | null>(null);
  const [referralStats, setReferralStats] = useState<ReferralStatsData | null>(null);
  const [referralLinkCopied, setReferralLinkCopied] = useState(false);

  // Password change state
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changePwdLoading, setChangePwdLoading] = useState(false);
  const [changePwdError, setChangePwdError] = useState('');
  const [changePwdSuccess, setChangePwdSuccess] = useState('');

  // Check admin status
  useEffect(() => {
    const checkAdmin = async () => {
      try {
        const token = getToken();
        if (token) {
          const res = await fetch('/api/admin/check', {
            headers: { 'x-session': token },
          });
          setIsAdmin(res.ok);
        }
      } catch {
        setIsAdmin(false);
      }
    };
    checkAdmin();
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await callAuthenticatedApi('/api/user/status');
      if (!res) return;
      const data = await res.json();
      setStatus(data);
    } catch {
      // Not authenticated
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await callAuthenticatedApi('/api/workflow/list');
      if (!res) return;
      const data = await res.json();
      if (data.data) {
        setWorkflows(data.data);
      }
    } catch {
      // Silently fail
    }
  }, []);

  const fetchAuditLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await callAuthenticatedApi('/api/audit-logs');
      if (!res) return;
      const data = await res.json();
      setAuditLogs(data.logs || []);
    } catch {
      // Silently fail
    } finally {
      setLogsLoading(false);
    }
  }, []);

  const fetchReferralStats = useCallback(async () => {
    try {
      const res = await callAuthenticatedApi('/api/referral/stats');
      if (!res) return;
      if (!res.ok) {
        setReferralStats(null);
        return;
      }
      const data = await res.json();
      // 确保 referrals 是数组
      setReferralStats({
        referralCount: data.referralCount ?? 0,
        totalCommission: data.totalCommission ?? 0,
        referrals: Array.isArray(data.referrals) ? data.referrals : [],
      });
    } catch {
      setReferralStats(null);
    }
  }, []);

  const handleGetReferralLink = async () => {
    try {
      const res = await callAuthenticatedApi('/api/referral/link');
      if (!res) return;
      const data = await res.json();
      if (data.referralUrl) {
        await navigator.clipboard.writeText(data.referralUrl);
        setReferralLinkCopied(true);
        setTimeout(() => setReferralLinkCopied(false), 2000);
      }
    } catch {
      // Silently fail
    }
  };

  const handleChangePassword = async () => {
    setChangePwdError('');
    setChangePwdSuccess('');

    if (!oldPassword) { setChangePwdError('请输入当前密码'); return; }
    if (!newPassword) { setChangePwdError('请输入新密码'); return; }
    if (!confirmPassword) { setChangePwdError('请确认新密码'); return; }
    if (newPassword !== confirmPassword) { setChangePwdError('两次输入的新密码不一致'); return; }
    if (newPassword.length < 6) { setChangePwdError('新密码至少需要6位'); return; }

    setChangePwdLoading(true);
    try {
      const res = await callAuthenticatedApi('/api/user/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword, newPassword, confirmPassword }),
      });

      if (!res) { setChangePwdError('网络错误，请重试'); return; }

      const data = await res.json();
      if (res.ok) {
        setChangePwdSuccess(data.message || '密码修改成功');
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
        // 2 秒后跳转到登录页
        setTimeout(() => {
          setShowChangePwd(false);
          setChangePwdSuccess('');
          removeToken();
          router.replace('/login');
        }, 2000);
      } else {
        setChangePwdError(data.error || '修改密码失败');
      }
    } catch {
      setChangePwdError('网络错误，请重试');
    } finally {
      setChangePwdLoading(false);
    }
  };

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    // Verify token validity
    fetch('/api/auth/session', {
      headers: { 'x-session': token },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          fetchStatus();
        } else {
          removeToken();
          router.replace('/login');
        }
      })
      .catch(() => router.replace('/login'));
  }, [router, fetchStatus]);

  useEffect(() => {
    if (status?.activation?.isActive && status?.cozeConnected) {
      fetchWorkflows();
    }
  }, [status, fetchWorkflows]);

  // Fetch announcements
  useEffect(() => {
    const fetchAnnouncements = async () => {
      try {
        const res = await callAuthenticatedApi('/api/announcements');
        if (!res) return;
        const data = await res.json();
        setAnnouncements(data.announcements || []);
      } catch {
        // silently fail
      }
    };
    if (status) fetchAnnouncements();
  }, [status]);

  // Fetch referral stats if member
  useEffect(() => {
    if (status?.membership?.isMember) {
      fetchReferralStats();
    }
  }, [status, fetchReferralStats]);

  const handleLogout = async () => {
    if (!confirm('确定要退出登录吗？')) return;
    removeToken();
    router.replace('/login');
  };

  const handleCozeConnect = async () => {
    setCozeConnecting(true);
    try {
      const res = await callAuthenticatedApi('/api/coze/oauth/authorize');
      if (!res) return;
      const data = await res.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch (err) {
      console.error('Failed to get OAuth URL:', err);
    } finally {
      setCozeConnecting(false);
    }
  };

  const handleCozeDisconnect = async () => {
    if (!confirm('确定要断开 Coze 账户连接吗？断开后将无法使用工作流。')) return;
    try {
      await callAuthenticatedApi('/api/coze/oauth/disconnect', { method: 'DELETE' });
      await fetchStatus();
    } catch {
      // Silently fail
    }
  };

  const handleRunWorkflow = async (streaming: boolean) => {
    if (!selectedWorkflow) return;
    setRunning(true);
    setWorkflowResult('');
    setStreamResult('');

    try {
      let params = {};
      if (workflowParams.trim()) {
        params = JSON.parse(workflowParams);
      }

      if (streaming) {
        const res = await callAuthenticatedApi('/api/workflow/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflow_id: selectedWorkflow, parameters: params }),
        });

        if (!res) return;

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || '流式调用失败');
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error('无法读取流');

        const decoder = new TextDecoder();
        let fullText = '';
        let sseBuffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          sseBuffer += chunk;

          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data:')) {
              const dataStr = line.slice(5).trim();
              if (!dataStr || dataStr === '[DONE]') continue;
              try {
                const data = JSON.parse(dataStr);
                if (data.content !== undefined && data.content !== null) {
                  fullText += data.content;
                }
                if (data.type === 'conversation.message.delta' && data.content) {
                  fullText += data.content;
                }
                if (data.event === 'conversation.message.delta' && data.content) {
                  fullText += data.content;
                }
              } catch {
                if (dataStr && dataStr !== '{}') {
                  fullText += dataStr;
                }
              }
            }
          }
          setStreamResult(fullText);
        }
      } else {
        const res = await callAuthenticatedApi('/api/workflow/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflow_id: selectedWorkflow, parameters: params }),
        });

        if (!res) return;
        const data = await res.json();
        setWorkflowResult(JSON.stringify(data, null, 2));
      }

      // Refresh audit logs
      fetchAuditLogs();
    } catch (err) {
      const message = err instanceof Error ? err.message : '调用失败';
      setWorkflowResult(`错误: ${message}`);
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const isActivated = status?.activation?.isActive ?? false;
  const isCozeConnected = status?.cozeConnected ?? false;
  const isReady = isActivated && isCozeConnected;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-3 sm:px-4">
          <h1 className="text-base sm:text-lg font-semibold text-gray-900 truncate">扣子工作流平台</h1>
          <div className="flex items-center gap-1 sm:gap-3">
            <Button variant="outline" size="sm" onClick={() => router.push('/tools')} className="text-xs sm:text-sm">
              <Workflow className="mr-0.5 sm:mr-1 h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">AI 工具</span>
            </Button>
            <span className="text-xs sm:text-sm text-gray-500 hidden sm:inline">{status?.user?.phone || status?.user?.email}</span>
            {status?.membership?.isMember && (
              <Badge className="bg-amber-500 hover:bg-amber-600 text-white text-xs">
                <Crown className="mr-0.5 h-3 w-3" />
                会员
              </Badge>
            )}
            {isAdmin && (
              <Button variant="ghost" size="sm" onClick={() => router.push('/admin')} className="text-xs sm:text-sm">
                <Shield className="mr-0.5 sm:mr-1 h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">管理</span>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-xs sm:text-sm">
              <LogOut className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setShowChangePwd(true); setChangePwdError(''); setChangePwdSuccess(''); setOldPassword(''); setNewPassword(''); setConfirmPassword(''); }} className="text-xs sm:text-sm text-gray-500">
              <Lock className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-3 sm:px-4 py-4 sm:py-6">
        {/* Announcements */}
        {announcements.length > 0 && (
          <div className="mb-4 sm:mb-6">
            <button
              onClick={() => setAnnouncementsExpanded(!announcementsExpanded)}
              className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2 hover:text-gray-900"
            >
              <Megaphone className="w-4 h-4 text-blue-500" />
              平台公告
              {announcementsExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {announcementsExpanded && (
              <div className="space-y-2">
                {announcements.map((a) => (
                  <Card
                    key={a.id}
                    className={`${!!a.is_pinned ? 'border-amber-200 bg-amber-50/30' : ''} cursor-pointer hover:shadow-md transition-shadow`}
                    onClick={() => setAnnounceDetail(a)}
                  >
                    <CardContent className="py-2.5 sm:py-3 px-3 sm:px-4">
                      <div className="flex items-start gap-2">
                        {!!a.is_pinned && <Pin className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <span className="text-xs sm:text-sm font-medium text-gray-900">{a.title}</span>
                            <span className="text-xs text-gray-400">{new Date(a.created_at).toLocaleDateString('zh-CN')}</span>
                          </div>
                          <p className="text-xs sm:text-sm text-gray-600 line-clamp-2 whitespace-pre-wrap">{stripHtml(a.content)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Status Cards */}
        <div className="mb-4 sm:mb-6 grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-3">
          {/* Activation Status */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <KeyRound className="h-4 w-4" />
                账户激活
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isActivated ? (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  <span className="text-sm text-green-700">已激活</span>
                  {status?.activation?.expiresAt && (
                    <Badge variant="outline" className="text-xs">
                      到期: {new Date(status.activation.expiresAt).toLocaleDateString()}
                    </Badge>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-amber-500" />
                    <span className="text-sm text-amber-700">未激活</span>
                  </div>
                  <Button size="sm" onClick={() => router.push('/activate')} className="bg-blue-600 hover:bg-blue-700">
                    去激活
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Coze Connection */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Zap className="h-4 w-4" />
                Coze 账户
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isCozeConnected ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <span className="text-sm text-green-700">已连接</span>
                    {status?.cozeUserId && (
                      <Badge variant="outline" className="text-xs">{status.cozeUserId}</Badge>
                    )}
                  </div>
                  <Button size="sm" variant="outline" onClick={handleCozeDisconnect}>
                    <Unplug className="mr-1 h-3 w-3" />
                    断开连接
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-amber-500" />
                    <span className="text-sm text-amber-700">未连接</span>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleCozeConnect}
                    disabled={!isActivated || cozeConnecting}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {cozeConnecting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ExternalLink className="mr-1 h-3 w-3" />}
                    连接 Coze 账户
                  </Button>
                  {!isActivated && (
                    <p className="text-xs text-gray-400">请先激活账户</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Credits */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Coins className="h-4 w-4 text-yellow-500" />
                积分余额
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-gray-900">{status?.credits?.balance ?? 0}</span>
                <span className="text-sm text-gray-500">积分</span>
              </div>
              <div className="mt-2 flex gap-3 text-xs text-gray-400">
                <span>累计充值: {status?.credits?.totalGranted ?? 0}</span>
                <span>累计消耗: {status?.credits?.totalConsumed ?? 0}</span>
              </div>
              <div className="mt-3">
                <Button
                  variant="link"
                  size="sm"
                  className="text-xs text-blue-600 p-0 h-auto"
                  onClick={() => router.push('/dashboard/credits')}
                >
                  查看明细 →
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Referrer Info */}
        {status?.referrer && (
          <div className="mb-4 sm:mb-6">
            <Card className="border-blue-100 bg-blue-50/50">
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-2">
                  <UserPlus className="h-4 w-4 text-blue-500" />
                  <span className="text-sm text-gray-500">推荐人：</span>
                  <span className="text-sm font-medium text-gray-900">{status.referrer.displayName}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Referral Module (Members Only) */}
        {status?.membership?.isMember && (
          <div className="mb-4 sm:mb-6">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <Share2 className="h-4 w-4 text-blue-600" />
                    分享推广
                  </CardTitle>
                  {referralStats && (
                    <Badge variant="secondary" className="text-xs">
                      已推广 {referralStats.referralCount} 人
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={handleGetReferralLink}
                  variant={referralLinkCopied ? 'default' : 'outline'}
                  className={referralLinkCopied ? 'bg-green-600 hover:bg-green-700' : ''}
                  size="sm"
                >
                  {referralLinkCopied ? (
                    <>
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                      已复制
                    </>
                  ) : (
                    <>
                      <Copy className="mr-1 h-3.5 w-3.5" />
                      复制分享链接
                    </>
                  )}
                </Button>
                {/* Downline List */}
                {referralStats && referralStats.referrals && referralStats.referrals.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-medium text-gray-500">我的下线</p>
                    {referralStats.referrals.map((ref) => (
                      <div key={ref.userId} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                        <span className="text-gray-700">{ref.phone || ref.email || ref.userId}</span>
                        <Badge variant={ref.status === 'active' ? 'default' : 'secondary'} className="text-xs">
                          {ref.status === 'active' ? '已激活' : '待激活'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Main Content */}
        {isReady ? (
          <div className="space-y-4">
            {/* Quick Access to AI Tools */}
            <Card className="border-blue-200 bg-blue-50/30">
              <CardContent className="py-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Workflow className="w-6 h-6 text-blue-600" />
                    <div>
                      <h3 className="font-medium text-gray-900">AI 工具</h3>
                      <p className="text-sm text-gray-500">浏览并使用所有可用的 AI 工具，使用您的 Coze 额度</p>
                    </div>
                  </div>
                  <Button onClick={() => router.push('/tools')} className="bg-blue-600 hover:bg-blue-700">
                    进入工具列表
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Tabs defaultValue="logs" className="space-y-4">
            <TabsList>
              <TabsTrigger value="logs">调用记录</TabsTrigger>
            </TabsList>

            <TabsContent value="logs">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">调用记录</CardTitle>
                    <Button size="sm" variant="outline" onClick={fetchAuditLogs}>
                      <RefreshCw className="mr-1 h-3 w-3" />
                      刷新
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {logsLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                    </div>
                  ) : auditLogs.length > 0 ? (
                    <div className="space-y-2">
                      {auditLogs.map((log) => (
                        <div key={log.id} className="flex items-start justify-between rounded-md border p-3 text-sm">
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge variant={log.status === 'success' ? 'default' : 'destructive'} className="text-xs">
                                {log.status}
                              </Badge>
                              <span className="font-medium">{log.action}</span>
                              {log.resource_type && (
                                <Badge variant="outline" className="text-xs">{log.resource_type}</Badge>
                              )}
                            </div>
                            {log.error_message && (
                              <p className="mt-1 text-xs text-red-500">{log.error_message}</p>
                            )}
                          </div>
                          <span className="text-xs text-gray-400">
                            {new Date(log.created_at).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex justify-center py-8 text-sm text-gray-400">
                      暂无调用记录
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <AlertCircle className="mx-auto mb-4 h-12 w-12 text-amber-400" />
              <h3 className="text-lg font-medium text-gray-900">请完成以下步骤</h3>
              <div className="mx-auto mt-4 max-w-sm space-y-3 text-left">
                <div className="flex items-center gap-3">
                  <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${isActivated ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                    {isActivated ? '✓' : '1'}
                  </div>
                  <span className={isActivated ? 'text-green-700' : 'text-gray-700'}>
                    激活账户 — 输入激活码
                  </span>
                  {!isActivated && (
                    <Button size="sm" variant="link" onClick={() => router.push('/activate')}>
                      去激活
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${isCozeConnected ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                    {isCozeConnected ? '✓' : '2'}
                  </div>
                  <span className={isCozeConnected ? 'text-green-700' : 'text-gray-700'}>
                    连接 Coze 账户 — 使用您的 Coze 积分
                  </span>
                  {!isCozeConnected && isActivated && (
                    <Button size="sm" variant="link" onClick={handleCozeConnect}>
                      去连接
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Change Password Modal */}
      {showChangePwd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (!changePwdLoading) { setShowChangePwd(false); setChangePwdError(''); setChangePwdSuccess(''); } }}>
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Lock className="w-5 h-5 text-gray-500" />
                修改密码
              </h2>
              <button
                onClick={() => { setShowChangePwd(false); setChangePwdError(''); setChangePwdSuccess(''); }}
                disabled={changePwdLoading}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-4">
              {changePwdError && (
                <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {changePwdError}
                </div>
              )}
              {changePwdSuccess && (
                <div className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  {changePwdSuccess}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">当前密码</label>
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder="请输入当前密码"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={changePwdLoading}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">新密码</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="新密码（至少6位）"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={changePwdLoading}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">确认新密码</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="再次输入新密码"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={changePwdLoading}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-5 py-4 border-t">
              <button
                onClick={() => { setShowChangePwd(false); setChangePwdError(''); setChangePwdSuccess(''); }}
                disabled={changePwdLoading}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleChangePassword}
                disabled={changePwdLoading}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {changePwdLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                确认修改
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Announcement Detail Modal */}
      {announceDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setAnnounceDetail(null)}>
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div className="flex items-center gap-2 min-w-0">
                {!!announceDetail.is_pinned && <Pin className="w-4 h-4 text-amber-500 shrink-0" />}
                <h2 className="text-lg font-semibold text-gray-900 truncate">{announceDetail.title}</h2>
              </div>
              <button
                onClick={() => setAnnounceDetail(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600 shrink-0 ml-3"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-5 flex-1">
              <p className="text-xs text-gray-400 mb-4">
                {new Date(announceDetail.created_at).toLocaleString('zh-CN')}
              </p>
              <div
                className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap [&_a]:text-blue-600 [&_a]:underline [&_a]:hover:text-blue-800"
                dangerouslySetInnerHTML={{
                  __html: announceDetail.content
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&amp;/g, '&')
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
                    .replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ')
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
