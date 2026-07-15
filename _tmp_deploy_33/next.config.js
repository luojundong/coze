/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: process.cwd(),
    rules: {
      '*.node': { loaders: ['raw-loader'] },
    },
  },
  // outputFileTracingRoot: path.resolve(__dirname, '../../'),
  allowedDevOrigins: ['*.dev.coze.site'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
        pathname: '/**',
      },
    ],
  },
  // Node 24 + pnpm hoisted 模式兼容
  // bcryptjs 必须打包进构建产物，否则跨平台部署时 pnpm 的依赖隔离会导致路径解析失败
  serverExternalPackages: ['pg', 'pg-native'],
};

module.exports = nextConfig;
