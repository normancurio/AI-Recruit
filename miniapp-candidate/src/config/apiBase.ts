/** 构建时由 Taro 注入，见 miniapp-candidate/.env.local */
export const API_BASE = String(process.env.TARO_APP_API_BASE || '').trim()

export function assertApiBase(): string {
  if (!API_BASE) {
    throw new Error(
      '未配置后端地址：在 miniapp-candidate/.env.local 中设置 TARO_APP_API_BASE（开发示例 http://127.0.0.1:3001），保存后重新编译小程序'
    )
  }
  return API_BASE
}

export function httpErrorMessage(res: { statusCode?: number; data?: unknown }, fallback: string): string {
  const data = res.data as { message?: string } | undefined
  return data?.message || `${fallback}（HTTP ${res.statusCode}）`
}
