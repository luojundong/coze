import { getToken } from '@/lib/api-client';

/**
 * 通用文件上传客户端（管理后台使用）
 * @param file  要上传的文件
 * @param dir   存储子目录（持久内容用 'content' / 'icon'，避免被定时清理）
 * @param kind  'image' 走 /api/upload/image，'media' 走 /api/upload/media
 * @returns     公网可访问的 URL
 */
export async function uploadFile(
  file: File,
  dir: string,
  kind: 'image' | 'media' = 'image'
): Promise<string> {
  const token = getToken();
  if (!token) throw new Error('未登录，请重新登录');

  const form = new FormData();
  form.append('file', file);

  const base = kind === 'image' ? '/api/upload/image' : '/api/upload/media';
  const res = await fetch(`${base}?dir=${encodeURIComponent(dir)}`, {
    method: 'POST',
    headers: { 'x-session': token },
    body: form,
  });

  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || '上传失败');
  }
  const d = await res.json();
  return d.url;
}
