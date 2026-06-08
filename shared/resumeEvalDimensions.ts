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
  if (fromDim != null && fromDim > 0) return clampScore(fromDim)
  return clampScore(inferEducationFitScore(profile, resumePlain) ?? 70)
}

function firstFinite(...vals: unknown[]): number | null {
  for (const v of vals) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

const ENGINEERING_DIM_KEYS = new Set(['tech_fit', 'code_quality', 'engineering_depth'])
const RISK_DIM_KEYS = new Set(['risk_fit', 'data_skill', 'depth'])

/** 从模型返回的 dimension_scores 键推断岗位维度体系 */
export function inferResumeEvalJobTypeFromDimensions(
  dim: Record<string, unknown>
): ResumeEvalJobType | null {
  const keys = Object.keys(dim || {})
  let eng = 0
  let risk = 0
  for (const k of keys) {
    if (ENGINEERING_DIM_KEYS.has(k)) eng++
    if (RISK_DIM_KEYS.has(k)) risk++
  }
  if (eng >= 2 && eng > risk) return 'engineering'
  if (risk >= 2 && risk > eng) return 'risk_ops'
  return null
}

/** 岗位上下文优先：不信模型 JSON 里的 job_type */
export function resolveResumeEvalJobType(params: {
  serverJobType: ResumeEvalJobType
  dim: Record<string, unknown>
}): ResumeEvalJobType {
  const fromDim = inferResumeEvalJobTypeFromDimensions(params.dim)
  if (fromDim && fromDim !== params.serverJobType) return params.serverJobType
  return params.serverJobType
}

function mergeDimEntries(
  a?: ResumeEvalDimEntry,
  b?: ResumeEvalDimEntry
): ResumeEvalDimEntry | undefined {
  if (!a && !b) return undefined
  const score = Math.max(Number(a?.score) || 0, Number(b?.score) || 0)
  const evidence = [...(a?.evidence || []), ...(b?.evidence || [])]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
  return {
    score: clampScore(score),
    evidence: [...new Set(evidence)].slice(0, 3)
  }
}

/** 模型返回了另一套维度键时，映射到当前岗位应有的六维（保留分数与 evidence） */
export function normalizeResumeEvalDimensionsForJobType(
  dim: Record<string, ResumeEvalDimEntry>,
  jobType: ResumeEvalJobType
): Record<string, ResumeEvalDimEntry> {
  const inferred = inferResumeEvalJobTypeFromDimensions(dim)
  if (!inferred || inferred === jobType) return dim

  const common: Array<keyof typeof dim> = ['impact', 'stability_growth', 'education_fit']
  const out: Record<string, ResumeEvalDimEntry> = {}
  for (const k of common) {
    if (dim[k]) out[k] = { ...dim[k], evidence: [...(dim[k].evidence || [])] }
  }

  if (jobType === 'engineering' && inferred === 'risk_ops') {
    const tech = mergeDimEntries(dim.tech_fit, mergeDimEntries(dim.risk_fit, dim.data_skill))
    const depth = mergeDimEntries(dim.engineering_depth, dim.depth)
    const code = mergeDimEntries(dim.code_quality, dim.data_skill)
    if (tech) out.tech_fit = tech
    if (depth) out.engineering_depth = depth
    if (code) out.code_quality = code
    return out
  }

  if (jobType === 'risk_ops' && inferred === 'engineering') {
    const risk = mergeDimEntries(dim.risk_fit, dim.tech_fit)
    const depth = mergeDimEntries(dim.depth, dim.engineering_depth)
    const data = mergeDimEntries(dim.data_skill, mergeDimEntries(dim.code_quality, dim.tech_fit))
    if (risk) out.risk_fit = risk
    if (depth) out.depth = depth
    if (data) out.data_skill = data
    return out
  }

  return dim
}

const ENGINEERING_CANONICAL_DIMS = [
  'tech_fit',
  'engineering_depth',
  'impact',
  'code_quality',
  'stability_growth',
  'education_fit'
] as const
const RISK_CANONICAL_DIMS = [
  'risk_fit',
  'depth',
  'impact',
  'data_skill',
  'stability_growth',
  'education_fit'
] as const

function inferMinScoreFromDimEvidence(dimKey: string, evidence: string[]): number | null {
  const blob = evidence.join(' ').toLowerCase()
  if (!blob.trim()) return null
  if (/sql|python|java|jmeter|selenium|postman|自动化|接口测试|测试框架|playwright|pytest/.test(blob)) {
    if (dimKey === 'code_quality') return 50
    if (dimKey === 'tech_fit' || dimKey === 'risk_fit' || dimKey === 'data_skill') return 45
  }
  if (/大学|本科|硕士|学士|学历|统招/.test(blob)) return 40
  if (/\d{4}[\./-年]\d{1,2}|至今|工作履历|任职/.test(blob)) return 45
  if (/负责|项目|系统|平台|模块|主导|参与/.test(blob)) return 40
  if (blob.length >= 12) return 35
  return null
}

/** 入库/展示前：映射到岗位应有维度、去掉错体系字段、有证据但 0 分时做最低分兜底 */
export function finalizeResumeEvalDimensionScores(
  dim: Record<string, ResumeEvalDimEntry>,
  jobType: ResumeEvalJobType
): Record<string, ResumeEvalDimEntry> {
  const normalized = normalizeResumeEvalDimensionsForJobType(dim, jobType)
  const canonical = jobType === 'engineering' ? ENGINEERING_CANONICAL_DIMS : RISK_CANONICAL_DIMS
  const out: Record<string, ResumeEvalDimEntry> = {}
  for (const k of canonical) {
    const v = normalized[k]
    if (!v) continue
    let score = clampScore(v.score)
    const evidence = [...(v.evidence || [])].map((x) => String(x || '').trim()).filter(Boolean)
    if (score <= 0 && evidence.length) {
      const inferred = inferMinScoreFromDimEvidence(k, evidence)
      if (inferred != null) score = inferred
    }
    out[k] = { score, evidence: evidence.slice(0, 3) }
  }
  return out
}

/** 正文充足但维度体系错误或几乎全 0 → 触发 AI 重试 */
export function shouldRetryResumeEvalParse(params: {
  dim: Record<string, ResumeEvalDimEntry>
  totalScore: number
  resumePlain: string
  jobType: ResumeEvalJobType
}): boolean {
  const plain = String(params.resumePlain || '').trim()
  if (plain.length < 300) return false

  const scores = Object.values(params.dim)
    .map((v) => Number(v?.score))
    .filter((n) => Number.isFinite(n))
  if (scores.length === 0) return true

  const nonZero = scores.filter((s) => s > 0)
  if (params.totalScore <= 0 && nonZero.length === 0) return true
  return false
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
