const ENV_API_BASE = String(import.meta.env.VITE_API_BASE || '').trim().replace(/\/$/, '')

/** 开发默认走 Vite 代理（空字符串 = 同源 /api） */
export function getApiBase(): string {
  return ENV_API_BASE
}

export function apiUrl(path: string): string {
  const base = getApiBase()
  const p = path.startsWith('/') ? path : `/${path}`
  return base ? `${base}${p}` : p
}

export const AI_INTERVIEWER_IMG_URL =
  String(import.meta.env.VITE_AI_INTERVIEWER_IMG_URL || '').trim() ||
  'https://xiang-xian-miniprogarm.tos-cn-shanghai.volces.com/static/ai-interviewer.png'

async function parseJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T
  } catch {
    return {} as T
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    }
  })
  const body = await parseJson<{ data?: T; message?: string }>(res)
  if (!res.ok) {
    throw new Error(body?.message || `请求失败（HTTP ${res.status}）`)
  }
  return body as T
}

export async function apiGetData<T>(path: string, query?: Record<string, string | number>): Promise<T> {
  const url = new URL(apiUrl(path), globalThis.location?.origin || 'http://localhost')
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== '' && v != null) url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url.toString(), { method: 'GET' })
  const body = await parseJson<{ data?: T; message?: string }>(res)
  if (!res.ok) {
    throw new Error(body?.message || `请求失败（HTTP ${res.status}）`)
  }
  if (body.data === undefined) {
    throw new Error(body?.message || '响应无 data')
  }
  return body.data
}

export async function apiPostData<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const body = await parseJson<{ data?: T; message?: string }>(res)
  if (!res.ok) {
    throw new Error(body?.message || `请求失败（HTTP ${res.status}）`)
  }
  if (body.data === undefined) {
    throw new Error(body?.message || '响应无 data')
  }
  return body.data
}
