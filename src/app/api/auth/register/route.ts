import { NextRequest, NextResponse } from 'next/server';
import { createUser } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    const account = email || '';

    if (!account || !password) {
      return NextResponse.json(
        { error: '账号和密码不能为空' },
        { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: '密码至少需要6个字符' },
        { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    const result = await createUser(account, password);

    if ('error' in result) {
      return NextResponse.json(
        { error: result.error },
        { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    return NextResponse.json({
      user: {
        id: result.user.id,
        email: result.user.email,
        phone: result.user.phone,
      },
      token: result.token,
    });
  } catch (error: any) {
    console.error('Register error:', error?.message || error);
    console.error('Register error stack:', error?.stack);
    return NextResponse.json(
      { error: '注册失败，请稍后重试' },
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }
}
