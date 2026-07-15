import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { query, queryOne, genId } from '@/lib/db';

/**
 * GET  /api/referral/link — 获取当前用户的分销链接
 * POST /api/referral/link — 生成/刷新分销链接
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, error } = await verifyAuth(req);
    if (error) return error;

    // 检查是否会员
    let isMember = false;
    try {
      const membership = await queryOne<any>(
        'SELECT is_member FROM user_memberships WHERE user_id = ?',
        [userId]
      );
      isMember = !!membership?.is_member;
    } catch {
      isMember = false;
    }

    if (!isMember) {
      return NextResponse.json({
        isMember: false,
        message: '您还不是会员，无法使用分销功能',
      });
    }

    // 获取用户信息（手机号/邮箱）
    const userInfo = await queryOne<any>(
      'SELECT phone, email FROM users WHERE id = ?',
      [userId]
    );

    // 生成分销码（使用用户ID的前8位 + 随机字符）
    const referralCode = `${userId.substring(0, 8)}_${Math.random().toString(36).substring(2, 6)}`;

    const referralUrl = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://coze.mooibi.com'}/login?ref=${referralCode}`;

    return NextResponse.json({
      isMember: true,
      referralCode,
      referralUrl,
      userPhone: userInfo?.phone || userInfo?.email || '',
    });
  } catch (err: any) {
    console.error('[referral/link] error:', err);
    return NextResponse.json({
      isMember: false,
      message: '获取分销链接失败',
      error: err?.message,
    }, { status: 200 });
  }
}

/**
 * 通过分销链接注册/激活时绑定关系
 * POST body: { referralCode: string, newUserId: string }
 */
export async function POST(req: NextRequest) {
  try {
    // 需要认证：只有登录用户才能绑定分销关系
    const { userId: callerId, error: authError } = await verifyAuth(req);
    if (authError) {
      console.warn('[referral/link] 未认证的绑定请求');
      return authError;
    }

    const body = await req.json();
    const { referralCode, newUserId } = body;

    console.log(`[referral/link] 绑定请求: referralCode=${referralCode?.substring(0, 12)}... newUserId=${newUserId?.substring(0, 8)}... callerId=${callerId?.substring(0, 8)}...`);

    if (!referralCode || !newUserId) {
      console.warn('[referral/link] 缺少参数');
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    // 从 referralCode 解析推荐人 user_id（格式: userId前8位_random）
    const referrerPrefix = referralCode.split('_')[0];
    if (!referrerPrefix || referrerPrefix.length < 8) {
      console.warn(`[referral/link] 无效的分销码: ${referralCode.substring(0, 12)}...`);
      return NextResponse.json({ error: '无效的分销码' }, { status: 400 });
    }

    // 查找推荐人
    const referrer = await queryOne<any>(
      'SELECT id FROM users WHERE id LIKE ? LIMIT 1',
      [`${referrerPrefix}%`]
    );
    if (!referrer) {
      console.warn(`[referral/link] 推荐人不存在: prefix=${referrerPrefix}`);
      return NextResponse.json({ error: '分销码无效，推荐人不存在' }, { status: 400 });
    }

    const referrerId = referrer.id;
    console.log(`[referral/link] 找到推荐人: ${referrerId.substring(0, 8)}...`);
    if (referrerId === newUserId) {
      console.warn(`[referral/link] 不能推荐自己`);
      return NextResponse.json({ error: '不能推荐自己' }, { status: 400 });
    }

    // 检查推荐人是否会员
    let membership: any = null;
    try {
      membership = await queryOne<any>(
        'SELECT is_member FROM user_memberships WHERE user_id = ?',
        [referrerId]
      );
    } catch (e: any) {
      console.error(`[referral/link] 查询会员状态失败:`, e.message);
      // 表可能不存在，继续尝试创建关系
    }
    if (!membership?.is_member) {
      console.warn(`[referral/link] 推荐人 ${referrerId.substring(0, 8)}... 不是会员 is_member=${membership?.is_member}`);
      return NextResponse.json({ error: '推荐人不是会员，分销关系无效' }, { status: 400 });
    }
    console.log(`[referral/link] 推荐人是会员 ✓`);

    // 检查是否已有分销关系
    const existing = await queryOne<any>(
      'SELECT id FROM referral_relations WHERE referred_user_id = ?',
      [newUserId]
    );
    if (existing) {
      console.log(`[referral/link] 已有分销关系，跳过`);
      return NextResponse.json({ message: '已有分销关系，无需重复绑定' });
    }

    // 创建分销关系
    const id = genId();
    await query(
      'INSERT INTO referral_relations (id, referrer_user_id, referred_user_id, status) VALUES (?, ?, ?, ?)',
      [id, referrerId, newUserId, 'active']
    );
    console.log(`[referral/link] ✓ 已创建分销关系: ${id.substring(0, 8)}... referrer=${referrerId.substring(0, 8)}... referred=${newUserId.substring(0, 8)}...`);

    // 更新 user_activations 的 referrer_user_id（找到该用户最近的激活记录）
    try {
      const updateResult = await query(
        'UPDATE user_activations SET referrer_user_id = ? WHERE user_id = ? AND referrer_user_id IS NULL ORDER BY activated_at DESC LIMIT 1',
        [referrerId, newUserId]
      );
      console.log(`[referral/link] user_activations 更新结果:`, updateResult);
    } catch (e: any) {
      console.warn('[referral/link] 更新 user_activations 失败（非关键）:', e.message);
    }

    console.log(`[Referral] User ${referrerId} referred user ${newUserId}`);

    return NextResponse.json({
      success: true,
      referrerId,
      referralId: id,
    });
  } catch (err: any) {
    console.error('[referral/link] 绑定异常:', err);
    return NextResponse.json({ error: '绑定分销关系失败' }, { status: 500 });
  }
}
