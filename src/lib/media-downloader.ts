/**
 * 媒体文件下载器
 * 从 Coze 返回的响应中提取媒体 URL，后台下载到 /public/download/ 目录
 * 采用 fire-and-forget 模式，不阻塞用户响应
 */
import fs from 'fs/promises';
import path from 'path';

const DOWNLOAD_DIR = path.join(process.cwd(), 'public', 'download');
const MAX_CONCURRENT = 3;
const DOWNLOAD_TIMEOUT = 120_000; // 单文件 120s 超时

/** 确保下载目录存在 */
async function ensureDir(): Promise<void> {
  try {
    await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
  } catch {
    /* 目录已存在 */
  }
}

/** 判断 URL 是否为媒体文件并返回扩展名 */
function getMediaExtension(url: string): string | null {
  const match = url.match(/\.(mp4|mov|avi|mkv|webm|wmv|flv|m4v|png|jpg|jpeg|gif|webp|bmp|svg)(\?|$)/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * 从 Coze 消息 content 中提取所有媒体 URL
 * 支持三种格式：
 *   1. content 为字符串 → 正则匹配媒体文件 URL
 *   2. content 为对象 → 提取 file_url / url / image_url / object_string 中的 URL
 *   3. content 为 JSON 字符串 → 解析后递归提取
 */
export function extractMediaUrls(content: any): string[] {
  const urls: string[] = [];
  if (!content) return urls;

  // 1. content 为字符串 → 正则匹配 Markdown 图片 / 裸媒体链接
  if (typeof content === 'string') {
    const mediaRegex = /https?:\/\/[^\s<>"'（）\(\)\[\]]*\.(?:mp4|mov|avi|mkv|webm|wmv|flv|m4v|png|jpg|jpeg|gif|webp|bmp|svg)(?:\?[^\s<>"'（）\(\)\[\]]*)?/gi;
    let match: RegExpExecArray | null;
    while ((match = mediaRegex.exec(content)) !== null) {
      urls.push(match[0]);
    }
    return urls;
  }

  // 2. content 为对象
  if (typeof content === 'object' && !Array.isArray(content)) {
    const c = content as Record<string, any>;
    if (typeof c.file_url === 'string') urls.push(c.file_url);
    if (typeof c.url === 'string') urls.push(c.url);
    if (typeof c.image_url === 'string') urls.push(c.image_url);
    if (c.image_url && typeof c.image_url === 'object' && typeof c.image_url.url === 'string') {
      urls.push(c.image_url.url);
    }
    // object_string: 某些版本的 Coze 将文件信息存储在 JSON 字符串中
    if (typeof c.object_string === 'string') {
      try {
        const parsed = JSON.parse(c.object_string);
        if (parsed && typeof parsed === 'object') {
          if (typeof parsed.file_url === 'string') urls.push(parsed.file_url);
          if (typeof parsed.url === 'string') urls.push(parsed.url);
        }
      } catch {
        /* 非 JSON 字符串，忽略 */
      }
    }
    return urls;
  }

  // 3. content 为 JSON 字符串（以 { 或 [ 开头）→ 解析后递归提取
  if (typeof content === 'string' && (content.startsWith('{') || content.startsWith('['))) {
    try {
      const parsed = JSON.parse(content);
      return extractMediaUrls(parsed);
    } catch {
      /* 非有效 JSON */
    }
  }

  return urls;
}

/**
 * 从 Coze SSE data 事件中收集媒体 URL
 * 处理两种场景：
 *   - answer 类型：content 为字符串，可能包含内联媒体 URL
 *   - file / image / video 类型：content 为对象，包含 file_url 等字段
 */
export function collectMediaFromSSEEvent(data: any, collectedUrls: string[]): void {
  if (!data || !data.content) return;

  if (typeof data.content === 'string') {
    collectedUrls.push(...extractMediaUrls(data.content));
  } else if (typeof data.content === 'object') {
    collectedUrls.push(...extractMediaUrls(data.content));
  }
}

/**
 * 从 Coze 消息列表中收集媒体 URL（用于非流式 JSON 响应）
 */
export function collectMediaFromMessages(messages: any[]): string[] {
  const urls: string[] = [];
  if (!Array.isArray(messages)) return urls;

  for (const msg of messages) {
    if (!msg.content) continue;

    // answer 类型消息中可能含有内联 URL
    if (typeof msg.content === 'string') {
      urls.push(...extractMediaUrls(msg.content));
    }
    // file / image / video 类型消息的 content 为对象
    else if (typeof msg.content === 'object') {
      urls.push(...extractMediaUrls(msg.content));
    }
  }
  return urls;
}

/** 下载单个文件到 /public/download/ */
async function downloadFile(url: string, taskId: string, index: number): Promise<string | null> {
  const ext = getMediaExtension(url);
  if (!ext) return null;

  const filename = `${taskId}_${Date.now()}_${index}.${ext}`;
  const filepath = path.join(DOWNLOAD_DIR, filename);

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT) });
    if (!response.ok) {
      console.warn(`[MediaDownloader] HTTP ${response.status} downloading: ${url}`);
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(filepath, buffer);

    const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
    console.log(`[MediaDownloader] Saved: ${filename} (${sizeMB}MB)`);
    return `/download/${filename}`;
  } catch (err: any) {
    console.warn(`[MediaDownloader] Failed to download ${url}: ${err.message}`);
    return null;
  }
}

/**
 * 后台批量下载媒体文件（fire-and-forget，不阻塞调用方）
 * @param taskId   任务 ID，用于文件命名
 * @param urls     要去重下载的媒体 URL 列表
 * @param logLabel 日志标签（如工具名称）
 */
export function triggerBackgroundDownload(
  taskId: string,
  urls: string[],
  logLabel?: string
): void {
  if (!urls || urls.length === 0) return;

  const uniqueUrls = [...new Set(urls)];
  const label = logLabel || 'unknown';
  console.log(`[MediaDownloader] Task ${taskId} (${label}): starting background download of ${uniqueUrls.length} files`);

  // Fire and forget — 不 await，不阻塞
  (async () => {
    await ensureDir();

    const results: (string | null)[] = [];
    // 并发控制：每次最多 MAX_CONCURRENT 个下载
    for (let i = 0; i < uniqueUrls.length; i += MAX_CONCURRENT) {
      const batch = uniqueUrls.slice(i, i + MAX_CONCURRENT);
      const batchResults = await Promise.all(
        batch.map((url, j) => downloadFile(url, taskId, i + j))
      );
      results.push(...batchResults);
    }

    const successCount = results.filter(Boolean).length;
    console.log(`[MediaDownloader] Task ${taskId}: ${successCount}/${uniqueUrls.length} files saved to /public/download/`);
  })().catch(err => {
    console.error(`[MediaDownloader] Task ${taskId}: fatal error:`, err);
  });
}
