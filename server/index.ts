import express from 'express'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { createRequire } from 'node:module'
import mysql, { type ResultSetHeader, type RowDataPacket } from 'mysql2/promise'
import multer from 'multer'
import Redis from 'ioredis'
import { PDFParse } from 'pdf-parse'
import mammoth from 'mammoth'

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

const mysqlPool = mysql.createPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'ai_recruit',
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  queueLimit: 0
})

/** 管理端演示库（HR users 等），与 MYSQL_DATABASE 业务库分离 */
const mysqlAdminPool = mysql.createPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_ADMIN_DATABASE || 'ai_recruit_admin',
  waitForConnections: true,
  connectionLimit: Math.min(5, Number(process.env.MYSQL_CONNECTION_LIMIT || 10)),
  queueLimit: 0
})

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

/** 岗位码（jobs.job_code）或后台生成的 interview_invitations.invite_code（如 INV…） */
type ResolvedInviteOrJob = {
  jobCode: string
  title: string
  department: string
  jobDbId: number
  /** 来自 interview_invitations 时存在，login-invite 需落库接受邀请 */
  invitationId?: number
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
    return {
      jobCode: r.jobCode,
      title: r.title,
      department: r.department,
      jobDbId: Number(r.jobDbId),
      invitationId: Number(r.invitationId),
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

const QUESTION_BANK = [
  { id: 'Q1', text: '请介绍一个你参与过的项目，并说明你的核心贡献。' },
  { id: 'Q2', text: '你如何定位线上问题并快速止血？' },
  { id: 'Q3', text: '请讲一个你做性能优化的案例和结果。' }
]

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

type ResumeScreeningAiResult = {
  candidateName: string
  matchScore: number
  status: string
  summary: string
}

function parseResumeScreeningAiJson(raw: string): ResumeScreeningAiResult | null {
  try {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
    const parsed = JSON.parse(cleaned) as Partial<ResumeScreeningAiResult>
    const candidateName = String(parsed?.candidateName || '').trim()
    const matchScore = Number(parsed?.matchScore)
    const status = String(parsed?.status || 'AI分析完成').trim() || 'AI分析完成'
    const summary = String(parsed?.summary || '').trim()
    if (!candidateName || !Number.isFinite(matchScore) || !summary) return null
    return {
      candidateName,
      matchScore: Math.max(0, Math.min(100, Math.round(matchScore))),
      status,
      summary
    }
  } catch {
    return null
  }
}

function guessCandidateNameFromResume(text: string): string {
  const t = text.replace(/\r\n/g, '\n').slice(0, 8000)
  const m =
    t.match(/(?:姓名|名字)[:：\s]*([^\s\n，,]{2,20})/) ||
    t.match(/Name[:：\s]*([A-Za-z\u4e00-\u9fa5][^\n]{1,30})/i)
  if (m?.[1]) return String(m[1]).trim().replace(/[,，.。]/g, '')
  const line = t.split('\n').find((l) => l.trim().length >= 2 && l.trim().length <= 24)
  return line?.trim().slice(0, 20) || '候选人'
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
  return {
    candidateName,
    matchScore,
    status: '关键词估算（未调用大模型）',
    summary:
      `（未调用大模型或调用失败：仅根据岗位 JD 与简历文本的关键词重叠度估算分数，仅供参考。）\n` +
      `目标岗位：${jobTitle || '—'}\n` +
      `若要结构化 AI 评估：在根目录 .env.local 配置 DASHSCOPE_API_KEY（阿里云百炼），可选 QWEN_RESUME_MODEL，重启 npm run dev:api 后重新筛查。`
  }
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
      return (tr.text || '').trim()
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
  const clipResume = params.resumeText.replace(/\s+/g, ' ').slice(0, 14000)
  const clipJd = (params.jdText || '').replace(/\s+/g, ' ').slice(0, 8000)
  const userPrompt = [
    `岗位名称：${params.jobTitle}`,
    `部门：${params.department || '—'}`,
    `JD：${clipJd || '（无正文）'}`,
    `简历全文（节选）：${clipResume}`
  ].join('\n')
  const data = await dashScopeChatCompletions({
    model,
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content:
          '你是资深招聘顾问。根据「岗位 JD」与「简历文本」评估匹配度。只输出一个 JSON 对象，不要 markdown 代码块，不要其它文字。格式：{"candidateName":"从简历推断的中文姓名或合理称呼","matchScore":0到100的整数,"status":"AI分析完成 或 不匹配 等简短状态","summary":"3～6 句中文，说明匹配点、风险与是否建议推进"}'
      },
      { role: 'user', content: userPrompt }
    ]
  })
  const raw = data?.choices?.[0]?.message?.content
  const text = typeof raw === 'string' ? raw : ''
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
      technical: Math.max(0, Math.min(100, score - 1)),
      logic: Math.max(0, Math.min(100, score + 1)),
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

function logAiQuestionFallback(reason: string, detail?: string) {
  const clip = detail ? String(detail).replace(/\s+/g, ' ').slice(0, 600) : ''
  console.warn(`[AI-questions] 回退到内置题库 | ${reason}${clip ? ` | ${clip}` : ''}`)
  if (flowLogEnabled) flowLog('AI 出题回退', false, `${reason}${clip ? ` | ${clip}` : ''}`)
}

function fallbackQuestionBank(count: number) {
  return QUESTION_BANK.slice(0, count).map((q, idx) => ({ id: `Q${idx + 1}`, text: q.text }))
}

async function generateAiQuestions(params: { title: string; department?: string; jdText?: string; count?: number }) {
  const count = params.count || 3
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim()
  if (!apiKey) {
    logAiQuestionFallback('未配置 DASHSCOPE_API_KEY')
    return fallbackQuestionBank(count)
  }
  const model = process.env.QWEN_QUESTION_MODEL || 'qwen3.5-plus'
  try {
    const userPrompt = [
      `岗位名称：${params.title}`,
      `部门：${params.department || '未知'}`,
      `JD：${params.jdText || '无'}`,
      `请生成恰好 ${count} 道中文专业技术面试题，要求具体、可考察真实能力。`
    ].join('\n')
    const data = await dashScopeChatCompletions({
      model,
      messages: [
        {
          role: 'system',
          content:
            '你是资深技术面试官。请根据用户给出的岗位信息输出恰好要求的题目数量。只输出一个 JSON 对象，格式：{"questions":[{"id":"Q1","text":"题干"}]}，id 从 Q1 起递增，不要 markdown 代码块，不要其它说明。'
        },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.6
    })
    const raw = data?.choices?.[0]?.message?.content
    const text = typeof raw === 'string' ? raw : ''
    if (!text.trim()) {
      logAiQuestionFallback(`模型返回空内容 model=${model}`, JSON.stringify(data).slice(0, 400))
      return fallbackQuestionBank(count)
    }
    const parsed = parseQuestionsJson(text, count)
    if (parsed?.length) {
      return parsed.slice(0, count).map((q, idx) => ({
        id: q.id || `Q${idx + 1}`,
        text: q.text
      }))
    }
    logAiQuestionFallback(`JSON 解析失败或 questions 为空 model=${model}`, text)
    return fallbackQuestionBank(count)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logAiQuestionFallback(`DashScope 调用异常 model=${model}`, msg)
    return fallbackQuestionBank(count)
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
    legacyToken: Boolean(String(process.env.ADMIN_API_TOKEN || '').trim())
  })
})

/** 管理库 users.role（中文）→ 管理端界面 Role */
function mapAdminDbRoleToUiRole(dbRole: string): 'admin' | 'delivery_manager' | 'recruiter' {
  const r = String(dbRole || '').trim()
  if (!r) return 'delivery_manager'
  if (/平台管理员|系统管理|超级管理/i.test(r)) return 'admin'
  if (/交付/i.test(r)) return 'delivery_manager'
  if (/招聘/i.test(r)) return 'recruiter'
  if (/管理/i.test(r)) return 'admin'
  return 'delivery_manager'
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

  try {
    const [rows] = await mysqlAdminPool.query<RowDataPacket[]>(
      'SELECT id, username, name, role, password_hash, status FROM users WHERE username = ? LIMIT 1',
      [username]
    )
    const row = rows[0] as {
      id?: string
      username?: string | null
      name?: string | null
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
      const userPayload = { name: displayName, username: un, uiRole }
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

/** HR 后台：岗位列表（与小程序 / 会话共用 jobs 表） */
app.get('/api/admin/jobs', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  try {
    const [rows] = await mysqlPool.query<any[]>(
      `SELECT id, project_id, job_code, title, department, jd_text, demand, location, skills, level, salary, recruiters
       FROM jobs ORDER BY id DESC`
    )
    res.json({
      data: rows.map((r) => ({
        ...r,
        recruiters: recruitersFromRow(r.recruiters)
      }))
    })
  } catch {
    res.status(500).json({ message: 'db error' })
  }
})

app.post('/api/admin/jobs', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  const title = String(req.body?.title || '').trim()
  let jobCode = String(req.body?.jobCode || '').trim().toUpperCase()
  if (!title) return res.status(400).json({ message: 'title required' })
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
  const level = String(req.body?.level ?? '').trim()
  const salary = String(req.body?.salary ?? '').trim()
  const recruitersJson = normalizeRecruitersForDb(req.body?.recruiters)
  try {
    await mysqlPool.query(
      `INSERT INTO jobs (project_id, job_code, title, department, jd_text, demand, location, skills, level, salary, recruiters)
       VALUES (?,?,?,?,?,?,?,?,?,?, CAST(? AS JSON))`,
      [
        projectId,
        jobCode,
        title,
        department,
        jdText,
        demand,
        location || null,
        skills || null,
        level || null,
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
  const title = req.body?.title !== undefined ? String(req.body.title).trim() : null
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
  const level = req.body?.level !== undefined ? String(req.body.level).trim() : undefined
  const salary = req.body?.salary !== undefined ? String(req.body.salary).trim() : undefined
  const recruiters =
    req.body?.recruiters !== undefined ? normalizeRecruitersForDb(req.body.recruiters) : undefined
  try {
    const fields: string[] = []
    const vals: any[] = []
    if (title !== null) {
      fields.push('title=?')
      vals.push(title)
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
    if (level !== undefined) {
      fields.push('level=?')
      vals.push(level || null)
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

app.get('/api/admin/resume-screenings', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  try {
    const [rows] = await mysqlPool.query<any[]>(
      `SELECT id, job_code, candidate_name, matched_job_title, match_score, status, report_summary, file_name, created_at
       FROM resume_screenings ORDER BY id DESC LIMIT 200`
    )
    res.json({ data: rows })
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code
    if (code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({ message: 'resume_screenings 表未创建，请执行 server/migration_resume_screenings.sql' })
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
      const [jobRows] = await mysqlPool.query<any[]>(
        'SELECT title, department, jd_text FROM jobs WHERE job_code=? LIMIT 1',
        [jobCode]
      )
      if (!jobRows.length) return res.status(404).json({ message: 'job not found' })
      const job = jobRows[0] as { title: string; department: string | null; jd_text: string | null }
      let plain: string
      try {
        plain = await extractResumePlainText(req.file.buffer, req.file.originalname, req.file.mimetype || '')
      } catch (ex) {
        const msg = ex instanceof Error ? ex.message : 'parse failed'
        return res.status(415).json({ message: msg })
      }
      if (!plain.trim()) return res.status(422).json({ message: '未能从文件中提取可读文本' })

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

      const [ins] = await mysqlPool.query<ResultSetHeader>(
        `INSERT INTO resume_screenings (job_code, candidate_name, matched_job_title, match_score, status, report_summary, file_name)
         VALUES (?,?,?,?,?,?,?)`,
        [
          jobCode,
          result.candidateName,
          String(job.title || ''),
          result.matchScore,
          result.status,
          result.summary,
          String(req.file.originalname || '').slice(0, 255)
        ]
      )
      flowLog('resume-screen', true, `job=${jobCode} score=${result.matchScore}`)
      res.json({
        data: {
          id: Number(ins.insertId),
          jobCode,
          candidateName: result.candidateName,
          matchedJobTitle: String(job.title || ''),
          matchScore: result.matchScore,
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

function generateUniqueInviteCode(): string {
  return `INV${crypto.randomBytes(6).toString('hex').toUpperCase()}`
}

/** HR：为某岗位生成一条待处理面试邀请（写入 interview_invitations，候选人可在小程序「邀请」列表或登录页输入 INV… 码） */
app.post('/api/admin/invitations', async (req, res) => {
  if (!(await assertAdminToken(req, res))) return
  const jobCode = String(req.body?.jobCode || '').trim().toUpperCase()
  if (!jobCode) return res.status(400).json({ message: 'jobCode required' })
  const rawDays = Number(req.body?.expiresInDays)
  const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(Math.floor(rawDays), 365) : 7
  try {
    const [jobs] = await mysqlPool.query<any[]>('SELECT id FROM jobs WHERE job_code=? LIMIT 1', [jobCode])
    if (!jobs.length) return res.status(404).json({ message: 'job not found' })
    const jobId = jobs[0].id as number
    let lastErr: unknown
    for (let attempt = 0; attempt < 8; attempt++) {
      const inviteCode = generateUniqueInviteCode()
      try {
        await mysqlPool.query(
          `INSERT INTO interview_invitations (invite_code, job_id, status, expires_at)
           VALUES (?, ?, 'pending', DATE_ADD(NOW(), INTERVAL ? DAY))`,
          [inviteCode, jobId, days]
        )
        return res.json({ data: { inviteCode, jobCode, expiresInDays: days } })
      } catch (e: unknown) {
        lastErr = e
        const code = (e as { code?: string })?.code
        if (code === 'ER_DUP_ENTRY') continue
        throw e
      }
    }
    console.error('[admin/invitations] allocate failed', lastErr)
    return res.status(500).json({ message: 'could not allocate invite code' })
  } catch {
    res.status(500).json({ message: 'db error' })
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
              inv.interviewer_user_id AS interviewerUserId,
              inv.interviewer_openid AS interviewerOpenId,
              j.id AS jobDbId,
              j.job_code AS jobCode,
              j.title AS title,
              j.department AS department
       FROM interview_invitations inv
       JOIN jobs j ON j.id = inv.job_id
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
       SET status='accepted',
           accepted_at=NOW(),
           candidate_user_id=COALESCE(candidate_user_id, ?),
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
    res.json({
      data: {
        sessionId,
        job: { id: inv.jobCode, title: inv.title, department: inv.department }
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

    if (resolved.invitationId) {
      const inviteIdUpper = inviteCodeRaw.trim().toUpperCase()
      const conn = await mysqlPool.getConnection()
      try {
        await conn.beginTransaction()
        const [invRows] = await conn.query<any[]>(
          `SELECT inv.id AS id,
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
        const [updHeader] = await conn.query<ResultSetHeader>(
          `UPDATE interview_invitations
           SET status='accepted',
               accepted_at=NOW(),
               candidate_user_id=COALESCE(candidate_user_id, ?),
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
    flowLog('login-invite 完成', true, `sessionId=${sessionId}`)
    res.json({ data: { openid, sessionId, name, job, trtc } })
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

app.get('/api/candidate/interview-questions', async (req, res) => {
  const jobId = String(req.query.jobId || '').trim().toUpperCase()
  if (!jobId) return res.status(400).json({ message: 'jobId required' })
  try {
    flowLog('interview-questions 开始', true, `jobId=${jobId}`)
    const [rows] = await mysqlPool.query<any[]>(
      'SELECT title, department, jd_text FROM jobs WHERE job_code=? LIMIT 1',
      [jobId]
    )
    const row = rows.length ? rows[0] : null
    const fallbackJob = JOBS[jobId as keyof typeof JOBS]
    if (!row && !fallbackJob) return res.status(404).json({ message: 'job not found' })
    const aiQuestions = await generateAiQuestions({
      title: String(row?.title || fallbackJob?.title || jobId),
      department: String(row?.department || fallbackJob?.department || ''),
      jdText: String(row?.jd_text || ''),
      count: 3
    })
    flowLog('interview-questions 成功', true, `count=${aiQuestions.length}`)
    res.json({ data: aiQuestions })
  } catch (e) {
    flowLog('interview-questions 失败', false, e instanceof Error ? e.message : 'generate questions failed')
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
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim()
  if (!apiKey) {
    flowLog('submit-interview', true, '未配置 DASHSCOPE，使用回退评分')
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
            '你是结构化面试评估助手。你必须只输出一个 JSON 对象，不得输出 markdown 或解释。JSON Schema: {"score":0-100数字,"passed":布尔,"overallFeedback":"字符串","dimensionScores":{"communication":0-100,"technical":0-100,"logic":0-100,"stability":0-100},"suggestions":["字符串"],"riskPoints":["字符串"]}。'
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
      return res.json({ data: { ...fallback, meta: { behaviorSignals, aiParsed: false } } })
    }
    flowLog('submit-interview AI评分', true, `score=${parsed.score} passed=${parsed.passed}`)
    return res.json({
    data: {
        ...parsed,
        meta: {
          behaviorSignals,
          aiParsed: true
        }
      }
    })
  } catch (e) {
    flowLog('submit-interview 异常', false, e instanceof Error ? e.message : 'unknown')
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
