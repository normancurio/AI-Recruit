import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

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

/** 业务库 projects.recruitment_leads（见 migration_projects_recruitment_leads.sql） */
let bizProjectsRecruitmentLeads: boolean | null = null;
async function bizProjectsHaveRecruitmentLeads(pool: mysql.Pool): Promise<boolean> {
  if (bizProjectsRecruitmentLeads !== null) return bizProjectsRecruitmentLeads;
  try {
    await pool.query('SELECT recruitment_leads FROM projects LIMIT 1');
    bizProjectsRecruitmentLeads = true;
  } catch {
    bizProjectsRecruitmentLeads = false;
  }
  return bizProjectsRecruitmentLeads;
}

/** 业务库 jobs 是否已执行 migration_add_jobs_claimed_by.sql */
let jobsClaimedByCol: boolean | null = null;
async function jobsHaveClaimedBy(pool: mysql.Pool): Promise<boolean> {
  if (jobsClaimedByCol !== null) return jobsClaimedByCol;
  try {
    await pool.query('SELECT claimed_by FROM jobs LIMIT 1');
    jobsClaimedByCol = true;
  } catch {
    jobsClaimedByCol = false;
  }
  return jobsClaimedByCol;
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

/** 按 job_code 统计 resume_screenings 条数；表不存在时返回空 Map */
async function screeningCountsByJobCode(pool: mysql.Pool): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT job_code AS jc, COUNT(*) AS cnt FROM resume_screenings GROUP BY job_code'
    );
    for (const r of rows) {
      const k = String(r.jc ?? '').trim();
      if (k) map.set(k, Number(r.cnt) || 0);
    }
  } catch {
    // 未迁移 resume_screenings 时忽略
  }
  return map;
}

/** 与 server/index.ts 库表登录一致：salt:hex(scrypt) */
function hashAdminPassword(password: string): string {
  const salt = `adm_${crypto.randomBytes(12).toString('hex')}`;
  const hex = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hex}`;
}

function mysqlDupKey(err: unknown): boolean {
  return Boolean(
    err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'ER_DUP_ENTRY'
  );
}

const CN_MOBILE_LOGIN_USERNAME_RE = /^1[3-9]\d{9}$/;

/** 与「平台管理员」等：登录名允许字母账号；其余角色建议使用手机号 */
function roleAllowsNonMobileLoginUsername(role: string): boolean {
  const r = String(role || '').trim();
  return /平台管理员|系统管理|超级管理/i.test(r) || r === '管理员';
}

function assertLoginUsernameMatchesRole(username: string, role: string): string | null {
  if (roleAllowsNonMobileLoginUsername(role)) return null;
  const u = String(username || '').trim();
  if (!CN_MOBILE_LOGIN_USERNAME_RE.test(u)) {
    return '非管理员角色的登录账号须为 11 位中国大陆手机号（1 开头第二位 3–9）';
  }
  return null;
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
  /** 管理端扩展 API（登录、工作台、简历筛查等）由 server/index.ts 提供；本机开发时由下方反向代理转发 */
  const adminApiUpstream = (process.env.ADMIN_API_UPSTREAM || 'http://127.0.0.1:3001').replace(/\/$/, '');

  // /api/admin/* 需原样转发 body，不能先被 express.json() 消费
  app.use((req, res, next) => {
    if (req.originalUrl.startsWith('/api/admin')) {
      return next();
    }
    return express.json()(req, res, next);
  });

  app.all(/^\/api\/admin(\/.*)?$/i, (req, res) => {
    let target: URL;
    try {
      target = new URL(req.originalUrl, adminApiUpstream);
    } catch {
      res.status(500).json({ message: 'ADMIN_API_UPSTREAM 配置无效' });
      return;
    }
    const isHttps = target.protocol === 'https:';
    const lib = isHttps ? https : http;
    const defaultPort = isHttps ? 443 : 80;
    const opts: http.RequestOptions = {
      hostname: target.hostname,
      port: target.port || defaultPort,
      path: target.pathname + target.search,
      method: req.method,
      headers: { ...req.headers, host: target.host }
    };
    const proxyReq = lib.request(opts, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (err) => {
      console.error('[server.ts] /api/admin 代理失败 →', adminApiUpstream, err.message);
      if (!res.headersSent) {
        res.status(502).json({
          message:
            '管理扩展 API 未就绪：请在本机另开终端运行 npm run dev:api（默认端口 3001），或执行 npm run dev:full 同时启动前后台。也可设置环境变量 ADMIN_API_UPSTREAM 指向上游地址。'
        });
      }
    });
    req.pipe(proxyReq);
  });

  app.get('/favicon.ico', (_req, res) => {
    res.status(204).end();
  });

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
      const hasRl = await bizProjectsHaveRecruitmentLeads(bizPool);
      const projSql = hasUi
        ? hasRl
          ? `SELECT id, name, client, dept, manager, recruitment_leads, status, project_code, start_date, end_date, description, member_count, created_at, updated_at
             FROM projects ORDER BY updated_at DESC, id DESC`
          : `SELECT id, name, client, dept, manager, status, project_code, start_date, end_date, description, member_count, created_at, updated_at
             FROM projects ORDER BY updated_at DESC, id DESC`
        : hasRl
          ? `SELECT id, name, client, dept, manager, recruitment_leads, status, created_at, updated_at
             FROM projects ORDER BY updated_at DESC, id DESC`
          : `SELECT id, name, client, dept, manager, status, created_at, updated_at
             FROM projects ORDER BY updated_at DESC, id DESC`;
      const [projects] = await bizPool.query<any[]>(projSql);
      const hasClaim = await jobsHaveClaimedBy(bizPool);
      const jobsSql = hasClaim
        ? `SELECT project_id, job_code, title, department, jd_text, demand, location, skills, level, salary, recruiters, claimed_by, updated_at
           FROM jobs ORDER BY updated_at DESC, id DESC`
        : `SELECT project_id, job_code, title, department, jd_text, demand, location, skills, level, salary, recruiters, updated_at
           FROM jobs ORDER BY updated_at DESC, id DESC`;
      const [jobs] = await bizPool.query<any[]>(jobsSql);
      const screeningByJob = await screeningCountsByJobCode(bizPool);
      const mappedProjects = (projects || []).map((p) => {
        const jobMapped = (jobs || [])
          .filter((j) => String(j.project_id || '') === String(p.id || ''))
          .map((j) => {
            const jc = String(j.job_code || '');
            return {
              id: jc,
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
              updatedAt: fmtSqlDateTime(j.updated_at),
              screeningCount: screeningByJob.get(jc) ?? 0,
              ...(hasClaim ? { claimedBy: String(j.claimed_by || '').trim() } : {})
            };
          });
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
          ...(hasRl ? { recruitmentLeads: parseRecruiters(p.recruitment_leads) } : {}),
          jobs: jobMapped
        };
      });
      const unassignedJobs = (jobs || [])
        .filter((j) => !j.project_id)
        .map((j) => {
          const jc = String(j.job_code || '');
          return {
            id: jc,
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
            updatedAt: fmtSqlDateTime(j.updated_at),
            screeningCount: screeningByJob.get(jc) ?? 0,
            ...(hasClaim ? { claimedBy: String(j.claimed_by || '').trim() } : {})
          };
        });
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
      const [exists] = await bizPool.query<RowDataPacket[]>(
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
      const status = String(body?.status ?? '进行中').trim() || '进行中';
      const hasRl = await bizProjectsHaveRecruitmentLeads(bizPool);
      const leadsJson =
        hasRl && body?.recruitmentLeads !== undefined
          ? normalizeRecruitersForDb(body.recruitmentLeads)
          : null;
      if (hasUi) {
        if (hasRl && leadsJson !== null) {
          await bizPool.query(
            `INSERT INTO projects (id, name, client, dept, manager, recruitment_leads, status, project_code, start_date, end_date, description, member_count)
             VALUES (?,?,?,?,?,CAST(? AS JSON),?,?,?,?,?,?)`,
            [
              id,
              name,
              client,
              dept,
              manager,
              leadsJson,
              status,
              projectCode,
              startDate,
              endDate,
              description,
              memberCount
            ]
          );
        } else {
          await bizPool.query(
            `INSERT INTO projects (id, name, client, dept, manager, status, project_code, start_date, end_date, description, member_count)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [
              id,
              name,
              client,
              dept,
              manager,
              status,
              projectCode,
              startDate,
              endDate,
              description,
              memberCount
            ]
          );
        }
      } else {
        await bizPool.query(
          `INSERT INTO projects (id, name, client, dept, manager, status) VALUES (?,?,?,?,?,?)`,
          [id, name, client, dept, manager, status]
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

  app.patch('/api/projects/:projectId', async (req, res) => {
    try {
      const id = String(req.params.projectId || '').trim();
      if (!id || id === 'EMPTY' || id === 'UNASSIGNED') {
        res.status(400).json({ message: '无效的项目' });
        return;
      }
      const body = req.body as Record<string, unknown> | null;
      const name = String(body?.name ?? '').trim();
      if (!name) {
        res.status(400).json({ message: '项目名称必填' });
        return;
      }
      const hasUi = await bizProjectsHaveUiFields(bizPool);
      const hasRl = await bizProjectsHaveRecruitmentLeads(bizPool);
      const patches: string[] = [];
      const vals: unknown[] = [];
      patches.push('name=?');
      vals.push(name);
      if (body?.dept !== undefined) {
        patches.push('dept=?');
        vals.push(String(body.dept ?? '').trim() || null);
      }
      if (body?.client !== undefined) {
        patches.push('client=?');
        vals.push(String(body.client ?? '').trim() || null);
      }
      if (body?.manager !== undefined) {
        patches.push('manager=?');
        vals.push(String(body.manager ?? '').trim() || null);
      }
      if (body?.status !== undefined) {
        patches.push('status=?');
        vals.push(String(body.status ?? '').trim() || '进行中');
      }
      if (hasUi) {
        if (body?.projectCode !== undefined) {
          patches.push('project_code=?');
          vals.push(String(body.projectCode ?? '').trim() || null);
        }
        if (body?.startDate !== undefined) {
          const s =
            body.startDate != null && String(body.startDate).trim()
              ? String(body.startDate).slice(0, 10)
              : null;
          patches.push('start_date=?');
          vals.push(s);
        }
        if (body?.endDate !== undefined) {
          const s =
            body.endDate != null && String(body.endDate).trim() ? String(body.endDate).slice(0, 10) : null;
          patches.push('end_date=?');
          vals.push(s);
        }
        if (body?.description !== undefined) {
          patches.push('description=?');
          vals.push(
            body.description != null && String(body.description).trim() ? String(body.description) : null
          );
        }
        if (body?.memberCount !== undefined) {
          patches.push('member_count=?');
          vals.push(Math.max(0, Math.min(9999, Number(body.memberCount) || 0)));
        }
      }
      if (hasRl && body?.recruitmentLeads !== undefined) {
        patches.push('recruitment_leads=CAST(? AS JSON)');
        vals.push(normalizeRecruitersForDb(body.recruitmentLeads));
      }
      vals.push(id);
      const [hdr] = await bizPool.query<ResultSetHeader>(
        `UPDATE projects SET ${patches.join(', ')} WHERE id=?`,
        vals
      );
      if (!hdr.affectedRows) {
        res.status(404).json({ message: '项目不存在' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('[PATCH /api/projects/:projectId]', e);
      res.status(500).json({ message: 'db error' });
    }
  });

  app.delete('/api/projects/:projectId', async (req, res) => {
    try {
      const id = String(req.params.projectId || '').trim();
      if (!id || id === 'EMPTY' || id === 'UNASSIGNED') {
        res.status(400).json({ message: '无效的项目' });
        return;
      }
      const [hdr] = await bizPool.query<ResultSetHeader>('DELETE FROM projects WHERE id=?', [id]);
      if (!hdr.affectedRows) {
        res.status(404).json({ message: '项目不存在' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('[DELETE /api/projects/:projectId]', e);
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
      const hasClaim = await jobsHaveClaimedBy(bizPool);
      const initialClaim = null;
      if (hasClaim && initialClaim) {
        await bizPool.query(
          `INSERT INTO jobs (project_id, job_code, title, department, jd_text, demand, location, skills, level, salary, recruiters, claimed_by)
           VALUES (?,?,?,?,?,?,?,?,?,?, CAST(? AS JSON),?)`,
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
            recruitersJson,
            initialClaim
          ]
        );
      } else {
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
      }
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
      const recruitersJson =
        body?.recruiters !== undefined ? normalizeRecruitersForDb(body.recruiters) : undefined;

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
      if (recruitersJson !== undefined) {
        fields.push('recruiters=CAST(? AS JSON)');
        vals.push(recruitersJson);
      }
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

  app.post('/api/jobs/:jobCode/claim', async (req, res) => {
    try {
      const jobCode = String(req.params.jobCode || '').trim().toUpperCase();
      if (!jobCode) {
        res.status(400).json({ message: '岗位编码无效' });
        return;
      }
      const claimedBy = String(
        (req.body as Record<string, unknown> | null)?.claimedBy ??
          (req.body as Record<string, unknown> | null)?.claimed_by ??
          ''
      ).trim();
      if (!claimedBy) {
        res.status(400).json({ message: '请提供认领人姓名' });
        return;
      }
      const hasClaim = await jobsHaveClaimedBy(bizPool);
      if (!hasClaim) {
        res.status(503).json({ message: '认领功能需先执行 jobs claimed_by 数据库迁移' });
        return;
      }
      const [rows] = await bizPool.query<RowDataPacket[]>('SELECT claimed_by FROM jobs WHERE job_code=?', [
        jobCode
      ]);
      const row = rows[0] as { claimed_by?: unknown } | undefined;
      if (!row) {
        res.status(404).json({ message: '岗位不存在' });
        return;
      }
      const cur = row.claimed_by != null ? String(row.claimed_by).trim() : '';
      if (cur) {
        if (cur === claimedBy) {
          res.json({ ok: true });
          return;
        }
        res.status(409).json({ message: '该岗位已被其他招聘经理认领' });
        return;
      }
      await bizPool.query('UPDATE jobs SET claimed_by=? WHERE job_code=?', [claimedBy, jobCode]);
      res.json({ ok: true });
    } catch (e) {
      console.error('[POST /api/jobs/:jobCode/claim]', e);
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
      const [rows] = await adminPool.query(
        'SELECT * FROM depts ORDER BY level ASC, name ASC'
      );
      res.json(rows);
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.post('/api/depts', async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) {
      res.status(400).json({ message: '请填写部门名称' });
      return;
    }
    const parentId = String(b.parentId || b.parent_id || '').trim() || null;
    const manager = String(b.manager || '').trim() || '-';
    const count = Number(b.count);
    const ct = Number.isFinite(count) ? count : 0;
    let lv = 0;
    try {
      if (parentId) {
        const [prows] = await adminPool.query<RowDataPacket[]>(
          'SELECT id, level FROM depts WHERE id = ? LIMIT 1',
          [parentId]
        );
        if (!prows.length) {
          res.status(400).json({ message: '上级部门不存在，请刷新后重试' });
          return;
        }
        const pl = Number((prows[0] as { level?: number }).level) || 0;
        lv = pl + 1;
      } else {
        const level = Number(b.level);
        lv = Number.isFinite(level) ? Math.max(0, Math.min(99, level)) : 0;
      }
      const customId = String(b.id || '').trim();
      const id =
        customId ||
        `dept_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
      await adminPool.query(
        'INSERT INTO depts (id, parent_id, name, level, manager, count) VALUES (?, ?, ?, ?, ?, ?)',
        [id, parentId, name, lv, manager, ct]
      );
      res.status(201).json({ id });
    } catch (e) {
      if (mysqlDupKey(e)) {
        res.status(409).json({ message: '部门 id 已存在，请留空由系统自动生成或更换编号' });
        return;
      }
      const err = e as { code?: string; message?: string };
      if (err.code === 'ER_BAD_FIELD_ERROR' || String(err.message || '').includes('parent_id')) {
        res.status(503).json({
          message: 'depts 表缺少 parent_id 列，请执行 server/migration_depts_parent_id.sql 后重试'
        });
        return;
      }
      console.error('[POST /api/depts]', e);
      res.status(500).json({ message: 'db error' });
    }
  });

  app.patch('/api/depts/:id', async (req, res) => {
    const id = String(req.params.id || '').trim();
    const b = req.body || {};
    if (!id) {
      res.status(400).json({ message: '缺少部门 id' });
      return;
    }
    const patches: string[] = [];
    const vals: unknown[] = [];
    if (b.name !== undefined) {
      const name = String(b.name || '').trim();
      if (!name) {
        res.status(400).json({ message: '部门名称不能为空' });
        return;
      }
      patches.push('name = ?');
      vals.push(name);
    }
    if (b.level !== undefined) {
      const level = Number(b.level);
      patches.push('level = ?');
      vals.push(Number.isFinite(level) ? level : 0);
    }
    if (b.manager !== undefined) {
      patches.push('manager = ?');
      vals.push(String(b.manager || '').trim() || '-');
    }
    if (b.count !== undefined) {
      const count = Number(b.count);
      patches.push('count = ?');
      vals.push(Number.isFinite(count) ? count : 0);
    }
    if (patches.length === 0) {
      res.status(400).json({ message: '无有效更新字段' });
      return;
    }
    vals.push(id);
    try {
      const [hdr] = await adminPool.query<ResultSetHeader>(
        `UPDATE depts SET ${patches.join(', ')} WHERE id = ?`,
        vals
      );
      if (!hdr.affectedRows) {
        res.status(404).json({ message: '部门不存在' });
        return;
      }
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.delete('/api/depts/:id', async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) {
      res.status(400).json({ message: '缺少部门 id' });
      return;
    }
    try {
      try {
        const [[cnt]] = await adminPool.query<RowDataPacket[]>(
          'SELECT COUNT(*) AS n FROM depts WHERE parent_id = ?',
          [id]
        );
        const n = Number((cnt as { n?: number })?.n) || 0;
        if (n > 0) {
          res.status(400).json({ message: `该部门下仍有 ${n} 个子部门，请先删除或移走子部门` });
          return;
        }
      } catch {
        /* 无 parent_id 列时继续删除 */
      }
      const [hdr] = await adminPool.query<ResultSetHeader>('DELETE FROM depts WHERE id = ?', [id]);
      if (!hdr.affectedRows) {
        res.status(404).json({ message: '部门不存在' });
        return;
      }
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.get('/api/users', async (_req, res) => {
    try {
      const [rows] = await adminPool.query(
        'SELECT id, name, username, dept, role, status FROM users ORDER BY username ASC'
      );
      res.json(rows);
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.post('/api/users', async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const username = String(b.username || '').trim();
    const password = String(b.password || '');
    const dept = String(b.dept || '').trim() || '-';
    const role = String(b.role || '').trim() || '招聘人员';
    const status = String(b.status || '正常').trim();
    if (!name || !username) {
      res.status(400).json({ message: '请填写姓名与登录账号' });
      return;
    }
    if (!password) {
      res.status(400).json({ message: '请设置初始密码' });
      return;
    }
    if (status !== '正常' && status !== '停用') {
      res.status(400).json({ message: '状态须为「正常」或「停用」' });
      return;
    }
    const unameRule = assertLoginUsernameMatchesRole(username, role);
    if (unameRule) {
      res.status(400).json({ message: unameRule });
      return;
    }
    const id = String(b.id || '').trim() || `U${Date.now()}`;
    const hash = hashAdminPassword(password);
    try {
      await adminPool.query(
        'INSERT INTO users (id, name, username, dept, role, status, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, name, username, dept, role, status, hash]
      );
      res.status(201).json({ id });
    } catch (e) {
      if (mysqlDupKey(e)) {
        res.status(409).json({ message: '登录账号已存在' });
        return;
      }
      console.error('[POST /api/users]', e);
      res.status(500).json({ message: 'db error' });
    }
  });

  app.patch('/api/users/:id', async (req, res) => {
    const id = String(req.params.id || '').trim();
    const b = req.body || {};
    if (!id) {
      res.status(400).json({ message: '缺少用户 id' });
      return;
    }
    if (b.username !== undefined || b.role !== undefined) {
      try {
        const [curRows] = await adminPool.query<RowDataPacket[]>(
          'SELECT username, role FROM users WHERE id = ? LIMIT 1',
          [id]
        );
        const cur = curRows[0] as { username?: string; role?: string } | undefined;
        if (!cur) {
          res.status(404).json({ message: '用户不存在' });
          return;
        }
        const nextUsername =
          b.username !== undefined ? String(b.username || '').trim() : String(cur.username || '').trim();
        const nextRole =
          b.role !== undefined
            ? String(b.role || '').trim() || '招聘人员'
            : String(cur.role || '').trim() || '招聘人员';
        const unameRule = assertLoginUsernameMatchesRole(nextUsername, nextRole);
        if (unameRule) {
          res.status(400).json({ message: unameRule });
          return;
        }
      } catch {
        res.status(500).json({ message: 'db error' });
        return;
      }
    }
    const patches: string[] = [];
    const vals: unknown[] = [];
    if (b.name !== undefined) {
      const name = String(b.name || '').trim();
      if (!name) {
        res.status(400).json({ message: '姓名不能为空' });
        return;
      }
      patches.push('name = ?');
      vals.push(name);
    }
    if (b.username !== undefined) {
      const username = String(b.username || '').trim();
      if (!username) {
        res.status(400).json({ message: '登录账号不能为空' });
        return;
      }
      patches.push('username = ?');
      vals.push(username);
    }
    if (b.dept !== undefined) {
      patches.push('dept = ?');
      vals.push(String(b.dept || '').trim() || '-');
    }
    if (b.role !== undefined) {
      patches.push('role = ?');
      vals.push(String(b.role || '').trim() || '招聘人员');
    }
    if (b.status !== undefined) {
      const status = String(b.status).trim();
      if (status !== '正常' && status !== '停用') {
        res.status(400).json({ message: '状态须为「正常」或「停用」' });
        return;
      }
      patches.push('status = ?');
      vals.push(status);
    }
    if (b.password !== undefined && String(b.password).length > 0) {
      patches.push('password_hash = ?');
      vals.push(hashAdminPassword(String(b.password)));
    }
    if (patches.length === 0) {
      res.status(400).json({ message: '无有效更新字段' });
      return;
    }
    vals.push(id);
    try {
      const [hdr] = await adminPool.query<ResultSetHeader>(
        `UPDATE users SET ${patches.join(', ')} WHERE id = ?`,
        vals
      );
      if (!hdr.affectedRows) {
        res.status(404).json({ message: '用户不存在' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      if (mysqlDupKey(e)) {
        res.status(409).json({ message: '登录账号已存在' });
        return;
      }
      console.error('[PATCH /api/users]', e);
      res.status(500).json({ message: 'db error' });
    }
  });

  app.delete('/api/users/:id', async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) {
      res.status(400).json({ message: '缺少用户 id' });
      return;
    }
    try {
      const [hdr] = await adminPool.query<ResultSetHeader>('DELETE FROM users WHERE id = ?', [id]);
      if (!hdr.affectedRows) {
        res.status(404).json({ message: '用户不存在' });
        return;
      }
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.get('/api/roles', async (_req, res) => {
    try {
      const [rows] = await adminPool.query('SELECT * FROM roles ORDER BY id ASC');
      res.json(rows);
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.post('/api/roles', async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) {
      res.status(400).json({ message: '请填写角色名称' });
      return;
    }
    const id = String(b.id || '').trim() || `R${Date.now()}`;
    const desc = String(b.desc ?? '').trim();
    const users = Number(b.users);
    const u = Number.isFinite(users) ? users : 0;
    let menuKeysJson: string | null | undefined;
    if (b.menuKeys !== undefined) {
      if (b.menuKeys === null) menuKeysJson = null;
      else if (Array.isArray(b.menuKeys)) {
        const arr = (b.menuKeys as unknown[]).map((x) => String(x || '').trim()).filter(Boolean);
        menuKeysJson = JSON.stringify(arr);
      } else {
        res.status(400).json({ message: 'menuKeys 须为字符串数组或 null' });
        return;
      }
    }
    try {
      if (menuKeysJson !== undefined) {
        await adminPool.query(
          'INSERT INTO roles (id, name, `desc`, users, menu_keys) VALUES (?, ?, ?, ?, ?)',
          [id, name, desc, u, menuKeysJson]
        );
      } else {
        await adminPool.query('INSERT INTO roles (id, name, `desc`, users) VALUES (?, ?, ?, ?)', [
          id,
          name,
          desc,
          u
        ]);
      }
      res.status(201).json({ id });
    } catch (e) {
      if (mysqlDupKey(e)) {
        res.status(409).json({ message: '角色 id 已存在' });
        return;
      }
      console.error('[POST /api/roles]', e);
      res.status(500).json({ message: 'db error' });
    }
  });

  app.patch('/api/roles/:id', async (req, res) => {
    const id = String(req.params.id || '').trim();
    const b = req.body || {};
    if (!id) {
      res.status(400).json({ message: '缺少角色 id' });
      return;
    }
    const patches: string[] = [];
    const vals: unknown[] = [];
    if (b.name !== undefined) {
      const name = String(b.name || '').trim();
      if (!name) {
        res.status(400).json({ message: '角色名称不能为空' });
        return;
      }
      patches.push('name = ?');
      vals.push(name);
    }
    if (b.desc !== undefined) {
      patches.push('`desc` = ?');
      vals.push(String(b.desc ?? '').trim());
    }
    if (b.users !== undefined) {
      const users = Number(b.users);
      patches.push('users = ?');
      vals.push(Number.isFinite(users) ? users : 0);
    }
    if (b.menuKeys !== undefined) {
      if (b.menuKeys === null) {
        patches.push('menu_keys = ?');
        vals.push(null);
      } else if (Array.isArray(b.menuKeys)) {
        const arr = (b.menuKeys as unknown[]).map((x) => String(x || '').trim()).filter(Boolean);
        patches.push('menu_keys = ?');
        vals.push(JSON.stringify(arr));
      } else {
        res.status(400).json({ message: 'menuKeys 须为字符串数组或 null' });
        return;
      }
    }
    if (patches.length === 0) {
      res.status(400).json({ message: '无有效更新字段' });
      return;
    }
    vals.push(id);
    try {
      const [hdr] = await adminPool.query<ResultSetHeader>(
        `UPDATE roles SET ${patches.join(', ')} WHERE id = ?`,
        vals
      );
      if (!hdr.affectedRows) {
        res.status(404).json({ message: '角色不存在' });
        return;
      }
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.delete('/api/roles/:id', async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) {
      res.status(400).json({ message: '缺少角色 id' });
      return;
    }
    try {
      const [hdr] = await adminPool.query<ResultSetHeader>('DELETE FROM roles WHERE id = ?', [id]);
      if (!hdr.affectedRows) {
        res.status(404).json({ message: '角色不存在' });
        return;
      }
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.get('/api/menus', async (_req, res) => {
    try {
      const [rows] = await adminPool.query('SELECT * FROM menus ORDER BY level ASC, id ASC');
      res.json(rows);
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.post('/api/menus', async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) {
      res.status(400).json({ message: '请填写菜单名称' });
      return;
    }
    const id = String(b.id || '').trim() || `M${Date.now()}`;
    const type = String(b.type || '菜单').trim();
    const icon = String(b.icon || 'Menu').trim();
    const path = String(b.path || '').trim() || '/';
    const parentIdRaw = String(b.parentId || b.parent_id || '').trim() || null;
    let lv = 0;
    if (parentIdRaw) {
      try {
        const [prows] = await adminPool.query<RowDataPacket[]>(
          'SELECT level FROM menus WHERE id = ? LIMIT 1',
          [parentIdRaw]
        );
        if (!prows.length) {
          res.status(400).json({ message: '上级菜单不存在' });
          return;
        }
        lv = (Number((prows[0] as { level?: number }).level) || 0) + 1;
      } catch {
        res.status(500).json({ message: 'db error' });
        return;
      }
    } else {
      const level = Number(b.level);
      lv = Number.isFinite(level) ? level : 0;
    }
    try {
      await adminPool.query(
        'INSERT INTO menus (id, name, type, icon, path, parent_id, level) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, name, type, icon, path, parentIdRaw, lv]
      );
      res.status(201).json({ id });
    } catch (e) {
      if (mysqlDupKey(e)) {
        res.status(409).json({ message: '菜单 id 已存在' });
        return;
      }
      console.error('[POST /api/menus]', e);
      res.status(500).json({ message: 'db error' });
    }
  });

  app.patch('/api/menus/:id', async (req, res) => {
    const id = String(req.params.id || '').trim();
    const b = req.body || {};
    if (!id) {
      res.status(400).json({ message: '缺少菜单 id' });
      return;
    }
    const patches: string[] = [];
    const vals: unknown[] = [];
    if (b.name !== undefined) {
      const name = String(b.name || '').trim();
      if (!name) {
        res.status(400).json({ message: '菜单名称不能为空' });
        return;
      }
      patches.push('name = ?');
      vals.push(name);
    }
    if (b.type !== undefined) {
      patches.push('type = ?');
      vals.push(String(b.type || '').trim() || '菜单');
    }
    if (b.icon !== undefined) {
      patches.push('icon = ?');
      vals.push(String(b.icon || '').trim() || 'Menu');
    }
    if (b.path !== undefined) {
      patches.push('path = ?');
      vals.push(String(b.path || '').trim() || '/');
    }
    if (b.parentId !== undefined || b.parent_id !== undefined) {
      const raw = b.parentId !== undefined ? b.parentId : b.parent_id;
      const pid = raw == null || String(raw).trim() === '' ? null : String(raw).trim();
      if (pid === id) {
        res.status(400).json({ message: '上级菜单不能为自身' });
        return;
      }
      if (pid) {
        try {
          const [prows] = await adminPool.query<RowDataPacket[]>(
            'SELECT level FROM menus WHERE id = ? LIMIT 1',
            [pid]
          );
          if (!prows.length) {
            res.status(400).json({ message: '上级菜单不存在' });
            return;
          }
          const pl = Number((prows[0] as { level?: number }).level) || 0;
          patches.push('parent_id = ?');
          vals.push(pid);
          patches.push('level = ?');
          vals.push(pl + 1);
        } catch {
          res.status(500).json({ message: 'db error' });
          return;
        }
      } else {
        const level = Number(b.level);
        const nextLv = Number.isFinite(level) ? level : 0;
        patches.push('parent_id = ?');
        vals.push(null);
        patches.push('level = ?');
        vals.push(nextLv);
      }
    } else if (b.level !== undefined) {
      const level = Number(b.level);
      patches.push('level = ?');
      vals.push(Number.isFinite(level) ? level : 0);
    }
    if (patches.length === 0) {
      res.status(400).json({ message: '无有效更新字段' });
      return;
    }
    vals.push(id);
    try {
      const [hdr] = await adminPool.query<ResultSetHeader>(
        `UPDATE menus SET ${patches.join(', ')} WHERE id = ?`,
        vals
      );
      if (!hdr.affectedRows) {
        res.status(404).json({ message: '菜单不存在' });
        return;
      }
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: 'db error' });
    }
  });

  app.delete('/api/menus/:id', async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) {
      res.status(400).json({ message: '缺少菜单 id' });
      return;
    }
    try {
      const [hdr] = await adminPool.query<ResultSetHeader>('DELETE FROM menus WHERE id = ?', [id]);
      if (!hdr.affectedRows) {
        res.status(404).json({ message: '菜单不存在' });
        return;
      }
      res.json({ ok: true });
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
    const publicApi = String(
      process.env.MINIAPP_API_PUBLIC_URL || process.env.PUBLIC_API_BASE || ''
    )
      .trim()
      .replace(/\/$/, '');
    let spaIndexHtml: string | null = null;
    const loadSpaIndexHtml = (): string => {
      if (spaIndexHtml) return spaIndexHtml;
      const raw = fs.readFileSync(path.join(distPath, 'index.html'), 'utf8');
      if (publicApi) {
        const snip = `<script>window.__ADMIN_MINIAPP_API_BASE__=${JSON.stringify(publicApi)}</script>`;
        spaIndexHtml = raw.includes('</head>')
          ? raw.replace('</head>', `${snip}</head>`)
          : `${snip}${raw}`;
      } else {
        spaIndexHtml = raw;
      }
      return spaIndexHtml;
    };
    if (publicApi) {
      console.log(`[server.ts] 管理端将请求小程序 API：${publicApi}（来自 MINIAPP_API_PUBLIC_URL / PUBLIC_API_BASE）`);
    } else {
      console.warn(
        '[server.ts] 未设置 MINIAPP_API_PUBLIC_URL：管理端将使用构建期 VITE_API_BASE；若仍为 localhost，线上登录会 ERR_CONNECTION_REFUSED'
      );
    }
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.type('html').send(loadSpaIndexHtml());
    });
  }

  app.listen(uiPort, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${uiPort}`);
    console.log(`[server.ts] MySQL database (admin): ${adminDb}`);
    console.log(`[server.ts] MySQL database (biz): ${bizDb}`);
    console.log(`[server.ts] /api/admin → 代理到 ${adminApiUpstream}（需该端口有 server/index.ts 或设 ADMIN_API_UPSTREAM）`);
  });
}

startServer();
