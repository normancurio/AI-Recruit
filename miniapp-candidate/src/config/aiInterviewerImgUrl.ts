/** 由 config/index.ts defineConstants 注入，勿使用 process.env */
declare const TARO_AI_INTERVIEWER_IMG_URL: string

const DEFAULT_AI_INTERVIEWER_IMG =
  'https://xiang-xian-miniprogarm.tos-cn-shanghai.volces.com/static/ai-interviewer.png'

export const AI_INTERVIEWER_IMG_URL =
  String(typeof TARO_AI_INTERVIEWER_IMG_URL !== 'undefined' ? TARO_AI_INTERVIEWER_IMG_URL : '').trim() ||
  DEFAULT_AI_INTERVIEWER_IMG
