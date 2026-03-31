/** 由 config/index.ts defineConstants 注入，勿使用 process.env */
declare const TARO_VOIP_FALLBACK_OPENID: string

export const VOIP_FALLBACK_INTERVIEWER_OPENID = String(TARO_VOIP_FALLBACK_OPENID || '').trim()
