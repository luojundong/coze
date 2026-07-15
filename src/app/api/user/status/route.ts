import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { query, queryOne } from '@/lib/db';
import { getUserCredits } from '@/lib/credit';
import { verifyToken, getUserById } from '@/lib/auth';
import { getCozeToken, refreshCozeToken } from '@/lib/coze-token';

export async function GET(req: NextRequest) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  // Check all activation records
  const activations = await query<any>(
    'SELECT is_active, expires_at, activated_at, tool_id FROM user_activations WHERE user_id = ? AND is_active = 1',
    [userId]
  );

  const globalActivation = activations?.find((a: any) => a.tool_id === null);
  const activatedToolIds = activations?.filter((a: any) => a.tool_id !== null).map((a: any) => a.tool_id) || [];
  const isFullyActivated = !!globalActivation;
  const hasAnyActivation = isFullyActivated || activatedToolIds.length > 0;

  // Check Coze token - verify it's actually valid (can decrypt, not expired)
  let cozeConnected = false;
  let cozeUserId: string | null = null;
  let cozeTokenExpiresAt: string | null = null;

  try {
    let tokenData = await getCozeToken(userId);
    if (tokenData?.accessToken) {
      const expiresAt = tokenData.expiresAt ? new Date(tokenData.expiresAt) : null;
      // 统一使用 5 分钟缓冲，与 getValidCozeToken 保持一致
      const isExpired = expiresAt ? expiresAt.getTime() - Date.now() < 5 * 60 * 1000 : false;

      // 如果 token 过期，尝试用 refresh_token 刷新
      if (isExpired && tokenData.refreshToken) {
        try {
          const refreshed = await refreshCozeToken(userId);
          tokenData = refreshed;
          cozeConnected = true;
        } catch {
          cozeConnected = false;
        }
      } else {
        cozeConnected = !isExpired;
      }

      cozeUserId = tokenData.cozeUserId ?? null;
      cozeTokenExpiresAt = tokenData.expiresAt ?? null;
    }
  } catch {
    // Token decryption failed or not found - treat as not connected
    cozeConnected = false;
  }

  // Get user info from our auth system
  const token = req.headers.get('x-session');
  let userInfo = null;
  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      userInfo = await getUserById(decoded.userId);
    }
  }

  // Get credits
  const credits = await getUserCredits(userId);

  // 获取上级推荐人信息（通过分销关系）
  let referrer: any = null;
  try {
    const referrerRel = await queryOne<any>(
      `SELECT rr.referrer_user_id, u.phone, u.email
       FROM referral_relations rr
       LEFT JOIN users u ON u.id = rr.referrer_user_id
       WHERE rr.referred_user_id = ?
       LIMIT 1`,
      [userId]
    );
    if (referrerRel) {
      referrer = {
        userId: referrerRel.referrer_user_id,
        phone: referrerRel.phone || null,
        email: referrerRel.email || null,
        displayName: referrerRel.phone || referrerRel.email || referrerRel.referrer_user_id,
      };
    }
  } catch {
    // 表可能不存在，静默降级
    referrer = null;
  }

  // 获取会员状态
  let isMember = false;
  let membershipActivatedAt: string | null = null;
  try {
    const membership = await queryOne<any>(
      'SELECT is_member, activated_at FROM user_memberships WHERE user_id = ?',
      [userId]
    );
    isMember = membership?.is_member || false;
    membershipActivatedAt = membership?.activated_at || null;
  } catch {
    // 表可能不存在，静默降级
    isMember = false;
    membershipActivatedAt = null;
  }

  return NextResponse.json({
    user: {
      id: userInfo?.id || userId,
      email: userInfo?.email || '',
      phone: userInfo?.phone || null,
      createdAt: null,
    },
    activation: hasAnyActivation
      ? {
          isActive: true,
          activatedAt: globalActivation?.activated_at || activations?.[0]?.activated_at,
          expiresAt: globalActivation?.expires_at || activations?.[0]?.expires_at,
          isFullAccess: isFullyActivated,
          activatedToolIds,
        }
      : null,
    cozeConnected,
    cozeUserId,
    cozeTokenExpiresAt,
    credits,
    referrer,
    membership: {
      isMember,
      activatedAt: membershipActivatedAt,
    },
  });
}
