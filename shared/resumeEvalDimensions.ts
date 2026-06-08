import type { ResumeEvalJobType } from './resumeEvalPrompt'

export type ResumeEvalDimEntry = { score: number; evidence: string[] }

export const RESUME_EVAL_DIMENSION_WEIGHTS: Record<string, number> = {
  risk_fit: 25,
  tech_fit: 25,
  depth: 20,
  engineering_depth: 20,
  impact: 20,
  data_skill: 15,
  code_quality: 15,
  stability_growth: 10,
  education_fit: 10,
  /** @deprecated 旧版六维，与新记录 education_fit 二选一 */
  communication_business: 10
}

function clampScore(n: unknown): number {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(100, Math.round(x)))
}

function weightedDimScore(
  dim: Record<string, ResumeEvalDimEntry>,
  keys: Array<[string, number]>
): number | null {
  let sum = 0
  let totalWeight = 0
  for (const [key, weight] of keys) {
    const score = dim[key]?.score
    if (!Number.isFinite(Number(score))) continue
    sum += clampScore(score) * weight
    totalWeight += weight
  }
  if (totalWeight <= 0) return null
  return clampScore(sum / totalWeight)
}

/** 从 profile / 正文推断学历匹配分（供 education_fit 缺失时写入四维「学历」列） */
export function inferEducationFitScore(profile: Record<string, unknown> | undefined, resumePlain: string): number | null {
  const edu = String(profile?.education || profile?.['学历'] || '').trim()
  const head = String(resumePlain || '').slice(0, 4000)
  const blob = `${edu} ${head}`
  if (/博士|Ph\.?\s*D|Doctor/i.test(blob)) return 92
  if (/硕士|研究生|Master|M\.?Sc|M\.?A/i.test(blob)) return 85
  if (/本科|学士|Bachelor|统招/i.test(blob)) return 78
  if (/大专|专科|高职|Associate/i.test(blob)) return 65
  if (/高中|中专|职高|中职/i.test(blob)) return 50
  if (/大学|学院/.test(blob) && /本科|学士/.test(blob)) return 78
  return null
}

function resolveEducationColumnScore(
  dim: Record<string, ResumeEvalDimEntry>,
  profile: Record<string, unknown> | undefined,
  resumePlain: string
): number {
  const fromDim = firstFinite(
    dim.education_fit?.score,
    dim.communication_business?.score
  )
  if (fromDim != null) return clampScore(fromDim)
  return clampScore(inferEducationFitScore(profile, resumePlain) ?? 70)
}

function firstFinite(...vals: unknown[]): number | null {
  for (const v of vals) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

/** 六维 AI 分 → 库表四维（申朴画像仍读这四列，仅改善映射语义） */
export function mapEvalDimensionsToLegacyScores(params: {
  dim: Record<string, ResumeEvalDimEntry>
  jobType: ResumeEvalJobType
  profile?: Record<string, unknown>
  resumePlain?: string
  fallbackOverall?: number
}): {
  skillScore: number
  experienceScore: number
  educationScore: number
  stabilityScore: number
} {
  const { dim, jobType, profile, resumePlain = '' } = params
  const overall = clampScore(params.fallbackOverall ?? 0)

  const fallback = {
    skillScore: clampScore(overall + 7),
    experienceScore: clampScore(overall + 2),
    educationScore: clampScore(overall + 10),
    stabilityScore: clampScore(overall - 12)
  }

  if (jobType === 'risk_ops') {
    return {
      skillScore:
        weightedDimScore(dim, [
          ['risk_fit', 13],
          ['data_skill', 7]
        ]) ?? fallback.skillScore,
      experienceScore:
        weightedDimScore(dim, [
          ['depth', 11],
          ['impact', 9]
        ]) ?? fallback.experienceScore,
      educationScore: resolveEducationColumnScore(dim, profile, resumePlain),
      stabilityScore: clampScore(dim.stability_growth?.score ?? fallback.stabilityScore)
    }
  }

  return {
    skillScore:
      weightedDimScore(dim, [
        ['tech_fit', 15],
        ['code_quality', 10]
      ]) ?? fallback.skillScore,
    experienceScore:
      weightedDimScore(dim, [
        ['engineering_depth', 11],
        ['impact', 9]
      ]) ?? fallback.experienceScore,
    educationScore: resolveEducationColumnScore(dim, profile, resumePlain),
    stabilityScore: clampScore(dim.stability_growth?.score ?? fallback.stabilityScore)
  }
}

export function weightedResumeEvalDimensionScore(
  dim: Record<string, ResumeEvalDimEntry>
): number | null {
  let sum = 0
  let totalWeight = 0
  for (const [key, value] of Object.entries(dim)) {
    const weight = RESUME_EVAL_DIMENSION_WEIGHTS[key] || 0
    if (!weight) continue
    const score = Number(value?.score)
    if (!Number.isFinite(score)) continue
    sum += clampScore(score) * weight
    totalWeight += weight
  }
  if (totalWeight <= 0) return null
  return clampScore(sum / totalWeight)
}

function looksLikeKeywordStack(text: string): boolean {
  const skillsBlock = text.match(/(?:技能|技术栈|专业技能)[^\n]{0,200}/i)?.[0] || ''
  const target = skillsBlock || text.slice(0, 1200)
  const tokens = target.split(/[,，、/|\s]+/).filter((t) => t.length >= 2)
  const projectVerbs = /负责|主导|参与|项目|系统|模块|优化|开发|设计/.test(target)
  return tokens.length >= 8 && !projectVerbs
}

/** 按 prompt 约束对维度分做服务端 clamp（模型不一定遵守） */
export function applyResumeEvalDimensionCaps(
  dim: Record<string, ResumeEvalDimEntry>,
  jobType: ResumeEvalJobType,
  resumePlain: string
): Record<string, ResumeEvalDimEntry> {
  const plain = String(resumePlain || '')
  const hasQuant = /\d{1,3}%/.test(plain) || /(?:提升|降低|减少|提高)[^。\n]{0,12}\d/.test(plain)
  const hasSqlData = /sql|hive|spark|etl|kettle|数据仓库|数仓|bi|doris|flink/i.test(plain)
  const hasComplexProject = /架构|核心模块|主导|负责.{0,8}(?:系统|平台|项目)|0到1|从0到1/i.test(plain)
  const hasRiskScene = /风控|反欺诈|信贷|策略运营|规则配置|交易风控/i.test(plain)

  const out: Record<string, ResumeEvalDimEntry> = {}
  for (const [k, v] of Object.entries(dim)) {
    out[k] = { score: v.score, evidence: [...(v.evidence || [])] }
  }

  const cap = (key: string, max: number) => {
    if (!out[key]) return
    out[key] = { ...out[key], score: Math.min(out[key].score, max) }
  }

  if (jobType === 'engineering') {
    if (!hasComplexProject) cap('engineering_depth', 70)
    if (!hasQuant) cap('impact', 75)
    if (looksLikeKeywordStack(plain)) cap('tech_fit', 65)
  } else {
    if (!hasQuant) cap('impact', 70)
    if (!hasSqlData) cap('data_skill', 65)
    if (!hasRiskScene) cap('risk_fit', 60)
  }
  return out
}
