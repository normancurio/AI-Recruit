import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const envLocalPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else {
  dotenv.config();
}

const adminDb = process.env.MYSQL_ADMIN_DATABASE || 'ai_recruit_admin';

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: adminDb,
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  queueLimit: 0
});

/** JSON 列在 mysql2 中可能已是数组；SQLite 时代是字符串 */
function parseRecruiters(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw) as unknown;
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function startServer() {
  try {
    await pool.query('SELECT 1');
  } catch (e) {
    console.error('[server.ts] MySQL 连接失败，请检查 .env.local 中 MYSQL_* 与库', adminDb);
    console.error(e);
    process.exit(1);
  }

  const app = express();
  /** 与 server/index.ts 的 PORT（默认 3001）分离，避免同时跑两套服务时端口冲突 */
  const uiPort = Number(process.env.ADMIN_UI_PORT || 3000);

  app.use(express.json());

  // --- API Routes（与 SQLite 版路径、响应结构一致）---

  app.get('/api/clients', async (_req, res) => {
    try {
      const [rows] = await pool.query('SELECT * FROM clients');
      res.json(rows);
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.get('/api/projects', async (_req, res) => {
    try {
      const [projects] = await pool.query('SELECT * FROM projects');
      const [jobs] = await pool.query('SELECT * FROM jobs');
      const result = (projects as Record<string, unknown>[]).map((p) => ({
        ...p,
        jobs: (jobs as Record<string, unknown>[])
          .filter((j) => j.project_id === p.id)
          .map((j) => ({
            ...j,
            recruiters: parseRecruiters(j.recruiters)
          }))
      }));
      res.json(result);
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.get('/api/resumes', async (_req, res) => {
    try {
      const [rows] = await pool.query('SELECT * FROM resumes');
      res.json(rows);
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.get('/api/applications', async (_req, res) => {
    try {
      const [rows] = await pool.query('SELECT * FROM applications');
      res.json(rows);
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.get('/api/depts', async (_req, res) => {
    try {
      const [rows] = await pool.query('SELECT * FROM depts');
      res.json(rows);
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.get('/api/users', async (_req, res) => {
    try {
      const [rows] = await pool.query('SELECT * FROM users');
      res.json(rows);
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.get('/api/roles', async (_req, res) => {
    try {
      const [rows] = await pool.query('SELECT * FROM roles');
      res.json(rows);
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.get('/api/menus', async (_req, res) => {
    try {
      const [rows] = await pool.query('SELECT * FROM menus');
      res.json(rows);
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { port: Number(process.env.ADMIN_UI_HMR_PORT || 24679) }
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(uiPort, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${uiPort}`);
    console.log(`[server.ts] MySQL database: ${adminDb}`);
  });
}

startServer();
