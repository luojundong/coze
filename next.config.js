/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: process.cwd(),
    rules: {
      '*.node': { loaders: ['raw-loader'] },
    },
  },
  // pg 仅由 drizzle-orm/pg-core 间接引入（运行态实际用 mysql2），
  // Turbopack 在 Node24/pnpm 下会错误地把 pg 外部化且无法生成外部包装模块，导致构建失败。
  // 用 transpilePackages 强制走打包通道，并将可选的 pg-native 外部化（缺失时 pg 自动回退 JS）。
  transpilePackages: ['pg'],
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
  serverExternalPackages: ['pg-native'],
};

module.exports = nextConfig;
