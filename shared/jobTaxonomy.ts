/**
 * 岗位「级别」与「岗位序列」规范：前后端共用，保证写入一致、筛选可比。
 * 标准岗位序列优先从库表 `standard_job_role_bases` 加载（见 server 与前端登录后同步）；
 * 表不可用或尚无启用项时回退到 FALLBACK_STANDARD_JOB_ROLE_BASES。
 */

/** 与业务约定一致的标准职级 */
export const STANDARD_JOB_LEVELS = ['初级', '中级', '高级', '资深'] as const

export type StandardJobLevel = (typeof STANDARD_JOB_LEVELS)[number]

const LEVEL_SET = new Set<string>(STANDARD_JOB_LEVELS)

/**
 * 历史/口语写法 → 标准四项之一（便于旧数据编辑一次后落库规范值）
 */
const LEVEL_ALIASES: Record<string, StandardJobLevel> = {
  初級: '初级',
  中級: '中级',
  高級: '高级',
  資深: '资深',
  实习: '初级',
  专家: '资深',
  專家: '资深',
  总监: '资深',
  總監: '资深',
  负责人: '资深',
  管理岗: '资深',
  总监负责人: '资深',
  '总监/负责人': '资深'
}

/**
 * 内置默认岗位序列（表为空或 API 未加载时的回退；与 migration 后首启种子一致）。
 * 新增/调整岗位请优先在管理端「标准岗位」维护；此处仅作兜底与冷启动种子源。
 */
export const FALLBACK_STANDARD_JOB_ROLE_BASES: readonly string[] = [
  'JAVA 开发工程师',
  'H5 (React&Vue)',
  '测试工程师',
  '移动测试工程师',
  '前端开发工程师',
  '大数据开发工程师',
  '需求分析师 (BA)',
  '产品经理',
  '质量分析师 QA',
  'UI 设计师',
  '技术经理',
  '项目经理 (PM)',
  '项目助理',
  '运维工程师',
  '原画设计',
  '策划',
  '数据运营',
  '产品运营',
  '模型设计',
  '新媒体运营',
  '服务台管理',
  'Python 开发工程师',
  'GO 开发工程师',
  'C++ 开发工程师',
  'IOS 开发工程师',
  'PHP 开发工程师',
  '安卓开发工程师',
  '系统分析师 (SA)',
  '系统架构师',
  '系统性能工程师',
  '信息安全工程师',
  '美工',
  '实施顾问',
  '数据分析师',
  '数据开发师',
  '数据库工程师',
  '数据库管理员 (DBA)',
  '数据治理工程师',
  '算法工程师',
  '算子库工程师',
  '财务分析',
  '财务助理',
  '交付经理',
  '解决方案工程师',
  '客户服务代表',
  '文案专员',
  '薪酬专员',
  '行政前台文员',
  '行政助理',
  '业务顾问',
  '招聘专员',
  '风控建模工程师',
  'ABAP',
  'UED 交互设计师',
  'Devops 研发工程师',
  'AI 训练师',
  '大数据测试',
  '应用程序开发',
  '风控研发',
  '技术支持',
  '后端开发工程师',
  '全栈工程师',
  'Go 开发工程师',
  'iOS 开发工程师',
  'Android 开发工程师',
  '嵌入式工程师',
  '硬件工程师',
  '机器学习工程师',
  '交互设计师',
  'HRBP',
  '运营专员',
  '市场专员',
  '财务专员',
  '行政专员',
  '机械设计岗',
  '产品工程师/机械工程师',
  '机器人应用工程师',
  'MES工程师',
  '成本估价岗',
  '电气设计岗',
  '软件算法岗'
] as const

let _standardJobRoleBasesOverride: string[] | null = null

/** Node/浏览器：用库表拉取结果覆盖内存中的标准序列；传空数组表示清除覆盖并回退到 FALLBACK */
export function setStandardJobRoleBasesFromDb(names: string[]): void {
  const cleaned = names.map((x) => String(x || '').trim()).filter(Boolean)
  _standardJobRoleBasesOverride = cleaned.length > 0 ? cleaned : null
}

export function getStandardJobRoleBases(): string[] {
  if (_standardJobRoleBasesOverride && _standardJobRoleBasesOverride.length > 0) {
    return [..._standardJobRoleBasesOverride]
  }
  return [...FALLBACK_STANDARD_JOB_ROLE_BASES]
}

export function getStandardJobRoleBaseSet(): Set<string> {
  return new Set(getStandardJobRoleBases())
}

/** 反推编辑表单中的岗位序列：优先与库里的 level 列组合匹配，否则尝试任意标准级别前缀 */
export function matchRoleBaseFromJobTitle(title: string, levelRaw: string): string | null {
  const t = normalizeJobTitle(String(title || ''))
  if (!t) return null
  const bases = [...getStandardJobRoleBases()].sort((a, b) => b.length - a.length)
  const baseSet = getStandardJobRoleBaseSet()
  const levelNorm = normalizeJobLevel(levelRaw)
  if (levelNorm) {
    const combined = `${levelNorm}`
    if (t.startsWith(combined)) {
      const rest = t.slice(combined.length)
      const restNorm = normalizeJobTitle(rest)
      if (restNorm && baseSet.has(restNorm)) return restNorm
    }
  }
  for (const lv of STANDARD_JOB_LEVELS) {
    const p = `${lv}`
    if (t.startsWith(p)) {
      const rest = t.slice(p.length)
      const restNorm = normalizeJobTitle(rest)
      if (restNorm && baseSet.has(restNorm)) return restNorm
    }
  }
  if (baseSet.has(t)) return t
  return null
}

/** 写入库的规范岗位全称 */
export function composeStandardJobTitle(level: StandardJobLevel, roleBaseRaw: string): string | null {
  const base = normalizeJobTitle(String(roleBaseRaw || ''))
  if (!base || !getStandardJobRoleBaseSet().has(base)) return null
  const out = `${level}${base}`
  if (out.length > 255) return null
  return out
}

export function jobLevelValidationMessage(): string {
  return `级别须为以下规范项之一：${STANDARD_JOB_LEVELS.join('、')}`
}

export function jobTitleValidationMessage(): string {
  return '岗位名称长度须在 2～255 个字符之间（首尾空格会去除，连续空格会合并）'
}

export function jobRoleBaseValidationMessage(): string {
  return '请从标准岗位列表中选择一项'
}

/**
 * 将用户输入的级别映射到标准项；无法识别时返回 null。
 */
export function normalizeJobLevel(raw: string): StandardJobLevel | null {
  const compact = String(raw || '')
    .trim()
    .replace(/\s+/g, '')
  if (!compact) return null
  const alias = LEVEL_ALIASES[compact]
  if (alias) return alias
  if (LEVEL_SET.has(compact)) return compact as StandardJobLevel
  return null
}

/**
 * 规范化岗位名称：去首尾空白、合并空白，长度校验。
 */
export function normalizeJobTitle(raw: string): string | null {
  const t = String(raw || '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
  if (t.length < 2 || t.length > 255) return null
  return t
}

/**
 * 简历解析得到的「职位」等文本，尽量对齐标准岗位序列写法（如 JAVA开发工程师 → JAVA 开发工程师）；无法匹配则返回清洗后的原文。
 */
export function normalizeExtractedJobTitleForDisplay(raw: string): string {
  const t = String(raw || '')
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
  if (!t) return ''
  const baseSet = getStandardJobRoleBaseSet()
  if (baseSet.has(t)) return t
  const compact = t.replace(/\s/g, '')
  for (const b of [...getStandardJobRoleBases()].sort((a, b) => b.length - a.length)) {
    if (compact === b.replace(/\s/g, '')) return b
  }
  return t.length <= 255 ? t : t.slice(0, 255)
}

/** 简历详情「职位」下拉：仅标准岗位序列（不含初级/中级等级别前缀），有序 */
export function buildStandardProfileJobRoleBaseOptions(): string[] {
  return [...getStandardJobRoleBases()].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}
