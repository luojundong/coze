'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Image from 'next/image';
import { KeyRound, Loader2, CheckCircle2 } from 'lucide-react';
import { callAuthenticatedApi, getToken, removeToken } from '@/lib/api-client';

const APP_ICON = 'https://coze-coding-project.tos.coze.site/gen_project_icon/2026-06-05/7647748950014869514_1780631428.png?sign=4902695670-5b34760099-0-cc71e7a9352b6916399b6f27b9568fec69eaf78f001a45c8aedc77d2651e830a';

export default function ActivatePage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [successToolName, setSuccessToolName] = useState('');
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch('/api/auth/session', { headers: { 'x-session': token } })
      .then(res => res.json())
      .then(data => {
        if (!data.user) {
          removeToken();
          router.replace('/login');
        } else {
          setChecking(false);
        }
      })
      .catch(() => {
        router.replace('/login');
      });
  }, [router]);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await callAuthenticatedApi('/api/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });

      if (!res) return;

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '激活失败');
      }

      setSuccess(true);
      setSuccessToolName(data.tool_name || '');
      setTimeout(() => router.replace('/dashboard'), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : '激活失败');
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

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-8 pb-8">
            <CheckCircle2 className="mx-auto mb-4 h-16 w-16 text-green-500" />
            <h2 className="text-xl font-semibold text-gray-900">激活成功</h2>
            {successToolName && (
              <p className="mt-1 text-sm text-blue-600">已激活工具：{successToolName}</p>
            )}
            {!successToolName && (
              <p className="mt-1 text-sm text-green-600">已激活全部工具</p>
            )}
            <p className="mt-2 text-sm text-gray-500">正在跳转到工作台...</p>
          </CardContent>
        </Card>
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
              alt="激活"
              width={64}
              height={64}
              className="rounded-xl"
            />
          </div>
          <CardTitle className="text-xl">输入激活码</CardTitle>
          <CardDescription>请输入您获得的激活码以激活账户</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleActivate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="activation-code">激活码</Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  id="activation-code"
                  placeholder="请输入激活码"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  className="pl-10 font-mono tracking-widest"
                  required
                />
              </div>
            </div>
            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
                {error}
              </div>
            )}
            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700"
              disabled={loading || !code.trim()}
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              激活
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
