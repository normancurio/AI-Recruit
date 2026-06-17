import type { Pool, RowDataPacket } from 'mysql2/promise'

export type ResumeVolumeUiRole = 'admin' | 'delivery_manager' | 'recruiter' | 'recruiting_manager'

export type ResumeVolumeDailyPoint = {
  date: string
  count: number
}

export type ResumeVolumeStatsResult = {
  summary: {
    total: number
    dayCount: number
    avgPerDay: number
    peak: { date: string; count: number } | null
    trough: { date: string; count: number } | null
    previousPeriod: {
      total: number
      avgPerDay: number
      changePct: number | null
    } | null
  }
  daily: ResumeVolumeDailyPoint[]
  meta: {
    dateFrom: string
    dateTo: string
  }
}

function parseDateParam(v: unknown, fallback: Date): Date {
  const s = String(v ?? '').trim()
  if (!s) return fallback
  const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s)
  return Number.isNaN(d.getTime()) ? fallback : d
}

function fmtDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** mysql2 的 DATE 列可能是 Date 对象，需规范成 YYYY-MM-DD */
function normalizeMysqlDateKey(raw: unknown): string {
  if (!raw) return ''
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return fmtDate(raw)
  const s = String(raw).trim()
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (iso?.[1]) return iso[1]
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '' : fmtDate(d)
}

/** 补齐日期区间内无数据的自然日为 0 */
export function fillDailyCounts(
  rows: Array<{ day: string; count: number }>,
  dateFrom: string,
  dateTo: string
): ResumeVolumeDailyPoint[] {
  const map = new Map<string, number>()
  for (const r of rows) {
    const d = normalizeMysqlDateKey(r.day)
    if (!d) continue
    map.set(d, Number(r.count) || 0)
  }
  const out: ResumeVolumeDailyPoint[] = []
  const cur = new Date(`${dateFrom}T00:00:00`)
  const end = new Date(`${dateTo}T00:00:00`)
  if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime()) || cur > end) return out
  while (cur <= end) {
    const key = fmtDate(cur)
    out.push({ date: key, count: map.get(key) ?? 0 })
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

function emptyResult(dateFrom: string, dateTo: string): ResumeVolumeStatsResult {
  const daily = fillDailyCounts([], dateFrom, dateTo)
  return {
    summary: {
      total: 0,
      dayCount: daily.length,
      avgPerDay: 0,
      peak: null,
      trough: null,
      previousPeriod: null
    },
    daily,
    meta: { dateFrom, dateTo }
  }
}

async function queryDailyCounts(
  bizPool: Pool,
  from: Date,
  toExclusive: Date,
  allowedJobCodes: string[] | null,
  allowedUploaderLowers: string[] | null
): Promise<Array<{ day: string; count: number }>> {
  const whereParts = ['s.created_at >= ?', 's.created_at < ?']
  const whereParams: unknown[] = [from, toExclusive]

  if (allowedJobCodes) {
    if (!allowedJobCodes.length) return []
    const ph = allowedJobCodes.map(() => '?').join(', ')
    whereParts.push(`UPPER(TRIM(s.job_code)) IN (${ph})`)
    whereParams.push(...allowedJobCodes.map((c) => String(c).trim().toUpperCase()))
  }

  if (allowedUploaderLowers) {
    if (!allowedUploaderLowers.length) return []
    const ph = allowedUploaderLowers.map(() => '?').join(', ')
    whereParts.push(`LOWER(TRIM(COALESCE(s.uploader_username,''))) IN (${ph})`)
    whereParams.push(...allowedUploaderLowers)
  }

  const [rows] = await bizPool.query<RowDataPacket[]>(
    `SELECT DATE(s.created_at) AS day, COUNT(*) AS cnt
     FROM resume_screenings s
     WHERE ${whereParts.join(' AND ')}
     GROUP BY DATE(s.created_at)
     ORDER BY day ASC`,
    whereParams
  )

  return (rows || []).map((r) => ({
    day: normalizeMysqlDateKey(r.day),
    count: Number(r.cnt) || 0
  }))
}

function pickPeak(daily: ResumeVolumeDailyPoint[]): ResumeVolumeDailyPoint | null {
  return daily.reduce<ResumeVolumeDailyPoint | null>(
    (best, d) => (!best || d.count > best.count ? d : best),
    null
  )
}

function pickTrough(daily: ResumeVolumeDailyPoint[]): ResumeVolumeDailyPoint | null {
  const nonzero = daily.filter((d) => d.count > 0)
  if (!nonzero.length) return null
  return nonzero.reduce<ResumeVolumeDailyPoint | null>(
    (best, d) => (!best || d.count < best.count ? d : best),
    null
  )
}

export async function buildResumeVolumeStatsReport(opts: {
  bizPool: Pool
  query: Record<string, unknown>
  allowedJobCodes: string[] | null
  allowedUploaderLowers: string[] | null
}): Promise<ResumeVolumeStatsResult> {
  const now = new Date()
  const defaultFrom = new Date(now)
  defaultFrom.setDate(defaultFrom.getDate() - 29)
  const dateFrom = parseDateParam(opts.query.dateFrom ?? opts.query.from, defaultFrom)
  const dateTo = parseDateParam(opts.query.dateTo ?? opts.query.to, now)
  const fromStr = fmtDate(dateFrom)
  const toStr = fmtDate(dateTo)
  const toExclusive = new Date(dateTo)
  toExclusive.setDate(toExclusive.getDate() + 1)

  const rows = await queryDailyCounts(
    opts.bizPool,
    dateFrom,
    toExclusive,
    opts.allowedJobCodes,
    opts.allowedUploaderLowers
  )
  if (opts.allowedJobCodes && !opts.allowedJobCodes.length) return emptyResult(fromStr, toStr)
  if (opts.allowedUploaderLowers && !opts.allowedUploaderLowers.length) return emptyResult(fromStr, toStr)

  const daily = fillDailyCounts(rows, fromStr, toStr)
  const total = daily.reduce((sum, d) => sum + d.count, 0)
  const dayCount = daily.length
  const peak = pickPeak(daily)
  const trough = pickTrough(daily)

  let previousPeriod: ResumeVolumeStatsResult['summary']['previousPeriod'] = null
  if (dayCount > 0) {
    const prevToExclusive = new Date(dateFrom)
    const prevFrom = new Date(dateFrom)
    prevFrom.setDate(prevFrom.getDate() - dayCount)
    const prevRows = await queryDailyCounts(
      opts.bizPool,
      prevFrom,
      prevToExclusive,
      opts.allowedJobCodes,
      opts.allowedUploaderLowers
    )
    const prevTotal = prevRows.reduce((sum, r) => sum + r.count, 0)
    previousPeriod = {
      total: prevTotal,
      avgPerDay: dayCount ? round1(prevTotal / dayCount) : 0,
      changePct: prevTotal > 0 ? round1(((total - prevTotal) / prevTotal) * 100) : null
    }
  }

  return {
    summary: {
      total,
      dayCount,
      avgPerDay: dayCount ? round1(total / dayCount) : 0,
      peak: peak && peak.count > 0 ? { date: peak.date, count: peak.count } : null,
      trough,
      previousPeriod
    },
    daily,
    meta: { dateFrom: fromStr, dateTo: toStr }
  }
}
