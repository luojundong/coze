/**
 * 构建发送给 Coze /v3/chat 的多模态用户消息（单条）。
 *
 * Coze additional_messages 的 content_type 只支持 `text` / `object_string` / `card`，
 * 没有 `image` 这个类型。图片必须放进 `content_type: 'object_string'` 的 content（JSON 数组）里。
 *
 * 规则（依据 Coze 官方文档）：
 * - 纯文本：content_type 必须为 'text'，content 为文本字符串。
 * - 含图片：content_type 必须为 'object_string'，content 为数组序列化的 JSON 字符串，
 *   形如 [{type:'text',text:'...'},{type:'image',file_url:{url:'公网URL'}}]。
 *   - 文本与图片打包进同一条 object_string 时不受「纯图片必须紧邻文本消息」的限制。
 *   - file_url 必须是公网可公开访问的地址（base64 data URI / 内网地址均会触发 Request parameter error）。
 *
 * 图片 URL 来源：浏览器端上传后由后端返回的公网地址（public/uploads/...），或用户输入的图片链接，
 * 均为公网可访问，可直接作为 file_url。
 * 音频/视频 URL 仍按 v43 行为保留在文本中，由 Coze 工作流自行解析。
 */

export interface CozeTextMessage {
  role: 'user';
  content_type: 'text';
  content: string;
}

export interface CozeObjectStringMessage {
  role: 'user';
  content_type: 'object_string';
  content: string;
}

export type CozeUserMessage = CozeTextMessage | CozeObjectStringMessage;

/**
 * 从文本中提取图片 URL（http/https 或 /uploads/... 相对路径）。
 * 对于相对路径，会拼接 publicBaseUrl 生成绝对 URL。
 * 返回去重后的 URL 数组。
 *
 * 注意：仅提取图片扩展名（png/jpg/jpeg/gif/webp/bmp）。
 * 音频/视频等多媒体文件由 Coze 工作流/智能体自行从文本中的 URL 解析处理。
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

/**
 * 构建 Coze additional_messages 中的用户消息。
 *
 * - 无图片：返回 content_type='text' 的纯文本消息（符合 Coze 规范，避免参数错误）。
 * - 有图片：返回 content_type='object_string' 消息，content 为 JSON 数组，
 *   包含文本元素（若文本为空用空格占位以满足「文本+图片同条」规则）与图片 file_url 元素。
 *
 * 图片一律使用公网 URL（extractImageUrls 已补全为绝对地址），不使用 base64。
 */
export function buildMultimodalUserMessage(rawText: string, publicBaseUrl?: string): CozeUserMessage {
  const imageUrls = extractImageUrls(rawText, publicBaseUrl);
  const text = removeImageUrls(rawText);

  // 纯文本：必须用 content_type: 'text'
  if (imageUrls.length === 0) {
    return { role: 'user', content_type: 'text', content: text || ' ' };
  }

  // 含图片：必须用 content_type: 'object_string'，文本与图片打包进同一条
  const contentObjects: Array<
    { type: 'text'; text: string } | { type: 'image'; file_url: { url: string } }
  > = [];

  // 文本（含音频/视频 URL 等）作为 text 元素；为空时用空格占位，
  // 以满足 Coze「文本+图片同条 object_string 不受纯图片限制」的规则
  contentObjects.push({ type: 'text', text: text.trim().length > 0 ? text.trim() : ' ' });

  for (const url of imageUrls) {
    contentObjects.push({ type: 'image', file_url: { url } });
  }

  return {
    role: 'user',
    content_type: 'object_string',
    content: JSON.stringify(contentObjects),
  };
}
