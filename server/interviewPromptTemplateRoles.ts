/** AI 面试提示词模板：角色标识归一化与可见/可编辑权限判断 */

export type PromptRoleCanonical =
  | 'admin'
  | 'delivery_manager'
  | 'recruiter'
  | 'recruiting_manager'
  | 'ai_interviewer_manager'

export const ALL_INTERVIEW_PROMPT_ROLES: PromptRoleCanonical[] = [
  'admin',
  'delivery_manager',
  'recruiter',
  'recruiting_manager',
  'ai_interviewer_manager'
]

/** 默认模板应对所有可发起面试的后台角色开放 */
export const DEFAULT_INTERVIEW_PROMPT_VISIBLE_ROLES: PromptRoleCanonical[] = [...ALL_INTERVIEW_PROMPT_ROLES]

/** 默认模板仅管理员与 AI 面试官管理员可改 */
export const DEFAULT_INTERVIEW_PROMPT_EDITABLE_ROLES: PromptRoleCanonical[] = [
  'admin',
  'ai_interviewer_manager'
]

const PROMPT_ROLE_ALIAS_TO_CANONICAL: Record<string, PromptRoleCanonical> = {
  admin: 'admin',
  superadmin: 'admin',
  super_admin: 'admin',
  平台管理员: 'admin',
  系统管理: 'admin',
  超级管理: 'admin',

  delivery_manager: 'delivery_manager',
  交付经理: 'delivery_manager',

  recruiter: 'recruiter',
  招聘专员: 'recruiter',
  招聘人员: 'recruiter',

  recruiting_manager: 'recruiting_manager',
  招聘经理: 'recruiting_manager',
  招募经理: 'recruiting_manager',

  ai_interviewer_manager: 'ai_interviewer_manager',
  ai面试官管理员: 'ai_interviewer_manager',
  AI面试官管理员: 'ai_interviewer_manager'
}

export function normalizePromptRoleKey(raw: unknown): PromptRoleCanonical | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const direct = PROMPT_ROLE_ALIAS_TO_CANONICAL[s]
  if (direct) return direct
  const lower = s.toLowerCase()
  const byLower = PROMPT_ROLE_ALIAS_TO_CANONICAL[lower]
  if (byLower) return byLower
  if (/AI面试官管理员/i.test(s)) return 'ai_interviewer_manager'
  if (/平台管理员|系统管理|超级管理/i.test(s)) return 'admin'
  if (/交付经理/i.test(s)) return 'delivery_manager'
  if (/招聘经理|招募经理/i.test(s)) return 'recruiting_manager'
  if (/招聘专员|招聘人员/i.test(s)) return 'recruiter'
  if (/^admin$/i.test(s)) return 'admin'
  if (/^delivery_manager$/i.test(s)) return 'delivery_manager'
  if (/^recruiter$/i.test(s)) return 'recruiter'
  if (/^recruiting_manager$/i.test(s)) return 'recruiting_manager'
  return null
}

export function normalizePromptRoleList(
  raw: unknown,
  fallback: PromptRoleCanonical[] = ALL_INTERVIEW_PROMPT_ROLES
): PromptRoleCanonical[] {
  let arr: unknown = raw
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw)
    } catch {
      arr = raw
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    }
  }
  const roles = Array.isArray(arr) ? arr : []
  const out = new Set<PromptRoleCanonical>()
  for (const item of roles) {
    const canon = normalizePromptRoleKey(item)
    if (canon) out.add(canon)
  }
  if (!out.size) return [...fallback]
  return Array.from(out)
}

export function mergePromptRoleLists(
  ...lists: Array<readonly PromptRoleCanonical[] | PromptRoleCanonical[]>
): PromptRoleCanonical[] {
  const out = new Set<PromptRoleCanonical>()
  for (const list of lists) {
    for (const role of list) out.add(role)
  }
  return Array.from(out)
}

export type PromptTemplateRoleActor = {
  uiRole?: string | null
  roleNames?: string[] | null
}

export function actorPromptRoleKeys(actor: PromptTemplateRoleActor | null | undefined): string[] {
  const keys = [String(actor?.uiRole || '').trim(), ...(actor?.roleNames || [])].filter(Boolean)
  return Array.from(new Set(keys))
}

export function actorPromptCanonicalRoles(actor: PromptTemplateRoleActor | null | undefined): PromptRoleCanonical[] {
  const out = new Set<PromptRoleCanonical>()
  for (const key of actorPromptRoleKeys(actor)) {
    const canon = normalizePromptRoleKey(key)
    if (canon) out.add(canon)
  }
  return Array.from(out)
}

export function canViewPromptTemplate(
  actor: PromptTemplateRoleActor | null | undefined,
  template: { visibleRoles: readonly string[] },
  fallbackVisible: PromptRoleCanonical[] = ALL_INTERVIEW_PROMPT_ROLES
): boolean {
  const actorCanon = actorPromptCanonicalRoles(actor)
  if (actorCanon.includes('admin')) return true
  const visibleCanon = normalizePromptRoleList(template.visibleRoles, fallbackVisible)
  return actorCanon.some((role) => visibleCanon.includes(role))
}

export function canEditPromptTemplate(
  actor: PromptTemplateRoleActor | null | undefined,
  template: { editableRoles: readonly string[] },
  fallbackEditable: PromptRoleCanonical[] = ['admin']
): boolean {
  const actorCanon = actorPromptCanonicalRoles(actor)
  if (actorCanon.includes('admin')) return true
  const editableCanon = normalizePromptRoleList(template.editableRoles, fallbackEditable)
  return actorCanon.some((role) => editableCanon.includes(role))
}
