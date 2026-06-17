/** 讯飞 WebAPI 常见错误码 → 用户可读提示 */
export function formatXfyunError(message: string, code?: number): string {
  const msg = String(message || '').trim()
  const lower = msg.toLowerCase()
  if (code === 10005 || lower.includes('licc')) {
    return '讯飞 APPID 未授权听写服务：请到控制台为该应用开通「语音听写（流式版）」，并确认 APPID/APIKey/APISecret 三者同属一个应用'
  }
  if (code === 11200 || lower.includes('no license')) {
    return '讯飞听写权限不足：请检查是否开通流式听写，或试用额度是否用完'
  }
  if (code === 11201 || lower.includes('not enough license')) {
    return '讯飞今日调用次数已用完，请次日再试或联系讯飞提升额度'
  }
  if (code === 10165 || lower.includes('invalid handle')) {
    return '讯飞会话异常，正在重连…'
  }
  return msg || `讯飞识别错误(${String(code ?? 'unknown')})`
}

export function isXfyunFatalError(message: string, code?: number): boolean {
  const lower = String(message || '').toLowerCase()
  if (code === 10005 || code === 11200 || code === 11201) return true
  return lower.includes('licc') || lower.includes('no license') || lower.includes('not enough license')
}
