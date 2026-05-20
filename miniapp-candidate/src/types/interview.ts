export interface CandidateProfile {
  name: string
  /** 可选；未绑定时可为空字符串 */
  phone?: string
  inviteCode: string
  openid?: string
  /** HR 邀请绑定的 resume_screenings.id；有则服务端按该条取简历出题 */
  resumeScreeningId?: number
  /** 当前登录使用的服务端会话 id；用于锁定本次邀请绑定的 AI 面试官模板 */
  sessionId?: string
}

export interface JobInfo {
  id: string
  title: string
  department: string
}

export interface InterviewQuestion {
  id: string
  text: string
  type?: 'main' | 'follow_up'
  parentQuestionId?: string
}

export interface InterviewAnswer {
  questionId: string
  question: string
  answer: string
}

export interface InterviewResult {
  score: number
  passed: boolean
  overallFeedback: string
  dimensionScores?: Record<string, number>
  suggestions?: string[]
  riskPoints?: string[]
  meta?: Record<string, unknown>
}
