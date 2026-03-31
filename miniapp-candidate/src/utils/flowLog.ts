import Taro from '@tarojs/taro'

declare const TARO_FLOW_DEBUG: string

const STORAGE_KEY = 'FLOW_DEBUG'

function fromEnv(): boolean {
  return String(typeof TARO_FLOW_DEBUG !== 'undefined' ? TARO_FLOW_DEBUG : '').trim() === '1'
}

/** 开发者工具：wx.setStorageSync('FLOW_DEBUG', '1') 后重进小程序；或 .env.local 设 TARO_APP_FLOW_DEBUG=1 并重编 */
export function flowDebugEnabled(): boolean {
  if (fromEnv()) return true
  try {
    const v = Taro.getStorageSync(STORAGE_KEY)
    return v === '1' || v === true
  } catch {
    return false
  }
}

export function flowLog(step: string, ok: boolean, detail?: string) {
  if (!flowDebugEnabled()) return
  const mark = ok ? '✓' : '✗'
  const line = detail ? `${step} | ${detail}` : step
  console.log(`[候选流程] ${mark}`, line)
}

export function flowLogInfo(step: string, detail?: string) {
  if (!flowDebugEnabled()) return
  console.log('[候选流程] ·', step, detail ?? '')
}
