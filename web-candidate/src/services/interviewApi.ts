import { apiGetData, apiPostData, apiUrl, getApiBase } from '../config/api'
import type {
  CandidateProfile,
  InterviewAnswer,
  InterviewQuestion,
  InterviewResult,
  JobInfo
} from '../types/interview'
import type { TrtcCredential } from '../types/trtc'
import { getQuestionsPrefetchKey } from '../utils/storage'

export type LoginInviteResult = {
  openid: string
  sessionId: string
  name: string
  job: JobInfo
  trtc?: TrtcCredential | null
  resumeScreeningId?: number | null
}

export type InterviewFollowUpConfig = {
  enabled: boolean
  maxPerInterview: number
  maxPerQuestion: number
  modelWaitMs: number
  shortAnswerThreshold: number
  fallbackEnabled: boolean
  demoMode?: boolean
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

export type PreparedFollowUpResult =
  | { status: 'ready'; question: InterviewQuestion }
  | { status: 'pending' | 'none' | 'skipped' | 'error'; question?: undefined }

function cacheKeyForQuestions(jobId: string, candidateName: string, resumeScreeningId?: number) {
  const rs =
    typeof resumeScreeningId === 'number' && resumeScreeningId > 0 ? String(resumeScreeningId) : ''
  return `${String(jobId).trim().toUpperCase()}\t${String(candidateName).trim()}\t${rs}`
}

const inflightQuestions = new Map<string, Promise<InterviewQuestion[]>>()
const resolvedQuestionsMemory = new Map<string, InterviewQuestion[]>()

export async function loginWithInviteCodeH5(params: {
  inviteCode: string
  name: string
  phone: string
}): Promise<LoginInviteResult> {
  return apiPostData<LoginInviteResult>('/api/candidate/login-invite-h5', {
    inviteCode: params.inviteCode.trim().toUpperCase(),
    name: params.name.trim(),
    phone: params.phone.trim()
  })
}

export async function fetchInterviewQuestions(
  jobId: string,
  candidateName?: string,
  resumeScreeningId?: number
): Promise<InterviewQuestion[]> {
  if (!getApiBase() && !import.meta.env.DEV) {
    throw new Error('请配置 VITE_API_BASE 或确保开发代理可用')
  }
  const query: Record<string, string | number> = {
    jobId,
    candidateName: candidateName?.trim() || ''
  }
  if (typeof resumeScreeningId === 'number' && resumeScreeningId > 0) {
    query.resumeScreeningId = resumeScreeningId
  }
  return apiGetData<InterviewQuestion[]>('/api/candidate/interview-questions', query)
}

export function prefetchInterviewQuestions(
  jobId: string,
  candidateName?: string,
  resumeScreeningId?: number
): void {
  const key = cacheKeyForQuestions(jobId, String(candidateName || ''), resumeScreeningId)
  if (inflightQuestions.has(key)) return
  const p = fetchInterviewQuestions(jobId, candidateName, resumeScreeningId).then((questions) => {
    resolvedQuestionsMemory.set(key, questions)
    try {
      localStorage.setItem(
        getQuestionsPrefetchKey(),
        JSON.stringify({ cacheKey: key, questions, at: Date.now() })
      )
    } catch {
      /* ignore */
    }
    return questions
  })
  inflightQuestions.set(key, p)
  p.finally(() => inflightQuestions.delete(key))
}

export async function fetchInterviewQuestionsOrPrefetched(
  jobId: string,
  candidateName?: string,
  resumeScreeningId?: number
): Promise<InterviewQuestion[]> {
  const key = cacheKeyForQuestions(jobId, String(candidateName || ''), resumeScreeningId)
  try {
    const raw = localStorage.getItem(getQuestionsPrefetchKey())
    if (raw) {
      const parsed = JSON.parse(raw) as { cacheKey?: string; questions?: InterviewQuestion[] }
      if (parsed.cacheKey === key && Array.isArray(parsed.questions) && parsed.questions.length) {
        localStorage.removeItem(getQuestionsPrefetchKey())
        resolvedQuestionsMemory.delete(key)
        return parsed.questions
      }
    }
  } catch {
    /* ignore */
  }
  const mem = resolvedQuestionsMemory.get(key)
  if (mem?.length) {
    resolvedQuestionsMemory.delete(key)
    return mem
  }
  const inflight = inflightQuestions.get(key)
  if (inflight) {
    const got = await inflight.catch(() => null)
    if (got?.length) return got
  }
  return fetchInterviewQuestions(jobId, candidateName, resumeScreeningId)
}

export async function startLiveSession(params: {
  sessionId: string
  jobId: string
  candidateName: string
  candidateOpenId?: string
  questions: InterviewQuestion[]
}) {
  await apiPostData<unknown>('/api/live/session/start', params)
}

export async function bindSessionMember(params: {
  sessionId: string
  role: 'candidate' | 'interviewer'
  openid: string
}) {
  await apiPostData<unknown>('/api/live/session/bind-members', params)
}

export async function syncLiveTranscript(
  sessionId: string,
  text: string,
  meta?: { questionId?: string; question?: string }
) {
  if (!text.trim()) return
  await apiPostData<unknown>('/api/live/session/transcript', {
    sessionId,
    text,
    questionId: meta?.questionId || '',
    question: meta?.question || ''
  })
}

/** TRTC 旁路信令：监考端轮询 session/state 可见字幕轨迹 */
export async function syncTrtcRoomSignal(sessionId: string, text: string, kind = 'subtitle') {
  if (!sessionId || !text.trim()) return
  try {
    await apiPostData<unknown>('/api/live/session/trtc-signal', { sessionId, text, kind })
  } catch {
    /* 会话未创建等 */
  }
}

export async function fetchTrtcCredential(params: {
  sessionId: string
  userId: string
}): Promise<TrtcCredential | null> {
  const res = await fetch(apiUrl('/api/candidate/trtc/credential'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: params.sessionId, userId: params.userId })
  })
  let body: { data?: TrtcCredential; message?: string } = {}
  try {
    body = (await res.json()) as typeof body
  } catch {
    body = {}
  }
  if (res.status === 503) return null
  if (!res.ok) {
    throw new Error(body?.message || `TRTC 凭证获取失败（HTTP ${res.status}）`)
  }
  if (!body.data?.sdkAppId || !body.data.userSig) return null
  return body.data
}

export async function syncLiveQa(params: {
  sessionId: string
  questionId: string
  question: string
  answer: string
}) {
  await apiPostData<unknown>('/api/live/session/qa', params)
}

export async function fetchInterviewFollowUpConfig(
  jobId: string,
  sessionId?: string
): Promise<InterviewFollowUpConfig> {
  try {
    const data = await apiGetData<Partial<InterviewFollowUpConfig>>(
      '/api/candidate/interview-followup-config',
      { jobId, sessionId: sessionId || '' }
    )
    return { ...DEFAULT_INTERVIEW_FOLLOW_UP_CONFIG, ...data }
  } catch {
    return DEFAULT_INTERVIEW_FOLLOW_UP_CONFIG
  }
}

export async function fetchPreparedFollowUp(params: {
  sessionId: string
  questionId: string
  waitMs?: number
}): Promise<PreparedFollowUpResult> {
  if (!params.sessionId || !params.questionId) return { status: 'none' }
  try {
    return await apiGetData<PreparedFollowUpResult>('/api/live/session/follow-up', {
      sessionId: params.sessionId,
      questionId: params.questionId,
      waitMs: params.waitMs || 0
    })
  } catch {
    return { status: 'error' }
  }
}

export async function submitInterview(
  profile: CandidateProfile,
  jobId: string,
  answers: InterviewAnswer[],
  sessionId?: string
): Promise<InterviewResult> {
  return apiPostData<InterviewResult>('/api/candidate/submit-interview', {
    profile,
    jobId,
    answers,
    sessionId: sessionId || ''
  })
}
