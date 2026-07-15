// utils/content-parser.js
// 解析富文本内容（HTML 片段）为可视化块数组，供小程序渲染。
// 支持: 纯文本、<a href> 链接、<img src> 图片、<video src> 视频、<br>、换行符。

/**
 * 将 HTML 富文本解析为 block 数组
 * block 类型:
 *   { type: 'text', text }
 *   { type: 'link', text, url }
 *   { type: 'image', url }
 *   { type: 'video', url }
 *   { type: 'br' }
 */
function parseRichContent(raw) {
  if (!raw) return [];

  const images = [];
  const videos = [];
  const links = [];
  let html = raw;

  // 1. 提取 <img src="...">
  html = html.replace(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, (m, url) => {
    const idx = images.length;
    images.push(url);
    return `[[IMG_${idx}]]`;
  });

  // 2. 提取 <video>...</video>（含 <source src>）
  html = html.replace(/<video\b[^>]*>[\s\S]*?<\/video>/gi, (m) => {
    let url = null;
    const srcMatch = m.match(/\bsrc=["']([^"']+)["']/i);
    if (srcMatch) url = srcMatch[1];
    else {
      const srcTag = m.match(/<source\b[^>]*\bsrc=["']([^"']+)["']/i);
      if (srcTag) url = srcTag[1];
    }
    const idx = videos.length;
    videos.push(url || '');
    return `[[VID_${idx}]]`;
  });

  // 2b. 自闭合 <video src="..." /> 或 <video src="...">
  html = html.replace(/<video\b[^>]*\bsrc=["']([^"']+)["'][^>]*\/?>/gi, (m, url) => {
    const idx = videos.length;
    videos.push(url);
    return `[[VID_${idx}]]`;
  });

  // 3. 提取 <a href="...">text</a>
  html = html.replace(/<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, url, text) => {
    const idx = links.length;
    const cleanText = (text || url).replace(/<[^>]*>/g, '');
    links.push({ url, text: cleanText });
    return `[[LINK_${idx}]]`;
  });

  // 4. 按 <br> 和 \n 分段
  const blocks = [];
  const lines = html.split(/<br\s*\/?>/i);
  lines.forEach((line, li) => {
    if (li > 0) blocks.push({ type: 'br' });
    const subLines = line.split(/\n/);
    subLines.forEach((sub, si) => {
      if (si > 0) blocks.push({ type: 'br' });
      if (!sub) return;
      parseLine(sub, images, videos, links, blocks);
    });
  });

  return blocks;
}

const TOKEN_RE = /\[\[IMG_(\d+)\]\]|\[\[VID_(\d+)\]\]|\[\[LINK_(\d+)\]\]|(https?:\/\/[^\s，。\n\r<>"']+)/gi;

function parseLine(line, images, videos, links, blocks) {
  let last = 0;
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(line)) !== null) {
    if (m.index > last) {
      const text = line.slice(last, m.index);
      if (text) blocks.push({ type: 'text', text });
    }
    if (m[1] !== undefined) {
      const url = images[parseInt(m[1], 10)];
      if (url) blocks.push({ type: 'image', url });
    } else if (m[2] !== undefined) {
      const url = videos[parseInt(m[2], 10)];
      if (url) blocks.push({ type: 'video', url });
    } else if (m[3] !== undefined) {
      const link = links[parseInt(m[3], 10)];
      if (link) blocks.push({ type: 'link', text: link.text, url: link.url });
    } else if (m[4]) {
      blocks.push({ type: 'link', text: m[4], url: m[4] });
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) {
    blocks.push({ type: 'text', text: line.slice(last) });
  }
}

module.exports = { parseRichContent };
