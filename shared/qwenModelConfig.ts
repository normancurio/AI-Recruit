/** 百炼 qwen3.7-plus 带日期版本（配额恢复前勿作默认） */
export const QWEN_PLUS_MODEL_DATED = 'qwen3.7-plus-2026-05-26'

/** 当前默认 plus 模型（日期版配额已用尽） */
export const QWEN_PLUS_MODEL_FALLBACK = 'qwen3.7-plus'

export function defaultQwenPlusModel(): string {
  return QWEN_PLUS_MODEL_FALLBACK
}

/** 若 primary 为 qwen3.7-plus 日期版，返回通用 fallback；否则 null */
export function qwenPlusModelFallbackFor(primary: string): string | null {
  const m = String(primary || '').trim()
  if (m === QWEN_PLUS_MODEL_DATED) return QWEN_PLUS_MODEL_FALLBACK
  if (/^qwen3\.7-plus-\d{4}-\d{2}-\d{2}$/.test(m)) return QWEN_PLUS_MODEL_FALLBACK
  return null
}

/** 日期版 plus 配额用尽、模型不可用等 → 可降级 */
export function isQwenPlusModelQuotaExhausted(err: unknown): boolean {
  const e = err as Error & { httpStatus?: number }
  const msg = String(e?.message || err || '').toLowerCase()
  const st = e.httpStatus
  if (/quota|配额|余额|用尽|用完|exceeded|insufficient|free tier|额度|allocation|allocated|insufficient_quota/.test(msg)) {
    return true
  }
  if (/model.*not.*(found|exist|available|access)|invalidmodel|model_not_found|model disabled|does not exist/.test(msg)) {
    return true
  }
  if (st === 429) return true
  if (st === 400 && /quota|limit|model|insufficient/.test(msg)) return true
  return false
}
