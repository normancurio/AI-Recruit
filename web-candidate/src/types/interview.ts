export interface CandidateProfile {
  name: string
  phone?: string
  inviteCode: string
  openid?: string
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
