import crypto from 'crypto'

const DEFAULT_IAT_HOST = 'iat-api.xfyun.cn'
const DEFAULT_IAT_PATH = '/v2/iat'

export type XfyunEnv = {
  appId: string
  apiKey: string
  apiSecret: string
  host: string
  path: string
}

export function checkXfyunIatEnv(): { ok: true; env: XfyunEnv } | { ok: false } {
  const appId = process.env.XFYUN_APP_ID?.trim() || ''
  const apiKey = process.env.XFYUN_API_KEY?.trim() || ''
  const apiSecret = process.env.XFYUN_API_SECRET?.trim() || ''
  if (!appId || !apiKey || !apiSecret) return { ok: false }
  return {
    ok: true,
    env: {
      appId,
      apiKey,
      apiSecret,
      host: process.env.XFYUN_IAT_HOST?.trim() || DEFAULT_IAT_HOST,
      path: process.env.XFYUN_IAT_PATH?.trim() || DEFAULT_IAT_PATH
    }
  }
}

function hmacSha256Base64(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('base64')
}

/** 生成讯飞语音听写（流式版）WebSocket 鉴权 URL */
export function buildXfyunIatAuthWsUrl(env: XfyunEnv): string {
  const host = env.host
  const path = env.path.startsWith('/') ? env.path : `/${env.path}`
  const date = new Date().toUTCString()
  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`
  const signature = hmacSha256Base64(signatureOrigin, env.apiSecret)
  const authorizationOrigin = `api_key="${env.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`
  const authorization = Buffer.from(authorizationOrigin).toString('base64')
  const qs = new URLSearchParams({
    authorization,
    date,
    host
  })
  return `wss://${host}${path}?${qs.toString()}`
}

type XfyunWsWord = { w?: string }
type XfyunWsItem = { cw?: XfyunWsWord[] }
type XfyunResult = {
  sn?: number
  ls?: boolean
  pgs?: string
  rg?: number[]
  ws?: XfyunWsItem[]
}

/** 从听写 JSON 帧拼接文本（支持 wpgs 动态修正的简单解析） */
export function parseXfyunIatFrame(
  payload: { code?: number; message?: string; data?: { result?: XfyunResult; status?: number } },
  state: { finals: string[]; partial: string }
): { text: string; isFinal: boolean; error?: string } | null {
  if (payload.code !== 0) {
    return { text: '', isFinal: false, error: payload.message || `讯飞识别错误(${String(payload.code)})` }
  }
  const result = payload.data?.result
  if (!result?.ws?.length) return null

  const piece = result.ws
    .map((w) => w.cw?.map((c) => c.w || '').join('') || '')
    .join('')
  if (!piece) return null

  if (result.pgs === 'rpl' && Array.isArray(result.rg) && result.rg.length >= 2) {
    const [from, to] = result.rg
    const start = Math.max(0, from - 1)
    const end = Math.max(start, to)
    state.finals.splice(start, end - start + 1, piece)
    state.partial = ''
  } else if (result.pgs === 'apd') {
    state.finals.push(piece)
    state.partial = ''
  } else {
    state.partial = piece
  }

  const text = state.finals.join('') + state.partial
  const isFinal = Boolean(result.ls) || payload.data?.status === 2
  if (isFinal && state.partial) {
    state.finals.push(state.partial)
    state.partial = ''
  }
  return { text: state.finals.join('') + state.partial, isFinal }
}
