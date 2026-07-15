import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

// 最大文件大小：100MB
const MAX_FILE_SIZE = 100 * 1024 * 1024;

// 设置路由最大执行时长：180 秒（大文件上传需要更长时间）
export const maxDuration = 180;

// 上传目录（相对于项目根目录）
function getProjectRoot(): string {
  if (process.env.PROJECT_ROOT) return process.env.PROJECT_ROOT;
  const cwd = process.cwd();
  if (cwd.endsWith('.next') || cwd.includes('.next')) {
    return path.resolve(cwd, '..');
  }
  return cwd;
}

// 允许的文件类型
const ALLOWED_TYPES: Record<string, string[]> = {
  audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/m4a', 'audio/webm', 'audio/flac'],
  video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo', 'video/mpeg'],
  image: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp'],
};

// 持久内容目录（不被定时清理）：content=公告/联系老师/教程图片视频, icon=按钮图标
const PERSISTENT_DIRS = new Set(['content', 'icon']);

function getFileCategory(mimeType: string): string | null {
  for (const [category, types] of Object.entries(ALLOWED_TYPES)) {
    if (types.includes(mimeType)) return category;
  }
  return null;
}

function resolveUploadDir(category: string, dirParam?: string | null): string {
  // 优先使用指定的持久目录（如 content），否则按文件类型落入临时分类目录
  const target = dirParam && /^[a-zA-Z0-9_]+$/.test(dirParam) ? dirParam : category;
  return path.join(getProjectRoot(), 'public', 'uploads', target);
}

async function ensureUploadDir(dir: string): Promise<string> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  return dir;
}

export async function POST(req: NextRequest) {
  try {
    return await handleUpload(req);
  } catch (err) {
    console.error('[Upload] Unhandled error:', err);
    return NextResponse.json({ error: '文件上传服务异常' }, { status: 500 });
  }
}

async function handleUpload(req: NextRequest) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  const url = new URL(req.url);
  const dirParam = url.searchParams.get('dir');

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: '请求格式错误，需要 multipart/form-data' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: '缺少文件' }, { status: 400 });
  }

  const category = getFileCategory(file.type);
  if (!category) {
    return NextResponse.json({ error: `不支持的文件类型: ${file.type}` }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: `文件大小超过限制 (最大 ${MAX_FILE_SIZE / 1024 / 1024}MB)` }, { status: 400 });
  }

  try {
    const dir = await ensureUploadDir(resolveUploadDir(category, dirParam));
    const ext = file.name.split('.').pop() || (category === 'audio' ? 'mp3' : 'mp4');
    const fileName = `${userId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
    const filePath = path.join(dir, fileName);

    console.log(`[Upload] Saving ${category}: ${fileName}, size: ${file.size}`);
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, fileBuffer);

    const publicBaseUrl = process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || '';
    const relativePath = `/uploads/${dirParam && /^[a-zA-Z0-9_]+$/.test(dirParam) ? dirParam : category}/${fileName}`;
    const publicUrl = publicBaseUrl ? `${publicBaseUrl.replace(/\/$/, '')}${relativePath}` : relativePath;

    console.log(`[Upload] User ${userId} uploaded ${category}: ${fileName}, URL: ${publicUrl}`);

    return NextResponse.json({
      success: true,
      url: publicUrl,
      fileName,
      category,
      size: file.size,
      mimeType: file.type,
    });
  } catch (err) {
    console.error('[Upload] Write error:', err);
    return NextResponse.json({ error: '文件写入失败，请检查服务器磁盘空间和权限' }, { status: 500 });
  }
}
