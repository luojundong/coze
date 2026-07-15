import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-guard';
import { query, queryOne, execute, genId } from '@/lib/db';
import { createAuditLog } from '@/lib/audit-log';
import { randomBytes } from 'crypto';

export async function GET(req: NextRequest) {
  const { error } = await verifyAdminAuth(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
  const groupBy = searchParams.get('groupBy') || '';
  const batchId = searchParams.get('batchId') || '';
  const offset = (page - 1) * pageSize;

  // 按批次分组查询（按 batch_id 聚合，无 batch_id 的旧数据按 name+tool_id+created_at 聚合）
  if (groupBy === 'batch') {
    const [batches, countRow] = await Promise.all([
      query<any>(
        `SELECT 
          COALESCE(batch_id, CONCAT(name, '|', IFNULL(tool_ids, ''), '|', DATE_FORMAT(created_at, '%Y-%m-%d %H:%i'))) as batch_id,
          MAX(name) as name, 
          MAX(tool_ids) as tool_ids, 
          MAX(created_at) as batch_created_at,
          COUNT(*) as total_count,
          SUM(used_count) as total_used,
          MIN(expires_at) as batch_expires_at,
          MIN(is_active) as all_active,
          MAX(max_uses) as batch_max_uses
         FROM activation_codes 
         GROUP BY COALESCE(batch_id, CONCAT(name, '|', IFNULL(tool_ids, ''), '|', DATE_FORMAT(created_at, '%Y-%m-%d %H:%i')))
         ORDER BY MAX(created_at) DESC
         LIMIT ? OFFSET ?`,
        [pageSize, offset]
      ),
      queryOne<{ total: number }>(
        `SELECT COUNT(DISTINCT COALESCE(batch_id, CONCAT(name, '|', IFNULL(tool_ids, ''), '|', DATE_FORMAT(created_at, '%Y-%m-%d %H:%i')))) as total FROM activation_codes`
      ),
    ]);

    // 丰富工具名
    const allToolIds = new Set<string>();
    for (const b of (batches || [])) {
      if (b.tool_ids) {
        b.tool_ids.split(',').forEach((id: string) => allToolIds.add(id.trim()));
      }
    }
    let toolMap: Record<string, any> = {};
    if (allToolIds.size > 0) {
      const toolsData = await query<any>(
        `SELECT id, name FROM workflow_configs WHERE id IN (${Array.from(allToolIds).map(() => '?').join(',')})`,
        Array.from(allToolIds)
      );
      for (const t of toolsData) toolMap[t.id] = t;
    }

    const enrichedBatches = batches.map((b: any) => ({
      ...b,
      tool_info: null,  // 改为 tool_infos 数组
      tool_infos: b.tool_ids
        ? b.tool_ids.split(',').map((id: string) => toolMap[id.trim()] || { id: id.trim(), name: id.trim() })
        : null,
    }));

    return NextResponse.json({ batches: enrichedBatches, total: countRow?.total ?? 0, page, pageSize });
  }

  // 按 batch_id 获取详情列表
  if (batchId) {
    const codes = await query<any>(
      `SELECT * FROM activation_codes 
       WHERE batch_id = ? 
          OR (batch_id IS NULL AND CONCAT(name, '|', IFNULL(tool_ids, ''), '|', DATE_FORMAT(created_at, '%Y-%m-%d %H:%i')) = ?)
       ORDER BY code ASC`,
      [batchId, batchId]
    );

    // 丰富工具名
    const allToolIds = new Set<string>();
    for (const c of (codes || [])) {
      if (c.tool_ids) {
        c.tool_ids.split(',').forEach((id: string) => allToolIds.add(id.trim()));
      }
    }
    let toolMap: Record<string, any> = {};
    if (allToolIds.size > 0) {
      const toolsData = await query<any>(
        `SELECT id, name FROM workflow_configs WHERE id IN (${Array.from(allToolIds).map(() => '?').join(',')})`,
        Array.from(allToolIds)
      );
      for (const t of toolsData) toolMap[t.id] = t;
    }

    const enrichedCodes = codes.map((c: any) => ({
      ...c,
      tool_info: null,
      tool_infos: c.tool_ids
        ? c.tool_ids.split(',').map((id: string) => toolMap[id.trim()] || { id: id.trim(), name: id.trim() })
        : null,
    }));

    return NextResponse.json({ codes: enrichedCodes });
  }

  // 原有分页查询（兼容旧逻辑）
  const [codes, countRow] = await Promise.all([
    query<any>('SELECT * FROM activation_codes ORDER BY created_at DESC LIMIT ? OFFSET ?', [pageSize, offset]),
    queryOne<{ total: number }>('SELECT COUNT(*) as total FROM activation_codes'),
  ]);

  const allToolIds = new Set<string>();
  for (const c of (codes || [])) {
    if (c.tool_ids) {
      c.tool_ids.split(',').forEach((id: string) => allToolIds.add(id.trim()));
    }
  }
  let toolMap: Record<string, any> = {};
  if (allToolIds.size > 0) {
    const toolsData = await query<any>(
      `SELECT id, name, coze_id FROM workflow_configs WHERE id IN (${Array.from(allToolIds).map(() => '?').join(',')})`,
      Array.from(allToolIds)
    );
    for (const t of toolsData) toolMap[t.id] = t;
  }

  const enrichedCodes = codes.map((c: any) => ({
    ...c,
    tool_info: null,
    tool_infos: c.tool_ids
      ? c.tool_ids.split(',').map((id: string) => toolMap[id.trim()] || { id: id.trim(), name: id.trim() })
      : null,
  }));

  return NextResponse.json({ codes: enrichedCodes, total: countRow?.total ?? 0, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { userId: adminId, error } = await verifyAdminAuth(req);
  if (error) return error;

  let body: { name?: string; code?: string; max_uses?: number; expires_days?: number; count?: number; tool_ids?: string[] | null; grant_membership?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '请求格式错误' }, { status: 400 }); }

  const { name = '管理员创建', max_uses = 1, expires_days = 365, count = 1, tool_ids = null, grant_membership = false } = body;
  
  // tool_ids 为 null 或空数组表示全部工具
  const toolIdsStr = (tool_ids && tool_ids.length > 0) ? tool_ids.join(',') : null;
  
  const codes: string[] = [];
  const batchId = genId(); // 同批次共享 batch_id

  for (let i = 0; i < Math.min(count, 50); i++) {
    const code = body.code && count === 1 ? body.code : `ACT-${randomBytes(4).toString('hex').toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
    const expiresAt = new Date(Date.now() + expires_days * 86400000);

    await execute(
      `INSERT INTO activation_codes (id, name, code, max_uses, expires_at, tool_ids, batch_id, grant_membership) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [genId(), name, code, max_uses, expiresAt, toolIdsStr, batchId, grant_membership ? 1 : 0]
    );
    codes.push(code);
  }

  await createAuditLog({ userId: adminId, action: 'admin_create_activation_codes', resourceType: 'activation_code', details: { count: codes.length, tool_ids, batch_id: batchId } });
  return NextResponse.json({ codes, count: codes.length, batch_id: batchId });
}

export async function DELETE(req: NextRequest) {
  const { userId: adminId, error } = await verifyAdminAuth(req);
  if (error) return error;

  let body: { code_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '请求格式错误' }, { status: 400 }); }

  if (!body.code_id) return NextResponse.json({ error: '缺少 code_id' }, { status: 400 });

  await execute('DELETE FROM activation_codes WHERE id = ?', [body.code_id]);

  await createAuditLog({ userId: adminId, action: 'admin_delete_activation_code', resourceType: 'activation_code', resourceId: body.code_id });
  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest) {
  const { userId: adminId, error } = await verifyAdminAuth(req);
  if (error) return error;

  let body: { code_id?: string; is_active?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '请求格式错误' }, { status: 400 }); }

  if (!body.code_id) return NextResponse.json({ error: '缺少 code_id' }, { status: 400 });

  await execute(
    'UPDATE activation_codes SET is_active = ?, updated_at = NOW() WHERE id = ?',
    [body.is_active ? 1 : 0, body.code_id]
  );

  return NextResponse.json({ success: true });
}
