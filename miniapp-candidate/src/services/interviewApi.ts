import Taro from '@tarojs/taro'
import { API_BASE } from '../config/apiBase'
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

const MOCK_QUESTIONS: InterviewQuestion[] = [
  { id: 'Q1', text: '请介绍一个你参与过的前端项目，并说明你的核心贡献。' },
  { id: 'Q2', text: '你如何理解浏览器渲染流程？性能优化通常会从哪些点切入？' },
  { id: 'Q3', text: '遇到跨端兼容问题时，你会如何排查和制定修复方案？' }
]

function useMock() {
  return !API_BASE
}

export async function validateInviteCode(code: string): Promise<JobInfo> {
  const normalized = code.trim().toUpperCase()
  if (useMock()) {
    const job = MOCK_JOBS[normalized]
    if (!job) throw new Error('无效邀请码')
    return job
  }

  const res = await Taro.request<{ data: JobInfo }>({
    url: `${API_BASE}/api/candidate/validate-invite`,
    method: 'POST',
    data: { inviteCode: normalized }
  })

  if (res.statusCode >= 400 || !res.data?.data) {
    throw new Error('邀请码校验失败')
  }
  return res.data.data
}

export async function fetchInterviewQuestions(jobId: string): Promise<InterviewQuestion[]> {
  if (useMock()) return MOCK_QUESTIONS

  const res = await Taro.request<{ data: InterviewQuestion[] }>({
    url: `${API_BASE}/api/candidate/interview-questions`,
    method: 'GET',
    data: { jobId }
  })

  if (res.statusCode >= 400 || !Array.isArray(res.data?.data)) {
    throw new Error('拉取题目失败')
  }
  return res.data.data
}

export async function submitInterview(
  profile: CandidateProfile,
  jobId: string,
  answers: InterviewAnswer[]
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
    url: `${API_BASE}/api/candidate/submit-interview`,
    method: 'POST',
    data: { profile, jobId, answers }
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
    url: `${API_BASE}/api/live/session/start`,
    method: 'POST',
    data: params
  })
}

export async function syncLiveTranscript(sessionId: string, text: string) {
  if (useMock() || !text.trim()) return
  await Taro.request({
    url: `${API_BASE}/api/live/session/transcript`,
    method: 'POST',
    data: { sessionId, text }
  })
}

export async function syncLiveQa(params: {
  sessionId: string
  questionId: string
  question: string
  answer: string
}) {
  if (useMock()) return
  await Taro.request({
    url: `${API_BASE}/api/live/session/qa`,
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
  questions: { id: string; text: string }[]
  transcript: { ts: number; text: string }[]
  qa: { questionId: string; question: string; answer: string }[]
}

export type LiveSessionSummary = {
  sessionId: string
  candidateOpenId: string
  interviewerOpenId: string
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
    url: `${API_BASE}/api/interviewer/invitations`,
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
    url: `${API_BASE}/api/interviewer/live-sessions`,
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
      qa: []
    }
  }
  const res = await Taro.request<{ data: LiveSessionState }>({
    url: `${API_BASE}/api/live/session/state`,
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
    url: `${API_BASE}/api/live/session/bind-members`,
    method: 'POST',
    data: params
  })
}
