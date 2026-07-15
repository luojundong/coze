import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
// 统一从 stream/route.ts 导入 taskStore（所有路由共用同一个 Map）
import { taskStore } from '../../stream/route';

// 状态查询路由超时设短，快速失败
export const maxDuration = 15;

export async function GET(req: NextRequest) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get('taskId');

  if (!taskId) {
    return NextResponse.json({ error: '缺少 taskId 参数' }, { status: 400 });
  }

  const task = taskStore.get(taskId);

  if (!task) {
    return NextResponse.json({ error: '任务不存在或已过期' }, { status: 404 });
  }

  // 验证任务归属
  if (task.userId !== userId) {
    return NextResponse.json({ error: '无权访问此任务' }, { status: 403 });
  }

  return NextResponse.json({
    status: task.status,
    result: task.result || null,
    error: task.error || null,
    // 流式增量内容：running 状态下前端可获取已生成的部分文字
    chunk: task.chunk || null,
  });
}
