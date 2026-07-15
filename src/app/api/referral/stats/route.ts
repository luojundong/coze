import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { query } from '@/lib/db';

/**
 * GET /api/referral/stats — 获取当前用户的分销统计数据
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, error } = await verifyAuth(req);
    if (error) return error;

    console.log(`[referral/stats] 查询用户 ${userId.substring(0, 8)}...`);

    // 检查是否会员（表可能不存在，catch 兜底）
    let isMember = false;
    try {
      const membership = await query<any>(
        'SELECT is_member FROM user_memberships WHERE user_id = ?',
        [userId]
      );
      isMember = membership?.length > 0 && membership[0].is_member;
      console.log(`[referral/stats] 会员状态: isMember=${isMember} rows=${membership?.length} is_member_raw=${membership?.[0]?.is_member}`);
    } catch (e: any) {
      // user_memberships 表可能不存在
      console.warn(`[referral/stats] 查询会员状态异常:`, e.message);
      isMember = false;
    }

    if (!isMember) {
      console.log(`[referral/stats] 用户不是会员，返回空数据`);
      return NextResponse.json({
        isMember: false,
        referralCount: 0,
        totalCommission: 0,
        referrals: [],
      });
    }

    // 获取下级用户列表
    let referrals: any[] = [];
    try {
      referrals = await query<any>(
        `SELECT rr.referred_user_id, rr.status, rr.created_at,
                u.phone, u.email
         FROM referral_relations rr
         LEFT JOIN users u ON u.id = rr.referred_user_id
         WHERE rr.referrer_user_id = ?
         ORDER BY rr.created_at DESC`,
        [userId]
      );
      console.log(`[referral/stats] 查询到 ${referrals?.length || 0} 位下级用户`);
    } catch (e: any) {
      console.warn(`[referral/stats] 查询下级用户异常:`, e.message);
      referrals = [];
    }

    // 获取佣金总额
    let totalCommission = 0;
    try {
      const commissionRows = await query<any>(
        'SELECT COALESCE(SUM(amount), 0) as total FROM referral_commissions WHERE referrer_user_id = ?',
        [userId]
      );
      totalCommission = commissionRows?.[0]?.total || 0;
    } catch {
      totalCommission = 0;
    }

    console.log(`[referral/stats] 返回: referralCount=${referrals?.length || 0} totalCommission=${totalCommission}`);

    return NextResponse.json({
      isMember: true,
      referralCount: referrals?.length || 0,
      referrals: Array.isArray(referrals) ? referrals.map((r: any) => ({
        userId: r.referred_user_id,
        phone: r.phone || r.email || '未知用户',
        status: r.status || 'unknown',
        joinedAt: r.created_at,
      })) : [],
      totalCommission,
    });
  } catch (err: any) {
    console.error('[referral/stats] error:', err);
    return NextResponse.json({
      isMember: false,
      referralCount: 0,
      totalCommission: 0,
      referrals: [],
      error: err?.message || '获取统计数据失败',
    }, { status: 200 }); // 返回 200 避免前端报错
  }
}
