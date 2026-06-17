export type ResumeEvalRiskItem = { risk: string; interview_question: string }

const SYNTHETIC_DIMENSION_EVIDENCE_RE = /模型未返回该维度证据|请结合简历原文与JD人工复核/

const RISK_LACK_RE = /缺乏|没有|未见|未体现|缺少|未明确|无明确|未提及|未涉及/
const RISK_TERM_STOP_RE =
  /^(缺乏|没有|经验|背景|模块|业务|能力|明确|相关|特定|银行|金融|市场|岗位|候选人|简历|等|及|与|和|的|如|例如|包括|涉及)$/

function normalizeResumeMatchText(text: string): string {
  return String(text || '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/** 从「缺乏…如 A、B、C」类风险句里提取可能被简历反驳的关键词 */
export function extractTermsMentionedInResumeRisk(risk: string): string[] {
  const terms: string[] = []
  const examples = risk.match(/(?:如|例如|包括|涉及)[:：]?[^。；]+/g) || []
  for (const block of examples) {
    const cleaned = block.replace(/^(?:如|例如|包括|涉及)[:：]?\s*/, '')
    for (const part of cleaned.split(/[、，,/|]+/)) {
      const t = part
        .trim()
        .replace(/[等\.…].*$/, '')
        .replace(/[（(].*[）)]/g, '')
        .trim()
      if (t.length >= 2 && !RISK_TERM_STOP_RE.test(t)) terms.push(t)
    }
  }
  const direct =
    risk.match(/[\u4e00-\u9fff]{2,10}(?:买卖|衍生|租赁|期权|交易|系统|模块|业务|平台|开发|工程)/g) || []
  for (const t of direct) {
    if (!RISK_LACK_RE.test(t)) terms.push(t)
  }
  return [...new Set(terms.map((t) => t.trim()).filter(Boolean))]
}

export function riskContradictsResume(risk: string, resumePlain: string): boolean {
  const resume = normalizeResumeMatchText(resumePlain)
  if (!resume || !RISK_LACK_RE.test(risk)) return false
  const terms = extractTermsMentionedInResumeRisk(risk)
  if (!terms.length) return false
  return terms.some((term) => {
    const norm = normalizeResumeMatchText(term)
    return norm.length >= 2 && resume.includes(norm)
  })
}

export function filterContradictoryResumeRisks(
  risks: ResumeEvalRiskItem[],
  resumePlain?: string
): ResumeEvalRiskItem[] {
  const plain = String(resumePlain || '').trim()
  if (!plain || !risks.length) return risks
  return risks.filter((item) => !riskContradictsResume(item.risk, plain))
}

function extractExcerptFromEvidence(evidence: string): string {
  const s = String(evidence || '').trim()
  const m = s.match(/摘录[:：](.+)$/)
  return (m?.[1] || s).trim()
}

/** 维度 evidence 中的「摘录」是否能在简历正文找到支撑（OCR/空格差异时做宽松匹配） */
export function evidenceSupportedByResume(evidence: string, resumePlain: string): boolean {
  const resume = normalizeResumeMatchText(resumePlain)
  if (!resume) return true
  const excerpt = extractExcerptFromEvidence(evidence)
  const norm = normalizeResumeMatchText(excerpt)
  if (norm.length < 4) return true
  if (resume.includes(norm)) return true
  const probe = norm.slice(0, Math.min(16, norm.length))
  if (probe.length >= 4 && resume.includes(probe)) return true
  if (norm.length >= 8) {
    const chunks: string[] = []
    for (let i = 0; i + 1 < norm.length; i += 2) chunks.push(norm.slice(i, i + 2))
    if (chunks.length >= 4) {
      const hit = chunks.filter((c) => resume.includes(c)).length
      if (hit / chunks.length >= 0.55) return true
    }
  }
  return false
}

export function isSyntheticDimensionEvidence(evidence: string): boolean {
  return SYNTHETIC_DIMENSION_EVIDENCE_RE.test(String(evidence || ''))
}

export function sanitizeDimensionEvidenceList(evidence: string[], resumePlain?: string): string[] {
  const plain = String(resumePlain || '').trim()
  const withoutSynthetic = evidence
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .filter((line) => !isSyntheticDimensionEvidence(line))
  if (!withoutSynthetic.length) return []
  if (!plain) return withoutSynthetic
  const kept = withoutSynthetic.filter((line) => evidenceSupportedByResume(line, plain))
  if (kept.length) return kept
  // 模型摘录与 OCR 正文略有偏差时保留原文，避免重新评估后维度评语全空
  return withoutSynthetic.slice(0, 2)
}

export function sanitizeDimensionScoresEvidence(
  dim: Record<string, { score: number; evidence: string[] }>,
  resumePlain?: string
): Record<string, { score: number; evidence: string[] }> {
  const plain = String(resumePlain || '').trim()
  if (!plain) return dim
  const out: Record<string, { score: number; evidence: string[] }> = {}
  for (const [k, v] of Object.entries(dim)) {
    out[k] = {
      score: v.score,
      evidence: sanitizeDimensionEvidenceList(v.evidence || [], plain)
    }
  }
  return out
}
