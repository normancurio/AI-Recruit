const STORAGE_KEY = 'hr_admin_session_token'
const PROFILE_KEY = 'hr_admin_profile'

export type AdminUiRole = 'admin' | 'delivery_manager' | 'recruiter' | 'recruiting_manager'

export type AdminLoginProfile = {
  name: string
  username: string
  uiRole: AdminUiRole
  /** 非空时与职级默认菜单求交，仅显示这些侧边栏 id（来自管理库 roles.menu_keys） */
  allowedMenuKeys?: string[]
}

export function getAdminLoginProfile(): AdminLoginProfile | null {
  try {
    const raw = sessionStorage.getItem(PROFILE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<AdminLoginProfile>
    if (
      p &&
      typeof p.username === 'string' &&
      (p.uiRole === 'admin' ||
        p.uiRole === 'delivery_manager' ||
        p.uiRole === 'recruiter' ||
        p.uiRole === 'recruiting_manager')
    ) {
      let allowedMenuKeys: string[] | undefined
      if (
        typeof p === 'object' &&
        p !== null &&
        'allowedMenuKeys' in p &&
        Array.isArray((p as { allowedMenuKeys?: unknown }).allowedMenuKeys)
      ) {
        allowedMenuKeys = (p as { allowedMenuKeys: unknown[] }).allowedMenuKeys
          .map((x) => String(x || '').trim())
          .filter(Boolean)
      }
      return {
        name: String(p.name || p.username),
        username: p.username,
        uiRole: p.uiRole,
        ...(allowedMenuKeys !== undefined ? { allowedMenuKeys } : {})
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

export function setAdminLoginProfile(p: AdminLoginProfile | null) {
  try {
    if (p) sessionStorage.setItem(PROFILE_KEY, JSON.stringify(p))
    else sessionStorage.removeItem(PROFILE_KEY)
  } catch {
    /* ignore */
  }
  notify()
}
/** 为 true 时不使用 VITE_ADMIN_API_TOKEN，便于在本地退出后改用表单登录 */
const PREFER_SESSION_ONLY = 'hr_admin_prefer_session_only'

type Listener = () => void
const listeners: Listener[] = []

function notify() {
  listeners.forEach((fn) => {
    try {
      fn()
    } catch {
      /* ignore */
    }
  })
}

function preferSessionOnlyAuth(): boolean {
  try {
    return sessionStorage.getItem(PREFER_SESSION_ONLY) === '1'
  } catch {
    return false
  }
}

function setPreferSessionOnlyAuth(on: boolean) {
  try {
    if (on) sessionStorage.setItem(PREFER_SESSION_ONLY, '1')
    else sessionStorage.removeItem(PREFER_SESSION_ONLY)
  } catch {
    /* ignore */
  }
}

export function getAdminSessionToken(): string {
  try {
    return String(sessionStorage.getItem(STORAGE_KEY) || '').trim()
  } catch {
    return ''
  }
}

export function setAdminSessionToken(token: string) {
  try {
    sessionStorage.setItem(STORAGE_KEY, token.trim())
    sessionStorage.removeItem(PREFER_SESSION_ONLY)
  } catch {
    /* ignore */
  }
  notify()
}

export function clearAdminSessionToken() {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
    sessionStorage.removeItem(PROFILE_KEY)
  } catch {
    /* ignore */
  }
  notify()
}

/** 退出后屏蔽构建期 Token，同标签页内会显示登录框（刷新后恢复 env Token） */
export function logoutAdminMiniappAuth() {
  clearAdminSessionToken()
  setPreferSessionOnlyAuth(true)
  notify()
}

export function subscribeAdminSession(cb: Listener) {
  listeners.push(cb)
  return () => {
    const i = listeners.indexOf(cb)
    if (i >= 0) listeners.splice(i, 1)
  }
}

/** 请求小程序 API 时携带的令牌：优先 session，其次 VITE_ADMIN_API_TOKEN（可被退出屏蔽） */
export function getAdminApiTokenForMiniapp(): string {
  const session = getAdminSessionToken()
  if (session) return session
  if (preferSessionOnlyAuth()) return ''
  return String(import.meta.env.VITE_ADMIN_API_TOKEN || '').trim()
}

export function hasAdminApiCredentials(): boolean {
  return Boolean(getAdminApiTokenForMiniapp().trim())
}
