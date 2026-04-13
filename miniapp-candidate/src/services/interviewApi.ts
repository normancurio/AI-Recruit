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

export async function fetchInterviewQuestions(
  jobId: string,
  candidateName?: string,
  resumeScreeningId?: number
): Promise<InterviewQuestion[]> {
  if (useMock()) {
    throw new Error(
      '面试题由服务端大模型实时生成：请配置 TARO_APP_API_BASE 并确保后端已设置 DASHSCOPE_API_KEY'
    )
  }

  const res = await Taro.request<{ data: InterviewQuestion[]; message?: string }>({
    url: `${getApiBase()}/api/candidate/interview-questions`,
    method: 'GET',
    data: {
      jobId,
      candidateName: candidateName?.trim() || '',
      ...(typeof resumeScreeningId === 'number' && resumeScreeningId > 0 ? { resumeScreeningId } : {})
    }
  })

  if (res.statusCode >= 400 || !Array.isArray(res.data?.data)) {
    throw new Error(res.data?.message || `拉取题目失败（HTTP ${res.statusCode}）`)
  }
  return res.data.data
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
    data: { profile, jobId, answers, sessionId: sessionId || '' }
  })

  if (res.statusCode >= 400 || !res.data?.data) {
    throw new Error('提交面试失败')
  }
  return res.data.data
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

export async function syncLiveTranscript(sessionId: string, text: string) {
  if (useMock() || !text.trim()) return
  await Taro.request({
    url: `${getApiBase()}/api/live/session/transcript`,
    method: 'POST',
    data: { sessionId, text }
  })
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
