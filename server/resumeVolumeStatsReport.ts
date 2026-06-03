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

/** 补齐日期区间内无数据的自然日为 0 */
export function fillDailyCounts(
  rows: Array<{ day: string; count: number }>,
  dateFrom: string,
  dateTo: string
): ResumeVolumeDailyPoint[] {
  const map = new Map<string, number>()
  for (const r of rows) {
    const d = String(r.day || '').slice(0, 10)
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
    summary: { total: 0, dayCount: daily.length, avgPerDay: 0, peak: null },
    daily,
    meta: { dateFrom, dateTo }
  }
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

  const whereParts = ['s.created_at >= ?', 's.created_at < ?']
  const whereParams: unknown[] = [dateFrom, toExclusive]

  if (opts.allowedJobCodes) {
    if (!opts.allowedJobCodes.length) return emptyResult(fromStr, toStr)
    const ph = opts.allowedJobCodes.map(() => '?').join(', ')
    whereParts.push(`UPPER(TRIM(s.job_code)) IN (${ph})`)
    whereParams.push(...opts.allowedJobCodes.map((c) => String(c).trim().toUpperCase()))
  }

  if (opts.allowedUploaderLowers) {
    if (!opts.allowedUploaderLowers.length) return emptyResult(fromStr, toStr)
    const ph = opts.allowedUploaderLowers.map(() => '?').join(', ')
    whereParts.push(`LOWER(TRIM(COALESCE(s.uploader_username,''))) IN (${ph})`)
    whereParams.push(...opts.allowedUploaderLowers)
  }

  const whereSql = whereParts.join(' AND ')
  const [rows] = await opts.bizPool.query<RowDataPacket[]>(
    `SELECT DATE(s.created_at) AS day, COUNT(*) AS cnt
     FROM resume_screenings s
     WHERE ${whereSql}
     GROUP BY DATE(s.created_at)
     ORDER BY day ASC`,
    whereParams
  )

  const daily = fillDailyCounts(
    (rows || []).map((r) => ({
      day: String(r.day ?? ''),
      count: Number(r.cnt) || 0
    })),
    fromStr,
    toStr
  )
  const total = daily.reduce((sum, d) => sum + d.count, 0)
  const dayCount = daily.length
  const peak = daily.reduce<ResumeVolumeDailyPoint | null>(
    (best, d) => (!best || d.count > best.count ? d : best),
    null
  )

  return {
    summary: {
      total,
      dayCount,
      avgPerDay: dayCount ? round1(total / dayCount) : 0,
      peak: peak && peak.count > 0 ? { date: peak.date, count: peak.count } : null
    },
    daily,
    meta: { dateFrom: fromStr, dateTo: toStr }
  }
}
