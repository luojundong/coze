/**
 * Standalone 模式启动脚本
 * 1. 加载 .env.production 环境变量
 * 2. 写入数据库 server_startup_at（检测服务重启）
 * 3. 切换到 standalone 目录并启动 Next.js
 */
const { resolve, join } = require('path');
const { readFileSync, existsSync } = require('fs');

// 加载 .env.production
try {
  const envPath = resolve(process.cwd(), '.env.production');
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.substring(0, eqIdx).trim();
      const value = trimmed.substring(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
    console.log('[Startup] Loaded .env.production');
  }
} catch (err) {
  console.warn('[Startup] Warning: Could not load .env.production:', err.message);
}

// 切换到 standalone 目录
const standaloneDir = resolve(__dirname, '..', '.next', 'standalone');
process.chdir(standaloneDir);

// 写入数据库启动时间（异步，不阻塞服务启动）
setTimeout(() => {
  try {
    const mysql = require(join(standaloneDir, 'node_modules', 'mysql2', 'promise'));
    const pool = mysql.createPool({
      host: process.env.MYSQL_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT || '3306', 10),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'coze_workflow',
      charset: 'utf8mb4',
      waitForConnections: true,
      connectionLimit: 2,
      queueLimit: 0,
    });
    pool.execute(
      `INSERT INTO system_config (\`key\`, value, updated_at) VALUES ('server_startup_at', NOW(), NOW())
       ON DUPLICATE KEY UPDATE value = NOW(), updated_at = NOW()`
    ).then(() => {
      console.log('[Startup] server_startup_at updated to NOW()');
    }).catch(err => {
      console.error('[Startup] Failed to write server_startup_at:', err.message);
    }).finally(() => {
      pool.end();
    });
  } catch (err) {
    console.error('[Startup] DB init error:', err.message);
  }
}, 2000);

// 启动 standalone server
require('./server.js');
