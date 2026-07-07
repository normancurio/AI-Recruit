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
import multer from 'multer';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  normalizeJobLevel,
  normalizeJobTitle,
  jobLevelValidationMessage,
  jobTitleValidationMessage
} from './shared/jobTaxonomy';
import { createResilientMysqlPool } from './shared/mysqlResilientPool';
import {
  defaultQwenPlusModel,
  isQwenPlusModelQuotaExhausted,
  qwenPlusModelFallbackFor
} from './shared/qwenModelConfig';

const envLocalPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else {
  dotenv.config();
}

const adminDb = process.env.MYSQL_ADMIN_DATABASE || 'ai_recruit_admin';
const bizDb = process.env.MYSQL_DATABASE || 'ai_recruit';

const adminPool = createResilientMysqlPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: adminDb,
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  queueLimit: 0
});

const bizPool = createResilientMysqlPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: bizDb,
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  queueLimit: 0
});

const projectTemplateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }
});

const RESUME_STORAGE_DIR = (() => {
  const fromEnv = process.env.RESUME_STORAGE_DIR?.trim();
  if (!fromEnv) return path.resolve(process.cwd(), 'storage', 'resumes');
  return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv);
})();

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

function normalizeMultipartFilename(raw: string): string {
  const decoded = Buffer.from(String(raw || ''), 'latin1').toString('utf8');
  const picked = /[\u4e00-\u9fff]/.test(decoded) ? decoded : String(raw || '');
  return picked.replace(/[\\/:*?"<>|\r\n]+/g, '_').trim();
}

function safeStorageExt(fileName: string): string {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (ext && /^[.\w-]{1,16}$/.test(ext)) return ext;
  return '.bin';
}

function saveProjectResumeTemplateFile(file: { buffer: Buffer; originalname?: string; mimetype?: string }): {
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
} {
  fs.mkdirSync(RESUME_STORAGE_DIR, { recursive: true });
  const originalName =
    normalizeMultipartFilename(file.originalname || 'resume-template.docx').slice(0, 255) || 'resume-template.docx';
  const ext = safeStorageExt(originalName);
  const storageKey = `project-template-${Date.now()}-${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(RESUME_STORAGE_DIR, storageKey), file.buffer);
  return {
    storageKey,
    originalName,
    mimeType: String(file.mimetype || 'application/octet-stream').trim() || 'application/octet-stream',
    sizeBytes: Number(file.buffer?.length || 0)
  };
}

type GenerateJdPayload = { title: string; level: string; location?: string; salary?: string };

type InterviewFollowUpConfig = {
  enabled: boolean;
  maxPerInterview: number;
  maxPerQuestion: number;
  modelWaitMs: number;
  shortAnswerThreshold: number;
  fallbackEnabled: boolean;
  model: string;
  prompt: string;
};

const DEFAULT_FOLLOW_UP_PROMPT = [
  '你是结构化技术面试里的追问面试官。你的任务不是评价答案是否充分，而是从候选人的回答里继续追深一层，验证真实性、深度和个人贡献。',
  '只要候选人回答了有效内容，默认 should_follow_up=true，并生成 1 个具体追问。',
  '优先围绕回答中出现的项目、技术方案、难点、指标结果、个人职责、协作取舍、失败复盘来追问；追问要锚定候选人刚才说过的具体信息。',
  '只有以下情况才返回 should_follow_up=false：回答为空；明显只是复述题目或读题回声；只说“不知道/没有/不会”且无法继续追；回答完全无法理解。',
  '不要问泛泛的“能否展开说说”；不要重复原题；不要一次问多个问题；不要输出解释。',
  '只返回 JSON：{"should_follow_up": boolean, "question": string}。question 控制在 15-45 个中文字符。'
].join('\n');

const DEFAULT_FOLLOW_UP_CONFIG: InterviewFollowUpConfig = {
  enabled: true,
  maxPerInterview: 3,
  maxPerQuestion: 1,
  modelWaitMs: 700,
  shortAnswerThreshold: 18,
  fallbackEnabled: true,
  model: '',
  prompt: DEFAULT_FOLLOW_UP_PROMPT
};

function sanitizeFollowUpConfig(raw: Partial<InterviewFollowUpConfig> = {}): InterviewFollowUpConfig {
  const clampInt = (v: unknown, fallback: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
  };
  return {
    enabled: raw.enabled !== undefined ? Boolean(raw.enabled) : DEFAULT_FOLLOW_UP_CONFIG.enabled,
    maxPerInterview: clampInt(raw.maxPerInterview, DEFAULT_FOLLOW_UP_CONFIG.maxPerInterview, 0, 10),
    maxPerQuestion: clampInt(raw.maxPerQuestion, DEFAULT_FOLLOW_UP_CONFIG.maxPerQuestion, 0, 1),
    modelWaitMs: clampInt(raw.modelWaitMs, DEFAULT_FOLLOW_UP_CONFIG.modelWaitMs, 0, 5000),
    shortAnswerThreshold: clampInt(raw.shortAnswerThreshold, DEFAULT_FOLLOW_UP_CONFIG.shortAnswerThreshold, 2, 80),
    fallbackEnabled:
      raw.fallbackEnabled !== undefined ? Boolean(raw.fallbackEnabled) : DEFAULT_FOLLOW_UP_CONFIG.fallbackEnabled,
    model: String(raw.model || '').trim().slice(0, 80),
    prompt: String(raw.prompt || DEFAULT_FOLLOW_UP_PROMPT).trim().slice(0, 4000) || DEFAULT_FOLLOW_UP_PROMPT
  };
}

function followUpConfigForJson(config: InterviewFollowUpConfig) {
  return { ...config };
}

function followUpConfigFromRow(row: Record<string, unknown> | null | undefined): InterviewFollowUpConfig {
  if (!row) return { ...DEFAULT_FOLLOW_UP_CONFIG };
  return sanitizeFollowUpConfig({
    enabled: Number(row.enabled) !== 0,
    maxPerInterview: Number(row.max_per_interview),
    maxPerQuestion: Number(row.max_per_question),
    modelWaitMs: Number(row.model_wait_ms),
    shortAnswerThreshold: Number(row.short_answer_threshold),
    fallbackEnabled: Number(row.fallback_enabled) !== 0,
    model: String(row.model || ''),
    prompt: String(row.prompt || '')
  });
}

async function loadSystemFollowUpConfig(): Promise<InterviewFollowUpConfig> {
  try {
    const [rows] = await bizPool.query<any[]>(
      `SELECT enabled, max_per_interview, max_per_question, model_wait_ms,
              short_answer_threshold, fallback_enabled, model, prompt
       FROM interview_followup_settings WHERE id=1 LIMIT 1`
    );
    return followUpConfigFromRow(rows[0]);
  } catch {
    return { ...DEFAULT_FOLLOW_UP_CONFIG };
  }
}

async function saveSystemFollowUpConfig(raw: unknown): Promise<InterviewFollowUpConfig> {
  const config = sanitizeFollowUpConfig((raw || {}) as Partial<InterviewFollowUpConfig>);
  await bizPool.query(
    `INSERT INTO interview_followup_settings
       (id, enabled, max_per_interview, max_per_question, model_wait_ms,
        short_answer_threshold, fallback_enabled, model, prompt)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       enabled=VALUES(enabled),
       max_per_interview=VALUES(max_per_interview),
       max_per_question=VALUES(max_per_question),
       model_wait_ms=VALUES(model_wait_ms),
       short_answer_threshold=VALUES(short_answer_threshold),
       fallback_enabled=VALUES(fallback_enabled),
       model=VALUES(model),
       prompt=VALUES(prompt)`,
    [
      config.enabled ? 1 : 0,
      config.maxPerInterview,
      config.maxPerQuestion,
      config.modelWaitMs,
      config.shortAnswerThreshold,
      config.fallbackEnabled ? 1 : 0,
      config.model || null,
      config.prompt
    ]
  );
  return config;
}

async function saveFollowUpConfigForJob(jobCode: string, raw: unknown): Promise<void> {
  if (raw === undefined) return;
  const jc = String(jobCode || '').trim().toUpperCase();
  if (!jc) return;
  const config = sanitizeFollowUpConfig((raw || {}) as Partial<InterviewFollowUpConfig>);
  await bizPool.query(
    `INSERT INTO interview_followup_configs
       (job_code, enabled, max_per_interview, max_per_question, model_wait_ms,
        short_answer_threshold, fallback_enabled, model, prompt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       enabled=VALUES(enabled),
       max_per_interview=VALUES(max_per_interview),
       max_per_question=VALUES(max_per_question),
       model_wait_ms=VALUES(model_wait_ms),
       short_answer_threshold=VALUES(short_answer_threshold),
       fallback_enabled=VALUES(fallback_enabled),
       model=VALUES(model),
       prompt=VALUES(prompt)`,
    [
      jc,
      config.enabled ? 1 : 0,
      config.maxPerInterview,
      config.maxPerQuestion,
      config.modelWaitMs,
      config.shortAnswerThreshold,
      config.fallbackEnabled ? 1 : 0,
      config.model || null,
      config.prompt
    ]
  );
}

async function generateJobJdDashScope(payload: GenerateJdPayload): Promise<string> {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  const base = (
    process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  ).replace(/\/$/, '');
  const model = (process.env.QWEN_QUESTION_MODEL || defaultQwenPlusModel()).trim();
  const loc = String(payload.location || '').trim();
  const sal = String(payload.salary || '').trim();
  const userMsg = [
    '请根据以下信息编写一份中文职位描述（JD），结构包含：一、岗位概述；二、岗位职责（分条）；三、任职要求（分条）；四、加分项（可选）。语气专业简洁，不要使用 markdown 代码围栏。',
    '',
    `岗位名称：${payload.title}`,
    `级别：${payload.level}`,
    loc ? `工作地点：${loc}` : '',
    sal ? `薪资范围：${sal}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  if (!apiKey) {
    return [
      `【${payload.title}】（${payload.level}）`,
      '',
      '一、岗位概述',
      `本岗位与「${payload.title}」相关工作，级别为 ${payload.level}。`,
      loc ? `工作地点：${loc}。` : '',
      sal ? `参考薪资：${sal}。` : '',
      '',
      '二、岗位职责',
      '（请根据实际业务补充）',
      '',
      '三、任职要求',
      `1. 符合「${payload.level}」能力要求；`,
      '2. 良好的沟通与协作能力。',
      '',
      '—— 未配置 DASHSCOPE_API_KEY 时为占位模板；配置阿里云百炼密钥后可生成更完整 JD。'
    ].join('\n');
  }

  const reqBody = {
    model,
    temperature: 0.65,
    messages: [
      {
        role: 'system',
        content:
          '你是资深招聘与用人经理，只输出可直接粘贴到招聘系统的岗位 JD 正文，使用中文，适当用序号分条，不要输出 JSON，不要用 markdown 代码块围栏。'
      },
      { role: 'user', content: userMsg }
    ]
  };

  const callJdModel = async (body: typeof reqBody) => {
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const data = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
      message?: string;
    };
    if (!resp.ok) {
      const msg = data?.error?.message || data?.message || JSON.stringify(data);
      const e = new Error(msg || '大模型调用失败') as Error & { httpStatus?: number };
      e.httpStatus = resp.status;
      throw e;
    }
    const text = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!text) throw new Error('大模型未返回内容');
    return text;
  };

  try {
    return await callJdModel(reqBody);
  } catch (e) {
    const fallback = qwenPlusModelFallbackFor(model);
    if (fallback && isQwenPlusModelQuotaExhausted(e)) {
      console.warn(`[generateJobJd] 模型 ${model} 配额/不可用，降级 ${fallback}`);
      return await callJdModel({ ...reqBody, model: fallback });
    }
    throw e;
  }
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

/** 业务库 projects 是否已执行 migration_projects_shenpu_resume_template.sql */
let bizProjectsShenpuResumeTemplate: boolean | null = null;
async function bizProjectsHaveShenpuResumeTemplate(pool: mysql.Pool): Promise<boolean> {
  if (bizProjectsShenpuResumeTemplate !== null) return bizProjectsShenpuResumeTemplate;
  try {
    await pool.query(
      'SELECT shenpu_resume_template_file_name, shenpu_resume_template_storage_path, shenpu_resume_template_uploaded_at FROM projects LIMIT 1'
    );
    bizProjectsShenpuResumeTemplate = true;
  } catch {
    bizProjectsShenpuResumeTemplate = false;
  }
  return bizProjectsShenpuResumeTemplate;
}

async function ensureBizProjectsShenpuResumeTemplateColumns(pool: mysql.Pool): Promise<void> {
  const alters = [
    `ALTER TABLE projects ADD COLUMN shenpu_resume_template_file_name VARCHAR(255) NULL AFTER member_count`,
    `ALTER TABLE projects ADD COLUMN shenpu_resume_template_mime_type VARCHAR(128) NULL AFTER shenpu_resume_template_file_name`,
    `ALTER TABLE projects ADD COLUMN shenpu_resume_template_size_bytes BIGINT UNSIGNED NULL AFTER shenpu_resume_template_mime_type`,
    `ALTER TABLE projects ADD COLUMN shenpu_resume_template_storage_path VARCHAR(512) NULL AFTER shenpu_resume_template_size_bytes`,
    `ALTER TABLE projects ADD COLUMN shenpu_resume_template_uploaded_at TIMESTAMP NULL DEFAULT NULL AFTER shenpu_resume_template_storage_path`
  ];
  for (const sql of alters) {
    try {
      await pool.query(sql);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code !== 'ER_DUP_FIELDNAME') throw e;
    }
  }
  bizProjectsShenpuResumeTemplate = true;
}

async function invalidateShenpuResumesForProject(projectId: string): Promise<number> {
  const id = String(projectId || '').trim();
  if (!id) return 0;
  try {
    const onJob = `CONVERT(TRIM(j.job_code) USING utf8mb4) COLLATE utf8mb4_unicode_ci =
                   CONVERT(TRIM(s.job_code) USING utf8mb4) COLLATE utf8mb4_unicode_ci`;
    const onProject = `CONVERT(TRIM(j.project_id) USING utf8mb4) COLLATE utf8mb4_unicode_ci =
                       CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci`;
    const [rows] = await bizPool.query<RowDataPacket[]>(
      `SELECT sr.storage_path
       FROM resume_screening_shenpu_resumes sr
       INNER JOIN resume_screenings s ON s.id = sr.screening_id
       INNER JOIN jobs j ON ${onJob}
       WHERE ${onProject}`,
      [id]
    );
    const [hdr] = await bizPool.query<ResultSetHeader>(
      `DELETE sr
       FROM resume_screening_shenpu_resumes sr
       INNER JOIN resume_screenings s ON s.id = sr.screening_id
       INNER JOIN jobs j ON ${onJob}
       WHERE ${onProject}`,
      [id]
    );
    for (const row of rows || []) {
      const storageKey = String(row.storage_path || '').trim();
      if (storageKey && /^[\w.-]{4,240}$/.test(path.basename(storageKey))) {
        fs.rm(path.join(RESUME_STORAGE_DIR, path.basename(storageKey)), { force: true }, () => {});
      }
    }
    return Number(hdr.affectedRows || 0);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === 'ER_NO_SUCH_TABLE' || code === 'ER_BAD_FIELD_ERROR') return 0;
    console.warn('[projects] invalidate shenpu resumes skipped:', e);
    return 0;
  }
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
const AI_INTERVIEWER_MANAGER_ROLE_NAME = 'AI面试官管理员';

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

async function ensureAdminUserRolesTable(pool: mysql.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id VARCHAR(64) NOT NULL,
      role_id VARCHAR(64) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, role_id),
      KEY idx_user_roles_role (role_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await pool.query(`
    INSERT IGNORE INTO user_roles (user_id, role_id)
    SELECT u.id, r.id
    FROM users u
    JOIN roles r ON r.name = u.role
    WHERE TRIM(COALESCE(u.role, '')) <> ''
  `);
}

async function ensureAdminAiInterviewerManagerRole(pool: mysql.Pool): Promise<void> {
  await pool.query(
    `INSERT IGNORE INTO roles (id, name, \`desc\`, users, menu_keys)
     VALUES ('R_AI_INTERVIEWER_MANAGER', ?, '可维护 AI 面试官提示词模板', 0, ?)`,
    [AI_INTERVIEWER_MANAGER_ROLE_NAME, JSON.stringify(['sys-interview-prompt'])]
  );
  await pool.query(
    `UPDATE roles
     SET menu_keys = COALESCE(NULLIF(menu_keys, ''), ?)
     WHERE id = 'R_AI_INTERVIEWER_MANAGER'`,
    [JSON.stringify(['sys-interview-prompt'])]
  );
}

async function roleNamesByIds(pool: mysql.Pool, roleIds: string[]): Promise<string[]> {
  const ids = roleIds.map((x) => String(x || '').trim()).filter(Boolean);
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT id, name FROM roles WHERE id IN (${ph})`, ids);
  const order = new Map(ids.map((id, idx) => [id, idx]));
  return rows
    .map((r) => ({ id: String(r.id || ''), name: String(r.name || '').trim() }))
    .filter((r) => r.id && r.name)
    .sort((a, b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999))
    .map((r) => r.name);
}

function normalizeUserRoleIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.map((x) => String(x || '').trim()).filter(Boolean)));
}

async function replaceUserRoleLinks(pool: mysql.Pool, userId: string, roleIds: string[]): Promise<string> {
  await ensureAdminUserRolesTable(pool);
  const ids = normalizeUserRoleIds(roleIds);
  if (!ids.length) throw new Error('请至少选择一个角色');
  const names = await roleNamesByIds(pool, ids);
  if (!names.length) throw new Error('所选角色不存在');
  await pool.query('DELETE FROM user_roles WHERE user_id = ?', [userId]);
  for (const rid of ids) {
    await pool.query('INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, rid]);
  }
  return names[0] || '招聘人员';
}

/** 老库若未执行 migration_depts_dept_type.sql，会导致列表类型一直为「—」且无法写入 */
async function ensureAdminDeptsDeptTypeColumn(pool: mysql.Pool, database: string): Promise<void> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'depts' AND COLUMN_NAME = 'dept_type' LIMIT 1`,
      [database]
    );
    if (Array.isArray(rows) && rows.length > 0) return;
    await pool.query(
      `ALTER TABLE depts ADD COLUMN dept_type VARCHAR(32) NOT NULL DEFAULT '' COMMENT '交付/招聘/其他等' AFTER name`
    );
    console.log('[server.ts] 已为管理库 depts 表自动补充 dept_type 列（此前缺失）');
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === 'ER_DUP_FIELDNAME') return;
    console.warn('[server.ts] 检查/补充 depts.dept_type 列未成功（若部门类型仍无法保存，请手动执行 server/migration_depts_dept_type.sql）', e);
  }
}

async function ensureAdminDeptsSortOrderColumn(pool: mysql.Pool, database: string): Promise<void> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'depts' AND COLUMN_NAME = 'sort_order' LIMIT 1`,
      [database]
    );
    if (Array.isArray(rows) && rows.length > 0) return;
    await pool.query(`ALTER TABLE depts ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER level`);
    console.log('[server.ts] 已为管理库 depts 表自动补充 sort_order 列');
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === 'ER_DUP_FIELDNAME') return;
    console.warn('[server.ts] 检查/补充 depts.sort_order 列未成功（若拖拽排序不可用，请手动执行 server/migration_depts_sort_order.sql）', e);
  }
}

function naturalDeptSortKey(name: string): string {
  const cn: Record<string, string> = { 一: '01', 二: '02', 三: '03', 四: '04', 五: '05', 六: '06', 七: '07', 八: '08', 九: '09', 十: '10' };
  return String(name || '')
    .replace(/十([一二三四五六七八九])?/g, (_, tail) => String(10 + (tail ? Number(cn[tail]) : 0)).padStart(2, '0'))
    .replace(/[一二三四五六七八九]/g, (m) => cn[m] || m)
    .replace(/(\d+)/g, (m) => m.padStart(6, '0'));
}

async function initializeAdminDeptSortOrders(pool: mysql.Pool): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, parent_id, name, sort_order FROM depts ORDER BY parent_id ASC, level ASC, name ASC'
  );
  const byParent = new Map<string, Array<{ id: string; name: string; sortOrder: number }>>();
  for (const r of rows) {
    const key = String(r.parent_id || '');
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push({
      id: String(r.id),
      name: String(r.name || ''),
      sortOrder: Number(r.sort_order) || 0
    });
  }
  for (const siblings of byParent.values()) {
    const needsInit = siblings.every((x) => !x.sortOrder);
    if (!needsInit) continue;
    siblings.sort((a, b) => naturalDeptSortKey(a.name).localeCompare(naturalDeptSortKey(b.name), 'zh-CN'));
    for (let i = 0; i < siblings.length; i++) {
      await pool.query('UPDATE depts SET sort_order=? WHERE id=?', [(i + 1) * 10, siblings[i].id]);
    }
  }
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

  await ensureAdminDeptsDeptTypeColumn(adminPool, adminDb);
  await ensureAdminDeptsSortOrderColumn(adminPool, adminDb);
  await initializeAdminDeptSortOrders(adminPool);
  await ensureAdminAiInterviewerManagerRole(adminPool);

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
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
    }
  });

  app.get('/api/projects', async (_req, res) => {
    try {
      const hasUi = await bizProjectsHaveUiFields(bizPool);
      const hasRl = await bizProjectsHaveRecruitmentLeads(bizPool);
      const hasTpl = await bizProjectsHaveShenpuResumeTemplate(bizPool);
      const tplCols = hasTpl
        ? ', shenpu_resume_template_file_name, shenpu_resume_template_mime_type, shenpu_resume_template_size_bytes, shenpu_resume_template_storage_path, shenpu_resume_template_uploaded_at'
        : '';
      const projSql = hasUi
        ? hasRl
          ? `SELECT id, name, client, dept, manager, recruitment_leads, status, project_code, start_date, end_date, description, member_count, created_at, updated_at${tplCols}
             FROM projects ORDER BY updated_at DESC, id DESC`
          : `SELECT id, name, client, dept, manager, status, project_code, start_date, end_date, description, member_count, created_at, updated_at${tplCols}
             FROM projects ORDER BY updated_at DESC, id DESC`
        : hasRl
          ? `SELECT id, name, client, dept, manager, recruitment_leads, status, created_at, updated_at${tplCols}
             FROM projects ORDER BY updated_at DESC, id DESC`
          : `SELECT id, name, client, dept, manager, status, created_at, updated_at${tplCols}
             FROM projects ORDER BY updated_at DESC, id DESC`;
      const [projects] = await bizPool.query<any[]>(projSql);
      const hasClaim = await jobsHaveClaimedBy(bizPool);
      const jobsSql = hasClaim
        ? `SELECT j.project_id, j.job_code, j.title, j.department, j.jd_text, j.demand, j.location,
                  j.skills, j.level, j.salary, j.recruiters, j.claimed_by, j.updated_at,
                  f.enabled, f.max_per_interview, f.max_per_question, f.model_wait_ms,
                  f.short_answer_threshold, f.fallback_enabled, f.model, f.prompt
           FROM jobs j
           LEFT JOIN interview_followup_configs f ON f.job_code = j.job_code
           ORDER BY j.updated_at DESC, j.id DESC`
        : `SELECT j.project_id, j.job_code, j.title, j.department, j.jd_text, j.demand, j.location,
                  j.skills, j.level, j.salary, j.recruiters, j.updated_at,
                  f.enabled, f.max_per_interview, f.max_per_question, f.model_wait_ms,
                  f.short_answer_threshold, f.fallback_enabled, f.model, f.prompt
           FROM jobs j
           LEFT JOIN interview_followup_configs f ON f.job_code = j.job_code
           ORDER BY j.updated_at DESC, j.id DESC`;
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
              followUpConfig: followUpConfigForJson(followUpConfigFromRow(j)),
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
          shenpuResumeTemplate:
            hasTpl && p.shenpu_resume_template_storage_path
              ? {
                  fileName: String(p.shenpu_resume_template_file_name || '简历模板'),
                  mimeType: String(p.shenpu_resume_template_mime_type || 'application/octet-stream'),
                  sizeBytes: Number(p.shenpu_resume_template_size_bytes) || 0,
                  uploadedAt: fmtSqlDateTime(p.shenpu_resume_template_uploaded_at)
                }
              : null,
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
            followUpConfig: followUpConfigForJson(followUpConfigFromRow(j)),
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
          shenpuResumeTemplate: null,
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
          shenpuResumeTemplate: null,
          jobs: []
        });
      }
      res.json(result);
    } catch {
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
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
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
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
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
    }
  });

  app.post('/api/projects/:projectId/shenpu-resume-template', projectTemplateUpload.single('file'), async (req, res) => {
    try {
      const id = String(req.params.projectId || '').trim();
      if (!id || id === 'EMPTY' || id === 'UNASSIGNED') {
        res.status(400).json({ message: '无效的项目' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ message: '请选择要上传的简历模板文件' });
        return;
      }
      await ensureBizProjectsShenpuResumeTemplateColumns(bizPool);
      const originalName = normalizeMultipartFilename(req.file.originalname || '');
      const lower = originalName.toLowerCase();
      const mime = String(req.file.mimetype || '').toLowerCase();
      const allowed =
        lower.endsWith('.docx') ||
        lower.endsWith('.doc') ||
        lower.endsWith('.xlsx') ||
        lower.endsWith('.pdf') ||
        mime.includes('wordprocessingml') ||
        mime.includes('msword') ||
        mime.includes('spreadsheetml') ||
        mime.includes('excel') ||
        mime.includes('pdf');
      if (!allowed) {
        res.status(400).json({ message: '模板目前支持 Word、Excel 或 PDF 文件' });
        return;
      }
      const saved = saveProjectResumeTemplateFile(req.file);
      const [hdr] = await bizPool.query<ResultSetHeader>(
        `UPDATE projects
         SET shenpu_resume_template_file_name=?,
             shenpu_resume_template_mime_type=?,
             shenpu_resume_template_size_bytes=?,
             shenpu_resume_template_storage_path=?,
             shenpu_resume_template_uploaded_at=NOW()
         WHERE id=?`,
        [saved.originalName, saved.mimeType, saved.sizeBytes, saved.storageKey, id]
      );
      if (!hdr.affectedRows) {
        res.status(404).json({ message: '项目不存在' });
        return;
      }
      const invalidated = await invalidateShenpuResumesForProject(id);
      res.json({
        ok: true,
        data: {
          fileName: saved.originalName,
          mimeType: saved.mimeType,
          sizeBytes: saved.sizeBytes,
          uploadedAt: fmtSqlDateTime(new Date()),
          invalidatedShenpuResumeCount: invalidated
        }
      });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'ER_BAD_FIELD_ERROR') {
        res.status(503).json({ message: '项目表缺少模板字段，请执行 server/migration_projects_shenpu_resume_template.sql' });
        return;
      }
      console.error('[POST /api/projects/:projectId/shenpu-resume-template]', e);
      res.status(500).json({ message: '模板上传失败，请稍后重试或联系管理员。' });
    }
  });

  app.delete('/api/projects/:projectId/shenpu-resume-template', async (req, res) => {
    try {
      const id = String(req.params.projectId || '').trim();
      if (!id || id === 'EMPTY' || id === 'UNASSIGNED') {
        res.status(400).json({ message: '无效的项目' });
        return;
      }
      await ensureBizProjectsShenpuResumeTemplateColumns(bizPool);
      const [rows] = await bizPool.query<RowDataPacket[]>(
        'SELECT shenpu_resume_template_storage_path FROM projects WHERE id=? LIMIT 1',
        [id]
      );
      const storageKey = String(rows?.[0]?.shenpu_resume_template_storage_path || '').trim();
      const [hdr] = await bizPool.query<ResultSetHeader>(
        `UPDATE projects
         SET shenpu_resume_template_file_name=NULL,
             shenpu_resume_template_mime_type=NULL,
             shenpu_resume_template_size_bytes=NULL,
             shenpu_resume_template_storage_path=NULL,
             shenpu_resume_template_uploaded_at=NULL
         WHERE id=?`,
        [id]
      );
      if (!hdr.affectedRows) {
        res.status(404).json({ message: '项目不存在' });
        return;
      }
      await invalidateShenpuResumesForProject(id);
      if (storageKey && /^[\w.-]{4,240}$/.test(path.basename(storageKey))) {
        fs.rm(path.join(RESUME_STORAGE_DIR, path.basename(storageKey)), { force: true }, () => {});
      }
      res.json({ ok: true });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'ER_BAD_FIELD_ERROR') {
        res.status(503).json({ message: '项目表缺少模板字段，请执行 server/migration_projects_shenpu_resume_template.sql' });
        return;
      }
      console.error('[DELETE /api/projects/:projectId/shenpu-resume-template]', e);
      res.status(500).json({ message: '模板删除失败，请稍后重试或联系管理员。' });
    }
  });

  app.delete('/api/projects/:projectId', async (req, res) => {
    try {
      const id = String(req.params.projectId || '').trim();
      if (!id || id === 'EMPTY' || id === 'UNASSIGNED') {
        res.status(400).json({ message: '无效的项目' });
        return;
      }
      const hasTpl = await bizProjectsHaveShenpuResumeTemplate(bizPool);
      let storageKey = '';
      if (hasTpl) {
        const [rows] = await bizPool.query<RowDataPacket[]>(
          'SELECT shenpu_resume_template_storage_path FROM projects WHERE id=? LIMIT 1',
          [id]
        );
        storageKey = String(rows?.[0]?.shenpu_resume_template_storage_path || '').trim();
      }
      const [hdr] = await bizPool.query<ResultSetHeader>('DELETE FROM projects WHERE id=?', [id]);
      if (!hdr.affectedRows) {
        res.status(404).json({ message: '项目不存在' });
        return;
      }
      if (storageKey && /^[\w.-]{4,240}$/.test(path.basename(storageKey))) {
        fs.rm(path.join(RESUME_STORAGE_DIR, path.basename(storageKey)), { force: true }, () => {});
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('[DELETE /api/projects/:projectId]', e);
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
    }
  });

  app.post('/api/jobs/generate-jd', async (req, res) => {
    try {
      const body = req.body as Record<string, unknown> | null;
      const titleNorm = normalizeJobTitle(String(body?.title || ''));
      const levelNorm = normalizeJobLevel(String(body?.level || ''));
      if (!String(body?.title || '').trim() || !String(body?.level || '').trim()) {
        res.status(400).json({ message: '请填写岗位名称与级别后再生成 JD' });
        return;
      }
      if (!titleNorm || !levelNorm) {
        res
          .status(400)
          .json({ message: !titleNorm ? jobTitleValidationMessage() : jobLevelValidationMessage() });
        return;
      }
      const location = String(body?.location || '').trim();
      const salary = String(body?.salary || '').trim();
      const jdText = await generateJobJdDashScope({ title: titleNorm, level: levelNorm, location, salary });
      res.json({ jdText });
    } catch (e) {
      console.error('[POST /api/jobs/generate-jd]', e);
      res.status(500).json({ message: '生成岗位描述失败，请稍后重试或检查大模型配置。' });
    }
  });

  app.post('/api/jobs', async (req, res) => {
    try {
      const body = req.body as Record<string, unknown> | null;
      const titleNorm = normalizeJobTitle(String(body?.title || ''));
      let jobCode = String(body?.jobCode || '').trim().toUpperCase();
      if (!titleNorm) {
        res.status(400).json({
          message: String(body?.title || '').trim() ? jobTitleValidationMessage() : '岗位名称必填'
        });
        return;
      }
      const locationReq = String(body?.location ?? '').trim();
      const levelReq = String(body?.level ?? '').trim();
      const salaryReq = String(body?.salary ?? '').trim();
      if (!locationReq) {
        res.status(400).json({ message: '工作地点必填' });
        return;
      }
      if (!levelReq.trim()) {
        res.status(400).json({ message: '级别必填' });
        return;
      }
      const levelNorm = normalizeJobLevel(levelReq);
      if (!levelNorm) {
        res.status(400).json({ message: jobLevelValidationMessage() });
        return;
      }
      if (!salaryReq) {
        res.status(400).json({ message: '薪资范围必填' });
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
      const location = locationReq || null;
      const skills = String(body?.skills ?? '').trim() || null;
      const level = levelNorm;
      const salary = salaryReq || null;
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
            titleNorm,
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
            titleNorm,
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
      await saveFollowUpConfigForJob(jobCode, body?.followUpConfig);
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
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
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
      const titleNorm = normalizeJobTitle(String(body?.title ?? ''));
      if (!titleNorm) {
        res.status(400).json({
          message: String(body?.title ?? '').trim() ? jobTitleValidationMessage() : '岗位名称必填'
        });
        return;
      }
      const locationReq = String(body?.location ?? '').trim();
      const levelReq = String(body?.level ?? '').trim();
      const salaryReq = String(body?.salary ?? '').trim();
      if (!locationReq) {
        res.status(400).json({ message: '工作地点必填' });
        return;
      }
      if (!levelReq.trim()) {
        res.status(400).json({ message: '级别必填' });
        return;
      }
      const levelNorm = normalizeJobLevel(levelReq);
      if (!levelNorm) {
        res.status(400).json({ message: jobLevelValidationMessage() });
        return;
      }
      if (!salaryReq) {
        res.status(400).json({ message: '薪资范围必填' });
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
      const location = locationReq;
      const skills = String(body?.skills ?? '').trim();
      const level = levelNorm;
      const salary = salaryReq;
      const recruitersJson =
        body?.recruiters !== undefined ? normalizeRecruitersForDb(body.recruiters) : undefined;

      const fields: string[] = [];
      const vals: unknown[] = [];
      fields.push('title=?');
      vals.push(titleNorm);
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
      vals.push(location);
      fields.push('skills=?');
      vals.push(skills || null);
      fields.push('level=?');
      vals.push(level);
      fields.push('salary=?');
      vals.push(salary);
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
      await saveFollowUpConfigForJob(jobCode, body?.followUpConfig);
      res.json({ ok: true });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'ER_NO_REFERENCED_ROW_2') {
        res.status(400).json({ message: '所属项目不存在' });
        return;
      }
      console.error('[PATCH /api/jobs]', e);
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
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
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
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
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
    }
  });

  app.get('/api/resumes', async (_req, res) => {
    try {
      const [rows] = await adminPool.query('SELECT * FROM resumes');
      res.json(rows);
    } catch {
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
    }
  });

  app.get('/api/applications', async (_req, res) => {
    try {
      const [rows] = await adminPool.query('SELECT * FROM applications');
      res.json(rows);
    } catch {
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
    }
  });

  app.get('/api/depts', async (_req, res) => {
    try {
      const [rows] = await adminPool.query(
        'SELECT * FROM depts ORDER BY level ASC, sort_order ASC, name ASC'
      );
      res.json(rows);
    } catch {
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
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
    const deptType = String(b.deptType || b.dept_type || '').trim().slice(0, 32);
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
        'INSERT INTO depts (id, parent_id, name, dept_type, level, sort_order, manager, count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, parentId, name, deptType, lv, 0, manager, ct]
      );
      res.status(201).json({ id });
    } catch (e) {
      if (mysqlDupKey(e)) {
        res.status(409).json({ message: '部门 id 已存在，请留空由系统自动生成或更换编号' });
        return;
      }
      const err = e as { code?: string; message?: string };
      if (err.code === 'ER_BAD_FIELD_ERROR' && String(err.message || '').includes('dept_type')) {
        res.status(503).json({
          message: 'depts 表缺少 dept_type 列，请执行 server/migration_depts_dept_type.sql 后重试'
        });
        return;
      }
      if (err.code === 'ER_BAD_FIELD_ERROR' || String(err.message || '').includes('parent_id')) {
        res.status(503).json({
          message: 'depts 表缺少 parent_id 列，请执行 server/migration_depts_parent_id.sql 后重试'
        });
        return;
      }
      console.error('[POST /api/depts]', e);
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
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
    if (b.deptType !== undefined || b.dept_type !== undefined) {
      const raw = b.deptType !== undefined ? b.deptType : b.dept_type;
      patches.push('dept_type = ?');
      vals.push(String(raw ?? '').trim().slice(0, 32));
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
      // MySQL 默认「受影响行数」常为*实际被改写的行*：若新值与旧值完全一致，affectedRows 可能为 0，但部门仍存在。
      if (!hdr.affectedRows) {
        const [existRows] = await adminPool.query<RowDataPacket[]>(
          'SELECT 1 AS ok FROM depts WHERE id = ? LIMIT 1',
          [id]
        );
        if (!existRows.length) {
          res.status(404).json({ message: '部门不存在' });
          return;
        }
      }
      res.json({ ok: true });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === 'ER_BAD_FIELD_ERROR' && String(err.message || '').includes('dept_type')) {
        res.status(503).json({
          message: 'depts 表缺少 dept_type 列，请执行 server/migration_depts_dept_type.sql 后重试'
        });
        return;
      }
      console.error('[PATCH /api/depts/:id]', e);
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
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
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
    }
  });

  app.post('/api/depts/reorder', async (req, res) => {
    const parentId = String(req.body?.parentId || '').trim();
    const orderedIds = Array.isArray(req.body?.orderedIds)
      ? req.body.orderedIds.map((x: unknown) => String(x || '').trim()).filter(Boolean)
      : [];
    if (!orderedIds.length) return res.status(400).json({ message: 'orderedIds required' });
    const conn = await adminPool.getConnection();
    try {
      await conn.beginTransaction();
      for (let i = 0; i < orderedIds.length; i++) {
        await conn.query(
          parentId
            ? 'UPDATE depts SET sort_order=? WHERE id=? AND parent_id=?'
            : 'UPDATE depts SET sort_order=? WHERE id=? AND parent_id IS NULL',
          parentId ? [(i + 1) * 10, orderedIds[i], parentId] : [(i + 1) * 10, orderedIds[i]]
        );
      }
      await conn.commit();
      res.json({ ok: true });
    } catch (e) {
      await conn.rollback();
      res.status(500).json({ message: 'db error' });
    } finally {
      conn.release();
    }
  });

  app.get('/api/users', async (_req, res) => {
    try {
      await ensureAdminUserRolesTable(adminPool);
      const [rows] = await adminPool.query(
        `SELECT u.id, u.name, u.username, u.dept, u.role, u.status,
                CONCAT('[', COALESCE(GROUP_CONCAT(JSON_OBJECT('id', r.id, 'name', r.name) ORDER BY r.id SEPARATOR ','), ''), ']') AS roles_json
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         GROUP BY u.id, u.name, u.username, u.dept, u.role, u.status
         ORDER BY u.username ASC`
      );
      res.json(
        (rows as RowDataPacket[]).map((r) => {
          let roles: Array<{ id: string; name: string }> = []
          try {
            const parsed = JSON.parse(String(r.roles_json || '[]')) as Array<{ id?: unknown; name?: unknown }>
            roles = Array.isArray(parsed)
              ? parsed
                  .map((x) => ({ id: String(x.id || '').trim(), name: String(x.name || '').trim() }))
                  .filter((x) => x.id && x.name)
              : []
          } catch {
            roles = []
          }
          return { ...r, roles, roleIds: roles.map((x) => x.id) }
        })
      );
    } catch {
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
    }
  });

  app.post('/api/users', async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const username = String(b.username || '').trim();
    const password = String(b.password || '');
    const dept = String(b.dept || '').trim() || '-';
    const roleIds = normalizeUserRoleIds(b.roleIds);
    const roleNamesFromIds = roleIds.length ? await roleNamesByIds(adminPool, roleIds).catch(() => []) : [];
    const role = roleNamesFromIds[0] || String(b.role || '').trim() || '招聘人员';
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
      if (roleIds.length) {
        const primary = await replaceUserRoleLinks(adminPool, id, roleIds);
        await adminPool.query('UPDATE users SET role = ? WHERE id = ?', [primary, id]);
      } else {
        await ensureAdminUserRolesTable(adminPool);
        await adminPool.query(
          'INSERT IGNORE INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = ? LIMIT 1',
          [id, role]
        );
      }
      res.status(201).json({ id });
    } catch (e) {
      if (mysqlDupKey(e)) {
        res.status(409).json({ message: '登录账号已存在' });
        return;
      }
      console.error('[POST /api/users]', e);
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
    }
  });

  app.patch('/api/users/:id', async (req, res) => {
    const id = String(req.params.id || '').trim();
    const b = req.body || {};
    if (!id) {
      res.status(400).json({ message: '缺少用户 id' });
      return;
    }
    if (b.username !== undefined || b.role !== undefined || b.roleIds !== undefined) {
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
        const nextRoleIds = normalizeUserRoleIds(b.roleIds);
        const nextRoleNames = nextRoleIds.length ? await roleNamesByIds(adminPool, nextRoleIds).catch(() => []) : [];
        const nextRole =
          nextRoleNames[0] ||
          (b.role !== undefined
            ? String(b.role || '').trim() || '招聘人员'
            : String(cur.role || '').trim() || '招聘人员');
        const unameRule = assertLoginUsernameMatchesRole(nextUsername, nextRole);
        if (unameRule) {
          res.status(400).json({ message: unameRule });
          return;
        }
      } catch {
        res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
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
    if (b.role !== undefined || b.roleIds !== undefined) {
      const nextRoleIds = normalizeUserRoleIds(b.roleIds);
      const nextRoleNames = nextRoleIds.length ? await roleNamesByIds(adminPool, nextRoleIds).catch(() => []) : [];
      patches.push('role = ?');
      vals.push(nextRoleNames[0] || String(b.role || '').trim() || '招聘人员');
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
      if (b.roleIds !== undefined) {
        const primary = await replaceUserRoleLinks(adminPool, id, normalizeUserRoleIds(b.roleIds));
        await adminPool.query('UPDATE users SET role = ? WHERE id = ?', [primary, id]);
      }
      res.json({ ok: true });
    } catch (e) {
      if (mysqlDupKey(e)) {
        res.status(409).json({ message: '登录账号已存在' });
        return;
      }
      console.error('[PATCH /api/users]', e);
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
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
      await adminPool.query('DELETE FROM user_roles WHERE user_id = ?', [id]);
      if (!hdr.affectedRows) {
        res.status(404).json({ message: '用户不存在' });
        return;
      }
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
    }
  });

  app.get('/api/roles', async (_req, res) => {
    try {
      const [rows] = await adminPool.query('SELECT * FROM roles ORDER BY id ASC');
      res.json(rows);
    } catch {
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
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
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
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
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
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
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
    }
  });

  app.get('/api/menus', async (_req, res) => {
    try {
      const [rows] = await adminPool.query('SELECT * FROM menus ORDER BY level ASC, id ASC');
      res.json(rows);
    } catch {
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
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
        res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
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
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
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
          res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
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
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
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
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
    }
  });

  app.get('/api/admin/interview-followup-settings', async (_req, res) => {
    const config = await loadSystemFollowUpConfig();
    res.json({ data: followUpConfigForJson(config) });
  });

  app.patch('/api/admin/interview-followup-settings', async (req, res) => {
    try {
      const config = await saveSystemFollowUpConfig(req.body || {});
      res.json({ data: followUpConfigForJson(config) });
    } catch {
      res.status(500).json({ message: '数据库访问失败，请稍后重试或联系管理员。' });
    }
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { port: Number(process.env.ADMIN_UI_HMR_PORT || 24679) },
        watch: {
          ignored: ['**/storage/**', '**/.logs/**', '**/.pids/**', '**/miniapp-candidate/dist/**']
        }
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
    app.use(express.static(distPath, { index: false }));
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
