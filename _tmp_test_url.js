const content = `已为你生成固定镜头治愈乡村夜景视频，链接如下：https://coze-dianbo.tos-cn-beijing.volces.com/3375a5588e5c4020a8661a4f2e3eb220.mp4?X-Tos-Algorithm=TOS4-HMAC-SHA256&X-Tos-Credential=AKL&X-Tos-Date=20260701T021422Z&X-Tos-Expires=86400&X-Tos-Signature=d6efe3efcccb4fa9ce30870eff6ab1e0`;

const bareUrlRe = /(?<!["'(])(https?:\/\/[^\s<>"')\]]+)/gi;
const matches = [...content.matchAll(bareUrlRe)];
console.log('bareUrlRe matches count:', matches.length);
matches.forEach(m => console.log('  URL:', m[0].substring(0, 80) + '...'));

const nonImageExtRe = /\.(mp4|avi|mov|mkv|wmv|flv|webm|m4v|mp3|wav|ogg|aac|flac|pdf|docx?|xlsx?|pptx?|zip|rar|7z)(\?.*)?$/i;
const imageUrlPatterns = [
  /\/\/p9-.*\.byteimg\.com\//,
  /\/\/.*\.coze\.(cn|com)\/.*\/image/i,
  /\/\/.*\.volccdn\.com\//,
  /\/\/.*\/tos-.*\//,
  /\/api\/.*\/image/i,
];

const url = matches[0] ? matches[0][0] : '';
console.log('\\nURL captured:', url.substring(0, 80) + '...');
console.log('nonImageExtRe match (should be true for .mp4):', nonImageExtRe.test(url));
console.log('imageUrlPatterns match:');
imageUrlPatterns.forEach(r => console.log(' ', r.source, '->', r.test(url)));
console.log('\\nisImageUrl result:', (() => {
  if (/\.(png|jpe?g|gif|webp|bmp|svg|ico)(\?.*)?$/i.test(url)) return true;
  if (nonImageExtRe.test(url)) return false;
  return imageUrlPatterns.some(r => r.test(url));
})());
