#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"

cd "${COZE_WORKSPACE_PATH}"

# ============================================================
# 转移 Node.js 缓存目录到 D 盘（避免 C 盘空间不足）
# ============================================================
export NPM_CONFIG_CACHE="D:/npm-cache"
export PNPM_HOME="D:/pnpm"
export PNPM_STORE_DIR="D:/pnpm-store"
export NEXT_TELEMETRY_DISABLED=1

# 确保 D 盘目录存在
mkdir -p "$NPM_CONFIG_CACHE" "$PNPM_HOME" "$PNPM_STORE_DIR"

# 设置 pnpm 的 store 路径
pnpm config set store-dir "$PNPM_STORE_DIR" --global 2>/dev/null || true

echo "Cache dirs configured:"
echo "  npm cache: $NPM_CONFIG_CACHE"
echo "  pnpm store: $PNPM_STORE_DIR"

echo "Installing dependencies..."
pnpm install --prefer-frozen-lockfile --prefer-offline --loglevel debug --reporter=append-only

echo "Building the Next.js project..."
pnpm next build

echo "Bundling server with tsup..."
pnpm tsup src/server.ts --format cjs --platform node --target node20 --outDir dist --no-splitting --no-minify

echo "Build completed successfully!"
