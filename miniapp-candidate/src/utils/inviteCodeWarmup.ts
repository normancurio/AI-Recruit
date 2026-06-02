/** 从邀请码解析岗位码（及可选筛查 id），供登录页静默预热出题。 */
export function parseInviteForWarmup(
  inviteCode: string
): { jobId: string; resumeScreeningId?: number } | null {
  const code = inviteCode.trim().toUpperCase()
  if (code.length < 4 || code.length > 128) return null
  if (!/^[A-Z0-9_.@-]+$/.test(code)) return null

  const parts = code.split('-').filter(Boolean)
  const jobId = String(parts[0] || code).trim()
  if (jobId.length < 2) return null

  let resumeScreeningId: number | undefined
  if (parts.length >= 3) {
    const last = parts[parts.length - 1]
    const n = Number(last)
    if (Number.isFinite(n) && n > 0) resumeScreeningId = Math.floor(n)
  }

  return { jobId, resumeScreeningId }
}

export function canStartInviteWarmup(inviteCode: string): boolean {
  return Boolean(parseInviteForWarmup(inviteCode))
}
