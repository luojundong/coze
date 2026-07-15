'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getToken, removeToken } from '@/lib/api-client';
import {
  Users, Key, Shield, FileText, Lock, LayoutDashboard, ChevronLeft, Workflow, Coins, Megaphone, Menu, X, Tag, Crown, Settings, MessageSquare,
} from 'lucide-react';

const navItems = [
  { href: '/admin', label: '概览', icon: LayoutDashboard },
  { href: '/admin/tools', label: '工具管理', icon: Workflow },
  { href: '/admin/categories', label: '分类管理', icon: Tag },
  { href: '/admin/conversations', label: '对话记录', icon: MessageSquare },
  { href: '/admin/users', label: '用户管理', icon: Users },
  { href: '/admin/memberships', label: '会员管理', icon: Crown },
  { href: '/admin/codes', label: '激活码管理', icon: Key },
  { href: '/admin/credits', label: '积分管理', icon: Coins },
  { href: '/admin/announcements', label: '公告管理', icon: Megaphone },
  { href: '/admin/mini-config', label: '首页配置', icon: Settings },
  { href: '/admin/oauth', label: 'OAuth 配置', icon: Shield },
  { href: '/admin/encryption', label: '加密密钥', icon: Lock },
  { href: '/admin/logs', label: '审计日志', icon: FileText },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const checkAdmin = useCallback(async () => {
    const token = getToken();
    if (!token) {
      router.push('/login');
      return;
    }
    try {
      const res = await fetch('/api/admin/check', {
        headers: { 'x-session': token },
      });
      if (res.ok) {
        setIsAdmin(true);
      } else {
        router.push('/dashboard');
      }
    } catch {
      router.push('/dashboard');
    }
    setChecking(false);
  }, [router]);

  useEffect(() => { checkAdmin(); }, [checkAdmin]);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">验证管理员权限...</div>
      </div>
    );
  }

  if (!isAdmin) return null;

  const SidebarContent = () => (
    <>
      <div className="h-14 flex items-center px-4 border-b border-gray-200 justify-between">
        <div className="flex items-center">
          <Shield className="w-5 h-5 text-blue-600 mr-2" />
          <span className="font-semibold text-gray-900">管理后台</span>
        </div>
        {/* Close button (mobile only) */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="lg:hidden text-gray-400 hover:text-gray-600"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <nav className="flex-1 py-2">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                active ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </nav>
      {/* 返回工作台在侧边栏底部 */}
      <div className="p-4 border-t border-gray-200 mt-auto">
        <button
          onClick={() => router.push('/dashboard')}
          className="w-full flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          返回工作台
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile top bar */}
      <div className="lg:hidden flex items-center h-14 px-4 bg-white border-b border-gray-200">
        <button
          onClick={() => setSidebarOpen(true)}
          className="text-gray-600 hover:text-gray-900 mr-3"
        >
          <Menu className="w-5 h-5" />
        </button>
        <span className="font-semibold text-gray-900 text-sm">管理后台</span>
      </div>

      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex w-60 bg-white border-r border-gray-200 flex-col shrink-0 min-h-[calc(100vh-0px)]">
          <SidebarContent />
        </aside>

        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setSidebarOpen(false)}
            />
            {/* Sidebar */}
            <aside className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-xl flex flex-col z-50">
              <SidebarContent />
            </aside>
          </div>
        )}

        <main className="flex-1 overflow-auto">
          <div className="mx-auto p-3 sm:p-4 lg:p-6 max-w-6xl">
            {children}
          </div>
        </main>
      </div>

      {/* 固定左下角返回工作台按钮 */}
      <button
        onClick={() => router.push('/dashboard')}
        className="fixed left-4 bottom-4 z-50 flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-md text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 hover:shadow-lg transition-all"
        title="返回工作台"
      >
        <ChevronLeft className="w-4 h-4" />
        <span className="hidden sm:inline">返回工作台</span>
      </button>
    </div>
  );
}
