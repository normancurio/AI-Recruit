function normalizeText(v: string) {
  return String(v || '')
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
    .toLowerCase()
}

function longestCommonSubstringLen(a: string, b: string) {
  if (!a || !b) return 0
  const prev = new Array(b.length + 1).fill(0)
  let best = 0
  for (let i = 1; i <= a.length; i += 1) {
    let lastDiag = 0
    for (let j = 1; j <= b.length; j += 1) {
      const saved = prev[j]
      if (a[i - 1] === b[j - 1]) {
        prev[j] = lastDiag + 1
        if (prev[j] > best) best = prev[j]
      } else {
        prev[j] = 0
      }
      lastDiag = saved
    }
  }
  return best
}

/** 过滤读题回声被误写入回答（对齐小程序面试页逻辑） */
export function shouldDropQuestionEcho(params: {
  raw: string
  questionText: string
  answerOpenedAt: number
  /** 追问题干会复述候选人刚答内容，不宜对全句做子串过滤 */
  isFollowUp?: boolean
}): boolean {
  const t = normalizeText(params.raw)
  if (!t || t.length < 6) return false
  const q = normalizeText(params.questionText)
  if (!q || q.length < 6) return false
  const sinceOpen = Date.now() - params.answerOpenedAt
  if (params.isFollowUp) {
    if (sinceOpen >= 0 && sinceOpen < 2200) {
      const common = longestCommonSubstringLen(t, q)
      const coverage = common / Math.max(1, Math.min(t.length, q.length))
      if (common >= 12 && coverage >= 0.78) return true
    }
    return false
  }
  if (sinceOpen >= 0 && sinceOpen < 1800) {
    const common = longestCommonSubstringLen(t, q)
    const coverage = common / Math.max(1, Math.min(t.length, q.length))
    if (common >= 8 && coverage >= 0.55) return true
  }
  if (q.includes(t)) return true
  if (t.includes(q)) return true
  if (t.length >= 12 && q.includes(t.slice(0, 12))) return true
  if (t.length >= 12 && q.includes(t.slice(-12))) return true
  if (t.length > 20 && t.includes(q.slice(0, 20))) return true
  return false
}
