import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

// 最大文件大小：10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// 上传目录（相对于项目根目录）
function getProjectRoot(): string {
  if (process.env.PROJECT_ROOT) return process.env.PROJECT_ROOT;
  const cwd = process.cwd();
  if (cwd.endsWith('.next') || cwd.includes('.next')) {
    return path.resolve(cwd, '..');
  }
  return cwd;
}

// 允许的图片类型
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp'];

// 持久内容目录（不被定时清理）：content=公告/联系老师/教程图片, icon=按钮图标
const PERSISTENT_DIRS = new Set(['content', 'icon']);

function resolveUploadDir(dir: string): string {
  // 仅允许安全子目录名，持久目录与临时目录隔离
  const safe = /^[a-zA-Z0-9_]+$/.test(dir) ? dir : 'image';
  return path.join(getProjectRoot(), 'public', 'uploads', safe);
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
    console.error('[Upload Image] Unhandled error:', err);
    return NextResponse.json({ error: '图片上传服务异常' }, { status: 500 });
  }
}

async function handleUpload(req: NextRequest) {
  const { userId, error } = await verifyAuth(req);
  if (error) return error;

  const url = new URL(req.url);
  const dirParam = url.searchParams.get('dir') || 'image';
  const uploadDir = resolveUploadDir(dirParam);

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

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: `不支持的文件类型: ${file.type}，仅支持 png/jpeg/gif/webp/bmp` }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: `文件大小超过限制 (最大 ${MAX_FILE_SIZE / 1024 / 1024}MB)` }, { status: 400 });
  }

  try {
    const dir = await ensureUploadDir(uploadDir);
    const ext = file.name.split('.').pop() || 'png';
    const fileName = `${userId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
    const filePath = path.join(dir, fileName);

    console.log(`[Upload Image] Saving: ${fileName}, size: ${file.size}`);
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, fileBuffer);

    const publicBaseUrl = process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || '';
    const relativePath = `/uploads/${dirParam}/${fileName}`;
    const publicUrl = publicBaseUrl ? `${publicBaseUrl.replace(/\/$/, '')}${relativePath}` : relativePath;

    console.log(`[Upload Image] User ${userId} uploaded: ${fileName}, URL: ${publicUrl}`);

    return NextResponse.json({
      success: true,
      url: publicUrl,
      fileName,
    });
  } catch (err) {
    console.error('[Upload Image] Write error:', err);
    return NextResponse.json({ error: '图片写入失败，请检查服务器磁盘空间和权限' }, { status: 500 });
  }
}
