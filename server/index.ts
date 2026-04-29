import express from 'express'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { createRequire } from 'node:module'
import mysql, { type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise'
import multer from 'multer'
import Redis from 'ioredis'
import { PDFParse } from 'pdf-parse'
import mammoth from 'mammoth'
import {
  normalizeJobLevel,
  normalizeJobTitle,
  jobLevelValidationMessage,
  jobTitleValidationMessage,
  normalizeExtractedJobTitleForDisplay,
  STANDARD_JOB_ROLE_BASE_SET,
  matchRoleBaseFromJobTitle
} from '../shared/jobTaxonomy'

/** 将解析/抽取的应聘职位对齐为标准岗位序列（不含级别），供简历详情下拉落库 */
function matchJobTitleToStandardProfileOption(raw: string): string | null {
  const t = normalizeExtractedJobTitleForDisplay(String(raw || ''))
  if (!t) return null
  if (STANDARD_JOB_ROLE_BASE_SET.has(t)) return t
  const base = matchRoleBaseFromJobTitle(t, '')
  if (base && STANDARD_JOB_ROLE_BASE_SET.has(base)) return base
  return null
}
import { mysqlConnectionTimezoneOptions, wireMysqlSessionTimezone } from '../shared/mysqlSessionTimezone'

const requireCjs = createRequire(import.meta.url)

const envLocalPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath })
} else {
  dotenv.config()
}

const app = express()
const port = Number(process.env.PORT || 3001)
/** 绑定 0.0.0.0 便于手机/局域网访问本机 API（勿用 127.0.0.1 作为 bind 地址） */
const listenHost = process.env.HOST || '0.0.0.0'

const uploadAudioMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }
})

const uploadResumeMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }
})

/**
 * Multer/busboy 常将 UTF-8 文件名按 latin1 逐字节解码，导致中文乱码。
 * 若串中码点均 ≤255，则按字节重解为 UTF-8；已是正常 Unicode 的文件名不改动。
 */
function normalizeMultipartFilename(name: string | undefined | null): string {
  const raw = name == null ? '' : String(name)
  if (!raw) return ''
  if (![...raw].every((ch) => ch.charCodeAt(0) <= 255)) return raw
  try {
    const fixed = Buffer.from(raw, 'latin1').toString('utf8')
    if (fixed.includes('\uFFFD')) return raw
    return fixed
  } catch {
    return raw
  }
}

const mysqlPool = mysql.createPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'ai_recruit',
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  ...mysqlConnectionTimezoneOptions
})
wireMysqlSessionTimezone(mysqlPool)

/** 管理端演示库（HR users 等），与 MYSQL_DATABASE 业务库分离 */
const mysqlAdminPool = mysql.createPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_ADMIN_DATABASE || 'ai_recruit_admin',
  waitForConnections: true,
  connectionLimit: Math.min(5, Number(process.env.MYSQL_CONNECTION_LIMIT || 10)),
  queueLimit: 0,
  ...mysqlConnectionTimezoneOptions
})
wireMysqlSessionTimezone(mysqlAdminPool)

const ADMIN_SESSION_KEY_PREFIX = String(process.env.REDIS_ADMIN_SESSION_PREFIX || 'ar:admin:sess:').trim() || 'ar:admin:sess:'

let redisSingleton: Redis | null | undefined

function adminRedisConfigured(): boolean {
  return Boolean(String(process.env.REDIS_URL || '').trim() || String(process.env.REDIS_HOST || '').trim())
}

function getRedisClient(): Redis | null {
  if (redisSingleton === null) return null
  if (redisSingleton !== undefined) return redisSingleton
  const url = String(process.env.REDIS_URL || '').trim()
  const host = String(process.env.REDIS_HOST || '').trim()
  if (!url && !host) {
    redisSingleton = null
    return null
  }
  try {
    const baseOpts = { maxRetriesPerRequest: 2, enableReadyCheck: true }
    const client =
      url.length > 0
        ? new Redis(url, baseOpts)
        : new Redis(
            {
              host,
              port: Number(process.env.REDIS_PORT || 6379),
              password: process.env.REDIS_PASSWORD ? String(process.env.REDIS_PASSWORD) : undefined,
              db: Number(process.env.REDIS_DB || 0),
              ...baseOpts
            },
          )
    client.on('error', (err) => {
      console.error('[redis]', err.message)
    })
    redisSingleton = client
    return client
  } catch (e) {
    console.error('[redis] init failed', e)
    redisSingleton = null
    return null
  }
}

async function pingRedis(): Promise<boolean> {
  if (!adminRedisConfigured()) return false
  const r = getRedisClient()
  if (!r) return false
  try {
    return (await r.ping()) === 'PONG'
  } catch {
    return false
  }
}

/** 管理端登录图形验证码（存 Redis，TTL 默认 180s） */
const ADMIN_CAPTCHA_PREFIX =
  String(process.env.REDIS_CAPTCHA_PREFIX || 'ar:admin:captcha:').trim() || 'ar:admin:captcha:'
const ADMIN_CAPTCHA_TTL_SEC = Math.min(
  600,
  Math.max(60, Number.parseInt(String(process.env.ADMIN_CAPTCHA_TTL_SEC || '180'), 10) || 180)
)

function escapeXmlText(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function randomAdminCaptchaText(len = 4): string {
  const chars = '346789ABCDEFGHJKLMNPQRTUVWXY'
  const buf = crypto.randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += chars[buf[i]! % chars.length]!
  return out
}

function buildAdminCaptchaSvg(text: string): string {
  const w = 132
  const h = 44
  const chars = [...text]
  let texts = ''
  let x = 14
  for (let i = 0; i < chars.length; i++) {
    const ch = escapeXmlText(chars[i]!)
    const rot = ((i * 7 + (chars[i]!.charCodeAt(0) % 11)) % 9) - 4
    texts += `<text x="${x}" y="31" font-size="22" font-family="system-ui,Segoe UI,sans-serif" font-weight="700" fill="#0f172a" transform="rotate(${rot} ${x + 10} 24)">${ch}</text>`
    x += 28
  }
  let lines = ''
  for (let i = 0; i < 5; i++) {
    const b1 = crypto.randomBytes(4)
    const x1 = b1[0]! % w
    const y1 = b1[1]! % h
    const x2 = b1[2]! % w
    const y2 = b1[3]! % h
    lines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#cbd5e1" stroke-width="1"/>`
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="100%" height="100%" fill="#f1f5f9"/>` +
    lines +
    texts +
    `</svg>`
  )
}

/** 校验通过后删除 key（一次性）；错误输入不删，可继续试同一图 */
async function verifyAdminCaptchaAndConsume(captchaId: string, captchaCode: string): Promise<boolean> {
  const r = getRedisClient()
  if (!r) return false
  const id = String(captchaId || '').trim()
  const input = String(captchaCode || '').trim().toLowerCase()
  if (!id || !input) return false
  const key = `${ADMIN_CAPTCHA_PREFIX}${id}`
  try {
    const stored = await r.get(key)
    if (!stored) return false
    if (String(stored).toLowerCase() !== input) return false
    await r.del(key)
    return true
  } catch {
    return false
  }
}

function maskSecret(value: string, keepStart = 3, keepEnd = 2) {
  if (!value) return '(empty)'
  if (value.length <= keepStart + keepEnd) return '*'.repeat(value.length)
  return `${value.slice(0, keepStart)}${'*'.repeat(value.length - keepStart - keepEnd)}${value.slice(-keepEnd)}`
}

const flowLogEnabled = process.env.FLOW_LOG === '1' || process.env.FLOW_LOG === 'true'

function maskOpenidLite(oid: string) {
  if (!oid) return '(empty)'
  if (oid.length <= 12) return `${oid.slice(0, 3)}***`
  return `${oid.slice(0, 4)}…${oid.slice(-4)}`
}

/** 候选人/API 关键步骤；需根目录 .env.local 设置 FLOW_LOG=1 后重启 dev:api */
function flowLog(step: string, ok: boolean, detail?: string) {
  if (!flowLogEnabled) return
  const mark = ok ? '✓' : '✗'
  console.log(`[flow] ${mark} ${step}${detail ? ` | ${detail}` : ''}`)
}

function checkWechatEnv() {
  const appId = process.env.WECHAT_APPID || ''
  const appSecret = process.env.WECHAT_SECRET || ''
  const ok = Boolean(appId && appSecret)
  return { ok, appId, appSecret }
}

async function exchangeWechatJsCode(code: string): Promise<{ openid: string; sessionKey?: string; appid: string }> {
  const wechatEnv = checkWechatEnv()
  if (!wechatEnv.ok) throw new Error('WECHAT_ENV')
  const query = new URLSearchParams({
    appid: wechatEnv.appId,
    secret: wechatEnv.appSecret,
    js_code: code,
    grant_type: 'authorization_code'
  })
  const wechatRes = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query.toString()}`)
  const wechatData = (await wechatRes.json()) as { openid?: string; session_key?: string; errcode?: number; errmsg?: string }
  if (!wechatRes.ok || !wechatData.openid) {
    const err = new Error('code2Session failed') as Error & { wechat?: unknown }
    err.wechat = { errcode: wechatData.errcode, errmsg: wechatData.errmsg }
    throw err
  }
  return { openid: wechatData.openid, sessionKey: wechatData.session_key, appid: wechatEnv.appId }
}

/** 岗位码（jobs.job_code）或 interview_invitations.invite_code（形如 岗位码-发起人账号-筛查记录id） */
type ResolvedInviteOrJob = {
  jobCode: string
  title: string
  department: string
  jobDbId: number
  /** 来自 interview_invitations 时存在，login-invite 需落库接受邀请 */
  invitationId?: number
  /** HR 发邀时写入，与邀请码第三段筛查 id 一致 */
  resumeScreeningId?: number | null
  interviewerUserId?: number | null
  interviewerOpenid?: string | null
}

async function resolveInviteCode(inviteCode: string): Promise<ResolvedInviteOrJob | null> {
  const code = inviteCode.trim().toUpperCase()
  if (!code) return null
  const [rows] = await mysqlPool.query<any[]>(
    'SELECT id AS jobDbId, job_code AS jobCode, title, department FROM jobs WHERE job_code=? LIMIT 1',
    [code]
  )
  if (rows.length) {
    const r = rows[0]
    return {
      jobCode: r.jobCode,
      title: r.title,
      department: r.department,
      jobDbId: Number(r.jobDbId)
    }
  }
  const [invRows] = await mysqlPool.query<any[]>(
    `SELECT inv.id AS invitationId,
            inv.resume_screening_id AS resumeScreeningId,
            inv.interviewer_user_id AS interviewerUserId,
            inv.interviewer_openid AS interviewerOpenid,
            j.id AS jobDbId, j.job_code AS jobCode, j.title, j.department
     FROM interview_invitations inv
     JOIN jobs j ON j.id = inv.job_id
     WHERE inv.invite_code = ?
       AND inv.status = 'pending'
       AND (inv.expires_at IS NULL OR inv.expires_at > NOW())
     LIMIT 1`,
    [code]
  )
  if (invRows.length) {
    const r = invRows[0]
    const rsid = r.resumeScreeningId
    return {
      jobCode: r.jobCode,
      title: r.title,
      department: r.department,
      jobDbId: Number(r.jobDbId),
      invitationId: Number(r.invitationId),
      resumeScreeningId: rsid != null && Number(rsid) > 0 ? Number(rsid) : null,
      interviewerUserId: r.interviewerUserId ?? null,
      interviewerOpenid: r.interviewerOpenid ?? null
    }
  }
  const fallback = JOBS[code as keyof typeof JOBS]
  if (fallback) {
    return {
      jobCode: fallback.id,
      title: fallback.title,
      department: fallback.department,
      jobDbId: 0
    }
  }
  return null
}

app.use(express.json({ limit: '1mb' }))
app.use((_, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token')
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS')
  if (_.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

if (flowLogEnabled) {
  app.use((req, res, next) => {
    if (req.path === '/api/health') return next()
    const start = Date.now()
    res.on('finish', () => {
      const ms = Date.now() - start
      const st = res.statusCode
      const mark = st < 400 ? '✓' : st < 500 ? '⚠' : '✗'
      console.log(`[api] ${mark} ${req.method} ${req.path} → ${st} ${ms}ms`)
    })
    next()
  })
}

type TranscriptItem = {
  ts: number
  text: string
}

type QaItem = {
  questionId: string
  question: string
  answer: string
}

type SessionState = {
  sessionId: string
  jobId: string
  jobTitle: string
  department: string
  candidateName: string
  candidateOpenId: string
  interviewerOpenId: string
  questions: { id: string; text: string }[]
  transcript: TranscriptItem[]
  qa: QaItem[]
  /** 经 HTTP 上报的 TRTC 旁路信令（字幕等），便于服务端/监考端轮询 */
  trtcSignals: { ts: number; text: string; kind?: string }[]
  voipStatus?: string
  updatedAt: number
}

type UserRole = 'candidate' | 'interviewer'
type UserProfile = { openid: string; phone?: string; role: UserRole; updatedAt: number }

const JOBS = {
  J001: { id: 'J001', title: '前端开发工程师 (校招)', department: '大前端团队' },
  J002: { id: 'J002', title: 'Java后端工程师 (校招)', department: '业务中台' },
  J003: { id: 'J003', title: '高级前端架构师', department: '基础架构部' }
} as const

/** 入库简历正文上限，避免单行过大与出题 token 爆炸 */
const RESUME_PLAINTEXT_MAX_SAVE = 60000

const PERSONALIZED_INTERVIEW_TOTAL = 6
/** Docker 建议挂载卷并可选设置 RESUME_STORAGE_DIR=/data/resumes（见 docker-compose.yml） */
const RESUME_STORAGE_DIR = (() => {
  const fromEnv = process.env.RESUME_STORAGE_DIR?.trim()
  if (!fromEnv) return path.resolve(process.cwd(), 'storage', 'resumes')
  return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv)
})()

function ensureResumeStorageDir(): void {
  try {
    fs.mkdirSync(RESUME_STORAGE_DIR, { recursive: true })
  } catch (e) {
    console.warn('[resume-storage] mkdir failed', e)
  }
}

function safeResumeExt(fileName: string): string {
  const ext = path.extname(String(fileName || '')).toLowerCase()
  if (ext && /^[.\w-]{1,16}$/.test(ext)) return ext
  return '.bin'
}

function saveResumeOriginalFile(file: { buffer: Buffer; originalname?: string; mimetype?: string }): {
  /** 仅文件名，写入 DB，避免机器绝对路径随部署失效 */
  storageKey: string
  absPath: string
  mimeType: string
  sizeBytes: number
  originalName: string
} {
  ensureResumeStorageDir()
  const originalName = normalizeMultipartFilename(file.originalname || 'resume').slice(0, 255) || 'resume'
  const ext = safeResumeExt(originalName)
  const key = `${Date.now()}-${crypto.randomUUID()}${ext}`
  const absPath = path.join(RESUME_STORAGE_DIR, key)
  fs.writeFileSync(absPath, file.buffer)
  return {
    storageKey: key,
    absPath,
    mimeType: String(file.mimetype || 'application/octet-stream').trim() || 'application/octet-stream',
    sizeBytes: Number(file.buffer?.length || 0),
    originalName
  }
}

/** 将库内 storage_path（历史可能为绝对路径）解析为当前可读绝对路径 */
function resolveResumeStorageAbsPath(raw: unknown): string | null {
  const t = String(raw ?? '')
    .trim()
    .replace(/\0/g, '')
  if (!t) return null
  if (path.isAbsolute(t)) {
    try {
      if (fs.existsSync(t)) return t
    } catch {
      /* ignore */
    }
  }
  const base = path.basename(t)
  if (!base || base === '.' || base === '..') return null
  if (!/^[\w.-]{4,240}$/.test(base)) return null
  const abs = path.join(RESUME_STORAGE_DIR, base)
  try {
    return fs.existsSync(abs) ? abs : null
  } catch {
    return null
  }
}

function packResumeScreeningRow(row: { resume_plaintext?: string | null; report_summary?: string | null }): string {
  const full = String(row.resume_plaintext || '').trim()
  if (full.length >= 120) return full.slice(0, 56000)
  const sum = String(row.report_summary || '').trim()
  const merged = [full, sum ? `【AI 简历摘要】${sum}` : ''].filter(Boolean).join('\n\n')
  return merged.trim().slice(0, 56000)
}

/** 按筛查主键取简历，且校验 job_code 与当前岗位一致（防止跨岗篡改 id） */
async function fetchResumeTextByScreeningId(
  jobCodeUpper: string,
  screeningId: number
): Promise<{ text: string; candidateName: string } | null> {
  if (!Number.isFinite(screeningId) || screeningId <= 0) return null
  const jc = String(jobCodeUpper || '').trim().toUpperCase()
  try {
    const [rows] = await mysqlPool.query<any[]>(
      `SELECT resume_plaintext, report_summary, job_code, TRIM(candidate_name) AS candidate_name
       FROM resume_screenings WHERE id=? LIMIT 1`,
      [Math.floor(screeningId)]
    )
    if (!rows.length) return null
    const r = rows[0]
    if (String(r.job_code || '').trim().toUpperCase() !== jc) return null
    const text = packResumeScreeningRow(r)
    return { text, candidateName: String(r.candidate_name || '').trim() }
  } catch {
    return null
  }
}

async function fetchResumeTextForCandidate(jobCode: string, candidateNameRaw: string): Promise<string> {
  const name = String(candidateNameRaw || '').trim()
  if (!name) return ''
  const code = String(jobCode || '').trim().toUpperCase()
  try {
    const [rows] = await mysqlPool.query<any[]>(
      `SELECT resume_plaintext, report_summary FROM resume_screenings
       WHERE job_code=? AND (TRIM(candidate_name)=? OR candidate_name LIKE ?)
       ORDER BY id DESC LIMIT 1`,
      [code, name, `%${name}%`]
    )
    if (rows.length) return packResumeScreeningRow(rows[0])
  } catch {
    /* 表无 resume_plaintext 列等 */
  }
  return ''
}

type InterviewQuestionsHttpError = Error & { httpStatus: number }

function throwInterviewQuestionsHttp(status: number, message: string): never {
  const e = new Error(message) as InterviewQuestionsHttpError
  e.name = 'InterviewQuestionsHttpError'
  e.httpStatus = status
  throw e
}

function dashScopeCompatibleBaseUrl() {
  return (process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '')
}

async function dashScopeChatCompletions(body: Record<string, unknown>) {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim()
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY missing')
  const base = dashScopeCompatibleBaseUrl()
  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  const data = (await resp.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string }; message?: string }
  if (!resp.ok) {
    const msg = data?.error?.message || data?.message || JSON.stringify(data)
    throw new Error(msg)
  }
  return data
}

function parseQuestionsJson(raw: string, count: number): { id: string; text: string }[] | null {
  try {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
    const parsed = JSON.parse(cleaned) as { questions?: unknown }
    const list = parsed?.questions
    if (!Array.isArray(list) || list.length === 0) return null
    return list
      .slice(0, count)
      .map((q: unknown, idx: number) => {
        const o = q as { id?: string; text?: string }
        return {
          id: String(o?.id || `Q${idx + 1}`),
          text: String(o?.text || '').trim()
        }
      })
      .filter((q) => q.text)
  } catch {
    return null
  }
}

type AiInterviewScore = {
  score: number
  passed: boolean
  overallFeedback: string
  dimensionScores: Record<string, number>
  suggestions: string[]
  riskPoints: string[]
}

function parseAiInterviewScoreJson(raw: string): AiInterviewScore | null {
  try {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
    const parsed = JSON.parse(cleaned) as Partial<AiInterviewScore>
    const score = Number(parsed?.score)
    const passed = Boolean(parsed?.passed)
    const overallFeedback = String(parsed?.overallFeedback || '').trim()
    const dimensionScoresRaw = parsed?.dimensionScores && typeof parsed.dimensionScores === 'object' ? parsed.dimensionScores : {}
    const dimensionScores: Record<string, number> = {}
    for (const [k, v] of Object.entries(dimensionScoresRaw as Record<string, unknown>)) {
      const n = Number(v)
      if (!Number.isFinite(n)) continue
      dimensionScores[String(k)] = Math.max(0, Math.min(100, Math.round(n)))
    }
    const suggestions = Array.isArray(parsed?.suggestions) ? parsed!.suggestions!.map((x) => String(x)).filter(Boolean) : []
    const riskPoints = Array.isArray(parsed?.riskPoints) ? parsed!.riskPoints!.map((x) => String(x)).filter(Boolean) : []
    if (!Number.isFinite(score) || !overallFeedback) return null
    return {
      score: Math.max(0, Math.min(100, Math.round(score))),
      passed,
      overallFeedback,
      dimensionScores,
      suggestions,
      riskPoints
    }
  } catch {
    return null
  }
}

type InterviewReportPayload = {
  sessionId: string
  jobCode: string
  candidateName: string
  candidatePhone?: string
  candidateOpenId?: string
  score: number
  passed: boolean
  overallFeedback: string
  dimensionScores: Record<string, number>
  suggestions: string[]
  riskPoints: string[]
  behaviorSignals: Record<string, unknown>
  qa: Array<{ questionId: string; question: string; answer: string }>
}

/** 无会话 id 时仍写入 interview_reports 并推进 screening.pipeline_stage（占位 session_id ≤128） */
function ensureInterviewReportSessionId(jobId: string, sessionId: string): string {
  const trimmed = String(sessionId || '').trim()
  if (trimmed) return trimmed.slice(0, 128)
  const jc = String(jobId || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '') || 'JOB'
  const rand = crypto.randomBytes(6).toString('hex').toUpperCase()
  return `SUBMIT-${jc}-${rand}`.slice(0, 128)
}

async function markResumeScreeningPipelineReportDone(
  jobCode: string,
  candidateName: string,
  candidatePhone?: string
) {
  const jc = String(jobCode || '').trim()
  const cn = String(candidateName || '').trim()
  const cp = normalizeCnMobile(String(candidatePhone || '').trim())
  if (!jc || (!cn && !cp)) return
  try {
    if (cp) {
      await mysqlPool.query(
        `UPDATE resume_screenings SET pipeline_stage = 'report_done'
         WHERE UPPER(TRIM(job_code)) = UPPER(?) AND TRIM(candidate_phone) = TRIM(?)`,
        [jc, cp]
      )
      return
    }
    await mysqlPool.query(
      `UPDATE resume_screenings SET pipeline_stage = 'report_done'
       WHERE UPPER(TRIM(job_code)) = UPPER(?) AND TRIM(candidate_name) = TRIM(?)`,
      [jc, cn]
    )
  } catch (e: unknown) {
    const err = e as { errno?: number; code?: string; sqlMessage?: string }
    if (
      err.errno === 1054 ||
      err.code === 'ER_BAD_FIELD_ERROR' ||
      (String(err.sqlMessage || '').includes('Unknown column') &&
        String(err.sqlMessage || '').includes('pipeline_stage'))
    ) {
      return
    }
    console.warn('[markResumeScreeningPipelineReportDone]', e)
  }
}

async function upsertInterviewReport(payload: InterviewReportPayload) {
  if (!payload.sessionId || !payload.jobCode || !payload.candidateName) return
  const normalizedPhone = normalizeCnMobile(String(payload.candidatePhone || '').trim())
  try {
    await mysqlPool.query(
      `INSERT INTO interview_reports (
         session_id, job_code, candidate_name, candidate_phone, candidate_openid,
         overall_score, passed, overall_feedback,
         dimension_scores, suggestions, risk_points, behavior_signals, qa_json
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         job_code=VALUES(job_code),
         candidate_name=VALUES(candidate_name),
         candidate_phone=VALUES(candidate_phone),
         candidate_openid=VALUES(candidate_openid),
         overall_score=VALUES(overall_score),
         passed=VALUES(passed),
         overall_feedback=VALUES(overall_feedback),
         dimension_scores=VALUES(dimension_scores),
         suggestions=VALUES(suggestions),
         risk_points=VALUES(risk_points),
         behavior_signals=VALUES(behavior_signals),
         qa_json=VALUES(qa_json),
         updated_at=NOW()`,
      [
        payload.sessionId,
        payload.jobCode,
        payload.candidateName,
        normalizedPhone || null,
        payload.candidateOpenId || null,
        payload.score,
        payload.passed ? 1 : 0,
        payload.overallFeedback,
        JSON.stringify(payload.dimensionScores || {}),
        JSON.stringify(payload.suggestions || []),
        JSON.stringify(payload.riskPoints || []),
        JSON.stringify(payload.behaviorSignals || {}),
        JSON.stringify(payload.qa || [])
      ]
    )
  } catch (e: unknown) {
    const err = e as { errno?: number; code?: string; sqlMessage?: string }
    const missingPhoneColumn =
      err.errno === 1054 ||
      err.code === 'ER_BAD_FIELD_ERROR' ||
      (String(err.sqlMessage || '').includes('Unknown column') &&
        String(err.sqlMessage || '').includes('candidate_phone'))
    if (!missingPhoneColumn) throw e
    await mysqlPool.query(
      `INSERT INTO interview_reports (
         session_id, job_code, candidate_name, candidate_openid,
         overall_score, passed, overall_feedback,
         dimension_scores, suggestions, risk_points, behavior_signals, qa_json
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         job_code=VALUES(job_code),
         candidate_name=VALUES(candidate_name),
         candidate_openid=VALUES(candidate_openid),
         overall_score=VALUES(overall_score),
         passed=VALUES(passed),
         overall_feedback=VALUES(overall_feedback),
         dimension_scores=VALUES(dimension_scores),
         suggestions=VALUES(suggestions),
         risk_points=VALUES(risk_points),
         behavior_signals=VALUES(behavior_signals),
         qa_json=VALUES(qa_json),
         updated_at=NOW()`,
      [
        payload.sessionId,
        payload.jobCode,
        payload.candidateName,
        payload.candidateOpenId || null,
        payload.score,
        payload.passed ? 1 : 0,
        payload.overallFeedback,
        JSON.stringify(payload.dimensionScores || {}),
        JSON.stringify(payload.suggestions || []),
        JSON.stringify(payload.riskPoints || []),
        JSON.stringify(payload.behaviorSignals || {}),
        JSON.stringify(payload.qa || [])
      ]
    )
  }
  await markResumeScreeningPipelineReportDone(payload.jobCode, payload.candidateName, normalizedPhone || undefined)
}

type ResumeScreeningAiResult = {
  candidateName: string
  /** 从简历解析的大陆手机号，可能为空 */
  candidatePhone?: string
  matchScore: number
  status: string
  summary: string
  skillScore: number
  experienceScore: number
  educationScore: number
  stabilityScore: number
  /** 结构化评估结果 JSON（字符串） */
  evaluationJson?: string
}

function clampResumeScore(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

/** 无模型或旧数据时，用综合分估算四维（与历史前端 toDims 一致） */
function deriveResumeDimensionScores(overall: number): Pick<
  ResumeScreeningAiResult,
  'skillScore' | 'experienceScore' | 'educationScore' | 'stabilityScore'
> {
  const s = clampResumeScore(overall)
  return {
    skillScore: clampResumeScore(s + 7),
    experienceScore: clampResumeScore(s + 2),
    educationScore: clampResumeScore(s + 10),
    stabilityScore: clampResumeScore(s - 12)
  }
}

function firstFiniteNumber(...vals: unknown[]): number | null {
  for (const v of vals) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

function parseResumeScreeningAiJson(raw: string): ResumeScreeningAiResult | null {
  try {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
    const parsed = JSON.parse(cleaned) as Record<string, unknown>
    const candidateName = sanitizeCandidateName(parsed?.candidateName)
    const matchScore = Number(parsed?.matchScore)
    const status = String(parsed?.status || 'AI分析完成').trim() || 'AI分析完成'
    const summary = String(parsed?.summary || '').trim()
    if (!candidateName || !Number.isFinite(matchScore) || !summary) return null
    const overall = clampResumeScore(matchScore)
    const fallbackDims = deriveResumeDimensionScores(overall)
    const skillScore = clampResumeScore(
      firstFiniteNumber(
        parsed.skillScore,
        parsed.skill_score,
        (parsed.dimensionScores as Record<string, unknown> | undefined)?.skill,
        (parsed.dimensionScores as Record<string, unknown> | undefined)?.skillScore
      ) ?? fallbackDims.skillScore
    )
    const experienceScore = clampResumeScore(
      firstFiniteNumber(
        parsed.experienceScore,
        parsed.experience_score,
        (parsed.dimensionScores as Record<string, unknown> | undefined)?.experience,
        (parsed.dimensionScores as Record<string, unknown> | undefined)?.experienceScore
      ) ?? fallbackDims.experienceScore
    )
    const educationScore = clampResumeScore(
      firstFiniteNumber(
        parsed.educationScore,
        parsed.education_score,
        (parsed.dimensionScores as Record<string, unknown> | undefined)?.education,
        (parsed.dimensionScores as Record<string, unknown> | undefined)?.educationScore
      ) ?? fallbackDims.educationScore
    )
    const stabilityScore = clampResumeScore(
      firstFiniteNumber(
        parsed.stabilityScore,
        parsed.stability_score,
        (parsed.dimensionScores as Record<string, unknown> | undefined)?.stability,
        (parsed.dimensionScores as Record<string, unknown> | undefined)?.stabilityScore
      ) ?? fallbackDims.stabilityScore
    )
    const phoneRaw = String(parsed?.candidatePhone || parsed?.phone || parsed?.mobile || '').trim()
    const phoneParsed = normalizeCnMobile(phoneRaw)
    return {
      candidateName,
      ...(phoneParsed ? { candidatePhone: phoneParsed } : {}),
      matchScore: overall,
      status,
      summary,
      skillScore,
      experienceScore,
      educationScore,
      stabilityScore
    }
  } catch {
    return null
  }
}

function buildResumeEvalPromptForServer(params: {
  jobTitle: string
  department: string
  jdText: string
  resumeText: string
}): { userPrompt: string; systemPrompt: string } {
  const clipResume = params.resumeText.replace(/\s+/g, ' ').slice(0, 14000)
  const clipJd = (params.jdText || '').replace(/\s+/g, ' ').slice(0, 8000)
  const isRisk = /风控|反欺诈|信用|催收|合规|授信|风险/.test(
    `${params.jobTitle} ${params.department} ${params.jdText}`
  )
  const userPrompt = [
    `岗位名称：${params.jobTitle}`,
    `部门：${params.department || '—'}`,
    `JD：${clipJd || '（无正文）'}`,
    `简历全文（节选）：${clipResume}`
  ].join('\n')
  const riskDimKeys = 'risk_fit,depth,impact,data_skill,stability_growth,communication_business'
  const engDimKeys = 'tech_fit,engineering_depth,impact,code_quality,stability_growth,communication_business'
  const dimKeys = isRisk ? riskDimKeys : engDimKeys
  const systemPrompt =
    (isRisk
      ? '你是资深招聘评估专家。根据岗位JD与简历文本进行风控运营岗位评估。'
      : '你是资深招聘评估专家。根据岗位JD与简历文本进行研发岗位评估。') +
    '只输出 JSON 对象，不要 markdown，不要多余文本。' +
    '必须输出字段：schema_version,job_type,hard_gate,dimension_scores,total_score,strengths,risks,decision,summary,candidate_profile,candidate_name。' +
    'candidate_name：从简历中识别的候选人真实姓名（2～30 个字符）；能识别则必填，无法识别时填空字符串 ""（不要用「未知」「候选人」等占位）。' +
    'candidate_profile 为对象，从简历原文抽取候选人静态信息（无依据填 null；字符串可填空串）；其中可含 name 或「姓名」键，与 candidate_name 一致即可。' +
    '必填尽量填写：school（毕业/就读院校）、job_title（应聘职位，仅填标准岗位序列名称，勿带初级/中级等级别前缀，勿写 JD 要求）、email、candidate_phone、current_company（现任或最近工作单位全称，勿写职位名）、' +
    'gender（男|女|未知）、age（整数|null）、work_experience_years（工作年限年数|null）、major、education、' +
    'current_address、graduation_date、arrival_time、id_number、is_third_party、' +
    'has_degree、is_unified_enrollment、expected_salary、verifiable、recruitment_channel、resume_uploaded（布尔，无依据 null）。' +
    '禁止编造：无法从简历判断的字段必须为 null。' +
    `dimension_scores 必须包含：${dimKeys}。` +
    '关键：dimension_scores 的每个维度都必须是对象，格式为 {"score":0-100数字,"evidence":["证据点：...｜摘录：..."]}，evidence 至少 1 条。' +
    '不要把维度写成纯数字。' +
    'risks 必须是对象数组，格式为 {"risk":"...","interview_question":"..."}。' +
    'decision 仅允许：建议进入面试 / 建议备选 / 不建议推进。'
  return { userPrompt, systemPrompt }
}

function pickProfileStr(v: unknown): string {
  return String(v ?? '')
    .trim()
    .replace(/\u00a0/g, ' ')
}

function pickProfileBool(v: unknown): boolean | null {
  if (v === true || v === false) return v
  if (v === 1 || v === '1' || v === 'true' || v === '是') return true
  if (v === 0 || v === '0' || v === 'false' || v === '否') return false
  return null
}

function pickProfileInt(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : null
}

/** 简历结构化字段：写入 evaluation_json.candidate_profile，供管理端表格展示 */
function sanitizeCandidateProfile(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const p = raw as Record<string, unknown>
  const gender = pickProfileStr(p.gender ?? p['性别']) || null
  const major = pickProfileStr(p.major ?? p['专业']) || null
  const education = pickProfileStr(p.education ?? p['学历']) || null
  const personName = pickProfileStr(p.name ?? p['姓名'] ?? p.candidate_name) || null
  const jobTitleRaw = pickProfileStr(
    p.job_title ?? p['应聘岗位'] ?? p.expected_job ?? p.intent_job ?? p.position_title ?? p['岗位']
  )
  const job_title_matched = jobTitleRaw ? matchJobTitleToStandardProfileOption(jobTitleRaw) : null
  const job_title_norm = jobTitleRaw ? normalizeExtractedJobTitleForDisplay(jobTitleRaw) : ''
  const job_title =
    job_title_matched || (job_title_norm && job_title_norm.length <= 128 ? job_title_norm : null) || null
  const current_company =
    pickProfileStr(p.current_company ?? p['当前公司'] ?? p.employer ?? p.work_company ?? p.company_name) || null
  const school = pickProfileStr(p.school ?? p['学校'] ?? p.university ?? p.college) || null
  const email = pickProfileStr(p.email ?? p.mail ?? p['邮箱'] ?? p.E_mail) || null
  const current_address = pickProfileStr(p.current_address ?? p.address ?? p['现住址'] ?? p['地址']) || null
  const graduation_date = pickProfileStr(p.graduation_date ?? p['毕业时间']) || null
  const arrival_time = pickProfileStr(p.arrival_time ?? p['到岗时间']) || null
  const id_number = pickProfileStr(p.id_number ?? p.id_no ?? p['证件号码'] ?? p['身份证号']) || null
  const phoneNorm =
    normalizeCnMobile(String(p.candidate_phone ?? p.phone ?? p.mobile ?? '').trim()) ||
    pickProfileStr(p.candidate_phone ?? p.phone ?? p.mobile) ||
    null
  const recruitment_channel = pickProfileStr(p.recruitment_channel ?? p['招聘渠道']) || null
  const expected_salary = pickProfileStr(p.expected_salary ?? p['期望薪资']) || null
  const out: Record<string, unknown> = {
    ...(personName ? { name: personName } : {}),
    gender,
    age: pickProfileInt(p.age ?? p['年龄']),
    work_experience_years: pickProfileInt(p.work_experience_years ?? p.workYears ?? p['工作经验']),
    major,
    education,
    school: school || null,
    job_title: job_title || null,
    email: email || null,
    current_address: current_address || null,
    current_company: current_company || null,
    graduation_date: graduation_date || null,
    arrival_time: arrival_time || null,
    id_number: id_number || null,
    is_third_party: pickProfileBool(p.is_third_party ?? p['是否第三方']),
    candidate_phone: phoneNorm,
    has_degree: pickProfileBool(p.has_degree ?? p['是否有学位']),
    is_unified_enrollment: pickProfileBool(p.is_unified_enrollment ?? p['是否统招']),
    expected_salary: expected_salary || null,
    verifiable: pickProfileBool(p.verifiable ?? p['是否可查']),
    recruitment_channel: recruitment_channel || null,
    resume_uploaded: pickProfileBool(p.resume_uploaded ?? p['是否上传简历'])
  }
  const hasAny = Object.values(out).some((x) => x !== null && x !== undefined && x !== '')
  return hasAny ? out : undefined
}

type ResumeProfileRow = {
  candidateName: string
  gender: string | null
  age: number | null
  workExperienceYears: number | null
  jobTitle: string | null
  school: string | null
  candidatePhone: string | null
  email: string | null
  currentAddress: string | null
  currentCompany: string | null
  major: string | null
  education: string | null
  currentPosition: string | null
  graduationDate: string | null
  arrivalTime: string | null
  idNumber: string | null
  isThirdParty: number | null
  expectedSalary: string | null
  recruitmentChannel: string | null
  hasDegree: number | null
  isUnifiedEnrollment: number | null
  verifiable: number | null
  resumeUploaded: number | null
}

function profileBoolToTinyInt(v: unknown): number | null {
  const b = pickProfileBool(v)
  if (b === null) return null
  return b ? 1 : 0
}

function resumeProfileRowFromValues(input: {
  candidateName?: unknown
  profile?: unknown
}): ResumeProfileRow {
  const p =
    input.profile && typeof input.profile === 'object' && !Array.isArray(input.profile)
      ? (input.profile as Record<string, unknown>)
      : ({} as Record<string, unknown>)
  const candidateName = sanitizeCandidateName(input.candidateName) || '候选人'
  const jobTitleRaw = pickProfileStr(
    p.job_title ?? p['应聘岗位'] ?? p.expected_job ?? p.intent_job ?? p.position_title ?? p['岗位']
  )
  const jobTitleStd = jobTitleRaw ? matchJobTitleToStandardProfileOption(jobTitleRaw) : null
  const jobTitleFinal =
    jobTitleStd || (jobTitleRaw ? (jobTitleRaw.length <= 128 ? jobTitleRaw : jobTitleRaw.slice(0, 128)) : '')
  return {
    candidateName,
    gender: pickProfileStr(p.gender) || null,
    age: pickProfileInt(p.age),
    workExperienceYears: pickProfileInt(p.work_experience_years),
    jobTitle: jobTitleFinal ? jobTitleFinal : null,
    school: pickProfileStr(p.school ?? p['学校']) || null,
    candidatePhone:
      normalizeCnMobile(String(p.candidate_phone ?? p.phone ?? p.mobile ?? '')) ||
      pickProfileStr(p.candidate_phone ?? p.phone ?? p.mobile) ||
      null,
    email: pickProfileStr(p.email ?? p.mail ?? p['邮箱']) || null,
    currentAddress: pickProfileStr(p.current_address ?? p.address ?? p['现住址']) || null,
    currentCompany: pickProfileStr(p.current_company ?? p['当前公司']) || null,
    major: pickProfileStr(p.major) || null,
    education: pickProfileStr(p.education) || null,
    currentPosition: null,
    graduationDate: pickProfileStr(p.graduation_date ?? p['毕业时间']) || null,
    arrivalTime: pickProfileStr(p.arrival_time ?? p['到岗时间']) || null,
    idNumber: pickProfileStr(p.id_number ?? p.id_no ?? p['证件号码']) || null,
    isThirdParty: profileBoolToTinyInt(p.is_third_party ?? p['是否第三方']),
    expectedSalary: pickProfileStr(p.expected_salary) || null,
    recruitmentChannel: pickProfileStr(p.recruitment_channel) || null,
    hasDegree: profileBoolToTinyInt(p.has_degree),
    isUnifiedEnrollment: profileBoolToTinyInt(p.is_unified_enrollment),
    verifiable: profileBoolToTinyInt(p.verifiable),
    resumeUploaded: profileBoolToTinyInt(p.resume_uploaded)
  }
}

const PLACEHOLDER_NAMES = new Set(
  ['未知', '无', '未提供', '不详', '候选人', '未识别', '暂无', '姓名', '名字', 'n/a', 'na', 'null', 'none']
)

function isPlaceholderCandidateName(s: string): boolean {
  const t = s.trim().toLowerCase()
  if (!t) return true
  if (PLACEHOLDER_NAMES.has(s.trim())) return true
  if (PLACEHOLDER_NAMES.has(t)) return true
  return false
}

/** 候选人姓名清洗：过滤明显非姓名文本（句子、职责片段、占位词等）。 */
function sanitizeCandidateName(raw: unknown): string {
  const n = String(raw ?? '')
    .trim()
    .replace(/^[`"'“”‘’\s]+|[`"'“”‘’\s]+$/g, '')
    .replace(/[,，.。;；、]+$/g, '')
    .replace(/\s+/g, ' ')
  if (!n || isPlaceholderCandidateName(n)) return ''
  if (n.length < 2 || n.length > 30) return ''
  // 姓名不应包含明显句子标点、长数字、邮箱/链接等噪音。
  if (/[，。；;：:！？!?、]/.test(n)) return ''
  if (/\d{4,}/.test(n)) return ''
  if (/[@/\\#]/.test(n)) return ''
  // 允许中文姓名（含中点）或英文姓名（空格/点/连字符）。
  const zhName = /^[\u4e00-\u9fa5·•．]{2,16}$/.test(n)
  const enName = /^[A-Za-z][A-Za-z\s.'-]{1,29}$/.test(n)
  return zhName || enName ? n.slice(0, 64) : ''
}

function extractCandidateNameFromEvalParsed(parsed: Record<string, unknown>, rawProfile: unknown): string {
  const top = sanitizeCandidateName(parsed.candidate_name ?? parsed.candidateName)
  if (top) return top
  if (rawProfile && typeof rawProfile === 'object' && !Array.isArray(rawProfile)) {
    const rp = rawProfile as Record<string, unknown>
    const fromProf = sanitizeCandidateName(pickProfileStr(rp.name ?? rp['姓名'] ?? rp.candidate_name))
    if (fromProf) return fromProf
  }
  return ''
}

function normalizeResumeEvalDimension(
  value: unknown,
  dimName: string
): { score: number; evidence: string[] } {
  if (typeof value === 'number') {
    return {
      score: clampResumeScore(value),
      evidence: [`模型未返回该维度证据，请结合简历原文与JD人工复核（${dimName}）`]
    }
  }
  const o = (value || {}) as { score?: unknown; evidence?: unknown }
  const score = clampResumeScore(Number(o.score))
  const evidence = Array.isArray(o.evidence)
    ? o.evidence.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3)
    : []
  return {
    score,
    evidence:
      evidence.length > 0 ? evidence : [`模型未返回该维度证据，请结合简历原文与JD人工复核（${dimName}）`]
  }
}

function parseResumeEvalToScreeningResult(raw: string, resumePlain?: string): ResumeScreeningAiResult | null {
  try {
    const cleaned = String(raw || '')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
    const parsed = JSON.parse(cleaned) as Record<string, unknown>
    const totalScore = clampResumeScore(Number(parsed.total_score))
    if (!Number.isFinite(totalScore)) return null
    const rawDim = (parsed.dimension_scores || {}) as Record<string, unknown>
    const dim: Record<string, { score: number; evidence: string[] }> = {}
    for (const [k, v] of Object.entries(rawDim)) {
      dim[String(k)] = normalizeResumeEvalDimension(v, String(k))
    }
    const fallback = deriveResumeDimensionScores(totalScore)
    const skillScore = clampResumeScore(
      firstFiniteNumber(dim.data_skill?.score, dim.code_quality?.score) ?? fallback.skillScore
    )
    const experienceScore = clampResumeScore(
      firstFiniteNumber(dim.depth?.score, dim.engineering_depth?.score) ?? fallback.experienceScore
    )
    const educationScore = clampResumeScore(
      firstFiniteNumber(dim.communication_business?.score) ?? fallback.educationScore
    )
    const stabilityScore = clampResumeScore(
      firstFiniteNumber(dim.stability_growth?.score) ?? fallback.stabilityScore
    )
    const summary = String(parsed.summary || '').trim()
    const decision = String(parsed.decision || '建议备选').trim()
    const strengths = Array.isArray(parsed.strengths)
      ? parsed.strengths.map((x) => String(x || '').trim()).filter(Boolean)
      : []
    const risks = Array.isArray(parsed.risks)
      ? parsed.risks
          .map((r) => {
            if (typeof r === 'string') {
              const s = String(r || '').trim()
              return s ? { risk: s, interview_question: '' } : null
            }
            const o = (r || {}) as { risk?: unknown; interview_question?: unknown }
            const risk = String(o.risk || '').trim()
            const interviewQuestion = String(o.interview_question || '').trim()
            if (!risk && !interviewQuestion) return null
            return { risk, interview_question: interviewQuestion }
          })
          .filter(Boolean) as Array<{ risk: string; interview_question: string }>
      : []
    const mergedSummary = [
      summary || '暂无总结',
      strengths.length ? `优势：${strengths.slice(0, 3).join('；')}` : '',
      risks.length ? `风险：${risks.slice(0, 3).map((x) => x.risk).join('；')}` : '',
      `结论：${decision || '建议备选'}`
    ]
      .filter(Boolean)
      .join(' | ')
    const { candidate_profile: rawProfile, ...parsedRest } = parsed as Record<string, unknown> & {
      candidate_profile?: unknown
    }
    const sanitized = sanitizeCandidateProfile(rawProfile)
    const profileMerged = enrichCandidateProfileFromPlainText(sanitized, resumePlain?.trim() || '')
    const profileFinal = profileRecordHasMeaningfulField(profileMerged) ? profileMerged : undefined
    const candidateNameAi = extractCandidateNameFromEvalParsed(parsed, rawProfile)
    const normalizedEval = {
      ...parsedRest,
      dimension_scores: dim,
      risks,
      ...(profileFinal ? { candidate_profile: profileFinal } : {}),
      ...(candidateNameAi ? { candidate_name: candidateNameAi } : {})
    }
    return {
      candidateName: candidateNameAi,
      matchScore: totalScore,
      status: 'AI分析完成',
      summary: mergedSummary,
      skillScore,
      experienceScore,
      educationScore,
      stabilityScore,
      evaluationJson: JSON.stringify(normalizedEval)
    }
  } catch {
    return null
  }
}

function normalizeCnMobile(raw: string): string | null {
  const d = String(raw || '').replace(/\D/g, '')
  if (/^1[3-9]\d{9}$/.test(d)) return d
  if (d.length === 13 && d.startsWith('86')) {
    const rest = d.slice(2)
    if (/^1[3-9]\d{9}$/.test(rest)) return rest
  }
  return null
}

/** 从简历正文中抓取中国大陆手机号（优先带「手机/电话」等标签） */
function extractPhoneFromResumeText(text: string): string | null {
  const slice = text.replace(/\r\n/g, '\n').slice(0, 12000)
  const labeled = slice.match(
    /(?:手机|移动电话|联系电话|联系方式|电话|Phone|Tel|Mobile)[:：\s]*([+＋0-9\s\-—–]{11,22})/i
  )
  if (labeled?.[1]) {
    const n = normalizeCnMobile(labeled[1])
    if (n) return n
  }
  const compact = slice.replace(/[\s\-—–]/g, '')
  const m = compact.match(/1[3-9]\d{9}/g)
  if (m?.length) {
    for (const x of m) {
      const n = normalizeCnMobile(x)
      if (n) return n
    }
  }
  return null
}

/** 按规范化手机号维护 resume_candidates，返回主键；无手机号或表未迁移时返回 null */
async function ensureResumeCandidateIdForPhone(phoneNorm: string | null, displayName: string): Promise<number | null> {
  const p = phoneNorm && String(phoneNorm).trim() ? String(phoneNorm).trim() : ''
  if (!p) return null
  const name = String(displayName || '').trim().slice(0, 128) || null
  try {
    await mysqlPool.query(
      `INSERT INTO resume_candidates (phone, display_name) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         id = LAST_INSERT_ID(id),
         display_name = COALESCE(VALUES(display_name), resume_candidates.display_name),
         updated_at = CURRENT_TIMESTAMP`,
      [p, name]
    )
    const [lid] = await mysqlPool.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() AS i')
    const id = Number((lid[0] as { i?: unknown })?.i)
    return Number.isFinite(id) && id > 0 ? Math.floor(id) : null
  } catch (e: unknown) {
    const ex = e as { code?: string; errno?: number }
    if (ex.code === 'ER_NO_SUCH_TABLE' || ex.errno === 1146) return null
    throw e
  }
}

/**
 * 将 resume_screenings 与 resume_candidates 关联（同人 = 规范化手机号一致）。
 * 手机号无法规范化时 candidate_id 置空。表或列未迁移时静默跳过。
 */
async function linkResumeScreeningToCandidateByPhone(
  screeningId: number,
  phoneRaw: string | null | undefined,
  displayName: string
): Promise<number | null> {
  const sid = Math.floor(screeningId)
  if (!Number.isFinite(sid) || sid <= 0) return null
  const norm = normalizeCnMobile(String(phoneRaw || '').trim())
  try {
    if (!norm) {
      await mysqlPool.query('UPDATE resume_screenings SET candidate_id = NULL WHERE id = ?', [sid])
      return null
    }
    const cid = await ensureResumeCandidateIdForPhone(norm, displayName)
    if (cid) {
      await mysqlPool.query('UPDATE resume_screenings SET candidate_id = ? WHERE id = ?', [cid, sid])
      return cid
    }
    return null
  } catch (e: unknown) {
    const ex = e as { errno?: number; code?: string }
    if (ex.errno === 1054 || ex.code === 'ER_BAD_FIELD_ERROR' || ex.code === 'ER_NO_SUCH_TABLE' || ex.errno === 1146) {
      return null
    }
    throw e
  }
}

function extractEmailFromResumeText(text: string): string | null {
  const slice = text.replace(/\r\n/g, '\n').slice(0, 28000)
  const re = /\b[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}\b/g
  const found = slice.match(re)
  if (!found?.length) return null
  const badDomains = new Set(['example.com', 'test.com', 'domain.com', 'email.com', 'yourname.com'])
  for (const raw of found) {
    const m = raw.trim()
    const dom = m.split('@')[1]?.toLowerCase()
    if (dom && badDomains.has(dom)) continue
    if (m.length >= 5 && m.length <= 128) return m
  }
  return found[0].trim().length <= 128 ? found[0].trim() : null
}

/** 从简历正文抓取院校（常见标签 + 教育区块含「大学/学院」的行） */
function extractSchoolFromResumeText(text: string): string | null {
  const t = text.replace(/\r\n/g, '\n').replace(/[\t\u3000]+/g, ' ').slice(0, 26000)
  const labeled: RegExp[] = [
    /(?:毕业院校|本科院校|硕士院校|博士院校|就读院校|院校|学校)[:：\s\u3000]+([^\n\r,，;；|｜]{2,48})/,
    /(?:学校名称|毕业学校)[:：\s\u3000]+([^\n\r,，;；|｜]{2,48})/
  ]
  for (const re of labeled) {
    const m = t.match(re)
    if (m?.[1]) {
      const s = m[1].trim().replace(/\s{2,}/g, ' ').replace(/^[（(][^)）]*[)）]\s*/, '').slice(0, 80)
      if (s.length >= 2 && !/^[:：\s]+$/.test(s) && !/^\d+$/.test(s)) return s
    }
  }
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean)
  let inEdu = false
  for (let i = 0; i < Math.min(lines.length, 100); i++) {
    const line = lines[i]
    if (/^(教育背景|教育经历|学历信息|Education)/i.test(line)) inEdu = true
    if (inEdu && /(大学|学院|学校)$/.test(line) && line.length >= 4 && line.length <= 44) {
      if (!/^(专业|学历|本科|硕士|博士|时间|日期)/.test(line)) return line.slice(0, 80)
    }
  }
  return null
}

/** 从简历正文抓取现任/最近工作单位 */
function extractCurrentCompanyFromResumeText(text: string): string | null {
  const t = text.replace(/\r\n/g, '\n').replace(/[\t\u3000]+/g, ' ').slice(0, 26000)
  const labeled: RegExp[] = [
    /(?:现任公司|目前公司|就职公司|工作单位|任职公司|所在公司|公司名称|就职单位|目前任职)[:：\s\u3000]+([^\n\r,，;；|｜]{2,80})/
  ]
  for (const re of labeled) {
    const m = t.match(re)
    if (m?.[1]) {
      const s = m[1]
        .trim()
        .replace(/\s{2,}/g, ' ')
        .replace(/^[（(][^)）]*[)）]\s*/, '')
        .slice(0, 120)
      if (s.length >= 2 && !/^[:：\s\d.-]+$/.test(s)) return s
    }
  }
  return null
}

/** 应聘/求职岗位（与 current_position 现任岗区分） */
function extractJobIntentFromResumeText(text: string): string | null {
  const t = text.replace(/\r\n/g, '\n').replace(/[\t\u3000]+/g, ' ').slice(0, 22000)
  const patterns: RegExp[] = [
    /(?:求职意向|应聘岗位|期望岗位|意向岗位|应聘职位|期望职位|目标岗位|求职岗位|意向职位|期望从事)[:：\s\u3000]+([^\n\r,，;；|｜]{2,48})/,
    /(?:应聘|求职)[:：\s\u3000]+([^\n\r,，]{2,40}(?:工程师|开发|经理|主管|专员|设计师|分析师|顾问|总监|负责人|架构师|运营|产品))/
  ]
  for (const re of patterns) {
    const m = t.match(re)
    if (m?.[1]) {
      const s = normalizeExtractedJobTitleForDisplay(m[1].trim().replace(/\s{2,}/g, ' ').slice(0, 64))
      if (s.length >= 2) return s
    }
  }
  return null
}

function profileRecordHasMeaningfulField(out: Record<string, unknown>): boolean {
  return Object.values(out).some((x) => x !== null && x !== undefined && x !== '')
}

/** 在模型或清洗结果基础上，用正文正则补全缺失的学校/邮箱/应聘岗位等 */
function enrichCandidateProfileFromPlainText(
  base: Record<string, unknown> | undefined,
  plain: string
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(base || {}) }
  const pStr = (k: string) => pickProfileStr(out[k])
  const clip = plain.replace(/\r\n/g, '\n')
  if (!pStr('email')) {
    const e = extractEmailFromResumeText(clip)
    if (e) out.email = e
  }
  if (!pStr('school')) {
    const s = extractSchoolFromResumeText(clip)
    if (s) out.school = s
  }
  if (!pStr('job_title')) {
    const j = extractJobIntentFromResumeText(clip)
    if (j) out.job_title = j
  }
  if (!pStr('candidate_phone')) {
    const ph = extractPhoneFromResumeText(clip)
    if (ph) out.candidate_phone = ph
  }
  if (!pStr('current_company')) {
    const co = extractCurrentCompanyFromResumeText(clip)
    if (co) out.current_company = co
  }
  return out
}

function guessCandidateNameFromResume(text: string): string {
  const t = text.replace(/\r\n/g, '\n').slice(0, 12000)
  const patterns: RegExp[] = [
    /(?:姓\s*名|姓名|名字)[:：\s\u3000]*([^\s\n，,；;、]{2,30})/,
    /(?:申请人|求职者|应聘人|候选人姓名)[:：\s\u3000]*([^\s\n，,；;]{2,30})/,
    /Name\s*[:：\s]*([A-Za-z][A-Za-z\s.'-]{1,40})/i
  ]
  for (const re of patterns) {
    const m = t.match(re)
    if (m?.[1]) {
      let n = String(m[1])
        .trim()
        .replace(/[,，.。;；、]+$/g, '')
        .replace(/\s+/g, ' ')
      if (/^\d+$/.test(n)) continue
      if (isPlaceholderCandidateName(n)) continue
      if (n.length >= 2 && n.length <= 32) return n.slice(0, 64)
    }
  }
  const skipLine =
    /^(简历|个人简历|curriculum\s*vitae|resume|cv|个人简介|自我评价|求职意向|联系方式|教育背景|工作经历|项目经验|专业技能|电话|手机|邮箱|e-mail|@\d)/i
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean)
  for (const line of lines.slice(0, 25)) {
    if (line.length < 2 || line.length > 28) continue
    if (skipLine.test(line)) continue
    const digits = line.replace(/\D/g, '')
    if (digits.length >= 11 && /1[3-9]\d{9}/.test(digits)) continue
    if (/[@#]/.test(line) && line.length > 14) continue
    if (/^[0-9\s\-—–:+（）()]+$/.test(line)) continue
    if (/^[\u4e00-\u9fa5·•．\s]{2,8}$/.test(line)) return line.slice(0, 64)
    if (/^[A-Za-z][a-z]{1,12}(\s+[A-Za-z]+){0,2}$/.test(line)) return line.slice(0, 64)
  }
  return '候选人'
}

function fallbackResumeScreening(resumeText: string, jdText: string, jobTitle: string): ResumeScreeningAiResult {
  const candidateName = guessCandidateNameFromResume(resumeText)
  const resumeLower = resumeText.toLowerCase()
  const jd = (jdText || jobTitle || '').trim()
  const tokens = jd
    .split(/[\s,，.。;；、/|]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
  const uniq = [...new Set(tokens)].slice(0, 40)
  let hits = 0
  for (const w of uniq) {
    if (resumeLower.includes(w.toLowerCase())) hits++
  }
  const ratio = uniq.length ? hits / uniq.length : 0
  const matchScore = Math.min(100, Math.max(35, Math.round(42 + ratio * 58)))
  const dims = deriveResumeDimensionScores(matchScore)
  const phoneFound = extractPhoneFromResumeText(resumeText)
  const heurProfile = enrichCandidateProfileFromPlainText({}, resumeText)
  const hasHeurProfile = profileRecordHasMeaningfulField(heurProfile)
  const fallbackEval = {
    schema_version: 1,
    job_type: 'fallback',
    hard_gate: { passed: true, reasons: [] as string[] },
    decision: '建议备选',
    summary: '关键词回退：无大模型结构化简历字段。',
    candidate_profile: hasHeurProfile ? heurProfile : ({} as Record<string, unknown>),
    note: hasHeurProfile
      ? '未调用大模型或调用失败：分数为关键词估算；已根据简历正文正则补全部分 candidate_profile（邮箱/院校/应聘岗位等）。配置 DASHSCOPE_API_KEY 后可获得完整 AI 评估。'
      : '未调用大模型或调用失败：仅根据岗位 JD 与简历文本的关键词重叠度估算分数；未能从正文识别结构化字段（可能为扫描件 PDF）。配置 DASHSCOPE_API_KEY 并重启 dev:api 后可获得完整结构化。'
  }
  return {
    candidateName,
    ...(phoneFound ? { candidatePhone: phoneFound } : {}),
    matchScore,
    status: '关键词估算（未调用大模型）',
    summary:
      `（未调用大模型或调用失败：仅根据岗位 JD 与简历文本的关键词重叠度估算分数，仅供参考。）\n` +
      `目标岗位：${jobTitle || '—'}\n` +
      `若要结构化 AI 评估：在根目录 .env.local 配置 DASHSCOPE_API_KEY（阿里云百炼），可选 QWEN_RESUME_MODEL，重启 npm run dev:api 后重新筛查。`,
    ...dims,
    evaluationJson: JSON.stringify(fallbackEval)
  }
}

/** 部分 PDF 引擎会在相邻汉字间插入空格，导致「学校：清华大学」等模式匹配失败 */
function normalizePdfExtractedText(s: string): string {
  let t = s.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  for (let i = 0; i < 8; i++) {
    const next = t.replace(/([\u4e00-\u9fa5])\s([\u4e00-\u9fa5])/g, '$1$2')
    if (next === t) break
    t = next
  }
  return t.replace(/([:：])\s*\n\s*/g, '$1 ')
}

async function extractResumePlainText(buffer: Buffer, originalname: string, mimetype: string): Promise<string> {
  const ext = path.extname(originalname || '').toLowerCase()
  if (ext === '.txt' || mimetype === 'text/plain') {
    return buffer.toString('utf8')
  }
  if (ext === '.pdf' || mimetype === 'application/pdf') {
    const parser = new PDFParse({ data: buffer })
    try {
      const tr = await parser.getText()
      return normalizePdfExtractedText((tr.text || '').trim())
    } finally {
      await parser.destroy()
    }
  }
  if (ext === '.docx' || mimetype.includes('wordprocessingml') || mimetype.includes('officedocument')) {
    const r = await mammoth.extractRawText({ buffer })
    return (r.value || '').trim()
  }
  throw new Error('仅支持 TXT、PDF、DOCX；旧版 .doc 请另存为 DOCX 后上传')
}

async function runResumeScreeningWithAi(params: {
  resumeText: string
  jobTitle: string
  department: string
  jdText: string
}): Promise<ResumeScreeningAiResult | null> {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim()
  if (!apiKey) return null
  const model =
    process.env.QWEN_RESUME_MODEL?.trim() ||
    process.env.QWEN_QUESTION_MODEL?.trim() ||
    'qwen-turbo'
  const { userPrompt, systemPrompt } = buildResumeEvalPromptForServer(params)
  const data = await dashScopeChatCompletions({
    model,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      { role: 'user', content: userPrompt }
    ]
  })
  const raw = data?.choices?.[0]?.message?.content
  const text = typeof raw === 'string' ? raw : ''
  const next = parseResumeEvalToScreeningResult(text, params.resumeText)
  if (next) return next
  return parseResumeScreeningAiJson(text)
}

function fallbackInterviewScore(profile: { name?: string }, answers: Array<{ answer?: string }>): AiInterviewScore {
  const score = Math.min(
    100,
    Math.round(60 + answers.reduce((sum: number, item: { answer?: string }) => sum + Math.min((item.answer || '').length, 80), 0) / 12)
  )
  return {
    score,
    passed: score >= 75,
    overallFeedback:
      score >= 75
        ? `${profile?.name || '候选人'}回答结构较完整，表达清晰，具备继续复试的潜力。`
        : `${profile?.name || '候选人'}基础表达与技术细节仍需加强，建议补充项目深度和底层理解。`,
    dimensionScores: {
      communication: Math.max(0, Math.min(100, score - 3)),
      technicalDepth: Math.max(0, Math.min(100, score - 1)),
      logic: Math.max(0, Math.min(100, score + 1)),
      jobFit: Math.max(0, Math.min(100, score)),
      stability: Math.max(0, Math.min(100, score - 2))
    },
    suggestions: ['补充关键技术细节与可量化结果', '回答先给结论，再展开过程与权衡'],
    riskPoints: score >= 75 ? [] : ['回答深度不足，可能影响岗位匹配度']
  }
}

function guessAudioMimeFromName(name: string): string {
  const n = String(name || '').toLowerCase()
  if (n.endsWith('.mp3')) return 'audio/mpeg'
  if (n.endsWith('.m4a')) return 'audio/mp4'
  if (n.endsWith('.aac')) return 'audio/aac'
  if (n.endsWith('.wav')) return 'audio/wav'
  return 'audio/mpeg'
}

/** TRTC userId：仅字母数字与 _-，最长 32 */
function sanitizeTrtcUserId(raw: string): string {
  const s = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32)
  return s || 'u_guest'
}

/** 由会话 id 稳定映射到 TRTC 数字房间号（1～4294967295） */
function trtcRoomIdFromSession(sessionId: string): number {
  const buf = crypto.createHash('sha256').update(sessionId).digest()
  const n = buf.readUInt32BE(0)
  return (n % 4294967294) + 1
}

function genTrtcUserSig(sdkAppId: number, secretKey: string, userId: string, expireSeconds: number): string {
  const { Api } = requireCjs('tls-sig-api-v2') as {
    Api: new (id: number, key: string) => { genSig: (uid: string, exp: number) => string }
  }
  const api = new Api(sdkAppId, secretKey)
  return api.genSig(userId, expireSeconds)
}

function buildPersonalizedInterviewUserPromptBlock(params: {
  title: string
  department?: string
  jdText: string
  resumeText: string
  candidateName: string
}) {
  const hasResume = Boolean(String(params.resumeText || '').trim())
  const clipResume = String(params.resumeText || '')
    .replace(/\s+/g, ' ')
    .slice(0, 20000)
  const clipJd = String(params.jdText || '')
    .replace(/\s+/g, ' ')
    .slice(0, 12000)
  const userPrompt = [
    `候选人姓名：${params.candidateName || '未知'}`,
    `岗位名称：${params.title}`,
    `部门：${params.department || '未知'}`,
    `JD：${clipJd || '（无正文）'}`,
    hasResume
      ? `简历全文（节选）：${clipResume}`
      : '（未提供匹配到该候选人姓名的简历正文：Q2、Q3 请结合 JD 设计「假设候选人具备典型背景」的项目深挖题，题干中不要写「因无简历」之类字样。）'
  ].join('\n')
  return { hasResume, userPrompt }
}

function assertDashScopeForInterview(): { apiKey: string; model: string } {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim()
  if (!apiKey) {
    if (flowLogEnabled) flowLog('interview-questions AI', false, '未配置 DASHSCOPE_API_KEY')
    throwInterviewQuestionsHttp(503, '未配置大模型密钥（DASHSCOPE_API_KEY），面试题仅由模型生成')
  }
  const model = process.env.QWEN_QUESTION_MODEL || 'qwen3.5-plus'
  return { apiKey, model }
}

/** 仅 Q1：供小程序先开答，其余题异步拉取 */
async function generatePersonalizedInterviewFirst(params: {
  title: string
  department?: string
  jdText: string
  resumeText: string
  candidateName: string
}) {
  const { model } = assertDashScopeForInterview()
  const { userPrompt } = buildPersonalizedInterviewUserPromptBlock(params)
  try {
    const data = await dashScopeChatCompletions({
      model,
      messages: [
        {
          role: 'system',
          content:
            '你是资深技术面试官。请严格输出恰好 1 道中文面试题，放在一个 JSON 对象里，格式：{"questions":[{"id":"Q1","text":"题干"}]}。\n' +
            '要求：Q1 为开场自我介绍题，约 2～3 分钟，可提示包含教育、工作/项目亮点；不要 markdown 代码块，不要其它说明文字。'
        },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.45
    })
    const raw = data?.choices?.[0]?.message?.content
    const text = typeof raw === 'string' ? raw : ''
    if (!text.trim()) {
      if (flowLogEnabled) {
        flowLog('interview-questions AI', false, `模型返回空(首题) model=${model} ${JSON.stringify(data).slice(0, 400)}`)
      }
      throwInterviewQuestionsHttp(502, '大模型未返回有效题目，请稍后重试')
    }
    const parsed = parseQuestionsJson(text, 1)
    if (parsed?.length === 1 && parsed[0].text) {
      return [{ id: 'Q1', text: parsed[0].text }]
    }
    if (flowLogEnabled) flowLog('interview-questions AI', false, `JSON 解析失败(首题) model=${model}`)
    throwInterviewQuestionsHttp(502, '大模型输出格式异常（首题），请稍后重试')
  } catch (e) {
    if ((e as InterviewQuestionsHttpError).httpStatus) throw e
    const msg = e instanceof Error ? e.message : String(e)
    if (flowLogEnabled) flowLog('interview-questions AI', false, `DashScope 异常(首题) model=${model} ${msg}`)
    throwInterviewQuestionsHttp(502, `大模型出题失败：${msg.slice(0, 200)}`)
  }
}

/** Q2～Q6：在首题已展示后生成，题干勿与首题重复 */
async function generatePersonalizedInterviewRest(params: {
  title: string
  department?: string
  jdText: string
  resumeText: string
  candidateName: string
  firstQuestionText: string
}) {
  const restCount = PERSONALIZED_INTERVIEW_TOTAL - 1
  const { model } = assertDashScopeForInterview()
  const { userPrompt } = buildPersonalizedInterviewUserPromptBlock(params)
  const firstT = String(params.firstQuestionText || '').trim().slice(0, 2000)
  const userWithFirst = [userPrompt, `首题已向候选人展示，请勿重复首题内容，并自然衔接深度考察：\n${firstT || '（首题文本缺失，仍请输出 Q2～Q6）'}`].join(
    '\n\n'
  )
  try {
    const data = await dashScopeChatCompletions({
      model,
      messages: [
        {
          role: 'system',
          content:
            `你是资深技术面试官。请严格输出恰好 ${restCount} 道中文面试题，放在一个 JSON 对象里，格式：{"questions":[{"id":"Q2","text":"题干"},…]}。\n` +
            '要求：\n' +
            '1) Q2、Q3：必须围绕简历中的具体项目、实习或工作经历追问（技术细节、职责边界、难点与结果）；若用户消息中说明无简历则结合 JD 设计两道「项目/交付」情景深挖题。\n' +
            '2) Q4、Q5、Q6：与岗位 JD 强相关的纯技术题（可含原理、方案对比、排错、性能、安全等），不要行为面或空泛的「你怎么看」。\n' +
            `id 必须为 Q2 到 Q${PERSONALIZED_INTERVIEW_TOTAL} 递增；不要 markdown 代码块，不要其它说明文字。`
        },
        { role: 'user', content: userWithFirst }
      ],
      temperature: 0.45
    })
    const raw = data?.choices?.[0]?.message?.content
    const text = typeof raw === 'string' ? raw : ''
    if (!text.trim()) {
      if (flowLogEnabled) {
        flowLog('interview-questions AI', false, `模型返回空(余题) model=${model} ${JSON.stringify(data).slice(0, 400)}`)
      }
      throwInterviewQuestionsHttp(502, '大模型未返回有效题目，请稍后重试')
    }
    const parsed = parseQuestionsJson(text, restCount)
    if (parsed?.length) {
      const out = parsed
        .slice(0, restCount)
        .map((q, idx) => ({
          id: `Q${idx + 2}`,
          text: String(q?.text || '').trim()
        }))
        .filter((q) => q.text)
      if (out.length === restCount) return out
    }
    if (flowLogEnabled) flowLog('interview-questions AI', false, `JSON 解析失败或题量不足(余题) model=${model}`)
    throwInterviewQuestionsHttp(502, '大模型输出格式异常或未生成完整后续题目，请稍后重试')
  } catch (e) {
    if ((e as InterviewQuestionsHttpError).httpStatus) throw e
    const msg = e instanceof Error ? e.message : String(e)
    if (flowLogEnabled) flowLog('interview-questions AI', false, `DashScope 异常(余题) model=${model} ${msg}`)
    throwInterviewQuestionsHttp(502, `大模型出题失败：${msg.slice(0, 200)}`)
  }
}

/** 小程序 AI 面：Q1 自我介绍；Q2～Q3 基于简历项目；Q4～Q6 纯技术（结合 JD）。仅大模型生成，无内置题库兜底。 */
async function generatePersonalizedInterviewSix(params: {
  title: string
  department?: string
  jdText: string
  resumeText: string
  candidateName: string
}) {
  const total = PERSONALIZED_INTERVIEW_TOTAL
  const { model } = assertDashScopeForInterview()
  const { userPrompt } = buildPersonalizedInterviewUserPromptBlock(params)
  try {
    const data = await dashScopeChatCompletions({
      model,
      messages: [
        {
          role: 'system',
          content:
            `你是资深技术面试官。请严格输出恰好 ${total} 道中文面试题，放在一个 JSON 对象里，格式：{"questions":[{"id":"Q1","text":"题干"},…]}。` +
            '要求：\n' +
            '1) Q1：开场自我介绍题，约 2～3 分钟，可提示包含教育、工作/项目亮点。\n' +
            '2) Q2、Q3：必须围绕简历中的具体项目、实习或工作经历追问（技术细节、职责边界、难点与结果）；若上文说明无简历则结合 JD 设计两道「项目/交付」情景深挖题。\n' +
            '3) Q4、Q5、Q6：与岗位 JD 强相关的纯技术题（可含原理、方案对比、排错、性能、安全等），不要行为面或空泛的「你怎么看」。\n' +
            'id 必须为 Q1 到 Q6 递增；不要 markdown 代码块，不要其它说明文字。'
        },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.45
    })
    const raw = data?.choices?.[0]?.message?.content
    const text = typeof raw === 'string' ? raw : ''
    if (!text.trim()) {
      if (flowLogEnabled) {
        flowLog('interview-questions AI', false, `模型返回空 model=${model} ${JSON.stringify(data).slice(0, 400)}`)
      }
      throwInterviewQuestionsHttp(502, '大模型未返回有效题目，请稍后重试')
    }
    const parsed = parseQuestionsJson(text, total)
    if (parsed?.length) {
      const out = parsed.slice(0, total).map((q, idx) => ({
        id: q.id || `Q${idx + 1}`,
        text: q.text
      }))
      if (out.length === total && out.every((q) => q.text)) return out
    }
    if (flowLogEnabled) flowLog('interview-questions AI', false, `JSON 解析失败或题量不足 model=${model}`)
    throwInterviewQuestionsHttp(502, '大模型输出格式异常或未生成完整 6 道题，请稍后重试')
  } catch (e) {
    if ((e as InterviewQuestionsHttpError).httpStatus) throw e
    const msg = e instanceof Error ? e.message : String(e)
    if (flowLogEnabled) flowLog('interview-questions AI', false, `DashScope 异常 model=${model} ${msg}`)
    throwInterviewQuestionsHttp(502, `大模型出题失败：${msg.slice(0, 200)}`)
  }
}

async function dbPing() {
  await mysqlPool.query('SELECT 1')
}

async function ensureUserAndWechatAccount(params: { appid: string; openid: string; sessionKey?: string }) {
  const { appid, openid, sessionKey } = params
  const [rows] = await mysqlPool.query<any[]>(
    'SELECT id, user_id FROM wechat_accounts WHERE appid=? AND openid=? LIMIT 1',
    [appid, openid]
  )

  if (rows.length === 0) {
    const [userRes] = await mysqlPool.query<any>(
      "INSERT INTO users(phone, role, status) VALUES (NULL, 'candidate', 1)"
    )
    const userId = Number(userRes.insertId)
    await mysqlPool.query(
      'INSERT INTO wechat_accounts(user_id, appid, openid, session_key, last_login_at) VALUES (?,?,?,?,NOW())',
      [userId, appid, openid, sessionKey || null]
    )
    return { userId }
  }

  const userId = rows[0].user_id
  await mysqlPool.query(
    'UPDATE wechat_accounts SET session_key=?, last_login_at=NOW(), updated_at=NOW() WHERE appid=? AND openid=?',
    [sessionKey || null, appid, openid]
  )
  return { userId }
}

async function getUserProfileByOpenId(params: { appid: string; openid: string }): Promise<UserProfile & { userId: number; sessionKey?: string }> {
  const [rows] = await mysqlPool.query<any[]>(
    `SELECT u.id AS userId, wa.openid AS openid, u.phone AS phone, u.role AS role, u.updated_at AS updatedAt, wa.session_key AS sessionKey
     FROM wechat_accounts wa
     JOIN users u ON u.id = wa.user_id
     WHERE wa.appid=? AND wa.openid=?
     LIMIT 1`,
    [params.appid, params.openid]
  )
  if (rows.length === 0) {
    return { userId: 0, openid: params.openid, role: 'candidate', updatedAt: Date.now() }
  }
  const r = rows[0]
  const role = await syncUserRoleWithWhitelist({
    userId: r.userId,
    phone: r.phone,
    role: r.role
  })
  return {
    userId: r.userId,
    openid: r.openid,
    phone: r.phone || undefined,
    role,
    updatedAt: Date.now(),
    sessionKey: r.sessionKey || undefined
  }
}

/** 与微信 purePhoneNumber 对齐：去空格，去掉 +86 / 86 前缀 */
function normalizePhoneForMatch(raw: string): string {
  let s = String(raw || '')
    .trim()
    .replace(/\s+/g, '')
  if (s.startsWith('+86')) s = s.slice(3)
  if (s.startsWith('86') && s.length === 13) s = s.slice(2)
  return s
}

async function isInterviewerPhone(phone: string) {
  const n = normalizePhoneForMatch(phone)
  if (!n) return false
  // 兼容：CHAR 尾部空格、白名单里带 +86 / 86、或列类型为数字
  const [rows] = await mysqlPool.query<any[]>(
    `SELECT id FROM interviewer_phone_whitelist
     WHERE enabled = 1
       AND (
            TRIM(CAST(phone AS CHAR(32))) = ?
         OR TRIM(CAST(phone AS CHAR(32))) = CONCAT('+86', ?)
         OR TRIM(CAST(phone AS CHAR(32))) = CONCAT('86', ?)
       )
     LIMIT 1`,
    [n, n, n]
  )
  return rows.length > 0
}

/** 已绑定手机的用户：按白名单校正 role（解决「先绑定后加白名单」或改白名单不生效） */
async function syncUserRoleWithWhitelist(params: {
  userId: number
  phone: string | null | undefined
  role: string
}): Promise<UserRole> {
  const { userId, phone, role } = params
  const p = phone ? normalizePhoneForMatch(phone) : ''
  if (!userId || !p) return (role === 'interviewer' ? 'interviewer' : 'candidate') as UserRole
  const next: UserRole = (await isInterviewerPhone(p)) ? 'interviewer' : 'candidate'
  const cur: UserRole = role === 'interviewer' ? 'interviewer' : 'candidate'
  if (next !== cur) {
    await mysqlPool.query('UPDATE users SET role=?, updated_at=NOW() WHERE id=?', [next, userId])
  }
  return next
}

async function bindUserPhoneAndRole(params: { appid: string; openid: string; phone: string }) {
  const me = await getUserProfileByOpenId({ appid: params.appid, openid: params.openid })
  if (!me.userId) throw new Error('user not found')
  const phone = normalizePhoneForMatch(params.phone)
  if (!phone) throw new Error('invalid phone')
  const nextRole: UserRole = (await isInterviewerPhone(phone)) ? 'interviewer' : 'candidate'
  await mysqlPool.query('UPDATE users SET phone=?, role=?, updated_at=NOW() WHERE id=?', [phone, nextRole, me.userId])
  return { role: nextRole, phone }
}

async function getSessionInternalId(sessionId: string): Promise<number | null> {
  const [rows] = await mysqlPool.query<any[]>(
    'SELECT id FROM interview_sessions WHERE session_id=? LIMIT 1',
    [sessionId]
  )
  return rows.length ? rows[0].id : null
}

/** 候选人提交面试报告成功后，将关联邀请从 pending 标为 accepted（中途退出仍可再次登录，仅提交后失效） */
async function markInvitationConsumedAfterInterviewSubmit(externalSessionId: string) {
  const sid = String(externalSessionId || '').trim()
  if (!sid) return
  try {
    const [sessRows] = await mysqlPool.query<any[]>(
      'SELECT invitation_id FROM interview_sessions WHERE session_id=? AND invitation_id IS NOT NULL LIMIT 1',
      [sid]
    )
    if (!sessRows.length) return
    const invId = sessRows[0].invitation_id
    if (invId == null || !Number.isFinite(Number(invId))) return
    await mysqlPool.query(
      `UPDATE interview_invitations
       SET status='accepted', accepted_at=NOW(), updated_at=NOW()
       WHERE id=? AND status='pending'`,
      [Number(invId)]
    )
  } catch (e) {
    console.warn('[markInvitationConsumedAfterInterviewSubmit]', e)
  }
}

async function upsertSessionBase(params: {
  sessionId: string
  jobId: string
  appid: string
  candidateOpenId?: string
  interviewerOpenId?: string
}) {
  const appid = String(params.appid || '').trim()
  if (!appid) throw new Error('WECHAT_APPID not configured')

  const jobCode = params.jobId
  const [jobRows] = await mysqlPool.query<any[]>('SELECT id FROM jobs WHERE job_code=? LIMIT 1', [jobCode])
  if (!jobRows.length) throw new Error('job not found')
  const jobDbId = jobRows[0].id

  // candidate user id（仅新建会话时强制要求已登录过小程序并写入 wechat_accounts）
  let candidateUserId: number | null = null
  if (params.candidateOpenId) {
    const [uRows] = await mysqlPool.query<any[]>(
      'SELECT user_id FROM wechat_accounts WHERE appid=? AND openid=? LIMIT 1',
      [appid, params.candidateOpenId]
    )
    candidateUserId = uRows.length ? uRows[0].user_id : null
  }

  const [existing] = await mysqlPool.query<any[]>(
    'SELECT id FROM interview_sessions WHERE session_id=? LIMIT 1',
    [params.sessionId]
  )
  if (!existing.length) {
    if (!candidateUserId) {
      throw new Error('candidate user not found for openid')
    }
    await mysqlPool.query(
      `INSERT INTO interview_sessions(session_id, job_id, candidate_user_id, interviewer_user_id, candidate_openid, interviewer_openid, status, voip_status)
       VALUES (?,?,?,?,?,?, 'created','not_started')`,
      [
        params.sessionId,
        jobDbId,
        candidateUserId,
        null,
        params.candidateOpenId || '',
        params.interviewerOpenId || ''
      ]
    )
  } else {
    await mysqlPool.query(
      'UPDATE interview_sessions SET candidate_openid=COALESCE(NULLIF(?,\"\"),candidate_openid), interviewer_openid=COALESCE(NULLIF(?,\"\"),interviewer_openid), updated_at=NOW() WHERE session_id=?',
      [params.candidateOpenId || '', params.interviewerOpenId || '', params.sessionId]
    )
  }
}

app.get('/api/health', async (_, res) => {
  try {
    await dbPing()
    const body: { ok: true; db: true; redis?: boolean } = { ok: true, db: true }
    if (adminRedisConfigured()) {
      body.redis = await pingRedis()
    }
    res.json(body)
  } catch {
    res.status(503).json({ ok: false, db: false })
  }
})

app.post('/api/wechat/login', async (req, res) => {
  const code = String(req.body?.code || '').trim()
  if (!code) return res.status(400).json({ message: 'code required' })

  const wechatEnv = checkWechatEnv()
  if (!wechatEnv.ok) {
    return res.status(500).json({
      message: 'WECHAT_APPID / WECHAT_SECRET not configured'
    })
  }

  try {
    flowLog('wechat/login code2Session', true, 'request')
    const { openid, sessionKey, appid } = await exchangeWechatJsCode(code)
    await ensureUserAndWechatAccount({
      appid,
      openid,
      sessionKey
    })
    flowLog('wechat/login 完成', true, maskOpenidLite(openid))
    res.json({ data: { openid } })
  } catch (error) {
    const err = error as Error & { wechat?: unknown }
    flowLog('wechat/login 失败', false, err.message)
    if (err.message === 'code2Session failed') {
      return res.status(502).json({ message: err.message, wechat: err.wechat })
    }
    res.status(500).json({ message: 'request code2Session error' })
  }
})

function decryptWechatPhone(params: { sessionKey: string; encryptedData: string; iv: string }) {
  const sessionKey = Buffer.from(params.sessionKey, 'base64')
  const encryptedData = Buffer.from(params.encryptedData, 'base64')
  const iv = Buffer.from(params.iv, 'base64')

  const decipher = crypto.createDecipheriv('aes-128-cbc', sessionKey, iv)
  decipher.setAutoPadding(true)
  let decoded = decipher.update(encryptedData, undefined, 'utf8')
  decoded += decipher.final('utf8')
  return JSON.parse(decoded) as { phoneNumber?: string; purePhoneNumber?: string; countryCode?: string; watermark?: { appid?: string } }
}

app.post('/api/wechat/phone', async (req, res) => {
  const openid = String(req.body?.openid || '').trim()
  const encryptedData = String(req.body?.encryptedData || '').trim()
  const iv = String(req.body?.iv || '').trim()
  if (!openid || !encryptedData || !iv) return res.status(400).json({ message: 'invalid params' })

  const appId = process.env.WECHAT_APPID || ''
  if (!appId) return res.status(500).json({ message: 'WECHAT_APPID not configured' })

  const me = await getUserProfileByOpenId({ appid: appId, openid })
  if (!me.userId) return res.status(400).json({ message: 'user not found, please wx.login again' })
  if (!me.sessionKey) return res.status(400).json({ message: 'sessionKey missing, please wx.login again' })

  try {
    const data = decryptWechatPhone({ sessionKey: me.sessionKey, encryptedData, iv })
    if (appId && data?.watermark?.appid && data.watermark.appid !== appId) {
      return res.status(400).json({ message: 'watermark appid mismatch' })
    }
    const phone = String(data.purePhoneNumber || data.phoneNumber || '').trim()
    if (!phone) return res.status(400).json({ message: 'phone missing' })

    const { role, phone: storedPhone } = await bindUserPhoneAndRole({ appid: appId, openid, phone })
    res.json({ data: { phone: storedPhone, role } })
  } catch (e) {
    res.status(400).json({ message: 'decrypt phone failed' })
  }
})

app.get('/api/user/me', (req, res) => {
  const openid = String(req.query.openid || '').trim()
  if (!openid) return res.status(400).json({ message: 'openid required' })
  const appid = process.env.WECHAT_APPID || ''
  if (!appid) return res.status(500).json({ message: 'WECHAT_APPID not configured' })
  getUserProfileByOpenId({ appid, openid })
    .then((u) => res.json({ data: { openid: u.openid, role: u.role, phone: u.phone } }))
    .catch(() => res.status(500).json({ message: 'get profile failed' }))
})

app.post('/api/user/bind-phone', (req, res) => {
  const openid = String(req.body?.openid || '').trim()
  const phone = String(req.body?.phone || '').trim()
  if (!openid || !phone) return res.status(400).json({ message: 'invalid params' })
  const appid = process.env.WECHAT_APPID || ''
  if (!appid) return res.status(500).json({ message: 'WECHAT_APPID not configured' })
  bindUserPhoneAndRole({ appid, openid, phone })
    .then((r) => res.json({ data: r }))
    .catch(() => res.status(500).json({ message: 'bind phone failed' }))
})

const ADMIN_SESSION_TTL_SEC = Number(process.env.ADMIN_SESSION_TTL_SEC || 60 * 60 * 24 * 7)

function getAdminSessionSecret(): string {
  return String(process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_API_TOKEN || '').trim()
}

/** 可签发 HMAC 无状态令牌（未配 Redis 时的回退） */
function adminSessionSigningConfigured(): boolean {
  return Boolean(getAdminSessionSecret())
}

/** 管理端登录会话可持久化：Redis 或 HMAC 密钥至少其一 */
function adminSessionPersistenceConfigured(): boolean {
  return adminRedisConfigured() || adminSessionSigningConfigured()
}

async function createAdminRedisSession(userId: string, username: string): Promise<string | null> {
  if (!adminRedisConfigured()) return null
  const r = getRedisClient()
  if (!r) return null
  const sid = crypto.randomBytes(24).toString('hex')
  const key = `${ADMIN_SESSION_KEY_PREFIX}${sid}`
  try {
    await r.set(key, JSON.stringify({ uid: userId, u: username }), 'EX', ADMIN_SESSION_TTL_SEC)
    return sid
  } catch (e) {
    console.error('[redis] set admin session failed', e)
    return null
  }
}

/** 与 HMAC 令牌区分：不含 `.`，为 Redis 中存的 session id */
async function verifyAdminRedisSession(token: string): Promise<boolean> {
  if (!token || token.includes('.')) return false
  if (!adminRedisConfigured()) return false
  const r = getRedisClient()
  if (!r) return false
  const key = `${ADMIN_SESSION_KEY_PREFIX}${token}`
  try {
    const v = await r.get(key)
    return Boolean(v && v.length > 0)
  } catch {
    return false
  }
}

/** 环境变量单账号密码登录（与库表登录二选一或并存） */
function envAdminPasswordLoginConfigured(): boolean {
  const u = String(process.env.ADMIN_USERNAME || '').trim()
  const p = String(process.env.ADMIN_PASSWORD || '')
  return Boolean(u && p && adminSessionPersistenceConfigured())
}

/** 与库表 password_hash 一致：salt 与 hex(scrypt) 以冒号拼接 */
function verifyAdminPassword(password: string, stored: string): boolean {
  const s = String(stored || '').trim()
  if (!s) return false
  const i = s.indexOf(':')
  if (i <= 0) return false
  const salt = s.slice(0, i)
  const wantHex = s.slice(i + 1)
  if (!salt || !wantHex || !/^[0-9a-f]+$/i.test(wantHex)) return false
  try {
    const gotHex = crypto.scryptSync(password, salt, 64).toString('hex')
    const a = Buffer.from(wantHex, 'hex')
    const b = Buffer.from(gotHex, 'hex')
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/** 与 server.ts 管理库 users.password_hash 写入格式一致 */
function hashAdminPasswordForDb(password: string): string {
  const salt = `adm_${crypto.randomBytes(12).toString('hex')}`
  const hex = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hex}`
}

function extractAdminRequestToken(req: express.Request): string {
  const auth = String(req.headers.authorization || '')
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const headerToken = String(req.headers['x-admin-token'] || '').trim()
  return bearer || headerToken
}

/** 在 assertAdminToken 已通过的前提下，解析当前会话对应的管理库登录用户名（非环境令牌） */
async function resolveAdminDbUsernameFromToken(token: string): Promise<string | null> {
  const legacy = String(process.env.ADMIN_API_TOKEN || '').trim()
  if (legacy && token === legacy) return null

  if (token.includes('.')) {
    const dot = token.lastIndexOf('.')
    const payloadStr = token.slice(0, dot)
    try {
      const raw = JSON.parse(Buffer.from(payloadStr, 'base64url').toString('utf8')) as {
        v?: number
        exp?: number
        u?: string
      }
      if (typeof raw.exp !== 'number' || raw.exp < Math.floor(Date.now() / 1000)) return null
      if ((raw.v === 1 || raw.v === 2) && typeof raw.u === 'string' && raw.u.trim()) return raw.u.trim()
    } catch {
      return null
    }
    return null
  }

  if (!adminRedisConfigured()) return null
  const r = getRedisClient()
  if (!r) return null
  const key = `${ADMIN_SESSION_KEY_PREFIX}${token}`
  try {
    const v = await r.get(key)
    if (!v) return null
    const p = JSON.parse(v) as { u?: string }
    const u = String(p.u || '').trim()
    return u || null
  } catch {
    return null
  }
}

function signAdminSessionToken(userId: string, username: string): string | null {
  const secret = getAdminSessionSecret()
  if (!secret) return null
  const exp = Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL_SEC
  const payload = Buffer.from(JSON.stringify({ v: 2, uid: userId, u: username, exp }), 'utf8').toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

/** 兼容旧版仅 env 登录签发的 v:1 令牌 */
function signAdminSessionTokenLegacy(username: string): string | null {
  const secret = getAdminSessionSecret()
  if (!secret) return null
  const exp = Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL_SEC
  const payload = Buffer.from(JSON.stringify({ v: 1, u: username, exp }), 'utf8').toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

function verifyAdminSessionToken(token: string): boolean {
  const secret = getAdminSessionSecret()
  if (!secret || !token) return false
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return false
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expectSig = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  try {
    const a = Buffer.from(expectSig, 'utf8')
    const b = Buffer.from(sig, 'utf8')
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false
  } catch {
    return false
  }
  try {
    const raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      v?: number
      exp?: number
      u?: string
      uid?: string
    }
    if (typeof raw.exp !== 'number' || raw.exp < Math.floor(Date.now() / 1000)) return false
    if (raw.v === 1 && typeof raw.u === 'string' && raw.u.length > 0) return true
    if (raw.v === 2 && typeof raw.uid === 'string' && raw.uid.length > 0 && typeof raw.u === 'string') return true
    return false
  } catch {
    return false
  }
}

async function adminDbPasswordLoginAvailable(): Promise<boolean> {
  if (!adminSessionPersistenceConfigured()) return false
  try {
    const [rows] = await mysqlAdminPool.query<RowDataPacket[]>(
      'SELECT 1 AS ok FROM users WHERE password_hash IS NOT NULL AND TRIM(password_hash) <> ? LIMIT 1',
      ['']
    )
    return Array.isArray(rows) && rows.length > 0
  } catch {
    return false
  }
}

/** 公开：供管理前端判断是否展示登录框（无需鉴权） */
app.get('/api/admin/auth-status', async (_req, res) => {
  const dbPasswordLogin = await adminDbPasswordLoginAvailable()
  res.json({
    passwordLogin: envAdminPasswordLoginConfigured() || dbPasswordLogin,
    dbPasswordLogin,
    legacyToken: Boolean(String(process.env.ADMIN_API_TOKEN || '').trim()),
    /** 已配置 Redis 时登录须校验图形验证码（与 admin session 共用 Redis） */
    captchaEnabled: adminRedisConfigured()
  })
})

/** 获取登录图形验证码（需 Redis）；返回 SVG 由前端以 data URL 展示 */
app.get('/api/admin/captcha', async (_req, res) => {
  const r = getRedisClient()
  if (!r) {
    return res.status(503).json({ message: '验证码需要 Redis：请配置 REDIS_HOST 或 REDIS_URL' })
  }
  const text = randomAdminCaptchaText(4)
  const id = crypto.randomBytes(16).toString('hex')
  const key = `${ADMIN_CAPTCHA_PREFIX}${id}`
  try {
    await r.setex(key, ADMIN_CAPTCHA_TTL_SEC, text.toLowerCase())
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'redis set failed'
    flowLog('admin/captcha', false, msg)
    return res.status(503).json({ message: 'Redis 不可用，无法签发验证码' })
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.json({
    data: {
      captchaId: id,
      svg: buildAdminCaptchaSvg(text),
      expiresInSec: ADMIN_CAPTCHA_TTL_SEC
    }
  })
})

/** 管理库 users.role（中文）→ 管理端界面 Role */
function mapAdminDbRoleToUiRole(dbRole: string): 'admin' | 'delivery_manager' | 'recruiter' | 'recruiting_manager' {
  const r = String(dbRole || '').trim()
  if (!r) return 'delivery_manager'
  const rl = r.toLowerCase()
  if (rl === 'admin' || rl === 'superadmin' || rl === 'super_admin') return 'admin'
  if (rl === 'delivery_manager') return 'delivery_manager'
  if (rl === 'recruiting_manager') return 'recruiting_manager'
  if (rl === 'recruiter') return 'recruiter'
  if (/平台管理员|系统管理|超级管理/i.test(r)) return 'admin'
  if (/交付/i.test(r)) return 'delivery_manager'
  if (/招聘经理|招募经理/i.test(r)) return 'recruiting_manager'
  if (/招聘/i.test(r)) return 'recruiter'
  if (/管理/i.test(r)) return 'admin'
  return 'delivery_manager'
}

/** roles.menu_keys：mysql2 可能返回 string / Buffer / 已解析的数组（JSON 列时） */
function parseRoleMenuKeysColumn(raw: unknown): string[] | undefined {
  if (raw == null || raw === '') return undefined
  let parsed: unknown
  if (Array.isArray(raw)) {
    parsed = raw
  } else if (Buffer.isBuffer(raw)) {
    const s = raw.toString('utf8').trim()
    if (!s) return undefined
    try {
      parsed = JSON.parse(s)
    } catch {
      return undefined
    }
  } else if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return undefined
    }
  } else {
    return undefined
  }
  if (!Array.isArray(parsed)) return undefined
  return parsed.map((x) => String(x || '').trim()).filter(Boolean)
}

function parseRecruitmentLeadsColumn(raw: unknown): string[] {
  if (raw == null || raw === '') return []
  if (Array.isArray(raw)) return raw.map((x) => String(x || '').trim()).filter(Boolean)
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw) as unknown
      return Array.isArray(p) ? p.map((x) => String(x || '').trim()).filter(Boolean) : []
    } catch {
      return []
    }
  }
  return []
}

/** 与 users.role 按「角色名称」匹配 roles 行，读取 menu_keys（JSON 菜单 id 数组）；无列或空则 undefined */
async function loadAllowedMenuKeysForDbRole(roleName: string): Promise<string[] | undefined> {
  const name = String(roleName || '').trim()
  if (!name) return undefined
  try {
    const [rrows] = await mysqlAdminPool.query<RowDataPacket[]>(
      'SELECT menu_keys FROM roles WHERE name = ? LIMIT 1',
      [name]
    )
    const raw = rrows[0]?.menu_keys
    const keys = parseRoleMenuKeysColumn(raw)
    return keys
  } catch {
    return undefined
  }
}

/** 管理端登录：换会话令牌，浏览器可不再配置 VITE_ADMIN_API_TOKEN */
app.post('/api/admin/login', async (req, res) => {
  if (!adminSessionPersistenceConfigured()) {
    return res.status(503).json({
      message:
        'admin session not configured: set REDIS_HOST or REDIS_URL for Redis sessions, or ADMIN_SESSION_SECRET (or ADMIN_API_TOKEN) for signed tokens'
    })
  }
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password ?? '')
  if (!username || !password) {
    return res.status(400).json({ message: 'username and password required' })
  }

  if (adminRedisConfigured()) {
    const captchaId = String(req.body?.captchaId || '').trim()
    const captchaCode = String(req.body?.captchaCode ?? '').trim()
    if (!captchaId || !captchaCode) {
      return res.status(400).json({ message: '请输入图形验证码' })
    }
    const captchaOk = await verifyAdminCaptchaAndConsume(captchaId, captchaCode)
    if (!captchaOk) {
      return res.status(400).json({ message: '验证码错误或已过期，请刷新验证码后重试' })
    }
  }

  try {
    const [rows] = await mysqlAdminPool.query<RowDataPacket[]>(
      'SELECT id, username, name, dept, role, password_hash, status FROM users WHERE username = ? LIMIT 1',
      [username]
    )
    const row = rows[0] as {
      id?: string
      username?: string | null
      name?: string | null
      dept?: string | null
      role?: string | null
      password_hash?: string | null
      status?: string | null
    } | undefined
    if (row && String(row.password_hash || '').trim()) {
      if (!verifyAdminPassword(password, String(row.password_hash))) {
        return res.status(401).json({ message: 'invalid credentials' })
      }
      const st = String(row.status ?? '').trim()
      if (st && st !== '正常') {
        return res.status(403).json({ message: 'account disabled' })
      }
      const uid = String(row.id || '').trim()
      const un = String(row.username || username).trim()
      const displayName = String(row.name || un).trim() || un
      const uiRole = mapAdminDbRoleToUiRole(String(row.role || ''))
      const allowedMenuKeys = await loadAllowedMenuKeysForDbRole(String(row.role || ''))
      const dept = String(row.dept ?? '').trim()
      const userPayload = {
        name: displayName,
        username: un,
        uiRole,
        /** 始终下发，便于前端判断「未设置」与旧缓存；空串表示库中无部门 */
        dept,
        ...(allowedMenuKeys !== undefined ? { allowedMenuKeys } : {})
      }
      const redisTok = await createAdminRedisSession(uid || un, un)
      if (redisTok) {
        return res.json({ data: { token: redisTok, expiresInSec: ADMIN_SESSION_TTL_SEC, user: userPayload } })
      }
      if (!adminSessionSigningConfigured()) {
        return res.status(503).json({ message: 'Redis session unavailable and no ADMIN_SESSION_SECRET for token fallback' })
      }
      const token = signAdminSessionToken(uid || un, un)
      if (!token) return res.status(500).json({ message: 'session sign failed' })
      return res.json({ data: { token, expiresInSec: ADMIN_SESSION_TTL_SEC, user: userPayload } })
    }
  } catch {
    // 表或列不存在时走环境变量账号
  }

  if (!envAdminPasswordLoginConfigured()) {
    return res.status(401).json({
      message:
        'invalid credentials（请确认管理库 users.username / password_hash；若未使用库表登录可配置 ADMIN_USERNAME + ADMIN_PASSWORD）'
    })
  }
  const eu = String(process.env.ADMIN_USERNAME || '').trim()
  const ep = String(process.env.ADMIN_PASSWORD || '')
  if (username !== eu || password !== ep) {
    return res.status(401).json({ message: 'invalid credentials' })
  }
  const envUser = { name: '环境账号', username: eu, uiRole: 'admin' as const }
  const redisTok = await createAdminRedisSession(eu, eu)
  if (redisTok) {
    return res.json({ data: { token: redisTok, expiresInSec: ADMIN_SESSION_TTL_SEC, user: envUser } })
  }
  if (!adminSessionSigningConfigured()) {
    return res.status(503).json({ message: 'Redis session unavailable and no ADMIN_SESSION_SECRET for token fallback' })
  }
  const token = signAdminSessionTokenLegacy(username)
  if (!token) return res.status(500).json({ message: 'session sign failed' })
  res.json({ data: { token, expiresInSec: ADMIN_SESSION_TTL_SEC, user: envUser } })
})

async function assertAdminToken(req: express.Request, res: express.Response): Promise<boolean> {
  const legacy = String(process.env.ADMIN_API_TOKEN || '').trim()
  if (!legacy && !adminSessionPersistenceConfigured()) {
    res.status(503).json({
      message:
        'Admin auth not configured: set ADMIN_API_TOKEN, or REDIS_* for sessions, or ADMIN_SESSION_SECRET for signed sessions'
    })
    return false
  }
  const auth = String(req.headers.authorization || '')
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const headerToken = String(req.headers['x-admin-token'] || '').trim()
  const token = bearer || headerToken
  if (!token) {
    res.status(401).json({ message: 'unauthorized' })
    return false
  }
  if (legacy && token === legacy) return true
  if (token.includes('.') && verifyAdminSessionToken(token)) return true
  if (await verifyAdminRedisSession(token)) return true
  res.status(401).json({ message: 'unauthorized' })
  return false
}

/** 已登录用户修改管理库 users 密码（需账号密码登录会话，不支持纯环境 API 令牌） */
app.post('/api/admin/change-password', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  const token = extractAdminRequestToken(req)
  const username = await resolveAdminDbUsernameFromToken(token)
  if (!username) {
    res.status(400).json({
      message: '当前登录方式不支持在此修改密码，请使用管理员分配的账号密码登录后再试。'
    })
    return
  }
  const currentPassword = String(req.body?.currentPassword ?? '')
  const newPassword = String(req.body?.newPassword ?? '')
  if (!currentPassword || !newPassword) {
    res.status(400).json({ message: '请填写当前密码和新密码' })
    return
  }
  if (newPassword.length < 6) {
    res.status(400).json({ message: '新密码至少 6 位' })
    return
  }
  if (newPassword === currentPassword) {
    res.status(400).json({ message: '新密码不能与当前密码相同' })
    return
  }
  try {
    const [rows] = await mysqlAdminPool.query<RowDataPacket[]>(
      'SELECT password_hash, status FROM users WHERE username = ? LIMIT 1',
      [username]
    )
    const row = rows[0] as { password_hash?: string | null; status?: string | null } | undefined
    if (!row) {
      res.status(404).json({ message: '未找到您的账号信息，请联系管理员' })
      return
    }
    const st = String(row.status ?? '').trim()
    if (st && st !== '正常') {
      res.status(403).json({ message: '账号已停用，无法修改密码' })
      return
    }
    const stored = String(row.password_hash || '').trim()
    if (!stored || !verifyAdminPassword(currentPassword, stored)) {
      res.status(401).json({ message: '当前密码不正确' })
      return
    }
    const nextHash = hashAdminPasswordForDb(newPassword)
    const [hdr] = await mysqlAdminPool.query<ResultSetHeader>(
      'UPDATE users SET password_hash = ? WHERE username = ?',
      [nextHash, username]
    )
    if (!hdr.affectedRows) {
      res.status(500).json({ message: '更新失败，请稍后重试' })
      return
    }
    res.json({ ok: true })
  } catch (e) {
    console.error('[POST /api/admin/change-password]', e)
    res.status(500).json({ message: '系统繁忙，请稍后重试' })
  }
})

// MVP 管理接口：用手机号标注面试官（需 ADMIN_API_TOKEN）
app.post('/api/admin/interviewer/mark-phone', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  const raw = String(req.body?.phone || '').trim()
  const phone = normalizePhoneForMatch(raw)
  if (!phone) return res.status(400).json({ message: 'phone required' })
  mysqlPool
    .query(
      'INSERT INTO interviewer_phone_whitelist(phone, enabled, remark) VALUES (?,1,NULL) ON DUPLICATE KEY UPDATE enabled=1, updated_at=NOW()',
      [phone]
    )
    .then(() => res.json({ ok: true }))
    .catch(() => res.status(500).json({ message: 'db error' }))
})

function maskPhoneDisplay(phone: string | null | undefined) {
  const p = String(phone || '').replace(/\s/g, '')
  if (p.length >= 7) return `${p.slice(0, 3)}****${p.slice(-4)}`
  return p || '—'
}

/** 写入 jobs.recruiters（JSON）：与 schema_admin 一致为字符串数组 */
function normalizeRecruitersForDb(raw: unknown): string {
  if (raw === undefined || raw === null) return '[]'
  if (Array.isArray(raw)) return JSON.stringify(raw.map((x) => String(x)))
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return '[]'
    try {
      const p = JSON.parse(t) as unknown
      if (Array.isArray(p)) return JSON.stringify(p.map((x) => String(x)))
    } catch {
      return JSON.stringify([t])
    }
  }
  return '[]'
}

function recruitersFromRow(raw: unknown): string[] {
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

function adminRecruiterIdentityKeys(username: string, displayName: string): string[] {
  const u = String(username || '')
    .trim()
    .toLowerCase()
  const n = String(displayName || '')
    .trim()
    .toLowerCase()
  return [u, n].filter(Boolean)
}

function recruitersJsonContainsIdentity(recruitersRaw: unknown, keys: string[]): boolean {
  if (!keys.length) return false
  const arr = recruitersFromRow(recruitersRaw)
    .map((x) => String(x || '').trim().toLowerCase())
    .filter(Boolean)
  if (!arr.length) return false
  return arr.some((r) => keys.includes(r))
}

async function loadAdminSessionActor(token: string): Promise<{
  username: string
  displayName: string
  uiRole: ReturnType<typeof mapAdminDbRoleToUiRole>
} | null> {
  const un = await resolveAdminDbUsernameFromToken(token)
  if (!un) return null
  try {
    const [rows] = await mysqlAdminPool.query<RowDataPacket[]>(
      'SELECT username, name, role FROM users WHERE username = ? LIMIT 1',
      [un]
    )
    const row = rows[0] as { username?: string | null; name?: string | null; role?: string | null } | undefined
    const username = String(row?.username || un).trim() || un
    const displayName = String(row?.name || '').trim() || username
    const uiRole = mapAdminDbRoleToUiRole(String(row?.role || ''))
    return { username, displayName, uiRole }
  } catch {
    return { username: un, displayName: un, uiRole: mapAdminDbRoleToUiRole('') }
  }
}

async function screeningJobAllowsRecruiter(
  jobCode: string,
  actor: { username: string; displayName: string }
): Promise<boolean> {
  const jc = String(jobCode || '').trim()
  if (!jc) return false
  const keys = adminRecruiterIdentityKeys(actor.username, actor.displayName)
  const [jr] = await mysqlPool.query<RowDataPacket[]>(
    'SELECT recruiters FROM jobs WHERE UPPER(TRIM(job_code)) = UPPER(TRIM(?)) LIMIT 1',
    [jc]
  )
  const row = jr[0] as { recruiters?: unknown } | undefined
  if (!row) return false
  return recruitersJsonContainsIdentity(row.recruiters, keys)
}

function identityKeysHitLeadList(leads: string[], actor: { username: string; displayName: string }): boolean {
  const keys = adminRecruiterIdentityKeys(actor.username, actor.displayName)
  const lower = leads.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean)
  return keys.some((k) => lower.includes(k))
}

async function screeningJobAllowsRecruitingManager(
  jobCode: string,
  actor: { username: string; displayName: string }
): Promise<boolean> {
  const jc = String(jobCode || '').trim()
  if (!jc) return false
  const [jr] = await mysqlPool.query<RowDataPacket[]>(
    `SELECT p.recruitment_leads AS recruitment_leads
     FROM jobs j
     LEFT JOIN projects p ON p.id = j.project_id
     WHERE UPPER(TRIM(j.job_code)) = UPPER(TRIM(?))
     LIMIT 1`,
    [jc]
  )
  const row = jr[0] as { recruitment_leads?: unknown } | undefined
  if (!row) return false
  const leads = parseRecruitmentLeadsColumn(row.recruitment_leads)
  return leads.length > 0 && identityKeysHitLeadList(leads, actor)
}

async function screeningJobAllowsDeliveryManager(jobCode: string, actorDept: string): Promise<boolean> {
  const d = String(actorDept || '').trim()
  if (!d || d === '-') return false
  const [jr] = await mysqlPool.query<RowDataPacket[]>(
    `SELECT p.dept AS project_dept
     FROM jobs j
     LEFT JOIN projects p ON p.id = j.project_id
     WHERE UPPER(TRIM(j.job_code)) = UPPER(TRIM(?))
     LIMIT 1`,
    [jobCode]
  )
  const row = jr[0] as { project_dept?: unknown } | undefined
  if (!row) return false
  const pd = String(row.project_dept || '').trim()
  if (!pd) return false
  return d.toLowerCase() === pd.toLowerCase()
}

async function assertCanDeleteResumeScreening(
  token: string,
  jobCodeRaw: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const jobCode = String(jobCodeRaw || '').trim()
  if (!jobCode) return { ok: false, message: '记录岗位信息无效，无法校验删除权限' }

  const un = await resolveAdminDbUsernameFromToken(token)
  if (!un) return { ok: true }

  const [rows] = await mysqlAdminPool.query<RowDataPacket[]>(
    'SELECT username, name, role, dept FROM users WHERE username = ? LIMIT 1',
    [un]
  )
  const row = rows[0] as { username?: string | null; name?: string | null; role?: string | null; dept?: string | null } | undefined
  const username = String(row?.username || un).trim() || un
  const displayName = String(row?.name || '').trim() || username
  const actor = { username, displayName }
  const uiRole = mapAdminDbRoleToUiRole(String(row?.role || ''))
  const dept = String(row?.dept || '').trim()

  if (uiRole === 'admin') return { ok: true }
  if (uiRole === 'recruiter') {
    const ok = await screeningJobAllowsRecruiter(jobCode, actor)
    return ok ? { ok: true } : { ok: false, message: '仅可删除您负责招聘的岗位下的简历' }
  }
  if (uiRole === 'recruiting_manager') {
    const ok = await screeningJobAllowsRecruitingManager(jobCode, actor)
    return ok ? { ok: true } : { ok: false, message: '仅可删除您作为项目招聘负责人所属项目下的简历' }
  }
  if (uiRole === 'delivery_manager') {
    const ok = await screeningJobAllowsDeliveryManager(jobCode, dept)
    return ok ? { ok: true } : { ok: false, message: '仅可删除与您部门一致的项目下的简历' }
  }
  return { ok: false, message: '当前角色无删除权限' }
}

/** 与简历库/删除权限一致：某 job_code 下的筛查数据当前登录者是否可见（含环境/旧版令牌视为全量） */
async function jobCodesVisibleToAdminToken(token: string, jobCodes: string[]): Promise<Set<string>> {
  const uniq = [...new Set(jobCodes.map((x) => String(x || '').trim()).filter(Boolean))]
  const allowed = new Set<string>()
  await Promise.all(
    uniq.map(async (jc) => {
      const gate = await assertCanDeleteResumeScreening(token, jc)
      if (gate.ok) allowed.add(jc)
    })
  )
  return allowed
}

/**
 * 筛查主键 id（库中为 BIGINT）：规范为十进制数字串，供 IN (...) 与 JSON 安全下发；
 * 丢弃非法值；对超过 Number.MAX_SAFE_INTEGER 的 id 仅接受字符串形态，避免前端 Number 精度丢失导致删不掉。
 */
function normalizeResumeScreeningPkToken(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return null
    const n = Math.floor(v)
    if (!Number.isSafeInteger(n)) return null
    return String(n)
  }
  const s = String(v).trim()
  if (!/^\d{1,20}$/.test(s)) return null
  return s
}

function normalizeResumeScreeningDeleteIds(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of arr) {
    const s = normalizeResumeScreeningPkToken(x)
    if (!s) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
    if (out.length >= 200) break
  }
  return out
}

/** 在库内 screening_files 行已删除之后无法查路径；应在事务内先查出路径，提交后再调用本函数 */
async function unlinkResumeFileAbsPaths(absPaths: string[]): Promise<void> {
  for (const abs of absPaths) {
    if (!abs) continue
    try {
      await fs.promises.unlink(abs)
    } catch {
      /* ignore */
    }
  }
}

/** mysql2 对 BIGINT 等可能返回 bigint，JSON.stringify 会抛错 */
function jsonSafeMysqlCell(v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString()
  return v
}

function adminJobRowForJson(r: Record<string, unknown>) {
  return {
    id: jsonSafeMysqlCell(r.id),
    project_id: r.project_id,
    job_code: r.job_code,
    title: r.title,
    department: r.department,
    jd_text: r.jd_text,
    demand: jsonSafeMysqlCell(r.demand),
    location: r.location,
    skills: r.skills,
    level: r.level,
    salary: r.salary,
    recruiters: recruitersFromRow(r.recruiters)
  }
}

/** HR 后台：岗位列表（与小程序 / 会话共用 jobs 表） */
app.get('/api/admin/jobs', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  try {
    const [rows] = await mysqlPool.query<any[]>(
      `SELECT id, project_id, job_code, title, department, jd_text, demand, location, skills, level, salary, recruiters
       FROM jobs ORDER BY id DESC`
    )
    res.json({
      data: (rows as Record<string, unknown>[]).map((r) => adminJobRowForJson(r))
    })
  } catch (e) {
    console.error('[GET /api/admin/jobs]', e)
    res.status(500).json({ message: 'db error' })
  }
})

/** HR 后台：项目列表（简历筛查按项目筛选、岗位归属展示用） */
app.get('/api/admin/projects', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  try {
    const [rows] = await mysqlPool.query<any[]>(
      `SELECT id, name, project_code, client, dept, status, recruitment_leads FROM projects ORDER BY updated_at DESC, id DESC LIMIT 500`
    )
    res.json({
      data: (rows || []).map((r) => ({
        id: String(r.id ?? ''),
        name: String(r.name ?? ''),
        projectCode: r.project_code != null ? String(r.project_code) : null,
        client: r.client != null ? String(r.client) : null,
        dept: r.dept != null ? String(r.dept) : null,
        status: r.status != null ? String(r.status) : '',
        recruitmentLeads: parseRecruitmentLeadsColumn(r.recruitment_leads)
      }))
    })
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code
    if (code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({ message: 'projects 表未创建' })
    }
    console.error('[GET /api/admin/projects]', e)
    res.status(500).json({ message: 'db error' })
  }
})

app.post('/api/admin/jobs', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  const titleNorm = normalizeJobTitle(String(req.body?.title || ''))
  let jobCode = String(req.body?.jobCode || '').trim().toUpperCase()
  if (!titleNorm) {
    return res.status(400).json({
      message: String(req.body?.title || '').trim() ? jobTitleValidationMessage() : 'title required'
    })
  }
  if (!jobCode) {
    jobCode = `J${Date.now().toString(36).toUpperCase().slice(-8)}`
  }
  const projectIdRaw = req.body?.projectId
  const projectId =
    projectIdRaw === undefined || projectIdRaw === null || projectIdRaw === ''
      ? null
      : String(projectIdRaw).trim() || null
  const department = String(req.body?.department || '').trim()
  const jdText = String(req.body?.jdText || req.body?.jd || '').trim()
  const rawDemand = Number(req.body?.demand)
  const demand = Number.isFinite(rawDemand) && rawDemand > 0 ? Math.min(Math.floor(rawDemand), 99999) : 1
  const location = String(req.body?.location ?? '').trim()
  const skills = String(req.body?.skills ?? '').trim()
  const levelRaw = String(req.body?.level ?? '').trim()
  if (!levelRaw) return res.status(400).json({ message: 'level required' })
  const levelNorm = normalizeJobLevel(levelRaw)
  if (!levelNorm) return res.status(400).json({ message: jobLevelValidationMessage() })
  const salary = String(req.body?.salary ?? '').trim()
  const recruitersJson = normalizeRecruitersForDb(req.body?.recruiters)
  try {
    await mysqlPool.query(
      `INSERT INTO jobs (project_id, job_code, title, department, jd_text, demand, location, skills, level, salary, recruiters)
       VALUES (?,?,?,?,?,?,?,?,?,?, CAST(? AS JSON))`,
      [
        projectId,
        jobCode,
        titleNorm,
        department,
        jdText,
        demand,
        location || null,
        skills || null,
        levelNorm,
        salary || null,
        recruitersJson
      ]
    )
    res.json({ data: { jobCode } })
  } catch (e: any) {
    if (e?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'job_code exists' })
    if (e?.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(400).json({ message: 'projectId not found in projects' })
    }
    res.status(500).json({ message: 'db error' })
  }
})

app.patch('/api/admin/jobs/:jobCode', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  const jobCode = String(req.params.jobCode || '').trim().toUpperCase()
  if (!jobCode) return res.status(400).json({ message: 'jobCode required' })
  const titleIn = req.body?.title !== undefined
  const titleNorm = titleIn ? normalizeJobTitle(String(req.body.title)) : undefined
  if (titleIn) {
    if (!String(req.body.title ?? '').trim()) return res.status(400).json({ message: 'title required' })
    if (!titleNorm) return res.status(400).json({ message: jobTitleValidationMessage() })
  }
  const department = req.body?.department !== undefined ? String(req.body.department).trim() : null
  const jdText = req.body?.jdText !== undefined ? String(req.body.jdText) : null
  const projectId =
    req.body?.projectId !== undefined
      ? req.body.projectId === null || req.body.projectId === ''
        ? null
        : String(req.body.projectId).trim() || null
      : undefined
  const demand =
    req.body?.demand !== undefined
      ? (() => {
          const n = Number(req.body.demand)
          return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 99999) : 1
        })()
      : undefined
  const location = req.body?.location !== undefined ? String(req.body.location).trim() : undefined
  const skills = req.body?.skills !== undefined ? String(req.body.skills).trim() : undefined
  const levelIn = req.body?.level !== undefined
  let levelNorm: string | undefined
  if (levelIn) {
    const raw = String(req.body.level ?? '').trim()
    if (!raw) return res.status(400).json({ message: 'level required' })
    const ln = normalizeJobLevel(raw)
    if (!ln) return res.status(400).json({ message: jobLevelValidationMessage() })
    levelNorm = ln
  }
  const salary = req.body?.salary !== undefined ? String(req.body.salary).trim() : undefined
  const recruiters =
    req.body?.recruiters !== undefined ? normalizeRecruitersForDb(req.body.recruiters) : undefined
  try {
    const fields: string[] = []
    const vals: any[] = []
    if (titleIn && titleNorm) {
      fields.push('title=?')
      vals.push(titleNorm)
    }
    if (department !== null) {
      fields.push('department=?')
      vals.push(department)
    }
    if (jdText !== null) {
      fields.push('jd_text=?')
      vals.push(jdText)
    }
    if (projectId !== undefined) {
      fields.push('project_id=?')
      vals.push(projectId)
    }
    if (demand !== undefined) {
      fields.push('demand=?')
      vals.push(demand)
    }
    if (location !== undefined) {
      fields.push('location=?')
      vals.push(location || null)
    }
    if (skills !== undefined) {
      fields.push('skills=?')
      vals.push(skills || null)
    }
    if (levelIn && levelNorm) {
      fields.push('level=?')
      vals.push(levelNorm)
    }
    if (salary !== undefined) {
      fields.push('salary=?')
      vals.push(salary || null)
    }
    if (recruiters !== undefined) {
      fields.push('recruiters=CAST(? AS JSON)')
      vals.push(recruiters)
    }
    if (!fields.length) return res.status(400).json({ message: 'no fields to update' })
    vals.push(jobCode)
    const [hdr] = await mysqlPool.query<ResultSetHeader>(
      `UPDATE jobs SET ${fields.join(', ')} WHERE job_code=?`,
      vals
    )
    if (!hdr.affectedRows) return res.status(404).json({ message: 'job not found' })
    res.json({ ok: true })
  } catch (e: any) {
    if (e?.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(400).json({ message: 'projectId not found in projects' })
    }
    res.status(500).json({ message: 'db error' })
  }
})

/** job_code 跨表比较统一排序规则，避免 utf8mb4_unicode_ci / utf8mb4_0900_ai_ci 混用导致 JOIN 报错 */
function resumeScreeningsJobCodeMatchSql(jobAlias: string, screeningAlias: string): string {
  return `CONVERT(TRIM(${jobAlias}.job_code) USING utf8mb4) COLLATE utf8mb4_unicode_ci =
          CONVERT(TRIM(${screeningAlias}.job_code) USING utf8mb4) COLLATE utf8mb4_unicode_ci`
}

/** 按项目筛筛查记录：与 jobs.job_code + jobs.project_id 关联；`_null` 表示仅岗位未绑定项目 */
function resumeScreeningsJobFilterJoinSql(projectId: string | null): { fragment: string; params: unknown[] } {
  if (!projectId) return { fragment: '', params: [] }
  const onJob = resumeScreeningsJobCodeMatchSql('j', 's')
  if (projectId === '_null') {
    return {
      fragment: ` INNER JOIN jobs j ON ${onJob} AND (j.project_id IS NULL OR TRIM(j.project_id) = '') `,
      params: []
    }
  }
  return {
    fragment: ` INNER JOIN jobs j ON ${onJob} AND CONVERT(TRIM(j.project_id) USING utf8mb4) COLLATE utf8mb4_unicode_ci =
          CONVERT(TRIM(?) USING utf8mb4) COLLATE utf8mb4_unicode_ci `,
    params: [projectId]
  }
}

/** projects.id 与 jobs.project_id 常见 utf8mb4_unicode_ci / utf8mb4_0900_ai_ci 混用，须与 job_code 一样显式归一 */
function resumeScreeningsProjectIdMatchSql(projectAlias: string, jobAlias: string): string {
  return `CONVERT(TRIM(${projectAlias}.id) USING utf8mb4) COLLATE utf8mb4_unicode_ci =
          CONVERT(TRIM(${jobAlias}.project_id) USING utf8mb4) COLLATE utf8mb4_unicode_ci`
}

/** 筛查 job_code → jobs(jn) → projects(pn)，列表展示项目名称 */
function resumeScreeningsProjectJoinSql(): string {
  const onJn = resumeScreeningsJobCodeMatchSql('jn', 's')
  const onPn = resumeScreeningsProjectIdMatchSql('pn', 'jn')
  return `LEFT JOIN jobs jn ON ${onJn}
      LEFT JOIN projects pn ON ${onPn}`
}

function resumeScreeningsJoinSql(
  withPipelineStage: boolean,
  withSessionJoin: boolean,
  projectId: string | null,
  includeCandidateId = true
): {
  sql: string
  params: unknown[]
} {
  const cidCol = includeCandidateId ? 's.candidate_id, ' : ''
  const ps = withPipelineStage ? 's.pipeline_stage, ' : ''
  const sessCols = withSessionJoin
    ? `sess.status AS interview_session_status,
              sess.voip_status AS interview_session_voip,
              sess.updated_at AS interview_session_updated_at`
    : `NULL AS interview_session_status,
              NULL AS interview_session_voip,
              NULL AS interview_session_updated_at`
  const sessJoin = withSessionJoin
    ? `LEFT JOIN interview_sessions sess
         ON CONVERT(sess.session_id USING utf8mb4) COLLATE utf8mb4_unicode_ci =
            CONVERT(lr.session_id USING utf8mb4) COLLATE utf8mb4_unicode_ci`
    : ''
  const { fragment: jobJoin, params: jobParams } = resumeScreeningsJobFilterJoinSql(projectId)
  // 标量子查询取最新报告；CONVERT+COLLATE 避免表间 utf8mb4_unicode_ci / utf8mb4_0900_ai_ci 混用报错
  const sql = `SELECT s.id, s.job_code, s.candidate_name, s.candidate_phone, ${cidCol}s.matched_job_title, s.match_score,
              s.skill_score, s.experience_score, s.education_score, s.stability_score,
              s.status, ${ps}s.report_summary, s.evaluation_json, s.file_name, s.uploader_username,
              CAST(DATE_FORMAT(s.created_at, '%Y-%m-%d %H:%i:%s') AS CHAR(32)) AS created_at,
              EXISTS(SELECT 1 FROM resume_screening_files rf WHERE rf.screening_id = s.id LIMIT 1) AS has_original_file,
              SUBSTRING(COALESCE(s.resume_plaintext,''), 1, 12000) AS resume_plaintext,
              lr.overall_score AS interview_overall_score,
              lr.passed AS interview_passed,
              lr.updated_at AS interview_report_updated_at,
              lr.session_id AS interview_report_session_id,
              TRIM(COALESCE(pn.name, '')) AS job_project_name,
              ${sessCols}
       FROM resume_screenings s
       ${jobJoin}
       ${resumeScreeningsProjectJoinSql()}
       LEFT JOIN interview_reports lr ON lr.id = (
         SELECT ir.id
         FROM interview_reports ir
         WHERE CONVERT(TRIM(ir.job_code) USING utf8mb4) COLLATE utf8mb4_unicode_ci =
               CONVERT(TRIM(s.job_code) USING utf8mb4) COLLATE utf8mb4_unicode_ci
           AND (
             (
               TRIM(COALESCE(ir.candidate_phone, '')) <> ''
               AND TRIM(COALESCE(s.candidate_phone, '')) <> ''
               AND TRIM(ir.candidate_phone) = TRIM(s.candidate_phone)
             )
             OR (
               CONVERT(TRIM(ir.candidate_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci =
               CONVERT(TRIM(s.candidate_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci
             )
           )
         ORDER BY ir.updated_at DESC, ir.id DESC
         LIMIT 1
       )
       ${sessJoin}
       ORDER BY s.id DESC
       LIMIT 200`
  return { sql, params: jobParams }
}

function resumeScreeningsPlainSql(
  withPipelineStage: boolean,
  projectId: string | null,
  includeCandidateId = true
): { sql: string; params: unknown[] } {
  const cidCol = includeCandidateId ? 's.candidate_id, ' : ''
  const ps = withPipelineStage ? 'pipeline_stage, ' : ''
  const { fragment: jobJoin, params: jobParams } = resumeScreeningsJobFilterJoinSql(projectId)
  const sql = `SELECT s.id, s.job_code, s.candidate_name, s.candidate_phone, ${cidCol}s.matched_job_title, s.match_score,
              s.skill_score, s.experience_score, s.education_score, s.stability_score,
              s.status, ${ps}s.report_summary, s.evaluation_json, s.file_name, s.uploader_username,
              CAST(DATE_FORMAT(s.created_at, '%Y-%m-%d %H:%i:%s') AS CHAR(32)) AS created_at,
              EXISTS(SELECT 1 FROM resume_screening_files rf WHERE rf.screening_id = s.id LIMIT 1) AS has_original_file,
              SUBSTRING(COALESCE(s.resume_plaintext,''), 1, 12000) AS resume_plaintext,
              TRIM(COALESCE(pn.name, '')) AS job_project_name
       FROM resume_screenings s
       ${jobJoin}
       ${resumeScreeningsProjectJoinSql()}
       ORDER BY s.id DESC
       LIMIT 200`
  return { sql, params: jobParams }
}

/** 简历库列表：筛查主表 + 结构化详情（profiles）+ 项目名；字段贴合简历详情编辑 */
function resumeLibraryListSql(projectId: string | null): { sql: string; params: unknown[] } {
  const { fragment: jobJoin, params: jobParams } = resumeScreeningsJobFilterJoinSql(projectId)
  const sql = `SELECT s.id,
              s.candidate_name,
              s.candidate_phone,
              s.matched_job_title,
              s.job_code,
              s.file_name,
              CAST(DATE_FORMAT(s.created_at, '%Y-%m-%d %H:%i:%s') AS CHAR(32)) AS created_at,
              EXISTS(SELECT 1 FROM resume_screening_files rf WHERE rf.screening_id = s.id LIMIT 1) AS has_original_file,
              TRIM(COALESCE(pn.name, '')) AS job_project_name,
              TRIM(COALESCE(jn.title, '')) AS job_list_title,
              p.gender,
              p.age,
              p.work_experience_years,
              p.major,
              p.education,
              NULLIF(TRIM(p.job_title), '') AS profile_job_title,
              p.has_degree,
              p.is_unified_enrollment,
              p.expected_salary,
              p.verifiable,
              p.recruitment_channel,
              p.resume_uploaded
       FROM resume_screenings s
       ${jobJoin}
       ${resumeScreeningsProjectJoinSql()}
       LEFT JOIN resume_screening_profiles p ON p.screening_id = s.id
       ORDER BY s.id DESC
       LIMIT 500`
  return { sql, params: jobParams }
}

function isMissingPipelineStageColumn(e: unknown): boolean {
  const err = e as { errno?: number; message?: string }
  const m = String(err.message || '')
  return err.errno === 1054 && m.includes('pipeline_stage')
}

function isMissingInterviewSessionsRelation(e: unknown): boolean {
  const err = e as { code?: string; errno?: number; message?: string }
  const m = String(err.message || '')
  return err.code === 'ER_NO_SUCH_TABLE' && m.includes('interview_sessions')
}

function isCollationMismatch(e: unknown): boolean {
  const err = e as { code?: string; errno?: number }
  return err.code === 'ER_CANT_AGGREGATE_2COLLATIONS' || err.errno === 1267
}

function isMissingMysqlColumn(e: unknown, col: string): boolean {
  const err = e as { errno?: number; message?: string }
  return err.errno === 1054 && String(err.message || '').includes(col)
}

async function queryResumeScreeningsJoinedRows(projectId: string | null): Promise<any[]> {
  let usePipeline = true
  let useSession = true
  let includeCandidateId = true
  let lastErr: unknown
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const { sql, params } = resumeScreeningsJoinSql(usePipeline, useSession, projectId, includeCandidateId)
      const [rows] = await mysqlPool.query<any[]>(sql, params)
      let out = rows || []
      if (!usePipeline) out = out.map((r) => ({ ...r, pipeline_stage: r.pipeline_stage ?? 'resume_done' }))
      return out
    } catch (e) {
      lastErr = e
      if (isMissingPipelineStageColumn(e) && usePipeline) {
        usePipeline = false
        continue
      }
      if (isMissingInterviewSessionsRelation(e) && useSession) {
        useSession = false
        continue
      }
      if (isCollationMismatch(e) && useSession) {
        useSession = false
        continue
      }
      if (isMissingMysqlColumn(e, 'candidate_id') && includeCandidateId) {
        includeCandidateId = false
        continue
      }
      throw e
    }
  }
  throw lastErr
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 将 MySQL/JSON 的 created_at 统一成与表里「墙钟」一致的 `YYYY-MM-DD HH:mm:ss`；避免 `DATE_FORMAT` 仍被当 DATETIME 变 Date，JSON 成带 Z 的 ISO 后前端再 +8h */
function resumeScreeningCreatedAtForResponse(raw: unknown): string {
  if (raw == null) return ''
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) {
    return resumeScreeningCreatedAtForResponse(raw.toString('utf8').trim())
  }
  if (typeof raw === 'string') {
    const t = raw.trim()
    // 被误作 UTC 序列化的 ISO：直接取 T 前日期与 T～Z 之间的时间，不再按 Asia/Shanghai 从 UTC 换算
    const isoZ = t.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z$/i)
    if (isoZ) {
      return `${isoZ[1]} ${isoZ[2]}:${isoZ[3]}:${isoZ[4]}`
    }
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(t)) {
      return t.slice(0, 19)
    }
    return t
  }
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return ''
    // 与「墙钟当 UTC 装盒」的 Date 一致，用 getUTC* 成墙钟
    return `${raw.getUTCFullYear()}-${pad2(raw.getUTCMonth() + 1)}-${pad2(raw.getUTCDate())} ${pad2(
      raw.getUTCHours()
    )}:${pad2(raw.getUTCMinutes())}:${pad2(raw.getUTCSeconds())}`
  }
  return String(raw)
}

app.get('/api/admin/resume-screenings', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  const rawPid = String(req.query.projectId ?? req.query.project_id ?? '').trim()
  const projectId = rawPid.length ? rawPid : null
  try {
    const rows = await queryResumeScreeningsJoinedRows(projectId)
    const data = (rows || []).map((r) => ({
      ...r,
      id: jsonSafeMysqlCell((r as { id?: unknown }).id),
      created_at: resumeScreeningCreatedAtForResponse((r as { created_at?: unknown }).created_at),
      file_name:
        r?.file_name != null && String(r.file_name).trim()
          ? normalizeMultipartFilename(String(r.file_name)).slice(0, 255)
          : r.file_name
    }))
    res.json({ data })
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code
    if (code === 'ER_NO_SUCH_TABLE') {
      try {
        let rows: any[]
        let plainWithPipeline = true
        let plainWithCid = true
        for (;;) {
          try {
            const q = resumeScreeningsPlainSql(plainWithPipeline, projectId, plainWithCid)
            ;[rows] = await mysqlPool.query<any[]>(q.sql, q.params)
            break
          } catch (e2: unknown) {
            if (isMissingMysqlColumn(e2, 'candidate_id') && plainWithCid) {
              plainWithCid = false
              continue
            }
            if (isMissingPipelineStageColumn(e2) && plainWithPipeline) {
              plainWithPipeline = false
              continue
            }
            throw e2
          }
        }
        if (!plainWithPipeline) {
          rows = (rows || []).map((r) => ({ ...r, pipeline_stage: 'resume_done' }))
        }
        const patched = (rows || []).map((r) => ({
          ...r,
          id: jsonSafeMysqlCell((r as { id?: unknown }).id),
          created_at: resumeScreeningCreatedAtForResponse((r as { created_at?: unknown }).created_at),
          file_name:
            r?.file_name != null && String(r.file_name).trim()
              ? normalizeMultipartFilename(String(r.file_name)).slice(0, 255)
              : r.file_name,
          interview_overall_score: null,
          interview_passed: null,
          interview_report_updated_at: null,
          interview_report_session_id: null,
          interview_session_status: null,
          interview_session_voip: null,
          interview_session_updated_at: null
        }))
        return res.json({ data: patched })
      } catch (e2: unknown) {
        const c2 = (e2 as { code?: string })?.code
        if (c2 === 'ER_NO_SUCH_TABLE') {
          return res.status(503).json({ message: 'resume_screenings 表未创建，请执行 server/migration_resume_screenings.sql' })
        }
        console.error('[GET /api/admin/resume-screenings] fallback', (e2 as { code?: string; errno?: number; message?: string })?.code, (e2 as { message?: string })?.message, e2)
        return res.status(500).json({ message: 'db error' })
      }
    }
    const ex = e as { code?: string; errno?: number; message?: string }
    console.error('[GET /api/admin/resume-screenings]', ex.code, ex.errno, ex.message, e)
    res.status(500).json({ message: 'db error' })
  }
})

app.get('/api/admin/resume-library', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  const rawPid = String(req.query.projectId ?? req.query.project_id ?? '').trim()
  const projectId = rawPid.length ? rawPid : null
  try {
    const { sql, params } = resumeLibraryListSql(projectId)
    const [rows] = await mysqlPool.query<any[]>(sql, params)
    const data = (rows || []).map((r) => ({
      ...r,
      id: jsonSafeMysqlCell((r as { id?: unknown }).id),
      created_at: resumeScreeningCreatedAtForResponse((r as { created_at?: unknown }).created_at),
      file_name:
        r?.file_name != null && String(r.file_name).trim()
          ? normalizeMultipartFilename(String(r.file_name)).slice(0, 255)
          : r.file_name
    }))
    res.json({ data })
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code
    if (code === 'ER_NO_SUCH_TABLE') {
      const msg = String((e as { message?: string }).message || '')
      if (msg.includes('resume_screening_profiles')) {
        return res
          .status(503)
          .json({ message: '缺少结构化详情表，请执行 server/migration_resume_screening_profiles.sql' })
      }
      return res.status(503).json({ message: 'resume_screenings 表未创建，请执行 server/migration_resume_screenings.sql' })
    }
    console.error('[GET /api/admin/resume-library]', (e as { message?: string })?.message, e)
    res.status(500).json({ message: 'db error' })
  }
})

app.get('/api/admin/resume-library/:id/delivery-history', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  const idTok = normalizeResumeScreeningPkToken(req.params.id)
  if (!idTok) {
    return res.status(400).json({ message: 'invalid id' })
  }
  const token = extractAdminRequestToken(req)
  const projJoin = resumeScreeningsProjectJoinSql()
  const baseSelect = `SELECT s.id,
              s.job_code,
              s.matched_job_title,
              CAST(DATE_FORMAT(s.created_at, '%Y-%m-%d %H:%i:%s') AS CHAR(32)) AS created_at,
              TRIM(COALESCE(pn.name, '')) AS job_project_name,
              TRIM(COALESCE(jn.title, '')) AS job_list_title
       FROM resume_screenings s
       ${projJoin}`

  type AnchorRow = {
    id?: unknown
    job_code?: unknown
    candidate_phone?: unknown
    candidate_name?: unknown
    candidate_id?: unknown
  }

  let includeCid = true
  let anchor: AnchorRow | undefined
  for (;;) {
    try {
      const cols = includeCid
        ? 's.id, s.job_code, s.candidate_phone, s.candidate_name, s.candidate_id'
        : 's.id, s.job_code, s.candidate_phone, s.candidate_name'
      const [arows] = await mysqlPool.query<RowDataPacket[]>(
        `SELECT ${cols} FROM resume_screenings s WHERE s.id = ? LIMIT 1`,
        [idTok]
      )
      anchor = arows[0] as AnchorRow | undefined
      break
    } catch (e: unknown) {
      if (includeCid && isMissingMysqlColumn(e, 'candidate_id')) {
        includeCid = false
        continue
      }
      const code = (e as { code?: string })?.code
      if (code === 'ER_NO_SUCH_TABLE') {
        return res.status(503).json({ message: 'resume_screenings 表未创建' })
      }
      console.error('[GET /api/admin/resume-library/:id/delivery-history] anchor', e)
      return res.status(500).json({ message: 'db error' })
    }
  }

  if (!anchor) {
    return res.status(404).json({ message: '记录不存在' })
  }
  const anchorJob = String(anchor.job_code || '').trim()
  const anchorGate = await assertCanDeleteResumeScreening(token, anchorJob)
  if (anchorGate.ok === false) {
    return res.status(403).json({ message: anchorGate.message || '无权查看该记录的投递历史' })
  }

  let rows: RowDataPacket[] = []
  try {
    const cidRaw = includeCid ? anchor.candidate_id : null
    const cidStr =
      cidRaw != null && String(cidRaw).trim() !== '' && String(cidRaw).trim() !== '0'
        ? String(cidRaw).trim()
        : null

    if (includeCid && cidStr) {
      const [srows] = await mysqlPool.query<RowDataPacket[]>(
        `${baseSelect}
         WHERE s.candidate_id = ?
         ORDER BY s.created_at DESC, s.id DESC
         LIMIT 200`,
        [cidStr]
      )
      rows = srows || []
    } else {
      const phoneTrim = String(anchor.candidate_phone || '').trim()
      const nameTrim = String(anchor.candidate_name || '').trim()
      if (phoneTrim && nameTrim) {
        const [srows] = await mysqlPool.query<RowDataPacket[]>(
          `${baseSelect}
           WHERE TRIM(COALESCE(s.candidate_phone, '')) <> ''
             AND TRIM(s.candidate_phone) = ?
             AND LOWER(TRIM(s.candidate_name)) = LOWER(?)
           ORDER BY s.created_at DESC, s.id DESC
           LIMIT 200`,
          [phoneTrim, nameTrim]
        )
        rows = srows || []
      } else {
        const [srows] = await mysqlPool.query<RowDataPacket[]>(
          `${baseSelect}
           WHERE s.id = ?
           LIMIT 1`,
          [idTok]
        )
        rows = srows || []
      }
    }
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code
    if (code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({ message: 'resume_screenings 表未创建' })
    }
    console.error('[GET /api/admin/resume-library/:id/delivery-history]', e)
    return res.status(500).json({ message: 'db error' })
  }

  const jobCodes = (rows || []).map((r) => String((r as { job_code?: unknown }).job_code || '').trim()).filter(Boolean)
  const allowed = await jobCodesVisibleToAdminToken(token, jobCodes)
  const filtered = (rows || []).filter((r) => allowed.has(String((r as { job_code?: unknown }).job_code || '').trim()))

  const data = filtered.map((r) => ({
    id: jsonSafeMysqlCell((r as { id?: unknown }).id),
    job_code: String((r as { job_code?: unknown }).job_code || '').trim(),
    matched_job_title:
      (r as { matched_job_title?: unknown }).matched_job_title != null
        ? String((r as { matched_job_title?: unknown }).matched_job_title)
        : null,
    job_list_title:
      (r as { job_list_title?: unknown }).job_list_title != null
        ? String((r as { job_list_title?: unknown }).job_list_title).trim() || null
        : null,
    job_project_name:
      (r as { job_project_name?: unknown }).job_project_name != null
        ? String((r as { job_project_name?: unknown }).job_project_name).trim() || null
        : null,
    created_at: resumeScreeningCreatedAtForResponse((r as { created_at?: unknown }).created_at)
  }))

  res.json({ data })
})

app.patch('/api/admin/resume-screenings/:id', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  const idRaw = String(req.params.id || '').trim()
  const idNum = Number(idRaw)
  if (!Number.isFinite(idNum) || idNum <= 0) {
    return res.status(400).json({ message: 'invalid id' })
  }
  const hasName = req.body != null && Object.prototype.hasOwnProperty.call(req.body, 'candidateName')
  const hasPhone = req.body != null && Object.prototype.hasOwnProperty.call(req.body, 'candidatePhone')
  if (!hasName && !hasPhone) {
    return res.status(400).json({ message: '请提供 candidateName 或 candidatePhone' })
  }
  let candidateName: string | undefined
  if (hasName) {
    const raw = String(req.body.candidateName ?? '').trim()
    if (!raw) candidateName = '候选人'
    else {
      const normalized = sanitizeCandidateName(raw)
      if (!normalized) {
        return res.status(400).json({ message: '候选人姓名格式不正确，请填写 2-30 位中英文姓名' })
      }
      candidateName = normalized
    }
  }
  let candidatePhone: string | null | undefined
  if (hasPhone) {
    const raw = String(req.body.candidatePhone ?? '').trim()
    if (!raw) candidatePhone = null
    else {
      const norm = normalizeCnMobile(raw)
      candidatePhone = norm ?? raw.replace(/\s/g, '').slice(0, 32)
    }
  }
  try {
    const token = extractAdminRequestToken(req)
    const actor = await loadAdminSessionActor(token)
    if (!actor?.username) {
      return res.status(403).json({ message: '当前登录方式无法识别上传人，不能修改候选人信息' })
    }
    const [srows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT id, job_code, uploader_username FROM resume_screenings WHERE id = ? LIMIT 1',
      [Math.floor(idNum)]
    )
    if (!srows?.length) {
      return res.status(404).json({ message: '记录不存在' })
    }
    const row = srows[0] as { job_code?: string; uploader_username?: string | null }
    const uploader = String(row.uploader_username || '').trim().toLowerCase()
    const actorUsername = String(actor.username || '').trim().toLowerCase()
    if (!uploader) {
      return res.status(403).json({ message: '该记录缺少上传人信息，无法校验修改权限' })
    }
    if (!actorUsername || actorUsername !== uploader) {
      return res.status(403).json({ message: '仅上传该简历的账号可修改姓名和手机号' })
    }
    const fields: string[] = []
    const vals: unknown[] = []
    if (candidateName !== undefined) {
      fields.push('candidate_name = ?')
      vals.push(candidateName)
    }
    if (candidatePhone !== undefined) {
      fields.push('candidate_phone = ?')
      vals.push(candidatePhone)
    }
    if (!fields.length) {
      return res.status(400).json({ message: '无更新字段' })
    }
    vals.push(Math.floor(idNum))
    const [hdr] = await mysqlPool.query<ResultSetHeader>(
      `UPDATE resume_screenings SET ${fields.join(', ')} WHERE id = ?`,
      vals
    )
    if (!hdr.affectedRows) {
      return res.status(404).json({ message: '记录不存在' })
    }
    const [sAfter] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT candidate_name, candidate_phone FROM resume_screenings WHERE id = ? LIMIT 1',
      [Math.floor(idNum)]
    )
    if (sAfter?.length) {
      const rr = sAfter[0] as { candidate_name?: unknown; candidate_phone?: unknown }
      await linkResumeScreeningToCandidateByPhone(
        Math.floor(idNum),
        rr.candidate_phone != null ? String(rr.candidate_phone) : '',
        String(rr.candidate_name || '')
      )
    }
    res.json({ ok: true })
  } catch (e: unknown) {
    const ex = e as { code?: string; errno?: number; message?: string }
    if (ex.errno === 1054 || ex.code === 'ER_BAD_FIELD_ERROR') {
      return res.status(503).json({
        message:
          '库表缺少 candidate_phone / uploader_username 字段，请执行 server/migration_resume_screenings_candidate_phone.sql 和 server/migration_resume_screenings_uploader_username.sql'
      })
    }
    console.error('[PATCH /api/admin/resume-screenings/:id]', ex.message, e)
    res.status(500).json({ message: 'db error' })
  }
})

/** 删除简历筛查记录（含 profile、原件索引；邀请上的 screening 关联置空）。body: { ids: number[] }，最多 200 条 */
app.post('/api/admin/resume-screenings/delete', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  const ids = normalizeResumeScreeningDeleteIds(req.body?.ids)
  if (!ids.length) {
    return res.status(400).json({ message: '请提供要删除的记录 id 列表（ids）' })
  }
  const token = extractAdminRequestToken(req)
  let conn: PoolConnection | null = null
  try {
    const phSel = ids.map(() => '?').join(',')
    const [srows] = await mysqlPool.query<RowDataPacket[]>(
      `SELECT id, job_code FROM resume_screenings WHERE id IN (${phSel})`,
      ids
    )
    if (!srows?.length) {
      return res.status(404).json({ message: '所选记录不存在或已被删除' })
    }
    for (const row of srows) {
      const r = row as { id?: unknown; job_code?: unknown }
      const jc = String(r.job_code || '').trim()
      const gate = await assertCanDeleteResumeScreening(token, jc)
      if (gate.ok === false) {
        return res.status(403).json({ message: gate.message })
      }
    }
    const toDelete = (srows as { id?: unknown }[])
      .map((r) => normalizeResumeScreeningPkToken((r as { id?: unknown }).id))
      .filter((s): s is string => Boolean(s))
    const uniqueDelete = [...new Set(toDelete)]
    conn = await mysqlPool.getConnection()
    await conn.beginTransaction()
    const ph = uniqueDelete.map(() => '?').join(',')
    const [fileRows] = await conn.query<RowDataPacket[]>(
      `SELECT storage_path FROM resume_screening_files WHERE screening_id IN (${ph})`,
      uniqueDelete
    )
    const deleteCountByPath = new Map<string, number>()
    for (const row of fileRows || []) {
      const sp = String((row as { storage_path?: unknown }).storage_path ?? '')
        .trim()
        .replace(/\0/g, '')
      if (!sp) continue
      deleteCountByPath.set(sp, (deleteCountByPath.get(sp) || 0) + 1)
    }
    const absToUnlink: string[] = []
    const absSeen = new Set<string>()
    for (const [storagePath, delCnt] of deleteCountByPath) {
      const [totRows] = await conn.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS c FROM resume_screening_files WHERE storage_path = ?',
        [storagePath]
      )
      const total = Number((totRows?.[0] as { c?: unknown })?.c ?? 0)
      if (total === delCnt) {
        const abs = resolveResumeStorageAbsPath(storagePath)
        if (abs && !absSeen.has(abs)) {
          absSeen.add(abs)
          absToUnlink.push(abs)
        }
      }
    }
    try {
      await conn.query(`DELETE FROM resume_screening_profiles WHERE screening_id IN (${ph})`, uniqueDelete)
    } catch (e: unknown) {
      if ((e as { code?: string })?.code !== 'ER_NO_SUCH_TABLE') throw e
    }
    try {
      await conn.query(`DELETE FROM resume_screening_files WHERE screening_id IN (${ph})`, uniqueDelete)
    } catch (e: unknown) {
      if ((e as { code?: string })?.code !== 'ER_NO_SUCH_TABLE') throw e
    }
    try {
      await conn.query(
        `UPDATE interview_invitations SET resume_screening_id = NULL WHERE resume_screening_id IN (${ph})`,
        uniqueDelete
      )
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code
      const errno = (e as { errno?: number })?.errno
      if (code !== 'ER_BAD_FIELD_ERROR' && errno !== 1054) throw e
    }
    const [dh] = await conn.query<ResultSetHeader>(`DELETE FROM resume_screenings WHERE id IN (${ph})`, uniqueDelete)
    await conn.commit()
    conn.release()
    conn = null
    await unlinkResumeFileAbsPaths(absToUnlink)
    res.json({ ok: true, deleted: Number(dh.affectedRows) || uniqueDelete.length })
  } catch (e: unknown) {
    if (conn) {
      try {
        await conn.rollback()
      } catch {
        /* ignore */
      }
    }
    const ex = e as { code?: string; errno?: number; message?: string }
    if (ex.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({ message: '数据表不完整，无法完成删除' })
    }
    console.error('[POST /api/admin/resume-screenings/delete]', ex.message, e)
    res.status(500).json({ message: '删除失败，请稍后重试' })
  } finally {
    if (conn) conn.release()
  }
})

app.get('/api/admin/resume-screenings/:id/profile', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  const idNum = Number(String(req.params.id || '').trim())
  if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ message: 'invalid id' })
  try {
    const [rows] = await mysqlPool.query<any[]>(
      `SELECT screening_id, candidate_name, gender, age, work_experience_years, job_title, school, candidate_phone,
              email, current_address, current_company, major, education, current_position, graduation_date, arrival_time, id_number,
              is_third_party, expected_salary, recruitment_channel, has_degree, is_unified_enrollment,
              verifiable, resume_uploaded, updated_at
       FROM resume_screening_profiles
       WHERE screening_id=? LIMIT 1`,
      [Math.floor(idNum)]
    )
    if (rows.length) return res.json({ data: rows[0] })
    const [baseRows] = await mysqlPool.query<any[]>(
      'SELECT id, candidate_name, evaluation_json FROM resume_screenings WHERE id=? LIMIT 1',
      [Math.floor(idNum)]
    )
    if (!baseRows.length) return res.status(404).json({ message: '记录不存在' })
    const base = baseRows[0] as { candidate_name?: unknown; evaluation_json?: unknown }
    let evalObj: Record<string, unknown> = {}
    try {
      if (base.evaluation_json && typeof base.evaluation_json === 'object') evalObj = base.evaluation_json as Record<string, unknown>
      else if (base.evaluation_json) evalObj = JSON.parse(String(base.evaluation_json))
    } catch {
      evalObj = {}
    }
    const row = resumeProfileRowFromValues({
      candidateName: base.candidate_name,
      profile: evalObj.candidate_profile
    })
    return res.json({
      data: {
        screening_id: Math.floor(idNum),
        candidate_name: row.candidateName,
        gender: row.gender,
        age: row.age,
        work_experience_years: row.workExperienceYears,
        job_title: row.jobTitle,
        school: row.school,
        candidate_phone: row.candidatePhone,
        email: row.email,
        current_address: row.currentAddress,
        current_company: row.currentCompany,
        major: row.major,
        education: row.education,
        current_position: row.currentPosition,
        graduation_date: row.graduationDate,
        arrival_time: row.arrivalTime,
        id_number: row.idNumber,
        is_third_party: row.isThirdParty,
        expected_salary: row.expectedSalary,
        recruitment_channel: row.recruitmentChannel,
        has_degree: row.hasDegree,
        is_unified_enrollment: row.isUnifiedEnrollment,
        verifiable: row.verifiable,
        resume_uploaded: row.resumeUploaded,
        updated_at: null
      }
    })
  } catch (e: unknown) {
    const ex = e as { code?: string; errno?: number }
    if (ex.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({ message: '缺少结构化详情表，请执行 server/migration_resume_screening_profiles.sql' })
    }
    return res.status(500).json({ message: 'db error' })
  }
})

app.patch('/api/admin/resume-screenings/:id/profile', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  const idNum = Number(String(req.params.id || '').trim())
  if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ message: 'invalid id' })
  const row = resumeProfileRowFromValues({
    candidateName: req.body?.candidate_name,
    profile: req.body
  })
  try {
    const [existRows] = await mysqlPool.query<RowDataPacket[]>('SELECT id FROM resume_screenings WHERE id=? LIMIT 1', [
      Math.floor(idNum)
    ])
    if (!existRows.length) return res.status(404).json({ message: '记录不存在' })
    await mysqlPool.query(
      `INSERT INTO resume_screening_profiles
         (screening_id, candidate_name, gender, age, work_experience_years, job_title, school, candidate_phone,
          email, current_address, current_company, major, education, current_position, graduation_date, arrival_time, id_number,
          is_third_party, expected_salary, recruitment_channel, has_degree, is_unified_enrollment,
          verifiable, resume_uploaded)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         candidate_name=VALUES(candidate_name),
         gender=VALUES(gender),
         age=VALUES(age),
         work_experience_years=VALUES(work_experience_years),
         job_title=VALUES(job_title),
         school=VALUES(school),
         candidate_phone=VALUES(candidate_phone),
         email=VALUES(email),
         current_address=VALUES(current_address),
         current_company=VALUES(current_company),
         major=VALUES(major),
         education=VALUES(education),
         current_position=VALUES(current_position),
         graduation_date=VALUES(graduation_date),
         arrival_time=VALUES(arrival_time),
         id_number=VALUES(id_number),
         is_third_party=VALUES(is_third_party),
         expected_salary=VALUES(expected_salary),
         recruitment_channel=VALUES(recruitment_channel),
         has_degree=VALUES(has_degree),
         is_unified_enrollment=VALUES(is_unified_enrollment),
         verifiable=VALUES(verifiable),
         resume_uploaded=VALUES(resume_uploaded),
         updated_at=NOW()`,
      [
        Math.floor(idNum),
        row.candidateName,
        row.gender,
        row.age,
        row.workExperienceYears,
        row.jobTitle,
        row.school,
        row.candidatePhone,
        row.email,
        row.currentAddress,
        row.currentCompany,
        row.major,
        row.education,
        row.currentPosition,
        row.graduationDate,
        row.arrivalTime,
        row.idNumber,
        row.isThirdParty,
        row.expectedSalary,
        row.recruitmentChannel,
        row.hasDegree,
        row.isUnifiedEnrollment,
        row.verifiable,
        row.resumeUploaded
      ]
    )
    await mysqlPool.query('UPDATE resume_screenings SET candidate_name=?, candidate_phone=? WHERE id=?', [
      row.candidateName,
      row.candidatePhone,
      Math.floor(idNum)
    ])
    await linkResumeScreeningToCandidateByPhone(Math.floor(idNum), row.candidatePhone, row.candidateName)
    res.json({ ok: true })
  } catch (e: unknown) {
    const ex = e as { code?: string; errno?: number }
    if (ex.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({ message: '缺少结构化详情表，请执行 server/migration_resume_screening_profiles.sql' })
    }
    return res.status(500).json({ message: 'db error' })
  }
})

app.get('/api/admin/resume-screenings/:id/file', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  const idNum = Number(String(req.params.id || '').trim())
  if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ message: 'invalid id' })
  const mode = String(req.query.mode || '').trim().toLowerCase()
  const download = mode === 'download'
  try {
    const [rows] = await mysqlPool.query<any[]>(
      `SELECT original_name, mime_type, storage_path
       FROM resume_screening_files
       WHERE screening_id=? LIMIT 1`,
      [Math.floor(idNum)]
    )
    if (!rows.length) return res.status(404).json({ message: '未找到原始简历文件' })
    const r = rows[0] as { original_name?: unknown; mime_type?: unknown; storage_path?: unknown }
    const abs = resolveResumeStorageAbsPath(r.storage_path)
    if (!abs) return res.status(404).json({ message: '简历文件不存在或已被移除' })
    const mime = String(r.mime_type || '').trim() || 'application/octet-stream'
    const name = normalizeMultipartFilename(String(r.original_name || 'resume.bin')).slice(0, 255) || 'resume.bin'
    res.setHeader('Content-Type', mime)
    res.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`
    )
    return res.sendFile(abs)
  } catch (e: unknown) {
    const ex = e as { code?: string }
    if (ex.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({ message: '缺少简历文件表，请执行 server/migration_resume_screening_files.sql' })
    }
    return res.status(500).json({ message: 'db error' })
  }
})

/** 工作台：聚合 resume_screenings + interview_reports，不读管理库演示表 */
app.get('/api/admin/workbench-stats', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  try {
    const [[agg]] = await mysqlPool.query<RowDataPacket[]>(
      `SELECT
        (SELECT COUNT(*) FROM resume_screenings) AS resume_screening_count,
        (SELECT COUNT(*) FROM resume_screenings rs
         WHERE (rs.report_summary IS NULL OR TRIM(rs.report_summary) = '')
            OR rs.status LIKE '%待分析%'
            OR rs.status LIKE '%分析中%'
            OR rs.status LIKE '%排队%'
            OR rs.status LIKE '%处理中%') AS pending_analysis_count,
        (SELECT COUNT(*) FROM resume_screenings rs2 WHERE rs2.status LIKE '%待定%') AS pending_review_count`
    )
    let interviewReportCount = 0
    let interviewPassedCount = 0
    try {
      const [[rep]] = await mysqlPool.query<RowDataPacket[]>(
        `SELECT
          COUNT(*) AS total,
          COALESCE(SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END), 0) AS passed_n
         FROM interview_reports`
      )
      interviewReportCount = Number(rep?.total) || 0
      interviewPassedCount = Number(rep?.passed_n) || 0
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code
      if (code !== 'ER_NO_SUCH_TABLE') throw e
    }
    const [recentRows] = await mysqlPool.query<
      RowDataPacket[]
    >(
      `SELECT id, candidate_name, matched_job_title, match_score, status
       FROM resume_screenings ORDER BY id DESC LIMIT 8`
    )
    const recentScreenings = (recentRows || []).map((r) => ({
      id: jsonSafeMysqlCell(r.id),
      candidate_name: String(r.candidate_name ?? ''),
      matched_job_title: String(r.matched_job_title ?? ''),
      match_score: Number(r.match_score) || 0,
      status: String(r.status ?? '')
    }))
    let pendingInviteCount = 0
    let pendingReportCount = 0
    let timeoutResumeCount = 0
    let timeoutInviteCount = 0
    let exceptionCount = 0
    let focusJobAlertCount = 0
    try {
      const [[row]] = await mysqlPool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n
         FROM resume_screenings
         WHERE pipeline_stage = 'resume_done' AND match_score >= 70`
      )
      pendingInviteCount = Number(row?.n) || 0
    } catch {}
    try {
      const [[row]] = await mysqlPool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n
         FROM interview_sessions s
         LEFT JOIN interview_reports r ON r.session_id = s.session_id
         WHERE r.id IS NULL
           AND (s.status IN ('completed', 'finished', 'ended') OR s.voip_status IN ('ended', 'finished', 'closed'))`
      )
      pendingReportCount = Number(row?.n) || 0
    } catch {}
    try {
      const [[row]] = await mysqlPool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n
         FROM resume_screenings
         WHERE pipeline_stage = 'resume_done'
           AND created_at < (NOW() - INTERVAL 1 DAY)`
      )
      timeoutResumeCount = Number(row?.n) || 0
    } catch {}
    try {
      const [[row]] = await mysqlPool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n
         FROM interview_invitations
         WHERE status = 'pending'
           AND created_at < (NOW() - INTERVAL 2 DAY)`
      )
      timeoutInviteCount = Number(row?.n) || 0
    } catch {}
    try {
      const [[row]] = await mysqlPool.query<RowDataPacket[]>(
        `SELECT
           COALESCE((
             SELECT COUNT(*) FROM resume_screenings
             WHERE status LIKE '%失败%' OR status LIKE '%异常%'
           ), 0)
           +
           COALESCE((
             SELECT COUNT(*) FROM interview_sessions
             WHERE voip_status IN ('failed', 'abnormal', 'error')
           ), 0) AS n`
      )
      exceptionCount = Number(row?.n) || 0
    } catch {}
    try {
      const [[row]] = await mysqlPool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n
         FROM (
           SELECT j.job_code
           FROM jobs j
           LEFT JOIN (
             SELECT job_code, COUNT(*) AS screening_n
             FROM resume_screenings
             GROUP BY job_code
           ) rs
             ON CONVERT(j.job_code USING utf8mb4) COLLATE utf8mb4_unicode_ci =
                CONVERT(rs.job_code USING utf8mb4) COLLATE utf8mb4_unicode_ci
           WHERE j.demand > COALESCE(rs.screening_n, 0)
         ) t`
      )
      focusJobAlertCount = Number(row?.n) || 0
    } catch {}
    res.json({
      data: {
        resumeScreeningCount: Number(agg?.resume_screening_count) || 0,
        pendingAnalysisCount: Number(agg?.pending_analysis_count) || 0,
        pendingReviewCount: Number(agg?.pending_review_count) || 0,
        interviewReportCount,
        interviewPassedCount,
        pendingInviteCount,
        pendingReportCount,
        timeoutResumeCount,
        timeoutInviteCount,
        exceptionCount,
        focusJobAlertCount,
        recentScreenings
      }
    })
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code
    if (code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({ message: 'resume_screenings 表未创建，请执行 server/migration_resume_screenings.sql' })
    }
    console.error('[GET /api/admin/workbench-stats]', e)
    res.status(500).json({ message: 'db error' })
  }
})

app.get('/api/admin/interview-report', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  const screeningId = Number(req.query?.screeningId)
  if (!Number.isFinite(screeningId) || screeningId <= 0) {
    return res.status(400).json({ message: 'screeningId required' })
  }
  try {
    const [screenRows] = await mysqlPool.query<any[]>(
      'SELECT job_code, candidate_name, candidate_phone FROM resume_screenings WHERE id=? LIMIT 1',
      [screeningId]
    )
    if (!screenRows.length) return res.status(404).json({ message: '筛查记录不存在' })
    const screen = screenRows[0] as { job_code: string; candidate_name: string; candidate_phone?: string | null }
    const normalizedPhone = normalizeCnMobile(String(screen.candidate_phone || '').trim())
    const [repRows] = await mysqlPool.query<any[]>(
      `SELECT session_id, job_code, candidate_name, candidate_phone, overall_score, passed, overall_feedback,
              dimension_scores, suggestions, risk_points, behavior_signals, qa_json, updated_at
       FROM interview_reports
       WHERE UPPER(TRIM(job_code)) = UPPER(?)
         AND (
           (TRIM(COALESCE(candidate_phone, '')) <> '' AND TRIM(candidate_phone) = TRIM(?))
           OR (
             CONVERT(TRIM(candidate_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci =
             CONVERT(TRIM(?) USING utf8mb4) COLLATE utf8mb4_unicode_ci
           )
         )
       ORDER BY
         CASE
           WHEN TRIM(COALESCE(candidate_phone, '')) <> '' AND TRIM(candidate_phone) = TRIM(?) THEN 0
           ELSE 1
         END,
         updated_at DESC
       LIMIT 1`,
      [String(screen.job_code || '').trim().toUpperCase(), normalizedPhone, String(screen.candidate_name || '').trim(), normalizedPhone]
    )
    if (!repRows.length) return res.status(404).json({ message: '暂无面试报告（候选人可能尚未完成答题）' })
    const row = repRows[0] as Record<string, unknown>
    const parseJson = (v: unknown, fallback: unknown) => {
      if (v == null) return fallback
      if (typeof v === 'object') return v
      try {
        return JSON.parse(String(v))
      } catch {
        return fallback
      }
    }
    res.json({
      data: {
        sessionId: String(row.session_id || ''),
        jobCode: String(row.job_code || ''),
        candidateName: String(row.candidate_name || ''),
        score: Number(row.overall_score) || 0,
        passed: Number(row.passed) === 1,
        overallFeedback: String(row.overall_feedback || ''),
        dimensionScores: parseJson(row.dimension_scores, {}),
        suggestions: parseJson(row.suggestions, []),
        riskPoints: parseJson(row.risk_points, []),
        behaviorSignals: parseJson(row.behavior_signals, {}),
        qa: parseJson(row.qa_json, []),
        updatedAt: String(row.updated_at || '')
      }
    })
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code
    if (code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({ message: '缺少 interview_reports 表，请执行 server/migration_interview_reports.sql' })
    }
    res.status(500).json({ message: 'db error' })
  }
})

app.post(
  '/api/admin/resume-screen',
  uploadResumeMemory.single('file'),
  async (req, res) => {
    if (!(await assertAdminToken(req, res))) return
    const jobCode = String(req.body?.jobCode || '').trim().toUpperCase()
    if (!jobCode) return res.status(400).json({ message: 'jobCode required' })
    if (!req.file?.buffer?.length) return res.status(400).json({ message: 'file required' })
    try {
      const uploadFileName = normalizeMultipartFilename(req.file.originalname).slice(0, 255)
      const actorToken = extractAdminRequestToken(req)
      const uploaderUsername = (await resolveAdminDbUsernameFromToken(actorToken)) || ''
      if (!uploaderUsername) {
        return res.status(403).json({ message: '当前登录方式缺少账号标识，无法上传简历用于后续手机号权限校验' })
      }
      const [jobRows] = await mysqlPool.query<any[]>(
        'SELECT title, department, jd_text FROM jobs WHERE job_code=? LIMIT 1',
        [jobCode]
      )
      if (!jobRows.length) return res.status(404).json({ message: 'job not found' })
      const job = jobRows[0] as { title: string; department: string | null; jd_text: string | null }
      let plain: string
      try {
        plain = await extractResumePlainText(req.file.buffer, uploadFileName, req.file.mimetype || '')
      } catch (ex) {
        const msg = ex instanceof Error ? ex.message : 'parse failed'
        return res.status(415).json({ message: msg })
      }
      if (!plain.trim()) return res.status(422).json({ message: '未能从文件中提取可读文本' })

      const plainStore = plain.slice(0, RESUME_PLAINTEXT_MAX_SAVE)
      const resumePlainHash = crypto
        .createHash('sha256')
        .update(Buffer.from(plainStore, 'utf8'))
        .digest('hex')
        .toLowerCase()
      try {
        const [dupByContent] = await mysqlPool.query<RowDataPacket[]>(
          `SELECT id FROM resume_screenings
           WHERE job_code = ?
             AND resume_plaintext IS NOT NULL AND CHAR_LENGTH(TRIM(resume_plaintext)) > 0
             AND LOWER(SHA2(resume_plaintext, 256)) = ?
           LIMIT 1`,
          [jobCode, resumePlainHash]
        )
        if (Array.isArray(dupByContent) && dupByContent.length) {
          return res.status(409).json({
            message: '该岗位下已存在正文完全相同的简历筛查记录，请勿重复上传。',
            existingId: Number((dupByContent[0] as { id?: unknown }).id)
          })
        }
      } catch (dupErr) {
        console.warn('[resume-screen] duplicate body check skipped:', dupErr)
      }

      let result: ResumeScreeningAiResult
      try {
        const ai = await runResumeScreeningWithAi({
          resumeText: plain,
          jobTitle: String(job.title || ''),
          department: String(job.department || ''),
          jdText: String(job.jd_text || '')
        })
        if (!ai && flowLogEnabled) {
          flowLog('resume-screen', false, '未配置 DASHSCOPE_API_KEY 或大模型返回空，使用关键词回退')
        }
        result = ai || fallbackResumeScreening(plain, String(job.jd_text || ''), String(job.title || ''))
      } catch (aiErr) {
        const msg = aiErr instanceof Error ? aiErr.message : String(aiErr)
        if (flowLogEnabled) flowLog('resume-screen AI 失败', false, msg)
        else console.warn('[resume-screen] 大模型调用失败，使用关键词回退:', msg)
        result = fallbackResumeScreening(plain, String(job.jd_text || ''), String(job.title || ''))
      }

      const candidateName = sanitizeCandidateName(result.candidateName) || guessCandidateNameFromResume(plain)
      const phoneFromResult = normalizeCnMobile(String(result.candidatePhone || ''))
      const phoneFromText = extractPhoneFromResumeText(plain)
      const candidatePhone: string | null = phoneFromResult || phoneFromText || null
      const normForCandidate = normalizeCnMobile(String(candidatePhone || ''))
      let preResolveCandidateId: number | null = null
      if (normForCandidate) {
        try {
          preResolveCandidateId = await ensureResumeCandidateIdForPhone(normForCandidate, candidateName)
        } catch (preCandErr) {
          console.warn('[resume-screen] ensure candidate before insert skipped:', preCandErr)
        }
      }
      if (preResolveCandidateId) {
        try {
          const [dupByCandidate] = await mysqlPool.query<RowDataPacket[]>(
            'SELECT id FROM resume_screenings WHERE job_code = ? AND candidate_id = ? LIMIT 1',
            [jobCode, preResolveCandidateId]
          )
          if (Array.isArray(dupByCandidate) && dupByCandidate.length) {
            return res.status(409).json({
              message: '该手机号对应候选人已在该岗位下存在投递记录，请勿重复上传。',
              existingId: Number((dupByCandidate[0] as { id?: unknown }).id)
            })
          }
        } catch (dupCandErr) {
          console.warn('[resume-screen] duplicate job+candidate check skipped:', dupCandErr)
        }
      }

      const insertRow = async (
        withPhone: boolean,
        withEvaluationJson: boolean,
        withCandidateId: boolean
      ): Promise<ResultSetHeader> => {
        const evalJson = String(result.evaluationJson || '').trim() || null
        const cidForInsert =
          withPhone && withCandidateId && preResolveCandidateId != null
            ? Math.floor(preResolveCandidateId)
            : withPhone && withCandidateId
              ? null
              : undefined
        if (withPhone) {
          if (withCandidateId) {
            const [h] = withEvaluationJson
              ? await mysqlPool.query<ResultSetHeader>(
                  `INSERT INTO resume_screenings (
                     job_code, candidate_name, candidate_phone, candidate_id, matched_job_title, match_score,
                     skill_score, experience_score, education_score, stability_score,
                     status, report_summary, evaluation_json, resume_plaintext, file_name, uploader_username
                   ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                  [
                    jobCode,
                    candidateName,
                    candidatePhone,
                    cidForInsert as number | null,
                    String(job.title || ''),
                    result.matchScore,
                    result.skillScore,
                    result.experienceScore,
                    result.educationScore,
                    result.stabilityScore,
                    result.status,
                    result.summary,
                    evalJson,
                    plainStore,
                    uploadFileName,
                    uploaderUsername
                  ]
                )
              : await mysqlPool.query<ResultSetHeader>(
                  `INSERT INTO resume_screenings (
                     job_code, candidate_name, candidate_phone, candidate_id, matched_job_title, match_score,
                     skill_score, experience_score, education_score, stability_score,
                     status, report_summary, resume_plaintext, file_name, uploader_username
                   ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                  [
                    jobCode,
                    candidateName,
                    candidatePhone,
                    cidForInsert as number | null,
                    String(job.title || ''),
                    result.matchScore,
                    result.skillScore,
                    result.experienceScore,
                    result.educationScore,
                    result.stabilityScore,
                    result.status,
                    result.summary,
                    plainStore,
                    uploadFileName,
                    uploaderUsername
                  ]
                )
            return h
          }
          const [h] = withEvaluationJson
            ? await mysqlPool.query<ResultSetHeader>(
                `INSERT INTO resume_screenings (
                   job_code, candidate_name, candidate_phone, matched_job_title, match_score,
                   skill_score, experience_score, education_score, stability_score,
                   status, report_summary, evaluation_json, resume_plaintext, file_name, uploader_username
                 ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [
                  jobCode,
                  candidateName,
                  candidatePhone,
                  String(job.title || ''),
                  result.matchScore,
                  result.skillScore,
                  result.experienceScore,
                  result.educationScore,
                  result.stabilityScore,
                  result.status,
                  result.summary,
                  evalJson,
                  plainStore,
                  uploadFileName,
                  uploaderUsername
                ]
              )
            : await mysqlPool.query<ResultSetHeader>(
                `INSERT INTO resume_screenings (
                   job_code, candidate_name, candidate_phone, matched_job_title, match_score,
                   skill_score, experience_score, education_score, stability_score,
                   status, report_summary, resume_plaintext, file_name, uploader_username
                 ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [
                  jobCode,
                  candidateName,
                  candidatePhone,
                  String(job.title || ''),
                  result.matchScore,
                  result.skillScore,
                  result.experienceScore,
                  result.educationScore,
                  result.stabilityScore,
                  result.status,
                  result.summary,
                  plainStore,
                  uploadFileName,
                  uploaderUsername
                ]
              )
          return h
        }
        const [h] = withEvaluationJson
          ? await mysqlPool.query<ResultSetHeader>(
              `INSERT INTO resume_screenings (
                 job_code, candidate_name, matched_job_title, match_score,
                 skill_score, experience_score, education_score, stability_score,
                 status, report_summary, evaluation_json, resume_plaintext, file_name, uploader_username
               ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              [
                jobCode,
                candidateName,
                String(job.title || ''),
                result.matchScore,
                result.skillScore,
                result.experienceScore,
                result.educationScore,
                result.stabilityScore,
                result.status,
                result.summary,
                evalJson,
                plainStore,
                uploadFileName,
                uploaderUsername
              ]
            )
          : await mysqlPool.query<ResultSetHeader>(
              `INSERT INTO resume_screenings (
                 job_code, candidate_name, matched_job_title, match_score,
                 skill_score, experience_score, education_score, stability_score,
                 status, report_summary, resume_plaintext, file_name, uploader_username
               ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              [
                jobCode,
                candidateName,
                String(job.title || ''),
                result.matchScore,
                result.skillScore,
                result.experienceScore,
                result.educationScore,
                result.stabilityScore,
                result.status,
                result.summary,
                plainStore,
                uploadFileName,
                uploaderUsername
              ]
            )
        return h
      }
      const insertAttempts: Array<[boolean, boolean, boolean]> = [
        [true, true, true],
        [true, true, false],
        [true, false, true],
        [true, false, false],
        [false, false, false]
      ]
      let ins: ResultSetHeader | null = null
      let insertLastErr: unknown = null
      for (const [wp, we, wc] of insertAttempts) {
        try {
          ins = await insertRow(wp, we, wc)
          insertLastErr = null
          break
        } catch (insErr: unknown) {
          insertLastErr = insErr
          const ie = insErr as { errno?: number; code?: string }
          if (ie.errno === 1054 || ie.code === 'ER_BAD_FIELD_ERROR') continue
          if (ie.errno === 1062 || ie.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
              message: '该手机号对应候选人已在该岗位下存在投递记录，请勿重复上传。'
            })
          }
          throw insErr
        }
      }
      if (!ins) throw insertLastErr
      const screeningId = Number(ins.insertId)
      const screeningCandidateId = await linkResumeScreeningToCandidateByPhone(
        screeningId,
        candidatePhone,
        candidateName
      )
      const fileShaHex = crypto.createHash('sha256').update(req.file.buffer).digest('hex').toLowerCase()
      try {
        let saved: { storageKey: string; originalName: string; mimeType: string; sizeBytes: number }
        const cidForFile = screeningCandidateId ?? preResolveCandidateId
        if (cidForFile) {
          try {
            const [candRows] = await mysqlPool.query<RowDataPacket[]>(
              'SELECT last_file_sha256, last_storage_key FROM resume_candidates WHERE id = ? LIMIT 1',
              [Math.floor(cidForFile)]
            )
            const cr = candRows?.[0] as { last_file_sha256?: unknown; last_storage_key?: unknown } | undefined
            const lastHash = String(cr?.last_file_sha256 || '').toLowerCase()
            const lastKey = String(cr?.last_storage_key || '').trim()
            if (lastHash === fileShaHex && lastKey) {
              saved = {
                storageKey: lastKey,
                originalName: normalizeMultipartFilename(req.file.originalname || 'resume').slice(0, 255) || 'resume',
                mimeType: String(req.file.mimetype || 'application/octet-stream').trim() || 'application/octet-stream',
                sizeBytes: Number(req.file.buffer?.length || 0)
              }
            } else {
              const wr = saveResumeOriginalFile({
                buffer: req.file.buffer,
                originalname: uploadFileName,
                mimetype: req.file.mimetype || ''
              })
              await mysqlPool.query(
                'UPDATE resume_candidates SET last_file_sha256 = ?, last_storage_key = ? WHERE id = ?',
                [fileShaHex, wr.storageKey, Math.floor(cidForFile)]
              )
              saved = {
                storageKey: wr.storageKey,
                originalName: wr.originalName,
                mimeType: wr.mimeType,
                sizeBytes: wr.sizeBytes
              }
            }
          } catch (dedupErr) {
            console.warn('[resume-screen] candidate file dedup skipped:', dedupErr)
            const wr = saveResumeOriginalFile({
              buffer: req.file.buffer,
              originalname: uploadFileName,
              mimetype: req.file.mimetype || ''
            })
            saved = {
              storageKey: wr.storageKey,
              originalName: wr.originalName,
              mimeType: wr.mimeType,
              sizeBytes: wr.sizeBytes
            }
            try {
              await mysqlPool.query(
                'UPDATE resume_candidates SET last_file_sha256 = ?, last_storage_key = ? WHERE id = ?',
                [fileShaHex, wr.storageKey, Math.floor(cidForFile)]
              )
            } catch {
              /* ignore */
            }
          }
        } else {
          const wr = saveResumeOriginalFile({
            buffer: req.file.buffer,
            originalname: uploadFileName,
            mimetype: req.file.mimetype || ''
          })
          saved = {
            storageKey: wr.storageKey,
            originalName: wr.originalName,
            mimeType: wr.mimeType,
            sizeBytes: wr.sizeBytes
          }
        }
        await mysqlPool.query(
          `INSERT INTO resume_screening_files
             (screening_id, original_name, mime_type, file_size_bytes, storage_path)
           VALUES (?,?,?,?,?)
           ON DUPLICATE KEY UPDATE
             original_name=VALUES(original_name),
             mime_type=VALUES(mime_type),
             file_size_bytes=VALUES(file_size_bytes),
             storage_path=VALUES(storage_path),
             updated_at=NOW()`,
          [screeningId, saved.originalName, saved.mimeType, saved.sizeBytes, saved.storageKey]
        )
      } catch (fileErr) {
        console.warn('[resume-screen] save original file skipped:', fileErr)
      }
      try {
        const parsedEval =
          result.evaluationJson && String(result.evaluationJson).trim()
            ? (JSON.parse(String(result.evaluationJson)) as Record<string, unknown>)
            : ({} as Record<string, unknown>)
        const profile = resumeProfileRowFromValues({
          candidateName,
          profile: parsedEval?.candidate_profile
        })
        await mysqlPool.query(
          `INSERT INTO resume_screening_profiles
             (screening_id, candidate_name, gender, age, work_experience_years, job_title, school, candidate_phone,
              email, current_address, current_company, major, education, current_position, graduation_date, arrival_time, id_number,
              is_third_party, expected_salary, recruitment_channel, has_degree, is_unified_enrollment,
              verifiable, resume_uploaded)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE
             candidate_name=VALUES(candidate_name),
             gender=VALUES(gender),
             age=VALUES(age),
             work_experience_years=VALUES(work_experience_years),
             job_title=VALUES(job_title),
             school=VALUES(school),
             candidate_phone=VALUES(candidate_phone),
             email=VALUES(email),
             current_address=VALUES(current_address),
             current_company=VALUES(current_company),
             major=VALUES(major),
             education=VALUES(education),
             current_position=VALUES(current_position),
             graduation_date=VALUES(graduation_date),
             arrival_time=VALUES(arrival_time),
             id_number=VALUES(id_number),
             is_third_party=VALUES(is_third_party),
             expected_salary=VALUES(expected_salary),
             recruitment_channel=VALUES(recruitment_channel),
             has_degree=VALUES(has_degree),
             is_unified_enrollment=VALUES(is_unified_enrollment),
             verifiable=VALUES(verifiable),
             resume_uploaded=VALUES(resume_uploaded),
             updated_at=NOW()`,
          [
            screeningId,
            profile.candidateName,
            profile.gender,
            profile.age,
            profile.workExperienceYears,
            profile.jobTitle,
            profile.school,
            profile.candidatePhone,
            profile.email,
            profile.currentAddress,
            profile.currentCompany,
            profile.major,
            profile.education,
            profile.currentPosition,
            profile.graduationDate,
            profile.arrivalTime,
            profile.idNumber,
            profile.isThirdParty,
            profile.expectedSalary,
            profile.recruitmentChannel,
            profile.hasDegree,
            profile.isUnifiedEnrollment,
            profile.verifiable,
            profile.resumeUploaded
          ]
        )
      } catch (profileErr) {
        console.warn('[resume-screen] save structured profile skipped:', profileErr)
      }
      flowLog('resume-screen', true, `job=${jobCode} score=${result.matchScore}`)
      res.json({
        data: {
          id: screeningId,
          candidateId: screeningCandidateId,
          jobCode,
          candidateName,
          candidatePhone: candidatePhone ?? '',
          matchedJobTitle: String(job.title || ''),
          matchScore: result.matchScore,
          skillScore: result.skillScore,
          experienceScore: result.experienceScore,
          educationScore: result.educationScore,
          stabilityScore: result.stabilityScore,
          status: result.status,
          summary: result.summary
        }
      })
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code
      if (code === 'ER_NO_SUCH_TABLE') {
        return res.status(503).json({ message: 'resume_screenings 表未创建，请执行 server/migration_resume_screenings.sql' })
      }
      flowLog('resume-screen', false, e instanceof Error ? e.message : 'failed')
      res.status(500).json({ message: 'screening failed' })
    }
  }
)

function sanitizeInviteSegment(raw: string, fallback: string, maxLen = 12): string {
  const s = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
  return (s || fallback).slice(0, maxLen)
}

/** 发起人登录账号段：允许邮箱/手机形态中的常见字符 */
function sanitizeInviteAccountSegment(raw: string, fallback: string, maxLen = 28): string {
  const s = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_.@-]/g, '')
  return (s || fallback).slice(0, maxLen)
}

/**
 * 面试邀请码：岗位编号-发起人账号-简历（筛查）记录编号
 * 碰撞时在末尾追加短随机后缀（仍整体 ≤128 字符）
 */
function buildStructuredInviteCode(
  jobCode: string,
  initiatorAccount: string,
  screeningId: number,
  collisionSuffix?: string
): string {
  const jobSeg = sanitizeInviteSegment(jobCode, 'JOB', 28)
  const accSeg = sanitizeInviteAccountSegment(initiatorAccount, 'HR', 28)
  const sid =
    Number.isFinite(screeningId) && screeningId > 0
      ? String(Math.floor(screeningId))
      : `R${crypto.randomBytes(3).toString('hex').toUpperCase()}`
  const extra = collisionSuffix ? `-${collisionSuffix}` : ''
  return `${jobSeg}-${accSeg}-${sid}${extra}`.toUpperCase().slice(0, 128)
}

/** 业务库 jobs/users 的 BIGINT id：勿用 Number()，避免超过 MAX_SAFE_INTEGER 时外键写入失败 */
function mysqlRowIdForParam(v: unknown): string | number | null {
  if (v == null) return null
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim()
  return s.length ? s : null
}

async function markResumeScreeningPipelineInvited(screeningId: number, jobCodeUpper: string) {
  if (!Number.isFinite(screeningId) || screeningId <= 0 || !jobCodeUpper) return
  try {
    await mysqlPool.query(
      `UPDATE resume_screenings SET pipeline_stage = IF(pipeline_stage = 'report_done', pipeline_stage, 'invited')
       WHERE id = ? AND UPPER(TRIM(job_code)) = ?`,
      [Math.floor(screeningId), jobCodeUpper.trim()]
    )
  } catch (e: unknown) {
    const err = e as { errno?: number; code?: string; sqlMessage?: string }
    if (err.errno === 1054 || err.code === 'ER_BAD_FIELD_ERROR') return
    console.warn('[markResumeScreeningPipelineInvited]', e)
  }
}

/** HR：为某岗位生成一条待处理面试邀请（写入 interview_invitations，候选人可在小程序「邀请」列表或登录页输入 INV… 码） */
app.post('/api/admin/invitations', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  const jobCode = String(req.body?.jobCode || '').trim().toUpperCase()
  if (!jobCode) return res.status(400).json({ message: 'jobCode required' })
  const recruiterCode = String(req.body?.recruiterCode || '').trim()
  const rawDays = Number(req.body?.expiresInDays)
  const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(Math.floor(rawDays), 365) : 7
  const screeningIdRaw = Number(req.body?.screeningId)
  const screeningIdForPipeline = Number.isFinite(screeningIdRaw) && screeningIdRaw > 0 ? screeningIdRaw : 0
  try {
    const [jobs] = await mysqlPool.query<any[]>('SELECT id FROM jobs WHERE job_code=? LIMIT 1', [jobCode])
    if (!jobs.length) return res.status(404).json({ message: 'job not found' })
    const jobId = mysqlRowIdForParam(jobs[0].id)
    if (jobId == null) return res.status(500).json({ message: 'job id invalid' })
    /** 业务库 users 无 username，仅有 phone 等；HR 后台登录名（如 admin）不能映射到 interviewer_user_id */
    let interviewerUserId: string | number | null = null
    if (recruiterCode) {
      const phoneKey = normalizePhoneForMatch(recruiterCode).replace(/\D/g, '')
      if (/^1\d{10}$/.test(phoneKey)) {
        const [urs] = await mysqlPool.query<any[]>(
          `SELECT id FROM users
           WHERE phone IS NOT NULL AND TRIM(CAST(phone AS CHAR(32))) IN (?, ?, ?)
           LIMIT 1`,
          [phoneKey, `+86${phoneKey}`, `86${phoneKey}`]
        )
        if (urs.length > 0) interviewerUserId = mysqlRowIdForParam(urs[0].id)
      }
    }
    let lastErr: unknown
    for (let attempt = 0; attempt < 12; attempt++) {
      const collisionSuffix =
        attempt === 0 ? undefined : crypto.randomBytes(2).toString('hex').toUpperCase()
      const inviteCode = buildStructuredInviteCode(
        jobCode,
        recruiterCode || 'HR',
        screeningIdForPipeline,
        collisionSuffix
      )
      const screeningDbVal = screeningIdForPipeline > 0 ? screeningIdForPipeline : null
      const tryInsert = async (interviewer: string | number | null) => {
        await mysqlPool.query(
          `INSERT INTO interview_invitations (invite_code, job_id, interviewer_user_id, resume_screening_id, status, expires_at)
           VALUES (?, ?, ?, ?, 'pending', DATE_ADD(NOW(), INTERVAL ? DAY))`,
          [inviteCode, jobId, interviewer, screeningDbVal, days]
        )
      }
      try {
        await tryInsert(interviewerUserId)
        if (screeningIdForPipeline) await markResumeScreeningPipelineInvited(screeningIdForPipeline, jobCode)
        return res.json({
          data: {
            inviteCode,
            jobCode,
            recruiterCode: recruiterCode || '',
            expiresInDays: days
          }
        })
      } catch (e: unknown) {
        lastErr = e
        const code = (e as { code?: string })?.code
        if (code === 'ER_DUP_ENTRY') continue
        // 管理员用户名在 admin 库存在，但业务库 ai_recruit.users 无对应行时，interviewer_user_id 会触发外键错误
        if (code === 'ER_NO_REFERENCED_ROW_2' && interviewerUserId != null) {
          if (flowLogEnabled) flowLog('admin/invitations', false, 'interviewer_user_id FK 失败，改为不绑定面试官后重试')
          try {
            await tryInsert(null)
            if (screeningIdForPipeline) await markResumeScreeningPipelineInvited(screeningIdForPipeline, jobCode)
            return res.json({
              data: {
                inviteCode,
                jobCode,
                recruiterCode: recruiterCode || '',
                expiresInDays: days
              }
            })
          } catch (e2) {
            lastErr = e2
            const c2 = (e2 as { code?: string })?.code
            if (c2 === 'ER_DUP_ENTRY') continue
            throw e2
          }
        }
        throw e
      }
    }
    console.error('[admin/invitations] allocate failed', lastErr)
    return res.status(500).json({ message: 'could not allocate invite code' })
  } catch (e: unknown) {
    const err = e as { code?: string; errno?: number; sqlMessage?: string; message?: string }
    console.error('[admin/invitations]', err?.code || err?.message, err?.sqlMessage || '')
    if (err?.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({
        message: '数据库缺少 interview_invitations 表，请在业务库执行 server/schema.sql 中相关建表或迁移'
      })
    }
    if (err?.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(400).json({
        message: '外键校验失败：请确认岗位存在于 jobs 表，且业务库 users 与 interviewer 配置一致'
      })
    }
    res.status(500).json({ message: err?.sqlMessage || err?.message || 'db error' })
  }
})

/** 面试官会话列表，供 HR 后台展示「候选人」行 */
app.get('/api/admin/sessions', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  try {
    const [rows] = await mysqlPool.query<any[]>(
      `SELECT s.session_id AS sessionId, s.updated_at AS updatedAt,
              j.job_code AS jobCode, j.title AS jobTitle,
              u.phone AS phone, u.nickname AS nickname
       FROM interview_sessions s
       JOIN jobs j ON j.id = s.job_id
       LEFT JOIN users u ON u.id = s.candidate_user_id
       ORDER BY s.updated_at DESC
       LIMIT 200`
    )
    res.json({ data: rows })
  } catch {
    res.status(500).json({ message: 'db error' })
  }
})

app.get('/api/admin/session-report', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  const sessionId = String(req.query.sessionId || '').trim()
  if (!sessionId) return res.status(400).json({ message: 'sessionId required' })
  try {
    const sid = await getSessionInternalId(sessionId)
    if (!sid) return res.status(404).json({ message: 'session not found' })

    const [sessRows] = await mysqlPool.query<any[]>(
      `SELECT s.session_id AS sessionId, s.updated_at AS updatedAt,
              j.job_code AS jobCode, j.title AS jobTitle,
              u.phone AS phone, u.nickname AS nickname
       FROM interview_sessions s
       JOIN jobs j ON j.id = s.job_id
       LEFT JOIN users u ON u.id = s.candidate_user_id
       WHERE s.session_id=?
       LIMIT 1`,
      [sessionId]
    )
    if (!sessRows.length) return res.status(404).json({ message: 'session not found' })
    const meta = sessRows[0]

    const [msgRows] = await mysqlPool.query<any[]>(
      `SELECT message_type, content, created_at
       FROM interview_messages
       WHERE session_id=?
       ORDER BY created_at ASC`,
      [sid]
    )

    const qa: { q: string; a: string; feedback: string }[] = []
    let qaIdx = 0
    for (const m of msgRows) {
      if (m.message_type === 'qa_answer') {
        try {
          const obj = JSON.parse(String(m.content || '{}'))
          qaIdx += 1
          qa.push({
            q: String(obj.question || `题目 ${qaIdx}`),
            a: String(obj.answer || ''),
            feedback: '（来自线上面试记录）'
          })
        } catch {}
      }
    }

    const answers = qa.map((x) => x.a)
    const score = Math.min(
      100,
      Math.round(60 + answers.reduce((sum, a) => sum + Math.min(a.length, 80), 0) / 12)
    )
    const status: '建议通过' | '待定' | '不匹配' =
      score >= 80 ? '建议通过' : score >= 60 ? '待定' : '不匹配'

    const name = String(meta.nickname || '').trim() || `候选人 ${maskPhoneDisplay(meta.phone)}`

    const data = {
      id: `sess:${meta.sessionId}`,
      jobId: String(meta.jobCode || ''),
      name,
      phone: maskPhoneDisplay(meta.phone),
      time: meta.updatedAt ? new Date(meta.updatedAt).toLocaleString('zh-CN') : '—',
      score,
      status,
      overallFeedback:
        qa.length > 0
          ? `已记录 ${qa.length} 道题作答，综合评分 ${score} 分（与小程序线上面试同源）。`
          : '暂无答题记录，请候选人端完成面试或等待数据同步。',
      qa: qa.length ? qa : [{ q: '（无题目记录）', a: '—', feedback: '—' }],
      sessionId: meta.sessionId,
      source: 'api' as const
    }

    res.json({ data })
  } catch {
    res.status(500).json({ message: 'db error' })
  }
})

// 候选人邀请：返回 pending 且未过期的邀请（定向或全量）
app.get('/api/candidate/invitations', async (req, res) => {
  const openid = String(req.query.openid || '').trim()
  if (!openid) return res.status(400).json({ message: 'openid required' })
  const appid = process.env.WECHAT_APPID || ''
  if (!appid) return res.status(500).json({ message: 'WECHAT_APPID not configured' })

  const me = await getUserProfileByOpenId({ appid, openid })
  if (!me.userId) return res.status(400).json({ message: 'user not found' })

  const [rows] = await mysqlPool.query<any[]>(
    `SELECT inv.invite_code AS inviteId, j.job_code AS jobId, j.title AS title, j.department AS department
     FROM interview_invitations inv
     JOIN jobs j ON j.id = inv.job_id
     WHERE inv.status='pending'
       AND (inv.expires_at IS NULL OR inv.expires_at > NOW())
       AND (
            (inv.candidate_user_id IS NULL OR inv.candidate_user_id = ?)
         AND (NULLIF(TRIM(inv.candidate_openid), '') IS NULL OR inv.candidate_openid = ?)
       )
     ORDER BY inv.created_at DESC
     LIMIT 20`,
    [me.userId, openid]
  )
  res.json({ data: rows })
})

app.post('/api/candidate/invitations/accept', async (req, res) => {
  const openid = String(req.body?.openid || '').trim()
  const inviteId = String(req.body?.inviteId || '').trim()
  if (!openid || !inviteId) return res.status(400).json({ message: 'invalid params' })
  const appid = process.env.WECHAT_APPID || ''
  if (!appid) return res.status(500).json({ message: 'WECHAT_APPID not configured' })

  const me = await getUserProfileByOpenId({ appid, openid })
  if (!me.userId) return res.status(400).json({ message: 'user not found' })

  const conn = await mysqlPool.getConnection()
  try {
    await conn.beginTransaction()
    const [invRows] = await conn.query<any[]>(
      `SELECT inv.id AS id,
              inv.resume_screening_id AS resumeScreeningId,
              inv.interviewer_user_id AS interviewerUserId,
              inv.interviewer_openid AS interviewerOpenId,
              j.id AS jobDbId,
              j.job_code AS jobCode,
              j.title AS title,
              j.department AS department,
              TRIM(rs.candidate_name) AS screeningCandidateName
       FROM interview_invitations inv
       JOIN jobs j ON j.id = inv.job_id
       LEFT JOIN resume_screenings rs ON rs.id = inv.resume_screening_id
       WHERE inv.invite_code = ?
         AND inv.status='pending'
         AND (inv.expires_at IS NULL OR inv.expires_at > NOW())
         AND (
              (inv.candidate_user_id IS NULL OR inv.candidate_user_id = ?)
           AND (NULLIF(TRIM(inv.candidate_openid), '') IS NULL OR inv.candidate_openid = ?)
         )
       LIMIT 1
       FOR UPDATE`,
      [inviteId, me.userId, openid]
    )
    if (!invRows.length) {
      await conn.rollback()
      return res.status(404).json({ message: 'invite not found' })
    }

    const inv = invRows[0]
    const [updHeader] = await conn.query<ResultSetHeader>(
      `UPDATE interview_invitations
       SET candidate_user_id=COALESCE(candidate_user_id, ?),
           candidate_openid=COALESCE(NULLIF(candidate_openid, ''), ?),
           updated_at=NOW()
       WHERE id=? AND status='pending'`,
      [me.userId, openid, inv.id]
    )
    if (updHeader.affectedRows !== 1) {
      await conn.rollback()
      return res.status(409).json({ message: 'invite already processed' })
    }

    const sessionId = `${inv.jobCode}-${openid}`
    const [sessRows] = await conn.query<any[]>(
      'SELECT id FROM interview_sessions WHERE session_id=? LIMIT 1',
      [sessionId]
    )
    if (!sessRows.length) {
      await conn.query(
        `INSERT INTO interview_sessions(session_id, invitation_id, job_id, candidate_user_id, interviewer_user_id, candidate_openid, interviewer_openid, status, voip_status)
         VALUES (?,?,?,?,?,?,?, 'created','not_started')`,
        [
          sessionId,
          inv.id,
          inv.jobDbId,
          me.userId,
          inv.interviewerUserId || null,
          openid,
          String(inv.interviewerOpenId || '')
        ]
      )
    }

    await conn.commit()
    const rsid = inv.resumeScreeningId
    const resumeScreeningId =
      rsid != null && Number(rsid) > 0 ? Math.floor(Number(rsid)) : undefined
    const screeningName = String(inv.screeningCandidateName || '').trim()
    res.json({
      data: {
        sessionId,
        job: { id: inv.jobCode, title: inv.title, department: inv.department },
        ...(resumeScreeningId != null ? { resumeScreeningId } : {}),
        ...(screeningName ? { candidateName: screeningName } : {})
      }
    })
  } catch {
    await conn.rollback()
    res.status(500).json({ message: 'db error' })
  } finally {
    conn.release()
  }
})

app.post('/api/candidate/validate-invite', async (req, res) => {
  const inviteCode = String(req.body?.inviteCode || '').trim()
  try {
    const resolved = await resolveInviteCode(inviteCode)
    if (!resolved) return res.status(400).json({ message: '邀请码无效' })
    res.json({
      data: { id: resolved.jobCode, title: resolved.title, department: resolved.department }
    })
  } catch {
    res.status(500).json({ message: 'db error' })
  }
})

/** 候选人：wx.login 的 code + 邀请码 + 姓名，一次换 openid、校验岗位，并返回 TRTC UserSig（若已配置） */
app.post('/api/candidate/login-invite', async (req, res) => {
  const code = String(req.body?.code || '').trim()
  const inviteCodeRaw = String(req.body?.inviteCode || '').trim()
  const name = String(req.body?.name || '').trim()
  const phone = String(req.body?.phone || '').trim()
  if (!code || !inviteCodeRaw || !name) {
    return res.status(400).json({ message: 'code, inviteCode, name required' })
  }
  try {
    flowLog('login-invite 开始', true, `invite=${inviteCodeRaw} name=${name}`)
    const { openid, sessionKey, appid } = await exchangeWechatJsCode(code)
    flowLog('login-invite code2Session', true, maskOpenidLite(openid))
    await ensureUserAndWechatAccount({ appid, openid, sessionKey })
    if (phone) {
      try {
        await bindUserPhoneAndRole({ appid, openid, phone })
      } catch {
        /* 手机号格式或未过白名单时不阻断登录 */
      }
    }
    const me = await getUserProfileByOpenId({ appid, openid })
    if (!me.userId) return res.status(400).json({ message: 'user not found' })

    const resolved = await resolveInviteCode(inviteCodeRaw)
    if (!resolved) return res.status(400).json({ message: '邀请码无效' })

    let sessionId = `${resolved.jobCode}-${openid}`
    const job = { id: resolved.jobCode, title: resolved.title, department: resolved.department }
    let resumeScreeningId: number | null = null

    if (resolved.invitationId) {
      const inviteIdUpper = inviteCodeRaw.trim().toUpperCase()
      const conn = await mysqlPool.getConnection()
      try {
        await conn.beginTransaction()
        const [invRows] = await conn.query<any[]>(
          `SELECT inv.id AS id,
                  inv.resume_screening_id AS resumeScreeningId,
                  inv.interviewer_user_id AS interviewerUserId,
                  inv.interviewer_openid AS interviewerOpenId,
                  j.id AS jobDbId,
                  j.job_code AS jobCode,
                  j.title AS title,
                  j.department AS department
           FROM interview_invitations inv
           JOIN jobs j ON j.id = inv.job_id
           WHERE inv.invite_code = ?
             AND inv.id = ?
             AND inv.status='pending'
             AND (inv.expires_at IS NULL OR inv.expires_at > NOW())
             AND (
                  (inv.candidate_user_id IS NULL OR inv.candidate_user_id = ?)
               AND (NULLIF(TRIM(inv.candidate_openid), '') IS NULL OR inv.candidate_openid = ?)
             )
           LIMIT 1
           FOR UPDATE`,
          [inviteIdUpper, resolved.invitationId, me.userId, openid]
        )
        if (!invRows.length) {
          await conn.rollback()
          return res.status(400).json({ message: '邀请码无效或已使用' })
        }

        const inv = invRows[0]
        const rsidRow = inv.resumeScreeningId
        resumeScreeningId =
          rsidRow != null && Number(rsidRow) > 0 ? Math.floor(Number(rsidRow)) : null
        const [updHeader] = await conn.query<ResultSetHeader>(
          `UPDATE interview_invitations
           SET candidate_user_id=COALESCE(candidate_user_id, ?),
               candidate_openid=COALESCE(NULLIF(candidate_openid, ''), ?),
               updated_at=NOW()
           WHERE id=? AND status='pending'`,
          [me.userId, openid, inv.id]
        )
        if (updHeader.affectedRows !== 1) {
          await conn.rollback()
          return res.status(409).json({ message: 'invite already processed' })
        }

        sessionId = `${inv.jobCode}-${openid}`
        const [sessRows] = await conn.query<any[]>(
          'SELECT id FROM interview_sessions WHERE session_id=? LIMIT 1',
          [sessionId]
        )
        if (!sessRows.length) {
          await conn.query(
            `INSERT INTO interview_sessions(session_id, invitation_id, job_id, candidate_user_id, interviewer_user_id, candidate_openid, interviewer_openid, status, voip_status)
             VALUES (?,?,?,?,?,?,?, 'created','not_started')`,
            [
              sessionId,
              inv.id,
              inv.jobDbId,
              me.userId,
              inv.interviewerUserId || null,
              openid,
              String(inv.interviewerOpenId || '')
            ]
          )
        }

        await conn.commit()
      } catch (e) {
        await conn.rollback()
        throw e
      } finally {
        conn.release()
      }
    }

    let trtc: { sdkAppId: number; userId: string; userSig: string; roomId: number } | null = null
    const sdkAppId = Number(process.env.TRTC_SDK_APP_ID || 0)
    const secretKey = process.env.TRTC_SDK_SECRET_KEY?.trim()
    if (sdkAppId && secretKey) {
      const userId = sanitizeTrtcUserId(openid)
      const roomId = trtcRoomIdFromSession(sessionId)
      const expireSec = Number(process.env.TRTC_USER_SIG_EXPIRE_SEC || 86400)
      const userSig = genTrtcUserSig(sdkAppId, secretKey, userId, expireSec)
      trtc = { sdkAppId, userId, userSig, roomId }
    }
    flowLog('login-invite TRTC', Boolean(trtc), trtc ? `room=${trtc.roomId}` : '未配置或密钥为空')
    flowLog('login-invite 完成', true, `sessionId=${sessionId} resumeScreeningId=${resumeScreeningId ?? '—'}`)
    res.json({ data: { openid, sessionId, name, job, trtc, resumeScreeningId } })
  } catch (e) {
    const err = e as Error & { wechat?: unknown }
    flowLog('login-invite 异常', false, err.message)
    if (err.message === 'WECHAT_ENV') {
      return res.status(500).json({ message: 'WECHAT_APPID / WECHAT_SECRET not configured' })
    }
    if (err.message === 'code2Session failed') {
      return res.status(502).json({ message: err.message, wechat: err.wechat })
    }
    res.status(500).json({ message: 'login-invite failed' })
  }
})

async function loadInterviewQuestionContext(params: {
  jobId: string
  candidateName: string
  resumeScreeningIdRaw: string
}): Promise<{
  title: string
  department: string
  jdText: string
  resumeText: string
  effectiveCandidateName: string
  resumeBoundByScreeningId: boolean
}> {
  const jobId = params.jobId
  const candidateName = params.candidateName
  const resumeScreeningIdRaw = params.resumeScreeningIdRaw
  const [rows] = await mysqlPool.query<any[]>(
    'SELECT title, department, jd_text FROM jobs WHERE job_code=? LIMIT 1',
    [jobId]
  )
  const row = rows.length ? rows[0] : null
  const fallbackJob = JOBS[jobId as keyof typeof JOBS]
  if (!row && !fallbackJob) {
    const err = new Error('job not found') as Error & { httpStatus?: number }
    err.httpStatus = 404
    throw err
  }
  const title = String(row?.title || fallbackJob?.title || jobId)
  const department = String(row?.department || fallbackJob?.department || '')
  const jdText = String(row?.jd_text || '')

  let resumeText = ''
  let effectiveCandidateName = candidateName || '候选人'
  let resumeBoundByScreeningId = false
  if (resumeScreeningIdRaw && /^\d+$/.test(resumeScreeningIdRaw)) {
    const bound = await fetchResumeTextByScreeningId(jobId, Number(resumeScreeningIdRaw))
    if (bound) {
      resumeText = bound.text
      if (bound.candidateName) effectiveCandidateName = bound.candidateName
      resumeBoundByScreeningId = true
    }
  }
  if (!resumeText && candidateName) {
    resumeText = await fetchResumeTextForCandidate(jobId, candidateName)
  }
  return {
    title,
    department,
    jdText,
    resumeText,
    effectiveCandidateName: effectiveCandidateName || '候选人',
    resumeBoundByScreeningId
  }
}

app.get('/api/candidate/interview-questions', async (req, res) => {
  const jobId = String(req.query.jobId || '').trim().toUpperCase()
  const candidateName = String(req.query.candidateName || req.query.name || '').trim()
  const resumeScreeningIdRaw = String(req.query.resumeScreeningId || req.query.screeningId || '').trim()
  const phase = String(req.query.phase || '').trim().toLowerCase()
  if (!jobId) return res.status(400).json({ message: 'jobId required' })
  try {
    flowLog(
      'interview-questions 开始',
      true,
      `jobId=${jobId} candidate=${candidateName ? candidateName.slice(0, 8) : '(none)'} screening=${resumeScreeningIdRaw || '—'} phase=${phase || 'full'}`
    )
    const ctx = await loadInterviewQuestionContext({
      jobId,
      candidateName,
      resumeScreeningIdRaw
    })
    const genParams = {
      title: ctx.title,
      department: ctx.department,
      jdText: ctx.jdText,
      resumeText: ctx.resumeText,
      candidateName: ctx.effectiveCandidateName || '候选人'
    }

    if (phase === 'first') {
      const first = await generatePersonalizedInterviewFirst(genParams)
      flowLog(
        'interview-questions 首包',
        true,
        `count=${first.length} resume=${ctx.resumeText ? 'yes' : 'no'} resumeBind=${ctx.resumeBoundByScreeningId}`
      )
      return res.json({
        data: {
          questions: first,
          partial: true,
          expectedTotal: PERSONALIZED_INTERVIEW_TOTAL
        }
      })
    }

    const aiQuestions = await generatePersonalizedInterviewSix(genParams)
    flowLog(
      'interview-questions 成功',
      true,
      `count=${aiQuestions.length} resume=${ctx.resumeText ? 'yes' : 'no'} resumeBind=${ctx.resumeBoundByScreeningId}`
    )
    res.json({ data: aiQuestions })
  } catch (e) {
    const http = (e as InterviewQuestionsHttpError).httpStatus ?? (e as Error & { httpStatus?: number })?.httpStatus
    const msg = e instanceof Error ? e.message : 'generate questions failed'
    flowLog('interview-questions 失败', false, msg)
    if (typeof http === 'number' && http >= 400 && http < 600) {
      return res.status(http).json({ message: msg })
    }
    res.status(500).json({ message: 'generate questions failed' })
  }
})

/** 首题已展示后拉取 Q2～Q6（POST 避免首题题干过长超出 GET URL 限制） */
app.post('/api/candidate/interview-questions-rest', async (req, res) => {
  const jobId = String(req.body?.jobId || '').trim().toUpperCase()
  const candidateName = String(req.body?.candidateName || req.body?.name || '').trim()
  const resumeScreeningIdRaw = String(req.body?.resumeScreeningId || req.body?.screeningId || '').trim()
  const firstQuestionText = String(req.body?.firstQuestionText || '').trim()
  if (!jobId) return res.status(400).json({ message: 'jobId required' })
  if (!firstQuestionText) return res.status(400).json({ message: 'firstQuestionText required' })
  try {
    flowLog(
      'interview-questions-rest 开始',
      true,
      `jobId=${jobId} candidate=${candidateName ? candidateName.slice(0, 8) : '(none)'} screening=${resumeScreeningIdRaw || '—'}`
    )
    const ctx = await loadInterviewQuestionContext({
      jobId,
      candidateName,
      resumeScreeningIdRaw
    })
    const rest = await generatePersonalizedInterviewRest({
      title: ctx.title,
      department: ctx.department,
      jdText: ctx.jdText,
      resumeText: ctx.resumeText,
      candidateName: ctx.effectiveCandidateName || '候选人',
      firstQuestionText
    })
    flowLog(
      'interview-questions-rest 成功',
      true,
      `count=${rest.length} resume=${ctx.resumeText ? 'yes' : 'no'} resumeBind=${ctx.resumeBoundByScreeningId}`
    )
    res.json({
      data: {
        questions: rest,
        partial: false,
        expectedTotal: PERSONALIZED_INTERVIEW_TOTAL
      }
    })
  } catch (e) {
    const http = (e as InterviewQuestionsHttpError).httpStatus ?? (e as Error & { httpStatus?: number })?.httpStatus
    const msg = e instanceof Error ? e.message : 'generate questions failed'
    flowLog('interview-questions-rest 失败', false, msg)
    if (typeof http === 'number' && http >= 400 && http < 600) {
      return res.status(http).json({ message: msg })
    }
    res.status(500).json({ message: 'generate questions failed' })
  }
})

/** 小程序分段上传音频，服务端用百炼 Qwen-ASR（Data URL）转写 */
app.post(
  '/api/candidate/ai-interview/asr',
  uploadAudioMemory.single('file'),
  async (req, res) => {
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ message: 'file required' })
    }
    const sessionId = String(req.body?.sessionId || '').trim()
    const questionId = String(req.body?.questionId || '').trim()
    const segmentIndex = Number.isFinite(Number(req.body?.segmentIndex)) ? Number(req.body.segmentIndex) : 0
    if (!sessionId) {
      return res.status(400).json({ message: 'sessionId required' })
    }
    if (!process.env.DASHSCOPE_API_KEY?.trim()) {
      return res.status(503).json({ message: 'DASHSCOPE_API_KEY not configured' })
    }
    const mime =
      req.file.mimetype && req.file.mimetype !== 'application/octet-stream'
        ? req.file.mimetype
        : guessAudioMimeFromName(req.file.originalname)
    const dataUri = `data:${mime};base64,${req.file.buffer.toString('base64')}`
    const model = process.env.QWEN_ASR_MODEL || 'qwen3-asr-flash'
    try {
      const data = await dashScopeChatCompletions({
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: { data: dataUri }
              }
            ]
          }
        ],
        stream: false,
        extra_body: {
          asr_options: {
            enable_itn: true
          }
        }
      })
      const raw = data?.choices?.[0]?.message?.content
      const text = typeof raw === 'string' ? raw.trim() : ''
      res.json({ data: { sessionId, questionId, segmentIndex, text } })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'asr failed'
      res.status(502).json({ message: msg })
    }
  }
)

/** 腾讯云 TRTC：签发 UserSig，房间号由 sessionId 稳定派生（小程序 live-pusher 进房） */
app.post('/api/candidate/trtc/credential', (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim()
  const userIdRaw = String(req.body?.userId || '').trim()
  if (!sessionId || !userIdRaw) {
    flowLog('trtc/credential 参数', false, '缺 sessionId 或 userId')
    return res.status(400).json({ message: 'sessionId and userId required' })
  }
  const sdkAppId = Number(process.env.TRTC_SDK_APP_ID || 0)
  const secretKey = process.env.TRTC_SDK_SECRET_KEY?.trim()
  if (!sdkAppId || !secretKey) {
    flowLog('trtc/credential', false, 'TRTC 未配置')
    return res.status(503).json({ message: 'TRTC not configured' })
  }
  try {
    const userId = sanitizeTrtcUserId(userIdRaw)
    const roomId = trtcRoomIdFromSession(sessionId)
    const expireSec = Number(process.env.TRTC_USER_SIG_EXPIRE_SEC || 86400)
    const userSig = genTrtcUserSig(sdkAppId, secretKey, userId, expireSec)
    flowLog('trtc/credential 签发', true, `session=${sessionId} room=${roomId}`)
    res.json({ data: { sdkAppId, userId, userSig, roomId } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'userSig failed'
    flowLog('trtc/credential 异常', false, msg)
    res.status(500).json({ message: msg })
  }
})

app.post('/api/live/session/start', async (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim()
  const jobId = String(req.body?.jobId || '').trim()
  const candidateOpenId = String(req.body?.candidateOpenId || '').trim()
  const questions = Array.isArray(req.body?.questions) ? req.body.questions : []
  if (!sessionId) return res.status(400).json({ message: 'sessionId required' })

  const wechatEnv = checkWechatEnv()
  if (!wechatEnv.ok) {
    return res.status(500).json({ message: 'WECHAT_APPID / WECHAT_SECRET not configured' })
  }

  try {
    await upsertSessionBase({ sessionId, jobId, appid: wechatEnv.appId, candidateOpenId })
    const sid = await getSessionInternalId(sessionId)
    if (!sid) return res.status(500).json({ message: 'session create failed' })

    if (questions.length) {
      const [exists] = await mysqlPool.query<any[]>(
        'SELECT id FROM interview_questions WHERE session_id=? LIMIT 1',
        [sid]
      )
      if (!exists.length) {
        for (let i = 0; i < questions.length; i++) {
          const q = questions[i]
          await mysqlPool.query(
            'INSERT INTO interview_questions(session_id, question_no, question_text, source) VALUES (?,?,?,?)',
            [sid, i + 1, String(q?.text || ''), 'manual']
          )
        }
      }
    }

    flowLog('live/session/start 完成', true, sessionId)
    res.json({ ok: true })
  } catch (e) {
    flowLog('live/session/start 异常', false, e instanceof Error ? e.message : 'db error')
    res.status(500).json({ message: 'db error' })
  }
})

/** 首题已入库后追加 Q2～Q6（流式出题第二阶段） */
app.post('/api/live/session/append-questions', async (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim()
  const questions = Array.isArray(req.body?.questions) ? req.body.questions : []
  if (!sessionId) return res.status(400).json({ message: 'sessionId required' })
  if (!questions.length) return res.json({ ok: true, inserted: 0 })

  try {
    const sid = await getSessionInternalId(sessionId)
    if (!sid) return res.status(404).json({ message: 'session not found' })

    const [maxRows] = await mysqlPool.query<any[]>(
      'SELECT COALESCE(MAX(question_no), 0) AS m FROM interview_questions WHERE session_id=?',
      [sid]
    )
    let no = Number(maxRows[0]?.m || 0) + 1
    let inserted = 0
    for (const q of questions) {
      const text = String((q as { text?: string })?.text || '').trim()
      if (!text) continue
      await mysqlPool.query(
        'INSERT INTO interview_questions(session_id, question_no, question_text, source) VALUES (?,?,?,?)',
        [sid, no, text, 'ai']
      )
      no += 1
      inserted += 1
    }
    flowLog('live/session/append-questions', true, `${sessionId} inserted=${inserted}`)
    res.json({ ok: true, inserted })
  } catch (e) {
    flowLog('live/session/append-questions 异常', false, e instanceof Error ? e.message : 'db error')
    res.status(500).json({ message: 'db error' })
  }
})

/** 面试官：有待接入候选人的实时会话（候选人已进入且已绑定 openid） */
app.get('/api/interviewer/live-sessions', async (req, res) => {
  try {
    const [rows] = await mysqlPool.query<any[]>(
      `SELECT s.session_id AS sessionId,
              s.candidate_openid AS candidateOpenId,
              s.interviewer_openid AS interviewerOpenId,
              s.voip_status AS voipStatus,
              s.status AS status,
              s.updated_at AS updatedAt,
              j.job_code AS jobId,
              j.title AS jobTitle,
              j.department AS department
       FROM interview_sessions s
       JOIN jobs j ON j.id = s.job_id
       WHERE NULLIF(TRIM(s.candidate_openid), '') IS NOT NULL
       ORDER BY s.updated_at DESC
       LIMIT 40`
    )
    res.json({ data: rows })
  } catch {
    res.status(500).json({ message: 'db error' })
  }
})

/** 面试官：查看自己发起的邀请列表，可进入对应会话 */
app.get('/api/interviewer/invitations', async (req, res) => {
  const openid = String(req.query.openid || '').trim()
  if (!openid) return res.status(400).json({ message: 'openid required' })
  const appid = process.env.WECHAT_APPID || ''
  if (!appid) return res.status(500).json({ message: 'WECHAT_APPID not configured' })
  try {
    const me = await getUserProfileByOpenId({ appid, openid })
    if (!me.userId) return res.status(404).json({ message: 'user not found' })

    const [rows] = await mysqlPool.query<any[]>(
      `SELECT inv.invite_code AS inviteCode,
              inv.status AS inviteStatus,
              inv.expires_at AS expiresAt,
              inv.interviewer_openid AS interviewerOpenId,
              inv.candidate_openid AS candidateOpenId,
              j.job_code AS jobId,
              j.title AS jobTitle,
              j.department AS department,
              cu.phone AS candidatePhone,
              cu.nickname AS candidateName,
              s.session_id AS sessionId
       FROM interview_invitations inv
       JOIN jobs j ON j.id = inv.job_id
       LEFT JOIN users cu ON cu.id = inv.candidate_user_id
       LEFT JOIN interview_sessions s ON s.invitation_id = inv.id
       WHERE (inv.interviewer_user_id = ? OR inv.interviewer_openid = ?)
       ORDER BY inv.created_at DESC
       LIMIT 50`,
      [me.userId, openid]
    )
    res.json({ data: rows })
  } catch {
    res.status(500).json({ message: 'db error' })
  }
})

app.post('/api/live/session/bind-members', async (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim()
  const role = String(req.body?.role || '').trim()
  const openid = String(req.body?.openid || '').trim()
  if (!sessionId || !role || !openid) return res.status(400).json({ message: 'invalid params' })
  const appid = process.env.WECHAT_APPID || ''
  if (!appid) return res.status(500).json({ message: 'WECHAT_APPID not configured' })
  try {
    const internalId = await getSessionInternalId(sessionId)
    if (!internalId) return res.status(404).json({ message: 'session not found' })

    if (role === 'candidate') {
      await mysqlPool.query('UPDATE interview_sessions SET candidate_openid=?, updated_at=NOW() WHERE session_id=?', [openid, sessionId])
    }
    if (role === 'interviewer') {
      // set interviewer_user_id if we can resolve
      const [uRows] = await mysqlPool.query<any[]>(
        'SELECT user_id FROM wechat_accounts WHERE appid=? AND openid=? LIMIT 1',
        [appid, openid]
      )
      const interviewerUserId = uRows.length ? uRows[0].user_id : null
      await mysqlPool.query(
        'UPDATE interview_sessions SET interviewer_openid=?, interviewer_user_id=?, updated_at=NOW() WHERE session_id=?',
        [openid, interviewerUserId, sessionId]
      )
    }

    const [sess] = await mysqlPool.query<any[]>(
      'SELECT candidate_openid, interviewer_openid FROM interview_sessions WHERE session_id=? LIMIT 1',
      [sessionId]
    )
    const s = sess[0]
    res.json({
      data: {
        sessionId,
        candidateOpenId: s?.candidate_openid || '',
        interviewerOpenId: s?.interviewer_openid || ''
      }
    })
  } catch (e) {
    res.status(500).json({ message: 'db error' })
  }
})

/** 候选人发起视频请求：写入会话状态，供面试官侧显示「接听」；并从关联邀请回填面试官 openid（VoIP 接听方必须与 listener openid 一致） */
app.post('/api/live/session/request-video', async (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim()
  if (!sessionId) return res.status(400).json({ message: 'sessionId required' })
  try {
    const sid = await getSessionInternalId(sessionId)
    if (!sid) return res.status(404).json({ message: 'session not found' })
    await mysqlPool.query(
      `UPDATE interview_sessions s
       LEFT JOIN interview_invitations inv ON inv.id = s.invitation_id
       SET s.voip_status = 'waiting_interviewer_accept',
           s.interviewer_openid = COALESCE(NULLIF(TRIM(s.interviewer_openid), ''), NULLIF(TRIM(inv.interviewer_openid), '')),
           s.updated_at = NOW()
       WHERE s.session_id = ?`,
      [sessionId]
    )
    await mysqlPool.query(
      "INSERT INTO interview_messages(session_id, message_type, question_id, sender_role, content) VALUES (?, 'system', NULL, 'system', ?)",
      [sid, 'candidate_requested_video']
    )
    res.json({ ok: true })
  } catch {
    res.status(500).json({ message: 'db error' })
  }
})

/** 面试官点击接听：将会话视频状态置为已接听 */
app.post('/api/live/session/accept-video', async (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim()
  if (!sessionId) return res.status(400).json({ message: 'sessionId required' })
  try {
    const sid = await getSessionInternalId(sessionId)
    if (!sid) return res.status(404).json({ message: 'session not found' })
    await mysqlPool.query(
      "UPDATE interview_sessions SET voip_status='connected', updated_at=NOW() WHERE session_id=?",
      [sessionId]
    )
    await mysqlPool.query(
      "INSERT INTO interview_messages(session_id, message_type, question_id, sender_role, content) VALUES (?, 'system', NULL, 'system', ?)",
      [sid, 'interviewer_accepted_video']
    )
    res.json({ ok: true })
  } catch {
    res.status(500).json({ message: 'db error' })
  }
})

app.post('/api/live/session/transcript', async (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim()
  const text = String(req.body?.text || '').trim()
  if (!sessionId || !text) return res.status(400).json({ message: 'invalid params' })
  try {
    const sid = await getSessionInternalId(sessionId)
    if (!sid) return res.status(404).json({ message: 'session not found' })
    await mysqlPool.query(
      "INSERT INTO interview_messages(session_id, message_type, question_id, sender_role, content) VALUES (?, 'transcript', NULL, 'candidate', ?)",
      [sid, text]
    )
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ message: 'db error' })
  }
})

/** TRTC 旁路信令：前端将字幕/自定义 payload 上报，服务端落库供监考端轮询（非 TRTC 云端回调） */
app.post('/api/live/session/trtc-signal', async (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim()
  const text = String(req.body?.text || '').trim()
  const kind = String(req.body?.kind || 'subtitle').trim() || 'subtitle'
  if (!sessionId || !text) return res.status(400).json({ message: 'invalid params' })
  try {
    const sid = await getSessionInternalId(sessionId)
    if (!sid) return res.status(404).json({ message: 'session not found' })
    const payload = JSON.stringify({
      channel: 'trtc_signal',
      kind,
      text: text.slice(0, 8000),
      ts: Date.now()
    })
    await mysqlPool.query(
      "INSERT INTO interview_messages(session_id, message_type, question_id, sender_role, content) VALUES (?, 'system', NULL, 'candidate', ?)",
      [sid, payload]
    )
    res.json({ ok: true })
  } catch {
    res.status(500).json({ message: 'db error' })
  }
})

app.post('/api/live/session/qa', async (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim()
  const questionId = String(req.body?.questionId || '').trim()
  const question = String(req.body?.question || '').trim()
  const answer = String(req.body?.answer || '').trim()
  if (!sessionId || !questionId) return res.status(400).json({ message: 'invalid params' })
  try {
    const sid = await getSessionInternalId(sessionId)
    if (!sid) return res.status(404).json({ message: 'session not found' })
    const payload = JSON.stringify({ questionId, question, answer })
    await mysqlPool.query(
      "INSERT INTO interview_messages(session_id, message_type, question_id, sender_role, content) VALUES (?, 'qa_answer', NULL, 'candidate', ?)",
      [sid, payload]
    )
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ message: 'db error' })
  }
})

app.get('/api/live/session/state', async (req, res) => {
  const sessionId = String(req.query.sessionId || '').trim()
  if (!sessionId) return res.status(400).json({ message: 'sessionId required' })
  try {
    const [sessRows] = await mysqlPool.query<any[]>(
      `SELECT s.session_id, s.candidate_openid, s.interviewer_openid, s.voip_status,
              j.job_code, j.title AS job_title, j.department AS job_department
       FROM interview_sessions s
       JOIN jobs j ON j.id = s.job_id
       WHERE s.session_id=?
       LIMIT 1`,
      [sessionId]
    )
    if (!sessRows.length) return res.status(404).json({ message: 'session not found' })
    const sess = sessRows[0]
    const sid = await getSessionInternalId(sessionId)
    if (!sid) return res.status(404).json({ message: 'session not found' })

    const [qRows] = await mysqlPool.query<any[]>(
      'SELECT question_no, question_text FROM interview_questions WHERE session_id=? ORDER BY question_no ASC',
      [sid]
    )
    const questions: { id: string; text: string }[] = qRows.map((r) => ({
      id: `Q${Number(r.question_no) || 1}`,
      text: String(r.question_text || '')
    }))

    const [msgRows] = await mysqlPool.query<any[]>(
      `SELECT message_type, content, created_at
       FROM interview_messages
       WHERE session_id=?
       ORDER BY created_at DESC
       LIMIT 200`,
      [sid]
    )

    const transcript: TranscriptItem[] = []
    const trtcSignals: { ts: number; text: string; kind?: string }[] = []
    const qaLatest = new Map<string, QaItem>()
    for (let i = msgRows.length - 1; i >= 0; i--) {
      const m = msgRows[i]
      if (m.message_type === 'transcript') {
        transcript.push({ ts: new Date(m.created_at).getTime(), text: String(m.content || '') })
      }
      if (m.message_type === 'system') {
        try {
          const o = JSON.parse(String(m.content || '{}')) as { channel?: string; text?: string; kind?: string }
          if (o.channel === 'trtc_signal' && o.text) {
            trtcSignals.push({
              ts: new Date(m.created_at).getTime(),
              text: String(o.text),
              kind: o.kind ? String(o.kind) : undefined
            })
          }
        } catch {
          /* ignore */
        }
      }
      if (m.message_type === 'qa_answer') {
        try {
          const obj = JSON.parse(String(m.content || '{}'))
          if (obj?.questionId) {
            qaLatest.set(String(obj.questionId), {
              questionId: String(obj.questionId),
              question: String(obj.question || ''),
              answer: String(obj.answer || '')
            })
          }
        } catch {}
      }
    }

    const data: SessionState = {
      sessionId: sess.session_id,
      jobId: String(sess.job_code || ''),
      jobTitle: String(sess.job_title || ''),
      department: String(sess.job_department || ''),
      candidateName: '',
      candidateOpenId: String(sess.candidate_openid || ''),
      interviewerOpenId: String(sess.interviewer_openid || ''),
      voipStatus: String(sess.voip_status || 'not_started'),
      questions,
      transcript,
      qa: Array.from(qaLatest.values()),
      trtcSignals,
      updatedAt: Date.now()
    }
    res.json({ data })
  } catch (e) {
    res.status(500).json({ message: 'db error' })
  }
})

app.post('/api/candidate/submit-interview', async (req, res) => {
  const profile = (req.body?.profile || {}) as { name?: string; phone?: string; openid?: string }
  const jobId = String(req.body?.jobId || '').trim().toUpperCase()
  const sessionId = String(req.body?.sessionId || '').trim()
  const answers = Array.isArray(req.body?.answers) ? (req.body.answers as Array<{ questionId?: string; question?: string; answer?: string }>) : []

  const fallback = fallbackInterviewScore(profile, answers)
  const reportSessionId = ensureInterviewReportSessionId(jobId, sessionId)
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim()
  if (!apiKey) {
    flowLog('submit-interview', true, '未配置 DASHSCOPE，使用回退评分')
    await upsertInterviewReport({
      sessionId: reportSessionId,
      jobCode: jobId,
      candidateName: String(profile.name || '候选人'),
      candidatePhone: String(profile.phone || ''),
      candidateOpenId: String(profile.openid || ''),
      score: fallback.score,
      passed: fallback.passed,
      overallFeedback: fallback.overallFeedback,
      dimensionScores: fallback.dimensionScores || {},
      suggestions: fallback.suggestions || [],
      riskPoints: fallback.riskPoints || [],
      behaviorSignals: {},
      qa: answers.map((x) => ({
        questionId: String(x.questionId || ''),
        question: String(x.question || ''),
        answer: String(x.answer || '')
      }))
    })
    await markInvitationConsumedAfterInterviewSubmit(sessionId)
    return res.json({ data: fallback })
  }

  try {
    let transcriptTimeline: Array<{ ts: number; text: string }> = []
    let qaTimeline: Array<{ ts: number; questionId: string; question: string; answer: string }> = []
    let behaviorSignals: Record<string, unknown> = {}

    if (sessionId) {
      const sid = await getSessionInternalId(sessionId)
      if (sid) {
        const [msgRows] = await mysqlPool.query<any[]>(
          `SELECT message_type, content, created_at
           FROM interview_messages
           WHERE session_id=?
           ORDER BY created_at ASC
           LIMIT 400`,
          [sid]
        )
        for (const m of msgRows) {
          if (m.message_type === 'transcript') {
            transcriptTimeline.push({
              ts: new Date(m.created_at).getTime(),
              text: String(m.content || '')
            })
          } else if (m.message_type === 'qa_answer') {
            try {
              const o = JSON.parse(String(m.content || '{}')) as { questionId?: string; question?: string; answer?: string }
              qaTimeline.push({
                ts: new Date(m.created_at).getTime(),
                questionId: String(o.questionId || ''),
                question: String(o.question || ''),
                answer: String(o.answer || '')
              })
            } catch {
              /* ignore malformed payload */
            }
          }
        }
      }
    }

    const mergedQa = (answers.length ? answers : qaTimeline).map((item) => ({
      questionId: String(item.questionId || ''),
      question: String(item.question || ''),
      answer: String(item.answer || '')
    }))
    const nonEmptyAnswers = mergedQa.filter((x) => x.answer.trim())
    const transcriptChars = transcriptTimeline.reduce((sum, x) => sum + String(x.text || '').length, 0)
    const qaChars = nonEmptyAnswers.reduce((sum, x) => sum + x.answer.length, 0)
    const durationSec =
      transcriptTimeline.length >= 2
        ? Math.max(1, Math.round((transcriptTimeline[transcriptTimeline.length - 1].ts - transcriptTimeline[0].ts) / 1000))
        : 0
    behaviorSignals = {
      answeredQuestionCount: nonEmptyAnswers.length,
      totalQuestionCount: mergedQa.length,
      avgAnswerChars: nonEmptyAnswers.length ? Math.round(qaChars / nonEmptyAnswers.length) : 0,
      transcriptChars,
      qaChars,
      durationSec,
      shortAnswerRatio:
        mergedQa.length > 0 ? Number((mergedQa.filter((x) => x.answer.trim().length < 12).length / mergedQa.length).toFixed(3)) : 1
    }

    const promptPayload = {
      candidateProfile: {
        name: String(profile.name || ''),
        openid: String(profile.openid || ''),
        phone: String(profile.phone || '')
      },
      jobId,
      sessionId,
      questionsAndAnswers: mergedQa,
      transcriptTimeline,
      behaviorSignals
    }

    const model = process.env.QWEN_QUESTION_MODEL || 'qwen3.5-plus'
    const data = await dashScopeChatCompletions({
      model,
      messages: [
        {
          role: 'system',
          content:
            '你是结构化面试评估助手。请从多个方面给出可执行评价：沟通表达(communication)、技术深度(technicalDepth)、逻辑结构(logic)、岗位匹配(jobFit)、稳定性与抗压(stability)，每项 0-100。你必须只输出一个 JSON 对象，不得输出 markdown 或解释。JSON Schema: {"score":0-100数字,"passed":布尔,"overallFeedback":"字符串","dimensionScores":{"communication":0-100,"technicalDepth":0-100,"logic":0-100,"jobFit":0-100,"stability":0-100},"suggestions":["字符串"],"riskPoints":["字符串"]}。'
        },
        {
          role: 'user',
          content: `请基于以下面试数据评分并返回严格 JSON：\n${JSON.stringify(promptPayload)}`
        }
      ],
      temperature: 0.2
    })
    const raw = data?.choices?.[0]?.message?.content
    const text = typeof raw === 'string' ? raw : ''
    const parsed = parseAiInterviewScoreJson(text)
    if (!parsed) {
      flowLog('submit-interview AI解析', false, '模型返回非预期 JSON，使用回退评分')
      const out = { ...fallback, meta: { behaviorSignals, aiParsed: false } }
      await upsertInterviewReport({
        sessionId: reportSessionId,
        jobCode: jobId,
        candidateName: String(profile.name || '候选人'),
        candidatePhone: String(profile.phone || ''),
        candidateOpenId: String(profile.openid || ''),
        score: out.score,
        passed: out.passed,
        overallFeedback: out.overallFeedback,
        dimensionScores: out.dimensionScores || {},
        suggestions: out.suggestions || [],
        riskPoints: out.riskPoints || [],
        behaviorSignals,
        qa: mergedQa
      })
      await markInvitationConsumedAfterInterviewSubmit(sessionId)
      return res.json({ data: out })
    }
    flowLog('submit-interview AI评分', true, `score=${parsed.score} passed=${parsed.passed}`)
    const out = {
      data: {
        ...parsed,
        meta: {
          behaviorSignals,
          aiParsed: true
        }
      }
    }
    await upsertInterviewReport({
      sessionId: reportSessionId,
      jobCode: jobId,
      candidateName: String(profile.name || '候选人'),
      candidatePhone: String(profile.phone || ''),
      candidateOpenId: String(profile.openid || ''),
      score: parsed.score,
      passed: parsed.passed,
      overallFeedback: parsed.overallFeedback,
      dimensionScores: parsed.dimensionScores || {},
      suggestions: parsed.suggestions || [],
      riskPoints: parsed.riskPoints || [],
      behaviorSignals,
      qa: mergedQa
    })
    await markInvitationConsumedAfterInterviewSubmit(sessionId)
    return res.json(out)
  } catch (e) {
    flowLog('submit-interview 异常', false, e instanceof Error ? e.message : 'unknown')
    try {
      await upsertInterviewReport({
        sessionId: reportSessionId,
        jobCode: jobId,
        candidateName: String(profile.name || '候选人'),
        candidatePhone: String(profile.phone || ''),
        candidateOpenId: String(profile.openid || ''),
        score: fallback.score,
        passed: fallback.passed,
        overallFeedback: fallback.overallFeedback,
        dimensionScores: fallback.dimensionScores || {},
        suggestions: fallback.suggestions || [],
        riskPoints: fallback.riskPoints || [],
        behaviorSignals: {},
        qa: answers.map((x) => ({
          questionId: String(x.questionId || ''),
          question: String(x.question || ''),
          answer: String(x.answer || '')
        }))
      })
      await markInvitationConsumedAfterInterviewSubmit(sessionId)
    } catch (persistErr) {
      flowLog('submit-interview 异常后落库失败', false, persistErr instanceof Error ? persistErr.message : 'unknown')
    }
    return res.json({ data: fallback })
  }
})

app.listen(port, listenHost, () => {
  const wechatEnv = checkWechatEnv()
  const trtcSdkAppId = Number(process.env.TRTC_SDK_APP_ID || 0)
  const trtcSecret = String(process.env.TRTC_SDK_SECRET_KEY || '').trim()
  const trtcOk = Boolean(trtcSdkAppId && trtcSecret)
  console.log(`API server listening on http://${listenHost}:${port} (真机请用电脑局域网 IP 替代 localhost)`)
  console.log(
    `[startup-check] WeChat env: ${wechatEnv.ok ? 'OK' : 'MISSING'} | WECHAT_APPID=${maskSecret(
      wechatEnv.appId
    )} | WECHAT_SECRET=${maskSecret(wechatEnv.appSecret)}`
  )
  console.log(
    `[startup-check] TRTC env: ${trtcOk ? 'OK' : 'MISSING'} | TRTC_SDK_APP_ID=${trtcSdkAppId || 0} | TRTC_SDK_SECRET_KEY=${maskSecret(
      trtcSecret
    )}`
  )
  if (flowLogEnabled) {
    console.log('[startup-check] FLOW_LOG=1 → 终端会输出 [flow] 步骤与 [api] 请求摘要（/api/health 除外）')
  }
  if (!wechatEnv.ok) {
    console.warn('[startup-check] /api/wechat/login will return 500 until env vars are configured.')
  }
})
