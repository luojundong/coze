import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { readFileSync, existsSync, createReadStream } from 'fs';
import { resolve, join, extname } from 'path';
import { readdir, unlink, rmdir, stat } from 'fs/promises';

// 手动加载 .env.production（pm2 启动时不会自动加载）
try {
  const envPath = resolve(process.cwd(), '.env.production');
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
} catch {
  console.warn('Warning: Could not load .env.production');
}

const dev = process.env.COZE_PROJECT_ENV !== 'PROD';
const hostname = process.env.LISTEN_HOST || '0.0.0.0';
const port = parseInt(process.env.PORT || '5000', 10);

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  // 服务器启动时写入 server_startup_at，用于检测服务重启
  // 使用 NOW() 而非 JS Date，确保与 coze_tokens 表中的时间时区一致
  // 独立 try-catch，失败不阻塞后续迁移
  try {
    const { execute } = await import('./lib/db');
    await execute(
      `INSERT INTO system_config (\`key\`, value, updated_at) VALUES ('server_startup_at', NOW(), NOW())
       ON DUPLICATE KEY UPDATE value = NOW(), updated_at = NOW()`
    );
    console.log(`[Startup] server_startup_at updated to NOW()`);
  } catch (err) {
    console.error('[Startup] Failed to write server_startup_at:', err);
  }

  // ====== 自动检查并执行数据库迁移 ======
  try {
    console.log('[Migration] Checking pending migrations...');
    const { getPool } = await import('./lib/db');
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      // 检查 credit_transactions 表是否有 idempotency_key 列
      const [colCheck] = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_transactions' AND COLUMN_NAME = 'idempotency_key'`
      );
      const colExists = ((colCheck as any[])[0]?.cnt ?? 0) > 0;

      if (!colExists) {
        console.log('[Migration] Adding idempotency_key column to credit_transactions...');
        await conn.execute(
          'ALTER TABLE `credit_transactions` ADD COLUMN `idempotency_key` VARCHAR(64) NULL'
        );
        console.log('[Migration] ✓ idempotency_key column added');
      } else {
        console.log('[Migration] idempotency_key column already exists');
      }

      // 检查索引
      const [idxCheck] = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_transactions' AND INDEX_NAME = 'idx_credit_idempotency_key'`
      );
      const idxExists = ((idxCheck as any[])[0]?.cnt ?? 0) > 0;

      if (!idxExists) {
        console.log('[Migration] Adding index idx_credit_idempotency_key...');
        await conn.execute(
          'ALTER TABLE `credit_transactions` ADD INDEX `idx_credit_idempotency_key` (`idempotency_key`)'
        );
        console.log('[Migration] ✓ idx_credit_idempotency_key index added');
      } else {
        console.log('[Migration] idx_credit_idempotency_key index already exists');
      }

      // 检查唯一约束索引
      const [uniqCheck] = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_transactions' AND INDEX_NAME = 'uniq_credit_idempotency_key'`
      );
      const uniqExists = ((uniqCheck as any[])[0]?.cnt ?? 0) > 0;

      if (!uniqExists) {
        console.log('[Migration] Adding unique index uniq_credit_idempotency_key...');
        await conn.execute(
          'ALTER TABLE `credit_transactions` ADD UNIQUE INDEX `uniq_credit_idempotency_key` (`idempotency_key`)'
        );
        console.log('[Migration] ✓ uniq_credit_idempotency_key unique index added');
      } else {
        console.log('[Migration] uniq_credit_idempotency_key unique index already exists');
      }

      // 创建 mini_home_config 表（首页按钮与内容配置）
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS mini_home_config (
          id INT PRIMARY KEY DEFAULT 1,
          contact_teacher_text VARCHAR(50) DEFAULT '联系老师',
          contact_teacher_icon VARCHAR(600) DEFAULT '',
          tutorial_text VARCHAR(50) DEFAULT '使用教程',
          tutorial_icon VARCHAR(600) DEFAULT '',
          share_text VARCHAR(50) DEFAULT '分享',
          share_icon VARCHAR(600) DEFAULT '',
          contact_teacher_content TEXT,
          updated_at DATETIME
        )
      `);
      await conn.execute(`INSERT IGNORE INTO mini_home_config (id) VALUES (1)`);
      console.log('[Migration] mini_home_config table ready');

      // 创建 conversations 表（对话记录）
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS conversations (
          id VARCHAR(36) NOT NULL,
          user_id VARCHAR(36) NOT NULL,
          tool_id VARCHAR(36) NOT NULL,
          coze_conversation_id VARCHAR(128) NULL,
          title VARCHAR(255) NULL,
          is_deleted TINYINT(1) NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_conv_user_id (user_id),
          INDEX idx_conv_tool_id (tool_id),
          INDEX idx_conv_user_tool (user_id, tool_id),
          INDEX idx_conv_user_tool_not_deleted (user_id, tool_id, is_deleted)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('[Migration] conversations table ready');

      // 创建 conversation_messages 表（对话消息）
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS conversation_messages (
          id VARCHAR(36) NOT NULL,
          conversation_id VARCHAR(36) NOT NULL,
          role VARCHAR(16) NOT NULL,
          content TEXT NOT NULL,
          content_type VARCHAR(32) NULL DEFAULT 'text',
          sort_order INT NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_msg_conv_id (conversation_id),
          INDEX idx_msg_created_at (created_at),
          INDEX idx_msg_conv_sort (conversation_id, sort_order),
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('[Migration] conversation_messages table ready');

      // 检查 conversation_messages 是否有 sort_order 列（已存在表的升级）
      const [msgColCheck] = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conversation_messages' AND COLUMN_NAME = 'sort_order'`
      );
      if (((msgColCheck as any[])[0]?.cnt ?? 0) === 0) {
        await conn.execute(
          'ALTER TABLE conversation_messages ADD COLUMN sort_order INT NOT NULL DEFAULT 0'
        );
        console.log('[Migration] ✓ conversation_messages.sort_order column added');
      }

      // 检查 activation_codes 表是否有 duration_type 列
      const [durColCheck] = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activation_codes' AND COLUMN_NAME = 'duration_type'`
      );
      if (((durColCheck as any[])[0]?.cnt ?? 0) === 0) {
        await conn.execute(
          `ALTER TABLE activation_codes ADD COLUMN duration_type VARCHAR(16) NULL COMMENT '用户激活有效期: 1day/7days/month/year/permanent'`
        );
        console.log('[Migration] ✓ activation_codes.duration_type column added');
      } else {
        console.log('[Migration] activation_codes.duration_type column already exists');
      }

      console.log('[Migration] All migrations checked ✓');
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('[Migration] Failed:', err);
  }

  // MIME 类型映射表
  const MIME_TYPES: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
    '.webm': 'audio/webm',
    '.flac': 'audio/flac',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mpeg': 'video/mpeg',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  };

  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);

      // 静态文件服务：拦截 /uploads/ 请求，直接从 public/uploads/ 提供文件
      // 因为 Next.js 生产模式下 public/ 不会自动被 .next 包含
      if (parsedUrl.pathname && parsedUrl.pathname.startsWith('/uploads/')) {
        // 使用 __dirname 推导项目根目录（dist/server.js 在 dist/ 下，项目根在上层）
        const projectRoot = resolve(__dirname, '..');
        const uploadsDir = join(projectRoot, 'public', 'uploads');
        console.log(`[Static] Serving ${parsedUrl.pathname} from ${uploadsDir}`);
        // 安全校验：防止目录遍历攻击
        const relativePath = parsedUrl.pathname.replace('/uploads/', '');
        const safePath = resolve(uploadsDir, relativePath);

        // 确保解析后的路径在 uploadsDir 内
        if (!safePath.startsWith(uploadsDir)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }

        try {
          const fileStat = await stat(safePath);
          if (!fileStat.isFile()) {
            res.statusCode = 404;
            res.end('Not Found');
            return;
          }

          const ext = extname(safePath).toLowerCase();
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';

          // 支持 Range 请求（用于音频/视频的 seek 播放）
          const fileSize = fileStat.size;
          const rangeHeader = req.headers.range;

          if (rangeHeader) {
            const parts = rangeHeader.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = end - start + 1;

            res.statusCode = 206;
            res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Content-Length', chunkSize);
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'public, max-age=86400');

            const readStream = createReadStream(safePath, { start, end });
            readStream.pipe(res);
            readStream.on('error', () => {
              res.statusCode = 500;
              res.end('Stream Error');
            });
          } else {
            res.statusCode = 200;
            res.setHeader('Content-Length', fileSize);
            res.setHeader('Content-Type', contentType);
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Cache-Control', 'public, max-age=86400');

            const readStream = createReadStream(safePath);
            readStream.pipe(res);
            readStream.on('error', () => {
              res.statusCode = 500;
              res.end('Stream Error');
            });
          }
        } catch {
          // 文件不存在
          res.statusCode = 404;
          res.end('Not Found');
        }
        return;
      }

      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  server.once('error', err => {
    console.error(err);
    process.exit(1);
  });

  // ====== 定时清理 uploads 目录 ======
  const projectRoot = resolve(__dirname, '..');
  const UPLOADS_DIR = join(projectRoot, 'public', 'uploads');

  // 持久内容目录（按钮图标 icon、公告/教程内容 content 等），不参与 uploads 定时清理
  const SKIP_UPLOAD_DIRS = new Set(['icon', 'content', 'static', 'avatar']);

  async function cleanOldUploads() {
    if (!existsSync(UPLOADS_DIR)) return;

    const now = Date.now();
    const YESTERDAY_MS = 24 * 60 * 60 * 1000;
    // 删除修改时间在 24 小时之前的文件（即前天的及更早的）
    const cutoff = now - YESTERDAY_MS;

    try {
      const categories = await readdir(UPLOADS_DIR, { withFileTypes: true });
      let deletedCount = 0;
      let deletedSize = 0;

      for (const cat of categories) {
        if (!cat.isDirectory()) continue;
        // 跳过持久内容目录，避免误删长期使用的图标与内容图片/视频
        if (SKIP_UPLOAD_DIRS.has(cat.name)) continue;
        const catDir = join(UPLOADS_DIR, cat.name);
        const files = await readdir(catDir, { withFileTypes: true });

        for (const f of files) {
          if (!f.isFile()) continue;
          const filePath = join(catDir, f.name);
          try {
            const { stat } = await import('fs/promises');
            const fileStat = await stat(filePath);
            if (fileStat.mtimeMs < cutoff) {
              deletedSize += fileStat.size;
              await unlink(filePath);
              deletedCount++;
            }
          } catch {
            // 单个文件删除失败不影响其他文件
          }
        }

        // 如果目录为空，删除目录
        try {
          const remaining = await readdir(catDir);
          if (remaining.length === 0) {
            await rmdir(catDir);
          }
        } catch { /* ignore */ }
      }

      if (deletedCount > 0) {
        const sizeMB = (deletedSize / 1024 / 1024).toFixed(2);
        console.log(`[Cleanup] 已清理 ${deletedCount} 个过期上传文件 (${sizeMB} MB)`);
      }
    } catch (err) {
      console.error('[Cleanup] uploads 清理出错:', err);
    }
  }

  // ====== 定时清理 downloads 目录（媒体下载文件）======
  // 删除「前天」及更早的文件（保留今天与昨天），避免磁盘无限增长
  const DOWNLOAD_DIR = join(projectRoot, 'public', 'download');

  async function cleanOldDownloads() {
    if (!existsSync(DOWNLOAD_DIR)) return;

    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(now.getDate() - 2); // 前天
    cutoff.setHours(0, 0, 0, 0);       // 前天 00:00:00
    const cutoffMs = cutoff.getTime();

    try {
      const files = await readdir(DOWNLOAD_DIR, { withFileTypes: true });
      let deletedCount = 0;
      let deletedSize = 0;

      for (const f of files) {
        if (!f.isFile()) continue;
        const filePath = join(DOWNLOAD_DIR, f.name);
        try {
          const { stat } = await import('fs/promises');
          const fileStat = await stat(filePath);
          if (fileStat.mtimeMs < cutoffMs) {
            deletedSize += fileStat.size;
            await unlink(filePath);
            deletedCount++;
          }
        } catch {
          // 单个文件删除失败不影响其他文件
        }
      }

      if (deletedCount > 0) {
        const sizeMB = (deletedSize / 1024 / 1024).toFixed(2);
        console.log(`[Cleanup] 已清理 ${deletedCount} 个过期下载文件 (${sizeMB} MB，前天及更早)`);
      }
    } catch (err) {
      console.error('[Cleanup] download 清理出错:', err);
    }
  }

  // ====== 定时清理过期对话记录 ======
  // 注意：用户端在工具页只展示最近 24 小时的对话（由各 API 的 created_at > 24h 过滤实现），
  // 但后台"对话记录管理"需要保留更长时间的历史用于审计/查看，因此这里只做超长期归档清理，
  // 默认保留 90 天（可通过环境变量 CONVERSATION_RETENTION_DAYS 覆盖）。
  const CONVERSATION_RETENTION_DAYS = Math.max(
    1,
    parseInt(process.env.CONVERSATION_RETENTION_DAYS || '90', 10) || 90
  );
  async function cleanOldConversations() {
    try {
      const { getPool } = await import('./lib/db');
      const pool = getPool();
      const conn = await pool.getConnection();
      try {
        // 物理删除超过保留期的对话（CASCADE 自动清理关联消息）
        const [delResult] = await conn.execute(
          `DELETE FROM conversations WHERE created_at < DATE_SUB(NOW(), INTERVAL ${CONVERSATION_RETENTION_DAYS} DAY)`
        );
        const deletedCount = (delResult as any)?.affectedRows ?? 0;
        if (deletedCount > 0) {
          console.log(`[Cleanup] 已清理 ${deletedCount} 条超过 ${CONVERSATION_RETENTION_DAYS} 天的对话记录`);
        }
      } finally {
        conn.release();
      }
    } catch (err) {
      console.error('[Cleanup] 对话记录清理出错:', err);
    }
  }

  // 计算到下一个凌晨的时间
  function msUntilMidnight(): number {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0); // 明天 00:00:00
    return midnight.getTime() - now.getTime();
  }

  // 启动后等到第一个凌晨执行，之后每 24 小时执行一次
  const firstDelay = msUntilMidnight();
  const minutesToMidnight = Math.round(firstDelay / 1000 / 60);
  console.log(`[Cleanup] uploads/downloads/conversations 清理将在 ${minutesToMidnight} 分钟后首次执行`);

  // 对话记录清理：每 1 小时执行一次（仅清理超过保留期的历史归档）
  setInterval(() => {
    cleanOldConversations();
  }, 60 * 60 * 1000);

  // 启动后 5 分钟执行首次清理
  setTimeout(() => {
    cleanOldConversations();
  }, 5 * 60 * 1000);

  setTimeout(() => {
    cleanOldUploads();
    cleanOldDownloads();
    // 之后每 24 小时执行一次
    setInterval(() => {
      cleanOldUploads();
      cleanOldDownloads();
    }, 24 * 60 * 60 * 1000);
  }, firstDelay);

  server.listen(port, () => {
    console.log(
      `> Server listening at http://${hostname}:${port} as ${
        dev ? 'development' : process.env.COZE_PROJECT_ENV
      }`,
    );
  });
});
