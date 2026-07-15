'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { callAuthenticatedApi, getToken, removeToken } from '@/lib/api-client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Workflow, Bot, Link2, ArrowRight, Loader2, AlertCircle, Zap, Lock, Unlock, Search, X, Filter, Star, Megaphone, Pin,
} from 'lucide-react';

interface ToolItem {
  id: string;
  coze_id: string;
  name: string;
  description: string | null;
  type: string;
  category: string;
  icon_url: string | null;
  credit_cost: number;
  parameters_schema: Record<string, unknown> | null;
  sort_order: number;
  is_activated: boolean;
  is_favorited: boolean;
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
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export default function ToolsPage() {
  const router = useRouter();
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [cozeConnected, setCozeConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showActivationDialog, setShowActivationDialog] = useState(false);
  const [activationCode, setActivationCode] = useState('');
  const [activating, setActivating] = useState(false);
  const [activationError, setActivationError] = useState('');
  const [activationSuccess, setActivationSuccess] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementsExpanded, setAnnouncementsExpanded] = useState(true);
  const [announceDetail, setAnnounceDetail] = useState<Announcement | null>(null);

  const fetchTools = useCallback(async () => {
    try {
      const token = getToken();
      if (!token) {
        router.push('/login');
        return;
      }

      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      if (selectedCategory) params.set('category', selectedCategory);

      const res = await callAuthenticatedApi(`/api/tools?${params.toString()}`);
      if (!res || !res.ok) {
        const data = res ? await res.json() : {};
        setError(data.error || '加载失败');
        return;
      }
      const data = await res.json();
      setTools(data.tools || []);
      setCategories(data.categories || []);

      // Check Coze connection
      const statusRes = await callAuthenticatedApi('/api/user/status');
      if (statusRes && statusRes.ok) {
        const statusData = await statusRes.json();
        setCozeConnected(!!statusData.coze_connected);
      }
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  }, [router, searchQuery, selectedCategory]);

  useEffect(() => { fetchTools(); }, [fetchTools]);

  // 检测从 Coze OAuth 回调回来，自动刷新连接状态
  useEffect(() => {
    // 检查 URL 是否包含 coze OAuth 回调参数（code 或 error）
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const hasOAuthParams = urlParams.has('code') || urlParams.has('error') || urlParams.has('state');
      if (hasOAuthParams) {
        // 清理 URL 参数，避免重复触发
        const newUrl = window.location.pathname;
        window.history.replaceState({}, '', newUrl);
        // 重新检查 Coze 连接状态
        const checkCozeStatus = async () => {
          try {
            const statusRes = await callAuthenticatedApi('/api/user/status');
            if (statusRes && statusRes.ok) {
              const statusData = await statusRes.json();
              setCozeConnected(!!statusData.coze_connected);
            }
          } catch { /* ignore */ }
        };
        checkCozeStatus();
      }
    }
  }, []);

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
    fetchAnnouncements();
  }, []);

  // 搜索防抖
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const handleConnectCoze = async () => {
    try {
      const res = await callAuthenticatedApi('/api/coze/oauth/authorize');
      if (!res) {
        router.push('/login');
        return;
      }
      const data = await res.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        alert(data.error || '获取授权链接失败');
      }
    } catch {
      alert('连接 Coze 失败，请重试');
    }
  };

  const toggleFavorite = async (e: React.MouseEvent, tool: ToolItem) => {
    e.stopPropagation();
    try {
      if (tool.is_favorited) {
        await callAuthenticatedApi(`/api/favorites?tool_id=${tool.id}`, { method: 'DELETE' });
      } else {
        await callAuthenticatedApi('/api/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool_id: tool.id }),
        });
      }
      // 更新本地状态
      setTools(prev => prev.map(t => t.id === tool.id ? { ...t, is_favorited: !t.is_favorited } : t));
    } catch {
      // ignore
    }
  };

  const handleToolClick = (tool: ToolItem) => {
    if (!tool.is_activated) {
      setShowActivationDialog(true);
      setActivationCode('');
      setActivationError('');
      setActivationSuccess(false);
      return;
    }
    router.push(`/tools/${tool.id}`);
  };

  const handleActivate = async () => {
    if (!activationCode.trim()) {
      setActivationError('请输入激活码');
      return;
    }
    setActivating(true);
    setActivationError('');
    try {
      const res = await callAuthenticatedApi('/api/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: activationCode.trim() }),
      });
      if (!res) {
        router.push('/login');
        return;
      }
      const data = await res.json();
      if (res.ok && data.success) {
        setActivationSuccess(true);
        await fetchTools();
        setTimeout(() => {
          setShowActivationDialog(false);
          setActivationSuccess(false);
        }, 1500);
      } else {
        setActivationError(data.error || '激活失败');
      }
    } catch {
      setActivationError('激活失败，请重试');
    } finally {
      setActivating(false);
    }
  };

  const clearFilters = () => {
    setSearchInput('');
    setSearchQuery('');
    setSelectedCategory('');
  };

  const hasFilters = searchQuery || selectedCategory;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-96">
          <CardContent className="py-8 text-center">
            <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-3" />
            <p className="text-gray-700">{error}</p>
            <Button variant="outline" className="mt-4" onClick={() => router.push('/dashboard')}>
              返回工作台
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/dashboard')} className="text-gray-500 hover:text-gray-700 text-sm whitespace-nowrap">
              ← 工作台
            </button>
            <span className="text-gray-300 hidden sm:inline">|</span>
            <h1 className="font-semibold text-gray-900 hidden sm:inline">AI 工具</h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {cozeConnected ? (
              <div className="flex items-center gap-1.5 text-sm text-green-700 bg-green-50 px-2 sm:px-3 py-1.5 rounded-full">
                <Link2 className="w-3.5 h-3.5" />
                <span className="font-medium hidden sm:inline">Coze 已连接</span>
              </div>
            ) : (
              <Button size="sm" onClick={handleConnectCoze} className="bg-amber-600 hover:bg-amber-700 text-white text-xs sm:text-sm">
                <Link2 className="w-3.5 h-3.5 mr-1" /> 连接 Coze
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Coze not connected notice */}
      {!cozeConnected && (
        <div className="max-w-5xl mx-auto px-4 pt-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 sm:px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-amber-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">使用 AI 工具前需先连接您的 Coze 账户，将使用您的 Coze 额度</span>
              <span className="sm:hidden text-xs">请先连接 Coze 账户</span>
            </div>
            <Button size="sm" onClick={handleConnectCoze} className="bg-amber-600 hover:bg-amber-700 text-white shrink-0 text-xs">
              连接
            </Button>
          </div>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-4 py-4 sm:py-8">
        {/* Announcements */}
        {announcements.length > 0 && (
          <div className="mb-4 sm:mb-6">
            <button
              onClick={() => setAnnouncementsExpanded(!announcementsExpanded)}
              className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2 hover:text-gray-900"
            >
              <Megaphone className="w-4 h-4 text-blue-500" />
              平台公告
              {announcementsExpanded ? ' ▲' : ' ▼'}
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

        {/* 常用工具模块 */}
        {tools.filter(t => t.is_favorited).length > 0 && (
          <div className="mb-4 sm:mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
              <h2 className="text-sm font-semibold text-gray-700">常用工具</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
              {tools.filter(t => t.is_favorited).map((tool) => (
                <div
                  key={tool.id}
                  className="bg-white border rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow flex items-center gap-2"
                  onClick={() => handleToolClick(tool)}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    tool.type === 'bot' ? 'bg-purple-100' : 'bg-blue-100'
                  }`}>
                    {tool.type === 'bot'
                      ? <Bot className="w-4 h-4 text-purple-600" />
                      : <Workflow className="w-4 h-4 text-blue-600" />
                    }
                  </div>
                  <span className="text-sm font-medium text-gray-800 truncate">{tool.name}</span>
                  <button
                    onClick={(e) => toggleFavorite(e, tool)}
                    className="ml-auto text-amber-500 hover:text-amber-600 shrink-0"
                    title="取消常用"
                  >
                    <Star className="w-3.5 h-3.5 fill-amber-500" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search & Category Filter */}
        <div className="mb-4 sm:mb-6 space-y-3">
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="搜索工具名称或描述..."
              className="pl-9 pr-9 text-sm"
            />
            {searchInput && (
              <button
                onClick={() => { setSearchInput(''); setSearchQuery(''); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Category tabs */}
          {categories.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
              <button
                onClick={() => setSelectedCategory('')}
                className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  !selectedCategory
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                全部
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(selectedCategory === cat ? '' : cat)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    selectedCategory === cat
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="shrink-0 flex items-center gap-1 px-2 py-1.5 text-sm text-gray-400 hover:text-gray-600"
                >
                  <X className="w-3.5 h-3.5" />
                  清除
                </button>
              )}
            </div>
          )}
        </div>

        {/* Results count */}
        {hasFilters && (
          <p className="text-sm text-gray-500 mb-4">
            {tools.length === 0 ? '未找到匹配的工具' : `找到 ${tools.length} 个工具`}
          </p>
        )}

        {/* Tool Cards */}
        {tools.length === 0 && !hasFilters ? (
          <Card>
            <CardContent className="py-16 text-center">
              <Zap className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">暂无可用工具</p>
              <p className="text-gray-400 text-sm mt-1">管理员尚未配置 AI 工具</p>
            </CardContent>
          </Card>
        ) : tools.length === 0 && hasFilters ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Filter className="w-8 h-8 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">没有符合条件的工具</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={clearFilters}>
                清除筛选
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {tools.map((tool) => (
              <Card
                key={tool.id}
                className={`cursor-pointer hover:shadow-md transition-shadow group relative ${
                  !tool.is_activated ? 'opacity-90' : ''
                }`}
                onClick={() => handleToolClick(tool)}
              >
                {/* 收藏按钮 */}
                <button
                  onClick={(e) => toggleFavorite(e, tool)}
                  className={`absolute top-3 left-3 z-10 p-1 rounded-full transition-colors ${
                    tool.is_favorited
                      ? 'text-amber-500 bg-amber-50 hover:bg-amber-100'
                      : 'text-gray-300 bg-white/80 hover:text-amber-400 hover:bg-amber-50'
                  }`}
                  title={tool.is_favorited ? '取消常用' : '设为常用'}
                >
                  <Star className={`w-4 h-4 ${tool.is_favorited ? 'fill-amber-500' : ''}`} />
                </button>
                {!tool.is_activated && (
                  <div className="absolute top-3 right-3 z-10">
                    <div className="flex items-center gap-1 bg-gray-100 text-gray-500 px-2 py-1 rounded-full text-xs font-medium">
                      <Lock className="w-3 h-3" />
                      <span>未激活</span>
                    </div>
                  </div>
                )}
                {tool.is_activated && (
                  <div className="absolute top-3 right-3 z-10">
                    <div className="flex items-center gap-1 bg-green-50 text-green-600 px-2 py-1 rounded-full text-xs font-medium">
                      <Unlock className="w-3 h-3" />
                      <span>已激活</span>
                    </div>
                  </div>
                )}
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                      tool.type === 'bot' ? 'bg-purple-100' : 'bg-blue-100'
                    }`}>
                      {tool.type === 'bot'
                        ? <Bot className="w-5 h-5 text-purple-600" />
                        : <Workflow className="w-5 h-5 text-blue-600" />
                      }
                    </div>
                    <div className="flex-1 min-w-0 pr-16">
                      <CardTitle className="text-base truncate">{tool.name}</CardTitle>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          {tool.type === 'bot' ? '智能体' : '工作流'}
                        </Badge>
                        {tool.category && (
                          <Badge variant="secondary" className="text-xs">{tool.category}</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <CardDescription className="line-clamp-2 min-h-[2.5rem]">
                    {tool.description || '暂无描述'}
                  </CardDescription>
                  <div className="flex items-center justify-between mt-4">
                    <div className="flex items-center gap-1.5 text-sm text-gray-500">
                      <Link2 className="w-3.5 h-3.5" />
                      <span>使用 Coze 额度</span>
                    </div>
                    {!tool.is_activated ? (
                      <span className="text-xs text-amber-600 font-medium">请输入激活码</span>
                    ) : (
                      <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors" />
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Activation Dialog */}
      {showActivationDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">激活工具</h2>
            <p className="text-sm text-gray-500 mb-4">此工具需要激活码才能使用，请输入您获取的激活码</p>
            {activationSuccess ? (
              <div className="text-center py-4">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Unlock className="w-6 h-6 text-green-600" />
                </div>
                <p className="text-green-700 font-medium">激活成功！</p>
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <input
                    type="text"
                    value={activationCode}
                    onChange={(e) => { setActivationCode(e.target.value); setActivationError(''); }}
                    placeholder="请输入激活码"
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    onKeyDown={(e) => e.key === 'Enter' && handleActivate()}
                    autoFocus
                  />
                  {activationError && (
                    <p className="text-red-500 text-xs mt-1.5">{activationError}</p>
                  )}
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowActivationDialog(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-600 hover:bg-gray-50"
                  >取消</button>
                  <button
                    onClick={handleActivate}
                    disabled={activating || !activationCode.trim()}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
                  >{activating ? '激活中...' : '激活'}</button>
                </div>
              </>
            )}
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
