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
const bizDb = process.env.MYSQL_DATABASE || 'ai_recruit';

const adminPool = mysql.createPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: adminDb,
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  queueLimit: 0
});

const bizPool = mysql.createPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: bizDb,
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  queueLimit: 0
});

/** jobs.recruiters JSON 列：mysql2 可能返回数组 / 字符串 */
function parseRecruiters(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) {
    try {
      const p = JSON.parse(raw.toString('utf8')) as unknown
      return Array.isArray(p) ? p.map(String) : []
    } catch {
      return []
    }
  }
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw) as unknown
      return Array.isArray(p) ? p.map(String) : []
    } catch {
      return []
    }
  }
  return []
}

async function startServer() {
  try {
    await adminPool.query('SELECT 1');
    await bizPool.query('SELECT 1');
  } catch (e) {
    console.error('[server.ts] MySQL 连接失败，请检查 .env.local 中 MYSQL_* 与库', { adminDb, bizDb });
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
      const [rows] = await adminPool.query('SELECT * FROM clients');
      res.json(rows);
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.get('/api/projects', async (_req, res) => {
    try {
      const [projects] = await bizPool.query<any[]>(
        'SELECT id, name, client, dept, manager, status FROM projects ORDER BY updated_at DESC, id DESC'
      );
      const [jobs] = await bizPool.query<any[]>(
        `SELECT project_id, job_code, title, department, jd_text, demand, location, skills, level, salary, recruiters, updated_at
         FROM jobs ORDER BY updated_at DESC, id DESC`
      );
      const mappedProjects = (projects || []).map((p) => ({
        id: String(p.id || ''),
        name: String(p.name || ''),
        client: String(p.client || '业务主库'),
        dept: String(p.dept || '-'),
        manager: String(p.manager || '-'),
        status: String(p.status || '进行中'),
        jobs: (jobs || [])
          .filter((j) => String(j.project_id || '') === String(p.id || ''))
          .map((j) => ({
            id: String(j.job_code || ''),
            project_id: String(p.id || ''),
            title: String(j.title || ''),
            demand: Number(j.demand) > 0 ? Number(j.demand) : 1,
            location: String(j.location || j.department || '-'),
            skills: String(j.skills || '见 JD'),
            level: String(j.level || '待评估'),
            salary: String(j.salary || '面议'),
            jdText: String(j.jd_text || '').trim(),
            recruiters: parseRecruiters(j.recruiters)
          }))
      }));
      const unassignedJobs = (jobs || [])
        .filter((j) => !j.project_id)
        .map((j) => ({
          id: String(j.job_code || ''),
          project_id: 'UNASSIGNED',
          title: String(j.title || ''),
          demand: Number(j.demand) > 0 ? Number(j.demand) : 1,
          location: String(j.location || j.department || '-'),
          skills: String(j.skills || '见 JD'),
          level: String(j.level || '待评估'),
          salary: String(j.salary || '面议'),
          jdText: String(j.jd_text || '').trim(),
          recruiters: parseRecruiters(j.recruiters)
        }));
      const result = [...mappedProjects];
      if (unassignedJobs.length > 0) {
        result.push({
          id: 'UNASSIGNED',
          name: '未分配项目岗位',
          client: '业务主库',
          dept: '招聘中心',
          manager: '系统同步',
          status: '待归档',
          jobs: unassignedJobs
        });
      }
      if (result.length === 0) {
        result.push({
          id: 'EMPTY',
          name: '业务库岗位（ai_recruit）',
          client: '业务主库',
          dept: '招聘中心',
          manager: '系统同步',
          status: '进行中',
          jobs: []
        });
      }
      res.json(result);
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.get('/api/resumes', async (_req, res) => {
    try {
      const [rows] = await adminPool.query('SELECT * FROM resumes');
      res.json(rows);
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.get('/api/applications', async (_req, res) => {
    try {
      const [rows] = await adminPool.query('SELECT * FROM applications');
      res.json(rows);
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.get('/api/depts', async (_req, res) => {
    try {
      const [rows] = await adminPool.query('SELECT * FROM depts');
      res.json(rows);
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.get('/api/users', async (_req, res) => {
    try {
      const [rows] = await adminPool.query('SELECT * FROM users');
      res.json(rows);
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.get('/api/roles', async (_req, res) => {
    try {
      const [rows] = await adminPool.query('SELECT * FROM roles');
      res.json(rows);
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.get('/api/menus', async (_req, res) => {
    try {
      const [rows] = await adminPool.query('SELECT * FROM menus');
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
    console.log(`[server.ts] MySQL database (admin): ${adminDb}`);
    console.log(`[server.ts] MySQL database (biz): ${bizDb}`);
  });
}

startServer();
