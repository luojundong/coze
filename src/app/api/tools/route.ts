import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { query } from '@/lib/db';
import { getCozeToken } from '@/lib/coze-token';

export async function GET(req: NextRequest) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || '';
  const category = searchParams.get('category') || '';

  // 构建查询条件
  let whereClause = 'WHERE is_enabled = 1';
  const params: any[] = [];

  if (search) {
    whereClause += ' AND (name LIKE ? OR description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  if (category) {
    whereClause += ' AND category = ?';
    params.push(category);
  }

  // Get enabled workflow configs
  const configs = await query<any>(
    `SELECT id, coze_id, name, description, type, category, icon_url, credit_cost, parameters_schema, tutorial, sort_order
     FROM workflow_configs ${whereClause} ORDER BY sort_order ASC, created_at DESC`,
    params
  );

  // Get categories from tool_categories table (独立分类管理)
  const categories = await query<{ name: string }>(
    `SELECT name FROM tool_categories ORDER BY sort_order ASC, created_at ASC`
  );

  // Get user's activation records
  const activations = await query<{ tool_id: string | null }>(
    'SELECT tool_id FROM user_activations WHERE user_id = ? AND is_active = 1',
    [userId]
  );

  // Get user's favorites
  const favorites = await query<{ tool_id: string }>(
    'SELECT tool_id FROM user_favorites WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC',
    [userId]
  );
  const favoriteToolIds = new Set((favorites || []).map(f => f.tool_id));

  const globalActivation = activations?.find(a => a.tool_id === null);
  const isFullyActivated = !!globalActivation;
  const activatedToolIds = new Set(
    activations?.filter(a => a.tool_id !== null).map(a => a.tool_id) || []
  );

  const toolsWithActivation = (configs || []).map(tool => ({
    ...tool,
    is_activated: isFullyActivated || activatedToolIds.has(tool.id),
    is_favorited: favoriteToolIds.has(tool.id),
  }));

  let cozeConnected = false;
  try {
    const tokenData = await getCozeToken(userId);
    if (tokenData?.accessToken) {
      const expiresAt = tokenData.expiresAt ? new Date(tokenData.expiresAt) : null;
      // 统一使用 5 分钟缓冲，与 getValidCozeToken 保持一致
      cozeConnected = !expiresAt || expiresAt.getTime() - Date.now() > 5 * 60 * 1000;
    }
  } catch {
    cozeConnected = false;
  }

  return NextResponse.json({
    tools: toolsWithActivation,
    categories: (categories || []).map(c => c.name),
    coze_connected: cozeConnected,
    is_full_access: isFullyActivated,
  });
}
