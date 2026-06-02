import { flowLogInfo } from './flowLog'
import { preloadInterviewAssets } from './digitalHumanPreload'
import { canStartInviteWarmup, parseInviteForWarmup } from './inviteCodeWarmup'
import { prefetchInterviewWarmup } from './interviewWarmup'

const startedInviteKeys = new Set<string>()

/** 邀请码有效即触发：MP4/PNG 预载 + 快出 Q1 + 后台 Q2～Q6 + 首题 TTS */
export function triggerLoginWarmup(inviteCode: string, candidateName = ''): void {
  const code = inviteCode.trim().toUpperCase()
  if (!canStartInviteWarmup(code)) return
  const parsed = parseInviteForWarmup(code)
  if (!parsed?.jobId) return

  const dedupeKey = `${parsed.jobId}\t${code}`
  preloadInterviewAssets()
  if (startedInviteKeys.has(dedupeKey)) return
  startedInviteKeys.add(dedupeKey)

  flowLogInfo('登录页预热', `立即加载 job=${parsed.jobId}`)
  void prefetchInterviewWarmup({
    jobId: parsed.jobId,
    candidateName: candidateName.trim() || '候选人',
    inviteCode: code,
    resumeScreeningId: parsed.resumeScreeningId
  })
}
