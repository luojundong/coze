/**
 * 浏览器端图片压缩工具
 *
 * 背景：Web 端把用户上传的图片（原图 URL）直接传给 Coze 工作流，Coze 的图片下载节点
 * 对外部 URL 有体积/超时限制。手机拍摄的“风景照片”常达 5-10MB，经网络传给 Coze 时
 * 容易超过其下载超时，报“下载图片链接超时”。Coze 自身输出在 TOS 上下载无此问题。
 *
 * 做法：上传前在浏览器端用 canvas 把图片压缩（典型 10MB → <500KB），Coze 秒级下载完成。
 * - 仅对 image/* 生效；非图片原样返回
 * - 小于阈值（默认 1.5MB）的原图直接上传，省去压缩耗时
 * - 超过最大边长（默认 2000px）等比缩放
 * - 统一输出 JPEG quality 0.85
 * 失败（如浏览器不支持 createImageBitmap / HEIC 解码失败）时回退为上传原图，不影响功能。
 */

export interface CompressOptions {
  maxDim?: number;
  quality?: number;
  minSizeBytes?: number;
}

export async function compressImageFile(file: File, options: CompressOptions = {}): Promise<File> {
  const maxDim = options.maxDim ?? 2000;
  const quality = options.quality ?? 0.85;
  const minSizeBytes = options.minSizeBytes ?? 1.5 * 1024 * 1024;

  // 仅在浏览器环境且支持相关 API 时压缩
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') {
    return file;
  }
  if (!file.type.startsWith('image/')) return file;
  if (file.size <= minSizeBytes) return file;

  try {
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;
    if (width > maxDim || height > maxDim) {
      const scale = Math.min(maxDim / width, maxDim / height);
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality)
    );
    if (!blob) return file;

    const baseName = (file.name || 'image').replace(/\.[^.]+$/, '') || 'image';
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } catch (e) {
    console.warn('[compressImageFile] 压缩失败，回退原图上传:', e);
    return file;
  }
}
