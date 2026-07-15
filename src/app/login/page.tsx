'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, setToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Image from 'next/image';
import { Eye, EyeOff, Loader2, Mail, Smartphone } from 'lucide-react';

const APP_ICON = 'https://coze-coding-project.tos.coze.site/gen_project_icon/2026-06-05/7647748950014869514_1780631428.png?sign=4902695670-5b34760099-0-cc71e7a9352b6916399b6f27b9568fec69eaf78f001a45c8aedc77d2651e830a';
const APP_NAME = '扣子工作流网站';

export default function LoginPage() {
  const router = useRouter();
  const [isLogin, setIsLogin] = useState(true);
  const [loginMethod, setLoginMethod] = useState<'email' | 'phone'>('phone');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [referralBound, setReferralBound] = useState(false);

  // 从 URL 读取分销推荐码
  const referralCode = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('ref')
    : null;

  useEffect(() => {
    // Check if already logged in
    const token = getToken();
    if (token) {
      fetch('/api/auth/session', {
        headers: { 'x-session': token },
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.user) {
            router.replace('/dashboard');
          } else {
            setChecking(false);
          }
        })
        .catch(() => setChecking(false));
    } else {
      setChecking(false);
    }
  }, [router]);

  const validateAccount = (val: string): string | null => {
    if (!val) return '请输入账号';
    if (loginMethod === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) return '请输入正确的邮箱地址';
    } else {
      if (!/^1[3-9]\d{9}$/.test(val)) return '请输入正确的手机号码';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // 验证账号格式
    const accountError = validateAccount(account);
    if (accountError) {
      setError(accountError);
      return;
    }

    if (!isLogin && password !== confirmPassword) {
      setError('两次密码输入不一致');
      return;
    }

    if (password.length < 6) {
      setError('密码至少6位');
      return;
    }

    setLoading(true);

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: account, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || '操作失败');
      }

      setToken(data.token);

      // 带分销邀请码时（分享海报降级二维码链接 /login?ref=xxx），绑定分销关系
      if (referralCode && data.user?.id) {
        fetch('/api/referral/link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-session': data.token },
          body: JSON.stringify({ referralCode, newUserId: data.user.id }),
        })
          .then((res) => res.json())
          .then((result) => {
            if (result.success) {
              console.log('[login:web] 分销关系绑定成功');
              setReferralBound(true);
            } else {
              console.warn('[login:web] 分销关系绑定失败:', result.error);
            }
          })
          .catch((err) => {
            console.warn('[login:web] 分销关系绑定异常:', err);
          });
      }

      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            <Image
              src={APP_ICON}
              alt={APP_NAME}
              width={64}
              height={64}
              className="rounded-xl"
            />
          </div>
          <CardTitle className="text-xl">{APP_NAME}</CardTitle>
          <CardDescription>
            {isLogin ? '登录您的账户' : '注册新账户'}
          </CardDescription>
          {/* 分销推荐码提示 */}
          {referralCode && (
            <div className="mt-3 rounded-lg bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 p-3 text-center">
              <p className="text-sm font-medium text-blue-700">
                您是通过好友分享链接进入的
              </p>
              <p className="text-xs text-blue-500 mt-1">
                注册/登录后将自动绑定推广关系
              </p>
            </div>
          )}
          {referralBound && (
            <div className="mt-3 rounded-lg bg-green-50 border border-green-100 p-3 text-center">
              <p className="text-sm font-medium text-green-700">
                推广关系已成功绑定
              </p>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {/* 登录方式切换 */}
          <div className="mb-4 flex rounded-lg bg-gray-100 p-1">
            <button
              type="button"
              className={`flex-1 flex items-center justify-center gap-2 rounded-md py-2 text-sm font-medium transition-colors ${
                loginMethod === 'phone'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => { setLoginMethod('phone'); setAccount(''); setError(''); }}
            >
              <Smartphone className="h-4 w-4" />
              手机号
            </button>
            <button
              type="button"
              className={`flex-1 flex items-center justify-center gap-2 rounded-md py-2 text-sm font-medium transition-colors ${
                loginMethod === 'email'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => { setLoginMethod('email'); setAccount(''); setError(''); }}
            >
              <Mail className="h-4 w-4" />
              邮箱
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="account">
                {loginMethod === 'email' ? '邮箱' : '手机号'}
              </Label>
              <Input
                id="account"
                type={loginMethod === 'email' ? 'email' : 'tel'}
                placeholder={loginMethod === 'email' ? '请输入邮箱地址' : '请输入手机号码'}
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="请输入密码（至少6位）"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="confirm-password">确认密码</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  placeholder="请再次输入密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
            )}
            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
                {error}
              </div>
            )}
            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700"
              disabled={loading}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isLogin ? '登录' : '注册'}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm text-gray-500">
            {isLogin ? (
              <>
                还没有账号？
                <button
                  type="button"
                  className="ml-1 text-blue-600 hover:underline"
                  onClick={() => { setIsLogin(false); setError(''); }}
                >
                  去注册
                </button>
              </>
            ) : (
              <>
                已有账号？
                <button
                  type="button"
                  className="ml-1 text-blue-600 hover:underline"
                  onClick={() => { setIsLogin(true); setError(''); }}
                >
                  去登录
                </button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
