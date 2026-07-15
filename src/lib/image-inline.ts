import { readFile } from 'fs/promises';
import path from 'path';

export interface InlinedImage {
  originalUrl: string;
  dataUri: string;
  mime: string;
  size: number;
}

// 上传目录（相对于项目根目录）
function getProjectRoot(): string {
  if (process.env.PROJECT_ROOT) return process.env.PROJECT_ROOT;
  const cwd = process.cwd();
  if (cwd.endsWith('.next') || cwd.includes('.next')) {
    return path.resolve(cwd, '..');
  }
  return cwd;
}

function getPublicBaseUrl(): string {
  return process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || '';
}

function isLocalImageUrl(url: string): boolean {
  if (!url) return false;

  // 仅处理 http(s) URL 或相对路径
  const trimmed = url.trim();
  if (!trimmed.startsWith('http') && !trimmed.startsWith('/uploads/')) {
    return false;
  }

  // 路径必须以图片扩展名结尾（忽略 query string）
  const cleanUrl = trimmed.split('?')[0].toLowerCase();
  if (!/\.(png|jpe?g|gif|webp|bmp)$/.test(cleanUrl)) return false;

  // 相对路径 /uploads/... 直接视为本地
  if (trimmed.startsWith('/uploads/')) return true;

  // 完整 URL：检查域名是否属于当前服务器
  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) return false;
  try {
    const baseHost = new URL(baseUrl).hostname;
    const urlObj = new URL(trimmed);
    if (urlObj.hostname !== baseHost) return false;
    return urlObj.pathname.startsWith('/uploads/');
  } catch {
    return false;
  }
}

function urlToFilePath(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }
  return path.join(getProjectRoot(), 'public', pathname.replace(/^\//, ''));
}

function getMimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  switch (ext) {
    case 'png': return 'image/png';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'bmp': return 'image/bmp';
    case 'jpeg':
    case 'jpg':
    default: return 'image/jpeg';
  }
}

/**
 * 从文本中提取本地上传的图片 URL，读取文件并内联为 base64 data URI。
 *
 * 背景：Coze 服务器在海外/不同网络环境，直接下载用户服务器上的图片链接容易超时。
 * 通过把本地图片转为 base64 data URI，Coze 无需再发起外部 HTTP 下载，从根本上解决
 * "下载图片链接超时" 问题。
 *
 * 限制：
 * - 只处理当前服务器 public/uploads 目录下的图片，避免读取外部文件造成安全风险。
 * - 单张图片超过 maxSizeBytes 时跳过内联，避免 Coze 请求体过大。
 */
export async function inlineLocalImages(text: string, maxSizeBytes = 4 * 1024 * 1024): Promise<{ text: string; images: InlinedImage[] }> {
  if (!text || typeof text !== 'string') return { text: text || '', images: [] };

  // 匹配图片 URL：完整 http(s) 或相对路径 /uploads/...，扩展名 png/jpg/jpeg/gif/webp/bmp
  const imageUrlRe = /(https?:\/\/[^\s<>"')\]]+\.(?:png|jpe?g|gif|webp|bmp)(?:\?[^\s<>"')\]]*)?)|(\/uploads\/[^\s<>"')\]]+\.(?:png|jpe?g|gif|webp|bmp)(?:\?[^\s<>"')\]]*)?)/gi;
  const matches = Array.from(new Set(text.match(imageUrlRe) || []));

  const images: InlinedImage[] = [];
  let result = text;

  for (const url of matches) {
    if (!isLocalImageUrl(url)) continue;

    const filePath = urlToFilePath(url);
    const publicUploadsPath = path.resolve(getProjectRoot(), 'public', 'uploads');
    const resolvedPath = path.resolve(filePath);

    // 安全校验：禁止路径穿越到 uploads 目录之外
    if (!resolvedPath.startsWith(publicUploadsPath)) {
      console.warn(`[InlineImage] Skip path outside uploads: ${filePath}`);
      continue;
    }

    try {
      const buffer = await readFile(resolvedPath);
      if (buffer.length > maxSizeBytes) {
        console.warn(`[InlineImage] Skip oversized image: ${url} (${buffer.length} bytes > ${maxSizeBytes})`);
        continue;
      }
      const mime = getMimeFromPath(resolvedPath);
      const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;
      images.push({ originalUrl: url, dataUri, mime, size: buffer.length });
      result = result.replaceAll(url, dataUri);
      console.log(`[InlineImage] Inlined ${url} (${buffer.length} bytes)`);
    } catch (err) {
      console.warn(`[InlineImage] Failed to read ${url}:`, err);
    }
  }

  return { text: result, images };
}

/**
 * 递归处理对象/数组中的字符串值，把本地上传图片 URL 转为 base64 data URI。
 */
export async function inlineLocalImagesInObject(
  obj: unknown,
  maxSizeBytes = 4 * 1024 * 1024
): Promise<unknown> {
  if (typeof obj === 'string') {
    const { text } = await inlineLocalImages(obj, maxSizeBytes);
    return text;
  }
  if (Array.isArray(obj)) {
    return Promise.all(obj.map(item => inlineLocalImagesInObject(item, maxSizeBytes)));
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = await inlineLocalImagesInObject(value, maxSizeBytes);
    }
    return result;
  }
  return obj;
}

/**
 * 从文本中提取图片 URL（http/https 或 /uploads/... 相对路径）。
 * 对于相对路径，会拼接 publicBaseUrl 生成绝对 URL。
 * 返回去重后的 URL 数组。
 */
export function extractImageUrls(text: string, publicBaseUrl?: string): string[] {
  if (!text || typeof text !== 'string') return [];
  const imageUrlRe = /(https?:\/\/[^\s<>"'\)\]]+\.(?:png|jpe?g|gif|webp|bmp)(?:\?[^\s<>"'\)\]]*)?)|(\/uploads\/[^\s<>"'\)\]]+\.(?:png|jpe?g|gif|webp|bmp)(?:\?[^\s<>"'\)\]]*)?)/gi;
  const matches = Array.from(new Set(text.match(imageUrlRe) || []));
  return matches.map(url => {
    if (url.startsWith('http')) return url;
    if (!publicBaseUrl) return url;
    const base = publicBaseUrl.endsWith('/') ? publicBaseUrl.slice(0, -1) : publicBaseUrl;
    const path = url.startsWith('/') ? url : `/${url}`;
    return `${base}${path}`;
  });
}

/**
 * 从文本中移除图片 URL，并清理空行。
 */
export function removeImageUrls(text: string): string {
  if (!text || typeof text !== 'string') return text;
  const imageUrlRe = /(https?:\/\/[^\s<>"'\)\]]+\.(?:png|jpe?g|gif|webp|bmp)(?:\?[^\s<>"'\)\]]*)?)|(\/uploads\/[^\s<>"'\)\]]+\.(?:png|jpe?g|gif|webp|bmp)(?:\?[^\s<>"'\)\]]*)?)/gi;
  return text.replace(imageUrlRe, '').replace(/\n\s*\n/g, '\n').trim();
}

