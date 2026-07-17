import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { query, queryOne, execute, genId } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';
import { createAuditLog } from '@/lib/audit-log';
import { grantCredits } from '@/lib/credit';

/**
 * 根据 duration_type 计算用户激活到期时间
 * @returns MySQL DATETIME 格式的到期时间，或 null（永久）
 */
function calcActivationExpiry(durationType: string | null): Date | null {
  if (!durationType || durationType === 'permanent') return null;
  const now = new Date();
  switch (durationType) {
    case '1day':  return new Date(now.getTime() + 1 * 86400000);
    case '7days': return new Date(now.getTime() + 7 * 86400000);
    case 'month': return new Date(now.getTime() + 30 * 86400000);
    case 'year':  return new Date(now.getTime() + 365 * 86400000);
    default:      return null; // 未知类型默认永久
  }
}

export async function POST(req: NextRequest) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  const rateResult = await checkRateLimit(userId, 'activate');
  if (!rateResult.allowed) {
    return NextResponse.json(
      { error: '操作过于频繁，请稍后再试', resetAt: rateResult.resetAt },
      { status: 429 }
    );
  }

  let body: { code?: string; referralCode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  const { code, referralCode } = body;
  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    return NextResponse.json({ error: '请输入激活码' }, { status: 400 });
  }

  // 处理分销绑定（如果有 referralCode）
  if (referralCode && typeof referralCode === 'string') {
    const referrerPrefix = referralCode.split('_')[0];
    if (referrerPrefix && referrerPrefix.length >= 8) {
      const referrer = await queryOne<any>(
        'SELECT id FROM users WHERE id LIKE ? LIMIT 1',
        [`${referrerPrefix}%`]
      );
      if (referrer && referrer.id !== userId) {
        const existingRel = await queryOne<any>(
          'SELECT id FROM referral_relations WHERE referred_user_id = ?',
          [userId]
        );
        if (!existingRel) {
          await query(
            'INSERT INTO referral_relations (id, referrer_user_id, referred_user_id, status) VALUES (?, ?, ?, ?)',
            [genId(), referrer.id, userId, 'active']
          );
          console.log(`[Referral] User ${referrer.id} referred user ${userId} via activation`);
        }
      }
    }
  }

  // Find activation code
  const activationCode = await queryOne<any>(
    'SELECT id, code, max_uses, used_count, is_active, expires_at, tool_ids, duration_type, grant_membership FROM activation_codes WHERE code = ?',
    [code.trim()]
  );

  if (!activationCode) {
    await createAuditLog({ userId, action: 'activate', status: 'failure', errorMessage: '激活码不存在', req });
    return NextResponse.json({ error: '激活码不存在' }, { status: 404 });
  }

  if (!activationCode.is_active) {
    await createAuditLog({ userId, action: 'activate', status: 'failure', errorMessage: '激活码已禁用', req });
    return NextResponse.json({ error: '该激活码已禁用' }, { status: 400 });
  }

  if (activationCode.expires_at && new Date(activationCode.expires_at) < new Date()) {
    // 仅旧版激活码（有 expires_at 且无 duration_type）检查过期
    if (!activationCode.duration_type) {
      await createAuditLog({ userId, action: 'activate', status: 'failure', errorMessage: '激活码已过期', req });
      return NextResponse.json({ error: '该激活码已过期' }, { status: 400 });
    }
  }

  if (activationCode.max_uses !== null && activationCode.used_count >= activationCode.max_uses) {
    await createAuditLog({ userId, action: 'activate', status: 'failure', errorMessage: '激活码已达使用上限', req });
    return NextResponse.json({ error: '该激活码已达使用上限' }, { status: 400 });
  }

  // 解析 tool_ids：逗号分隔的工具ID列表，null/空表示全部工具
  const toolIdsRaw = activationCode.tool_ids as string | null;
  const toolIds: string[] = toolIdsRaw
    ? toolIdsRaw.split(',').map((s: string) => s.trim()).filter(Boolean)
    : [];
  const isGlobalActivation = toolIds.length === 0; // 无 tool_ids = 全部工具

  // Get tool names
  let toolNames: string[] = [];
  if (!isGlobalActivation) {
    const toolsData = await query<{ id: string; name: string }>(
      `SELECT id, name FROM workflow_configs WHERE id IN (${toolIds.map(() => '?').join(',')})`,
      toolIds
    );
    toolNames = toolsData.map(t => t.name);
  }

  // Check existing activations
  if (isGlobalActivation) {
    // 全局激活码：检查是否已有全局激活
    const existingGlobal = await queryOne<{ id: string }>(
      'SELECT id FROM user_activations WHERE user_id = ? AND is_active = 1 AND tool_id IS NULL',
      [userId]
    );
    if (existingGlobal) {
      return NextResponse.json({ error: '您的账户已激活全部工具' }, { status: 400 });
    }
  } else {
    // 工具激活码：检查哪些工具已经激活
    const existingActivations = await query<{ tool_id: string }>(
      'SELECT tool_id FROM user_activations WHERE user_id = ? AND is_active = 1',
      [userId]
    );
    
    // 检查是否有全局激活
    const hasGlobalActivation = existingActivations.some((a: any) => a.tool_id === null);
    if (hasGlobalActivation) {
      return NextResponse.json({ error: '您已激活全部工具，无需重复激活' }, { status: 400 });
    }

    // 过滤掉已激活的工具
    const existingToolIds = new Set(existingActivations.map((a: any) => a.tool_id));
    const alreadyActivated = toolIds.filter(id => existingToolIds.has(id));
    
    if (alreadyActivated.length === toolIds.length) {
      return NextResponse.json({ error: '激活码中的工具您已全部激活' }, { status: 400 });
    }
  }

  // 根据 duration_type 计算用户激活的过期时间
  const userExpiresAt = calcActivationExpiry(activationCode.duration_type);

  // 批量插入激活记录
  if (isGlobalActivation) {
    await execute(
      `INSERT INTO user_activations (id, user_id, activation_code_id, is_active, expires_at, tool_id)
       VALUES (?, ?, ?, 1, ?, NULL)`,
      [genId(), userId, activationCode.id, userExpiresAt]
    );
  } else {
    // 过滤掉已激活的工具
    const existingActivations = await query<{ tool_id: string }>(
      'SELECT tool_id FROM user_activations WHERE user_id = ? AND is_active = 1',
      [userId]
    );
    const existingToolIds = new Set(existingActivations.map((a: any) => a.tool_id));
    const newToolIds = toolIds.filter(id => !existingToolIds.has(id));

    for (const toolId of newToolIds) {
      await execute(
        `INSERT INTO user_activations (id, user_id, activation_code_id, is_active, expires_at, tool_id)
         VALUES (?, ?, ?, 1, ?, ?)`,
        [genId(), userId, activationCode.id, userExpiresAt, toolId]
      );
    }
  }

  // Increment used_count
  await execute(
    'UPDATE activation_codes SET used_count = used_count + 1 WHERE id = ?',
    [activationCode.id]
  );

  await createAuditLog({
    userId,
    action: 'activate',
    resourceType: 'activation_code',
    resourceId: activationCode.id,
    details: { tool_ids: toolIds, tool_names: toolNames, is_global: isGlobalActivation },
    req,
  });

  const INITIAL_CREDITS = 100;
  await grantCredits(userId, INITIAL_CREDITS, 'activation', `激活码激活赠送 ${INITIAL_CREDITS} 积分`);

  // 如果激活码设置了授予会员身份，自动为用户开通会员
  if (activationCode.grant_membership) {
    const existingMembership = await queryOne<any>(
      'SELECT id FROM user_memberships WHERE user_id = ?',
      [userId]
    );
    if (existingMembership) {
      await execute(
        'UPDATE user_memberships SET is_member = 1, expires_at = ?, updated_at = NOW() WHERE user_id = ?',
        [userExpiresAt, userId]
      );
    } else {
      await execute(
        'INSERT INTO user_memberships (id, user_id, is_member, expires_at) VALUES (?, ?, 1, ?)',
        [genId(), userId, userExpiresAt]
      );
    }
    console.log(`[Membership] Auto-granted membership to user ${userId} via activation code ${activationCode.code}`);
  }

  const toolLabel = isGlobalActivation
    ? '全部工具'
    : `${toolNames.length} 个工具`;
  const toolList = isGlobalActivation ? '全部工具' : toolNames.join('、');

  return NextResponse.json({
    success: true,
    message: `成功激活${toolLabel}`,
    tool_name: toolList,
    is_global: isGlobalActivation,
    activated_tool_ids: isGlobalActivation ? [] : toolIds,
    credits: INITIAL_CREDITS,
  });
}
