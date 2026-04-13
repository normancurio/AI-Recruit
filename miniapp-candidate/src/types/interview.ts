export interface CandidateProfile {
  name: string
  /** 可选；未绑定时可为空字符串 */
  phone?: string
  inviteCode: string
  openid?: string
  /** HR 邀请绑定的 resume_screenings.id；有则服务端按该条取简历出题 */
  resumeScreeningId?: number
}

export interface JobInfo {
  id: string
  title: string
  department: string
}

export interface InterviewQuestion {
  id: string
  text: string
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
