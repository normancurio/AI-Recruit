import Taro from '@tarojs/taro'
import { getApiBase } from '../config/apiBase'
import {
  CandidateProfile,
  InterviewAnswer,
  InterviewQuestion,
  InterviewResult,
  JobInfo
} from '../types/interview'

const MOCK_JOBS: Record<string, JobInfo> = {
  J001: { id: 'J001', title: '前端开发工程师 (校招)', department: '大前端团队' },
  J002: { id: 'J002', title: 'Java后端工程师 (校招)', department: '业务中台' },
  J003: { id: 'J003', title: '高级前端架构师', department: '基础架构部' }
}

function useMock() {
  return !getApiBase()
}

export type TrtcCredential = {
  sdkAppId: number
  userId: string
  userSig: string
  roomId: number
}

export type LoginInviteResult = {
  openid: string
  sessionId: string
  name: string
  job: JobInfo
  trtc: TrtcCredential | null
  /** 结构化面试邀请关联的筛查记录，用于出题精确匹配简历 */
  resumeScreeningId?: number | null
}

/** wx.login 的 code + 邀请码 + 姓名：换 openid、校验邀请码，并返回 TRTC 凭证（服务端已配 TRTC 时） */
export async function loginWithInviteCode(params: {
  code: string
  inviteCode: string
  name: string
  phone?: string
}): Promise<LoginInviteResult> {
  const invite = params.inviteCode.trim().toUpperCase()
  if (useMock()) {
    const job = MOCK_JOBS[invite]
    if (!job) throw new Error('无效邀请码')
    return {
      openid: 'mock_openid',
      sessionId: `${job.id}-mock_openid`,
      name: params.name.trim(),
      job,
      trtc: null
    }
  }
  const res = await Taro.request<{ data: LoginInviteResult; message?: string }>({
    url: `${getApiBase()}/api/candidate/login-invite`,
    method: 'POST',
    data: {
      code: params.code,
      inviteCode: invite,
      name: params.name.trim(),
      phone: params.phone?.trim() || ''
    }
  })
  if (res.statusCode >= 400 || !res.data?.data?.openid) {
    throw new Error(res.data?.message || '登录失败')
  }
  return res.data.data
}

export async function validateInviteCode(code: string): Promise<JobInfo> {
  const normalized = code.trim().toUpperCase()
  if (useMock()) {
    const job = MOCK_JOBS[normalized]
    if (!job) throw new Error('无效邀请码')
    return job
  }

  const res = await Taro.request<{ data: JobInfo }>({
    url: `${getApiBase()}/api/candidate/validate-invite`,
    method: 'POST',
    data: { inviteCode: normalized }
  })

  if (res.statusCode >= 400 || !res.data?.data) {
    throw new Error('邀请码校验失败')
  }
  return res.data.data
}

export type InterviewQuestionFetchOpts = {
  inviteCode?: string
  sessionId?: string
}

type QuestionsApiBody =
  | InterviewQuestion[]
  | { questions?: InterviewQuestion[]; partial?: boolean; expectedTotal?: number }

function normalizeQuestionsResponse(body: QuestionsApiBody | undefined): {
  questions: InterviewQuestion[]
  partial: boolean
} {
  if (Array.isArray(body)) return { questions: body, partial: false }
  const questions = Array.isArray(body?.questions) ? body.questions : []
  return { questions, partial: Boolean(body?.partial) }
}

function questionFetchQuery(
  jobId: string,
  candidateName?: string,
  resumeScreeningId?: number,
  opts?: InterviewQuestionFetchOpts
) {
  return {
    jobId,
    candidateName: candidateName?.trim() || '',
    inviteCode: opts?.inviteCode?.trim() || '',
    sessionId: opts?.sessionId?.trim() || '',
    ...(typeof resumeScreeningId === 'number' && resumeScreeningId > 0 ? { resumeScreeningId } : {})
  }
}

export async function fetchInterviewQuestions(
  jobId: string,
  candidateName?: string,
  resumeScreeningId?: number,
  opts?: InterviewQuestionFetchOpts
): Promise<InterviewQuestion[]> {
  if (useMock()) {
    throw new Error(
      '面试题由服务端大模型实时生成：请配置 TARO_APP_API_BASE 并确保后端已设置 DASHSCOPE_API_KEY'
    )
  }

  const res = await Taro.request<{ data: QuestionsApiBody; message?: string }>({
    url: `${getApiBase()}/api/candidate/interview-questions`,
    method: 'GET',
    data: questionFetchQuery(jobId, candidateName, resumeScreeningId, opts)
  })

  if (res.statusCode >= 400) {
    throw new Error(res.data?.message || `拉取题目失败（HTTP ${res.statusCode}）`)
  }
  const { questions } = normalizeQuestionsResponse(res.data?.data)
  if (!questions.length) throw new Error(res.data?.message || '拉取题目失败')
  return questions
}

async function fetchInterviewQuestionsFirst(
  jobId: string,
  candidateName?: string,
  resumeScreeningId?: number,
  opts?: InterviewQuestionFetchOpts
): Promise<{ questions: InterviewQuestion[]; partial: boolean }> {
  const res = await Taro.request<{ data: QuestionsApiBody; message?: string }>({
    url: `${getApiBase()}/api/candidate/interview-questions`,
    method: 'GET',
    data: {
      ...questionFetchQuery(jobId, candidateName, resumeScreeningId, opts),
      phase: 'first'
    }
  })
  if (res.statusCode >= 400) {
    throw new Error(res.data?.message || `拉取首题失败（HTTP ${res.statusCode}）`)
  }
  const parsed = normalizeQuestionsResponse(res.data?.data)
  if (!parsed.questions.length) throw new Error(res.data?.message || '拉取首题失败')
  return parsed
}

async function fetchInterviewQuestionsRest(
  jobId: string,
  candidateName: string | undefined,
  firstQuestionText: string,
  resumeScreeningId?: number,
  opts?: InterviewQuestionFetchOpts
): Promise<InterviewQuestion[]> {
  const res = await Taro.request<{ data: QuestionsApiBody; message?: string }>({
    url: `${getApiBase()}/api/candidate/interview-questions-rest`,
    method: 'POST',
    data: {
      ...questionFetchQuery(jobId, candidateName, resumeScreeningId, opts),
      firstQuestionText
    }
  })
  if (res.statusCode >= 400) {
    throw new Error(res.data?.message || `拉取后续题目失败（HTTP ${res.statusCode}）`)
  }
  return normalizeQuestionsResponse(res.data?.data).questions
}

const QUESTIONS_PREFETCH_STORAGE_KEY = 'interview_questions_prefetch_v1'

export function buildInterviewQuestionsCacheKey(
  jobId: string,
  candidateName: string,
  resumeScreeningId?: number,
  inviteCode?: string
) {
  const jid = String(jobId || '').trim().toUpperCase()
  const invite = String(inviteCode || '').trim().toUpperCase()
  if (invite) return `${jid}\t${invite}`
  const name = String(candidateName || '').trim()
  const rs =
    typeof resumeScreeningId === 'number' && Number.isFinite(resumeScreeningId) && resumeScreeningId > 0
      ? String(resumeScreeningId)
      : ''
  return `${jid}\t${name}\t${rs}`
}

function readPrefetchedQuestionsForKey(key: string, consume: boolean): InterviewQuestion[] | null {
  return readPrefetchedQuestions(key, consume)
}

function findPrefetchedQuestions(
  jobId: string,
  candidateName: string,
  resumeScreeningId: number | undefined,
  inviteCode: string | undefined,
  consume: boolean
): InterviewQuestion[] | null {
  const keys = [
    buildInterviewQuestionsCacheKey(jobId, candidateName, resumeScreeningId, inviteCode),
    buildInterviewQuestionsCacheKey(jobId, candidateName, resumeScreeningId),
    buildInterviewQuestionsCacheKey(jobId, '', undefined, inviteCode)
  ]
  for (const key of keys) {
    const hit = readPrefetchedQuestionsForKey(key, false)
    if (hit?.length) {
      if (consume) {
        for (const k of keys) readPrefetchedQuestionsForKey(k, true)
      }
      return hit
    }
  }
  return null
}

const inflightQuestionsByKey = new Map<string, Promise<InterviewQuestion[]>>()
/** 预取成功但 Storage 写入失败时仍可供面试页消费，避免再次打大模型 */
const resolvedQuestionsMemory = new Map<string, InterviewQuestion[]>()
/** 预取已完成、in-flight 已清理时，避免面试页重复请求大模型 */
const settledQuestionsByKey = new Map<string, InterviewQuestion[]>()

function persistPrefetchedQuestions(key: string, questions: InterviewQuestion[]) {
  resolvedQuestionsMemory.set(key, questions)
  settledQuestionsByKey.set(key, questions)
  try {
    Taro.setStorageSync(QUESTIONS_PREFETCH_STORAGE_KEY, {
      cacheKey: key,
      questions,
      at: Date.now()
    })
  } catch {
    /* 存储配额等；仍保留内存 / settled 供面试页读取 */
  }
}

function readPrefetchedQuestions(key: string, consume: boolean): InterviewQuestion[] | null {
  try {
    const raw = Taro.getStorageSync(QUESTIONS_PREFETCH_STORAGE_KEY) as
      | { cacheKey?: string; questions?: InterviewQuestion[] }
      | undefined
    if (raw?.cacheKey === key && Array.isArray(raw.questions) && raw.questions.length) {
      if (consume) {
        Taro.removeStorageSync(QUESTIONS_PREFETCH_STORAGE_KEY)
        resolvedQuestionsMemory.delete(key)
        settledQuestionsByKey.delete(key)
      }
      return raw.questions
    }
  } catch {
    /* ignore */
  }
  const mem = resolvedQuestionsMemory.get(key) || settledQuestionsByKey.get(key)
  if (!mem?.length) return null
  if (consume) {
    resolvedQuestionsMemory.delete(key)
    settledQuestionsByKey.delete(key)
    try {
      Taro.removeStorageSync(QUESTIONS_PREFETCH_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }
  return mem
}

async function fetchInterviewQuestionsPhased(
  jobId: string,
  candidateName?: string,
  resumeScreeningId?: number,
  opts?: InterviewQuestionFetchOpts
): Promise<InterviewQuestion[]> {
  const key = buildInterviewQuestionsCacheKey(
    jobId,
    String(candidateName || ''),
    resumeScreeningId,
    opts?.inviteCode
  )
  const { questions: first, partial } = await fetchInterviewQuestionsFirst(
    jobId,
    candidateName,
    resumeScreeningId,
    opts
  )
  persistPrefetchedQuestions(key, first)
  if (!partial || first.length >= 6) return first

  const firstText = String(first[0]?.text || '').trim()
  if (!firstText) return first

  void fetchInterviewQuestionsRest(jobId, candidateName, firstText, resumeScreeningId, opts)
    .then((rest) => {
      const merged = [...first, ...rest].filter((q) => q && String(q.text || '').trim())
      if (merged.length) persistPrefetchedQuestions(key, merged)
      return merged
    })
    .catch(() => {
      /* 后续题失败时面试页可再拉 */
    })

  return first
}

/** 首题已展示后补拉 Q2～Q6，并回调合并结果 */
export function ensureInterviewQuestionsRest(
  jobId: string,
  candidateName: string,
  firstQuestionText: string,
  resumeScreeningId: number | undefined,
  opts: InterviewQuestionFetchOpts | undefined,
  onMerged: (questions: InterviewQuestion[]) => void
): void {
  const key = buildInterviewQuestionsCacheKey(jobId, candidateName, resumeScreeningId, opts?.inviteCode)
  const cached = readPrefetchedQuestions(key, false)
  if (cached && cached.length >= 6) {
    onMerged(cached)
    return
  }

  void fetchInterviewQuestionsRest(jobId, candidateName, firstQuestionText, resumeScreeningId, opts)
    .then((rest) => {
      const base = cached?.length ? cached : [{ id: 'Q1', text: firstQuestionText }]
      const merged = [...base.slice(0, 1), ...rest].filter((q) => q && String(q.text || '').trim())
      if (merged.length) {
        persistPrefetchedQuestions(key, merged)
        onMerged(merged)
      }
    })
    .catch(() => {
      /* ignore */
    })
}

/**
 * 登录/候场可调用：先快出 Q1，再后台拉 Q2～Q6，与 fetchInterviewQuestionsOrPrefetched 共享 in-flight。
 */
export function prefetchInterviewQuestions(
  jobId: string,
  candidateName?: string,
  resumeScreeningId?: number,
  opts?: InterviewQuestionFetchOpts
): Promise<InterviewQuestion[]> {
  if (useMock()) return Promise.resolve([])
  const key = buildInterviewQuestionsCacheKey(
    jobId,
    String(candidateName || ''),
    resumeScreeningId,
    opts?.inviteCode
  )
  const cached = findPrefetchedQuestions(
    jobId,
    String(candidateName || ''),
    resumeScreeningId,
    opts?.inviteCode,
    false
  )
  if (cached?.length) return Promise.resolve(cached)

  const existing = inflightQuestionsByKey.get(key)
  if (existing) return existing

  const p = fetchInterviewQuestionsPhased(jobId, candidateName, resumeScreeningId, opts)
    .then((questions) => {
      persistPrefetchedQuestions(key, questions)
      return questions
    })
    .finally(() => {
      inflightQuestionsByKey.delete(key)
    })

  inflightQuestionsByKey.set(key, p)
  return p
}

/**
 * 进入答题前等待预取完成（已有缓存则立刻返回），避免面试页卡在「正在准备题目」。
 */
export async function waitForInterviewQuestionsPrefetch(
  jobId: string,
  candidateName?: string,
  resumeScreeningId?: number,
  opts?: { timeoutMs?: number; inviteCode?: string; sessionId?: string }
): Promise<InterviewQuestion[]> {
  const timeoutMs = opts?.timeoutMs ?? 120_000
  const key = buildInterviewQuestionsCacheKey(
    jobId,
    String(candidateName || ''),
    resumeScreeningId,
    opts?.inviteCode
  )
  const hit = findPrefetchedQuestions(
    jobId,
    String(candidateName || ''),
    resumeScreeningId,
    opts?.inviteCode,
    false
  )
  if (hit?.length) return hit

  let p = inflightQuestionsByKey.get(key)
  if (!p) {
    p = prefetchInterviewQuestions(jobId, candidateName, resumeScreeningId, opts)
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      p,
      new Promise<InterviewQuestion[]>((_, reject) => {
        timer = setTimeout(() => reject(new Error('prefetch_timeout')), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 优先使用等候页预取 / 进行中的预取（含首题快出），再回落到实时分段请求 */
export async function fetchInterviewQuestionsOrPrefetched(
  jobId: string,
  candidateName?: string,
  resumeScreeningId?: number,
  opts?: InterviewQuestionFetchOpts
): Promise<InterviewQuestion[]> {
  if (useMock()) {
    return fetchInterviewQuestions(jobId, candidateName, resumeScreeningId, opts)
  }
  const key = buildInterviewQuestionsCacheKey(
    jobId,
    String(candidateName || ''),
    resumeScreeningId,
    opts?.inviteCode
  )

  const cached = findPrefetchedQuestions(
    jobId,
    String(candidateName || ''),
    resumeScreeningId,
    opts?.inviteCode,
    true
  )
  if (cached?.length) return cached

  const inflight = inflightQuestionsByKey.get(key)
  if (inflight) {
    try {
      const got = await inflight
      if (Array.isArray(got) && got.length) return got
    } catch {
      /* 预取请求失败，回落到下方实时请求 */
    }
  }

  return fetchInterviewQuestionsPhased(jobId, candidateName, resumeScreeningId, opts)
}

export async function submitInterview(
  profile: CandidateProfile,
  jobId: string,
  answers: InterviewAnswer[],
  sessionId?: string
): Promise<InterviewResult> {
  if (useMock()) {
    const qualityScore = Math.min(
      100,
      Math.round(60 + answers.reduce((sum, item) => sum + Math.min(item.answer.length, 80), 0) / 12)
    )
    return {
      score: qualityScore,
      passed: qualityScore >= 75,
      overallFeedback:
        qualityScore >= 75
          ? '回答结构较完整，表达清晰，具备继续复试的潜力。'
          : '基础表达与技术细节仍需加强，建议补充项目深度和底层理解。'
    }
  }

  const res = await Taro.request<{ data: InterviewResult }>({
    url: `${getApiBase()}/api/candidate/submit-interview`,
    method: 'POST',
    timeout: 180_000,
    data: { profile, jobId, answers, sessionId: sessionId || '' }
  })

  if (res.statusCode >= 400 || !res.data?.data) {
    throw new Error('提交面试失败')
  }
  return res.data.data
}

/** 提交超时或网络失败时，查询服务端是否已落库报告 */
export async function fetchInterviewSubmitStatus(sessionId: string): Promise<{
  submitted: boolean
  result?: InterviewResult
}> {
  if (useMock() || !sessionId) return { submitted: false }
  const res = await Taro.request<{
    data?: { submitted?: boolean; result?: InterviewResult }
    message?: string
  }>({
    url: `${getApiBase()}/api/candidate/interview-submit-status`,
    method: 'GET',
    timeout: 15_000,
    data: { sessionId }
  })
  if (res.statusCode >= 400) return { submitted: false }
  const payload = res.data?.data
  if (!payload?.submitted || !payload.result) return { submitted: false }
  return { submitted: true, result: payload.result }
}

export async function startLiveSession(params: {
  sessionId: string
  jobId: string
  candidateName: string
  candidateOpenId?: string
  questions: InterviewQuestion[]
}) {
  if (useMock()) return
  await Taro.request({
    url: `${getApiBase()}/api/live/session/start`,
    method: 'POST',
    data: params
  })
}

export async function syncLiveTranscript(
  sessionId: string,
  text: string,
  meta?: { questionId?: string; question?: string }
) {
  if (useMock() || !text.trim()) return
  await Taro.request({
    url: `${getApiBase()}/api/live/session/transcript`,
    method: 'POST',
    data: {
      sessionId,
      text,
      questionId: meta?.questionId || '',
      question: meta?.question || ''
    }
  })
}

export type PreparedFollowUpResult =
  | { status: 'ready'; question: InterviewQuestion }
  | { status: 'pending' | 'none' | 'skipped' | 'error'; question?: undefined }

export type InterviewFollowUpConfig = {
  enabled: boolean
  maxPerInterview: number
  maxPerQuestion: number
  modelWaitMs: number
  shortAnswerThreshold: number
  fallbackEnabled: boolean
  demoMode?: boolean
  model?: string
  prompt?: string
}

export const DEFAULT_INTERVIEW_FOLLOW_UP_CONFIG: InterviewFollowUpConfig = {
  enabled: true,
  maxPerInterview: 3,
  maxPerQuestion: 1,
  modelWaitMs: 700,
  shortAnswerThreshold: 18,
  fallbackEnabled: true,
  demoMode: false
}

export async function fetchInterviewFollowUpConfig(jobId: string, sessionId?: string): Promise<InterviewFollowUpConfig> {
  if (useMock() || (!jobId && !sessionId)) return DEFAULT_INTERVIEW_FOLLOW_UP_CONFIG
  const res = await Taro.request<{ data?: Partial<InterviewFollowUpConfig>; message?: string }>({
    url: `${getApiBase()}/api/candidate/interview-followup-config`,
    method: 'GET',
    data: { jobId, sessionId: sessionId || '' }
  })
  if (res.statusCode >= 400) return DEFAULT_INTERVIEW_FOLLOW_UP_CONFIG
  return {
    ...DEFAULT_INTERVIEW_FOLLOW_UP_CONFIG,
    ...(res.data?.data || {})
  }
}

export async function fetchPreparedFollowUp(params: {
  sessionId: string
  questionId: string
  waitMs?: number
  requireModel?: boolean
}): Promise<PreparedFollowUpResult> {
  if (useMock() || !params.sessionId || !params.questionId) return { status: 'none' }
  const res = await Taro.request<{ data?: PreparedFollowUpResult; message?: string }>({
    url: `${getApiBase()}/api/live/session/follow-up`,
    method: 'GET',
    data: {
      sessionId: params.sessionId,
      questionId: params.questionId,
      waitMs: params.waitMs || 0,
      requireModel: params.requireModel ? '1' : ''
    }
  })
  if (res.statusCode >= 400) return { status: 'error' }
  return res.data?.data || { status: 'none' }
}

/** TRTC 旁路信令：字幕写入服务端，监考端可轮询 session/state */
export async function syncTrtcRoomSignal(sessionId: string, text: string, kind = 'subtitle') {
  if (useMock() || !sessionId || !text.trim()) return
  try {
    await Taro.request({
      url: `${getApiBase()}/api/live/session/trtc-signal`,
      method: 'POST',
      data: { sessionId, text, kind }
    })
  } catch {
    /* 会话未创建等 */
  }
}

/** 拉取 TRTC 进房凭证；未配置时服务端返回 503，调用方应回退本地 Camera */
export async function fetchTrtcCredential(params: {
  sessionId: string
  userId: string
}): Promise<TrtcCredential | null> {
  if (useMock()) return null
  const res = await Taro.request<{ data?: TrtcCredential; message?: string }>({
    url: `${getApiBase()}/api/candidate/trtc/credential`,
    method: 'POST',
    data: { sessionId: params.sessionId, userId: params.userId }
  })
  if (res.statusCode === 503) return null
  if (res.statusCode >= 400 || !res.data?.data) {
    throw new Error(res.data?.message || 'TRTC 凭证获取失败')
  }
  return res.data.data
}

export async function uploadAsrSegment(params: {
  filePath: string
  sessionId: string
  questionId: string
  segmentIndex: number
}): Promise<string> {
  if (useMock()) return ''
  const res = await Taro.uploadFile({
    url: `${getApiBase()}/api/candidate/ai-interview/asr`,
    filePath: params.filePath,
    name: 'file',
    formData: {
      sessionId: params.sessionId,
      questionId: params.questionId,
      segmentIndex: String(params.segmentIndex)
    }
  })
  let body: { data?: { text?: string }; message?: string } = {}
  try {
    body = JSON.parse((res.data as string) || '{}') as typeof body
  } catch {
    body = {}
  }
  if (res.statusCode >= 400) {
    throw new Error(body?.message || '语音识别失败')
  }
  return String(body?.data?.text || '').trim()
}

export async function syncLiveQa(params: {
  sessionId: string
  questionId: string
  question: string
  answer: string
}) {
  if (useMock()) return
  await Taro.request({
    url: `${getApiBase()}/api/live/session/qa`,
    method: 'POST',
    data: params
  })
}

export type LiveSessionState = {
  sessionId: string
  jobId?: string
  jobTitle?: string
  department?: string
  candidateOpenId?: string
  interviewerOpenId?: string
  voipStatus?: string
  questions: { id: string; text: string }[]
  transcript: { ts: number; text: string }[]
  qa: { questionId: string; question: string; answer: string }[]
  /** 候选人经 /trtc-signal 上报的字幕/信令时间线 */
  trtcSignals?: { ts: number; text: string; kind?: string }[]
}

export type LiveSessionSummary = {
  sessionId: string
  candidateOpenId: string
  interviewerOpenId: string
  voipStatus?: string
  status: string
  updatedAt: string
  jobId: string
  jobTitle: string
  department: string
}

export type InterviewerInvitation = {
  inviteCode: string
  inviteStatus: 'pending' | 'accepted' | 'expired' | 'cancelled'
  expiresAt?: string
  jobId: string
  jobTitle: string
  department: string
  candidatePhone?: string
  candidateName?: string
  sessionId?: string
}

export async function fetchInterviewerInvitations(openid: string): Promise<InterviewerInvitation[]> {
  if (useMock()) return []
  const res = await Taro.request<{ data: InterviewerInvitation[] }>({
    url: `${getApiBase()}/api/interviewer/invitations`,
    method: 'GET',
    data: { openid }
  })
  if (res.statusCode >= 400 || !Array.isArray(res.data?.data)) {
    throw new Error('拉取邀请列表失败')
  }
  return res.data.data
}

export async function fetchInterviewerLiveSessions(): Promise<LiveSessionSummary[]> {
  if (useMock()) return []
  const res = await Taro.request<{ data: LiveSessionSummary[] }>({
    url: `${getApiBase()}/api/interviewer/live-sessions`,
    method: 'GET'
  })
  if (res.statusCode >= 400 || !Array.isArray(res.data?.data)) {
    throw new Error('拉取面试列表失败')
  }
  return res.data.data
}

export async function getLiveSessionState(sessionId: string): Promise<LiveSessionState> {
  if (useMock()) {
    return {
      sessionId,
      candidateOpenId: '',
      interviewerOpenId: '',
      questions: [],
      transcript: [],
      qa: [],
      trtcSignals: []
    }
  }
  const res = await Taro.request<{ data: LiveSessionState }>({
    url: `${getApiBase()}/api/live/session/state`,
    method: 'GET',
    data: { sessionId }
  })
  if (res.statusCode >= 400 || !res.data?.data) {
    throw new Error('会话不存在')
  }
  return res.data.data
}

export async function bindSessionMember(params: {
  sessionId: string
  role: 'candidate' | 'interviewer'
  openid: string
}) {
  if (useMock()) return
  await Taro.request({
    url: `${getApiBase()}/api/live/session/bind-members`,
    method: 'POST',
    data: params
  })
}

export async function requestVideoInterview(sessionId: string) {
  if (useMock()) return
  await Taro.request({
    url: `${getApiBase()}/api/live/session/request-video`,
    method: 'POST',
    data: { sessionId }
  })
}

export async function acceptVideoInterview(sessionId: string) {
  if (useMock()) return
  await Taro.request({
    url: `${getApiBase()}/api/live/session/accept-video`,
    method: 'POST',
    data: { sessionId }
  })
}
