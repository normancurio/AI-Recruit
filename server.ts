import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import type { ResultSetHeader } from 'mysql2/promise';

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

/** 写入 jobs.recruiters（JSON 数组字符串） */
function normalizeRecruitersForDb(raw: unknown): string {
  if (raw === undefined || raw === null) return '[]';
  if (Array.isArray(raw)) return JSON.stringify(raw.map((x) => String(x)));
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return '[]';
    try {
      const p = JSON.parse(t) as unknown;
      if (Array.isArray(p)) return JSON.stringify(p.map((x) => String(x)));
    } catch {
      return JSON.stringify([t]);
    }
  }
  return '[]';
}

/** 业务库 projects 是否已执行 migration_projects_ui_fields.sql */
let bizProjectsUiFields: boolean | null = null;
async function bizProjectsHaveUiFields(pool: mysql.Pool): Promise<boolean> {
  if (bizProjectsUiFields !== null) return bizProjectsUiFields;
  try {
    await pool.query(
      'SELECT project_code, start_date, end_date, description, member_count FROM projects LIMIT 1'
    );
    bizProjectsUiFields = true;
  } catch {
    bizProjectsUiFields = false;
  }
  return bizProjectsUiFields;
}

function fmtSqlDate(v: unknown): string {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function fmtSqlDateTime(v: unknown): string {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    const d = v;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${h}:${min}`;
  }
  const s = String(v).replace('T', ' ');
  return s.length >= 16 ? s.slice(0, 16) : s;
}

function uniqRecruiterCountFromJobs(
  jobsMapped: Array<{ recruiters: string[] }>
): number {
  const s = new Set<string>();
  for (const j of jobsMapped) {
    for (const r of j.recruiters || []) {
      if (r) s.add(String(r));
    }
  }
  return s.size;
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
      const hasUi = await bizProjectsHaveUiFields(bizPool);
      const projSql = hasUi
        ? `SELECT id, name, client, dept, manager, status, project_code, start_date, end_date, description, member_count, created_at, updated_at
           FROM projects ORDER BY updated_at DESC, id DESC`
        : `SELECT id, name, client, dept, manager, status, created_at, updated_at
           FROM projects ORDER BY updated_at DESC, id DESC`;
      const [projects] = await bizPool.query<any[]>(projSql);
      const [jobs] = await bizPool.query<any[]>(
        `SELECT project_id, job_code, title, department, jd_text, demand, location, skills, level, salary, recruiters, updated_at
         FROM jobs ORDER BY updated_at DESC, id DESC`
      );
      const mappedProjects = (projects || []).map((p) => {
        const jobMapped = (jobs || [])
          .filter((j) => String(j.project_id || '') === String(p.id || ''))
          .map((j) => ({
            id: String(j.job_code || ''),
            project_id: String(p.id || ''),
            title: String(j.title || ''),
            demand: Number(j.demand) > 0 ? Number(j.demand) : 1,
            department: String(j.department || '-'),
            location: String(j.location || j.department || '-'),
            skills: String(j.skills || '见 JD'),
            level: String(j.level || '待评估'),
            salary: String(j.salary || '面议'),
            jdText: String(j.jd_text || '').trim(),
            recruiters: parseRecruiters(j.recruiters),
            updatedAt: fmtSqlDateTime(j.updated_at)
          }));
        const storedMembers = hasUi ? Number(p.member_count) || 0 : 0;
        const fromJobs = uniqRecruiterCountFromJobs(jobMapped);
        const memberCount = storedMembers > 0 ? storedMembers : fromJobs;
        return {
          id: String(p.id || ''),
          name: String(p.name || ''),
          client: String(p.client || '业务主库'),
          dept: String(p.dept || '-'),
          manager: String(p.manager || '-'),
          status: String(p.status || '进行中'),
          projectCode: hasUi && p.project_code ? String(p.project_code) : String(p.id || ''),
          startDate: hasUi ? fmtSqlDate(p.start_date) : fmtSqlDate(p.created_at),
          endDate: hasUi ? fmtSqlDate(p.end_date) : '',
          description: hasUi && p.description != null ? String(p.description) : '',
          memberCount,
          jobs: jobMapped
        };
      });
      const unassignedJobs = (jobs || [])
        .filter((j) => !j.project_id)
        .map((j) => ({
          id: String(j.job_code || ''),
          project_id: 'UNASSIGNED',
          title: String(j.title || ''),
          demand: Number(j.demand) > 0 ? Number(j.demand) : 1,
          department: String(j.department || '-'),
          location: String(j.location || j.department || '-'),
          skills: String(j.skills || '见 JD'),
          level: String(j.level || '待评估'),
          salary: String(j.salary || '面议'),
          jdText: String(j.jd_text || '').trim(),
          recruiters: parseRecruiters(j.recruiters),
          updatedAt: fmtSqlDateTime(j.updated_at)
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
          projectCode: 'UNASSIGNED',
          startDate: '',
          endDate: '',
          description: '',
          memberCount: 0,
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
          projectCode: '',
          startDate: '',
          endDate: '',
          description: '',
          memberCount: 0,
          jobs: []
        });
      }
      res.json(result);
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.post('/api/projects', async (req, res) => {
    try {
      const hasUi = await bizProjectsHaveUiFields(bizPool);
      const body = req.body as Record<string, unknown> | null;
      const id = String(body?.id ?? '').trim();
      const name = String(body?.name ?? '').trim();
      if (!id || !name) {
        res.status(400).json({ message: '项目编号与项目名称必填' });
        return;
      }
      if (id === 'EMPTY' || id === 'UNASSIGNED') {
        res.status(400).json({ message: '不能使用保留编号' });
        return;
      }
      const [exists] = await bizPool.query<Array<{ id: string }>>(
        'SELECT id FROM projects WHERE id=? LIMIT 1',
        [id]
      );
      if (exists.length > 0) {
        res.status(409).json({ message: '项目编号已存在' });
        return;
      }
      const dept = String(body?.dept ?? '').trim() || null;
      const client = String(body?.client ?? '').trim() || null;
      const manager = String(body?.manager ?? '').trim() || null;
      const projectCode = String(body?.projectCode ?? id).trim() || null;
      const startRaw = body?.startDate;
      const endRaw = body?.endDate;
      const startDate =
        startRaw != null && String(startRaw).trim()
          ? String(startRaw).slice(0, 10)
          : null;
      const endDate =
        endRaw != null && String(endRaw).trim() ? String(endRaw).slice(0, 10) : null;
      const description =
        body?.description != null && String(body.description).trim()
          ? String(body.description)
          : null;
      const memberCount = Math.max(0, Math.min(9999, Number(body?.memberCount) || 0));
      if (hasUi) {
        await bizPool.query(
          `INSERT INTO projects (id, name, client, dept, manager, status, project_code, start_date, end_date, description, member_count)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [
            id,
            name,
            client,
            dept,
            manager,
            '进行中',
            projectCode,
            startDate,
            endDate,
            description,
            memberCount
          ]
        );
      } else {
        await bizPool.query(
          `INSERT INTO projects (id, name, client, dept, manager, status) VALUES (?,?,?,?,?,?)`,
          [id, name, client, dept, manager, '进行中']
        );
      }
      res.status(201).json({ ok: true, id });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'ER_DUP_ENTRY') {
        res.status(409).json({ message: '项目编号已存在' });
        return;
      }
      console.error('[POST /api/projects]', e);
      res.status(500).json({ message: 'db error' });
    }
  });

  app.post('/api/jobs', async (req, res) => {
    try {
      const body = req.body as Record<string, unknown> | null;
      const title = String(body?.title || '').trim();
      let jobCode = String(body?.jobCode || '').trim().toUpperCase();
      if (!title) {
        res.status(400).json({ message: '岗位名称必填' });
        return;
      }
      if (!jobCode) {
        jobCode = `J${Date.now().toString(36).toUpperCase().slice(-10)}`;
      }
      const projectIdRaw = body?.projectId;
      const projectId =
        projectIdRaw === undefined || projectIdRaw === null || String(projectIdRaw).trim() === ''
          ? null
          : String(projectIdRaw).trim();
      if (projectId === 'UNASSIGNED' || projectId === 'EMPTY') {
        res.status(400).json({ message: '请选择有效项目或留空不关联' });
        return;
      }
      const department = String(body?.department || '').trim() || null;
      const jdText = String(body?.jdText || body?.jd || '').trim() || null;
      const rawDemand = Number(body?.demand);
      const demand =
        Number.isFinite(rawDemand) && rawDemand > 0 ? Math.min(Math.floor(rawDemand), 99999) : 1;
      const location = String(body?.location ?? '').trim() || null;
      const skills = String(body?.skills ?? '').trim() || null;
      const level = String(body?.level ?? '').trim() || null;
      const salary = String(body?.salary ?? '').trim() || null;
      const recruitersJson = normalizeRecruitersForDb(body?.recruiters);
      await bizPool.query(
        `INSERT INTO jobs (project_id, job_code, title, department, jd_text, demand, location, skills, level, salary, recruiters)
         VALUES (?,?,?,?,?,?,?,?,?,?, CAST(? AS JSON))`,
        [
          projectId,
          jobCode,
          title,
          department,
          jdText,
          demand,
          location,
          skills,
          level,
          salary,
          recruitersJson
        ]
      );
      res.status(201).json({ ok: true, jobCode });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'ER_DUP_ENTRY') {
        res.status(409).json({ message: '岗位编码已存在' });
        return;
      }
      if (code === 'ER_NO_REFERENCED_ROW_2') {
        res.status(400).json({ message: '所属项目不存在' });
        return;
      }
      console.error('[POST /api/jobs]', e);
      res.status(500).json({ message: 'db error' });
    }
  });

  app.patch('/api/jobs/:jobCode', async (req, res) => {
    try {
      const jobCode = String(req.params.jobCode || '').trim().toUpperCase();
      if (!jobCode) {
        res.status(400).json({ message: '岗位编码无效' });
        return;
      }
      const body = req.body as Record<string, unknown>;
      const title = String(body?.title ?? '').trim();
      if (!title) {
        res.status(400).json({ message: '岗位名称必填' });
        return;
      }
      const department = String(body?.department ?? '').trim();
      const jdText = body?.jdText !== undefined ? String(body.jdText) : '';
      const projectIdRaw = body?.projectId;
      let projectId: string | null | undefined;
      if (projectIdRaw === undefined) {
        projectId = undefined;
      } else if (projectIdRaw === null || String(projectIdRaw).trim() === '') {
        projectId = null;
      } else {
        const p = String(projectIdRaw).trim();
        if (p === 'UNASSIGNED' || p === 'EMPTY') {
          res.status(400).json({ message: '所属项目无效' });
          return;
        }
        projectId = p;
      }
      const rawDemand = Number(body?.demand);
      const demand =
        Number.isFinite(rawDemand) && rawDemand > 0 ? Math.min(Math.floor(rawDemand), 99999) : 1;
      const location = String(body?.location ?? '').trim();
      const skills = String(body?.skills ?? '').trim();
      const level = String(body?.level ?? '').trim();
      const salary = String(body?.salary ?? '').trim();
      const recruitersJson = normalizeRecruitersForDb(body?.recruiters);

      const fields: string[] = [];
      const vals: unknown[] = [];
      fields.push('title=?');
      vals.push(title);
      fields.push('department=?');
      vals.push(department || null);
      fields.push('jd_text=?');
      vals.push(jdText);
      if (projectId !== undefined) {
        fields.push('project_id=?');
        vals.push(projectId);
      }
      fields.push('demand=?');
      vals.push(demand);
      fields.push('location=?');
      vals.push(location || null);
      fields.push('skills=?');
      vals.push(skills || null);
      fields.push('level=?');
      vals.push(level || null);
      fields.push('salary=?');
      vals.push(salary || null);
      fields.push('recruiters=CAST(? AS JSON)');
      vals.push(recruitersJson);
      vals.push(jobCode);

      const [hdr] = await bizPool.query<ResultSetHeader>(
        `UPDATE jobs SET ${fields.join(', ')} WHERE job_code=?`,
        vals
      );
      if (!hdr.affectedRows) {
        res.status(404).json({ message: '岗位不存在' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'ER_NO_REFERENCED_ROW_2') {
        res.status(400).json({ message: '所属项目不存在' });
        return;
      }
      console.error('[PATCH /api/jobs]', e);
      res.status(500).json({ message: 'db error' });
    }
  });

  app.delete('/api/jobs/:jobCode', async (req, res) => {
    try {
      const jobCode = String(req.params.jobCode || '').trim().toUpperCase();
      if (!jobCode) {
        res.status(400).json({ message: '岗位编码无效' });
        return;
      }
      const [hdr] = await bizPool.query<ResultSetHeader>(
        'DELETE FROM jobs WHERE job_code=? LIMIT 1',
        [jobCode]
      );
      if (!hdr.affectedRows) {
        res.status(404).json({ message: '岗位不存在' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      const err = e as { code?: string; errno?: number };
      if (err.errno === 1451 || err.code === 'ER_ROW_IS_REFERENCED_2') {
        res.status(409).json({ message: '该岗位仍有关联数据，无法删除' });
        return;
      }
      console.error('[DELETE /api/jobs]', e);
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
