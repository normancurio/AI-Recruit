import type { CandidateProfile, JobInfo } from '../types/interview'
import type { TrtcCredential } from '../types/trtc'

const KEYS = {
  openid: 'wx_openid',
  sessionId: 'session_id',
  profile: 'candidate_profile',
  job: 'candidate_job',
  trtc: 'trtc_credential',
  questionsPrefetch: 'interview_questions_prefetch_v1'
} as const

export function getOpenId(): string {
  return localStorage.getItem(KEYS.openid) || ''
}

export function setOpenId(v: string) {
  localStorage.setItem(KEYS.openid, v)
}

export function getSessionId(): string {
  return localStorage.getItem(KEYS.sessionId) || ''
}

export function setSessionId(v: string) {
  localStorage.setItem(KEYS.sessionId, v)
}

export function getProfile(): CandidateProfile | null {
  try {
    const raw = localStorage.getItem(KEYS.profile)
    return raw ? (JSON.parse(raw) as CandidateProfile) : null
  } catch {
    return null
  }
}

export function setProfile(p: CandidateProfile) {
  localStorage.setItem(KEYS.profile, JSON.stringify(p))
}

export function getJob(): JobInfo | null {
  try {
    const raw = localStorage.getItem(KEYS.job)
    return raw ? (JSON.parse(raw) as JobInfo) : null
  } catch {
    return null
  }
}

export function setJob(j: JobInfo) {
  localStorage.setItem(KEYS.job, JSON.stringify(j))
}

export function getTrtcCredential(): TrtcCredential | null {
  try {
    const raw = localStorage.getItem(KEYS.trtc)
    return raw ? (JSON.parse(raw) as TrtcCredential) : null
  } catch {
    return null
  }
}

export function setTrtcCredential(c: TrtcCredential | null) {
  if (!c) {
    localStorage.removeItem(KEYS.trtc)
    return
  }
  localStorage.setItem(KEYS.trtc, JSON.stringify(c))
}

export function clearSession() {
  localStorage.removeItem(KEYS.profile)
  localStorage.removeItem(KEYS.job)
  localStorage.removeItem(KEYS.trtc)
  localStorage.removeItem('interview_result')
}

export function getQuestionsPrefetchKey() {
  return KEYS.questionsPrefetch
}
