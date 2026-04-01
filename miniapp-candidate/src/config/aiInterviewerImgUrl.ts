/** 由 config/index.ts defineConstants 注入，勿使用 process.env */
declare const TARO_AI_INTERVIEWER_IMG_URL: string

export const AI_INTERVIEWER_IMG_URL = String(
  typeof TARO_AI_INTERVIEWER_IMG_URL !== 'undefined' ? TARO_AI_INTERVIEWER_IMG_URL : ''
).trim()
