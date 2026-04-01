import Taro from '@tarojs/taro'

/** 构建时由 webpack 注入（miniapp-candidate/.env.local 的 TARO_APP_API_BASE） */
const ENV_API_BASE = String(process.env.TARO_APP_API_BASE || '').trim().replace(/\/$/, '')

const DEV_STORAGE_KEY = 'DEV_API_BASE'
declare const TARO_FLOW_DEBUG: string

function allowDevApiOverride() {
  return String(typeof TARO_FLOW_DEBUG !== 'undefined' ? TARO_FLOW_DEBUG : '').trim() === '1'
}

/**
 * 当前请求使用的 API 根地址（无尾部 /）。
 * - 默认：编译时的 TARO_APP_API_BASE；改 .env 后必须重新执行 `npm run dev:weapp` 才会生效。
 * - 开发覆盖：在微信开发者工具 / 真机里执行
 *   `wx.setStorageSync('DEV_API_BASE', 'http://192.168.1.16:3001')` 后重进小程序，可立刻指向新 IP，无需重编。
 */
export function getApiBase(): string {
  if (!allowDevApiOverride()) return ENV_API_BASE
  try {
    const v = Taro.getStorageSync(DEV_STORAGE_KEY) as string
    if (typeof v === 'string') {
      const t = v.trim().replace(/\/$/, '')
      if (/^https?:\/\//i.test(t)) return t
    }
  } catch {
    /* 非小程序环境等 */
  }
  return ENV_API_BASE
}

export function assertApiBase(): string {
  const b = getApiBase()
  if (!b) {
    throw new Error(
      '未配置后端地址：在 miniapp-candidate/.env.local 中设置 TARO_APP_API_BASE（开发示例 http://127.0.0.1:3001），保存后重新编译小程序'
    )
  }
  return b
}

/** @deprecated 请用 getApiBase()；该常量为编译期快照，不会读取 DEV_API_BASE 覆盖 */
export const API_BASE = ENV_API_BASE

export function httpErrorMessage(res: { statusCode?: number; data?: unknown }, fallback: string): string {
  const data = res.data as { message?: string } | undefined
  return data?.message || `${fallback}（HTTP ${res.statusCode}）`
}
