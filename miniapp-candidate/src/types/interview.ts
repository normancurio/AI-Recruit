export interface CandidateProfile {
  name: string
  phone: string
  inviteCode: string
  openid?: string
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
}
