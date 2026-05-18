import type { Pool, RowDataPacket } from 'mysql2/promise'
import { deptNamesMatch } from '../shared/deptMatch.js'

const HIGH_QUALITY_SCORE = 80
const QUALIFIED_SCORE = 70
const DEFAULT_MIN_UPLOADS = 3

const LATEST_REPORT_JOIN = `LEFT JOIN interview_reports lr ON lr.id = (
  SELECT ir.id
  FROM interview_reports ir
  WHERE CONVERT(TRIM(ir.job_code) USING utf8mb4) COLLATE utf8mb4_unicode_ci =
        CONVERT(TRIM(s.job_code) USING utf8mb4) COLLATE utf8mb4_unicode_ci
    AND (
      (
        TRIM(COALESCE(ir.candidate_phone, '')) <> ''
        AND TRIM(COALESCE(s.candidate_phone, '')) <> ''
        AND TRIM(ir.candidate_phone) = TRIM(s.candidate_phone)
      )
      OR (
        CONVERT(TRIM(ir.candidate_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci =
        CONVERT(TRIM(s.candidate_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci
      )
    )
  ORDER BY ir.updated_at DESC, ir.id DESC
  LIMIT 1
)`

export type RecruiterQualityUiRole = 'admin' | 'delivery_manager' | 'recruiter' | 'recruiting_manager'

export type RecruiterQualityRow = {
  dept: string
  username: string
  displayName: string
  role: string
  uploadCount: number
  highQualityCount: number
  highQualityRate: number
  avgMatchScore: number
  qualifiedCount: number
  invitedCount: number
  inviteRate: number
  interviewDoneCount: number
  interviewPassCount: number
  interviewPassRate: number | null
  avgInterviewScore: number | null
  qualityScore: number | null
  sampleInsufficient: boolean
}

export type RecruiterQualityReportResult = {
  rows: RecruiterQualityRow[]
  summary: {
    uploadCount: number
    interviewDoneCount: number
    interviewPassCount: number
    avgQualityScore: number | null
  }
  meta: {
    dateFrom: string
    dateTo: string
    deptFilter: string
    minUploads: number
    thresholds: { highQuality: number; qualified: number }
  }
}

type AdminUserRow = {
  username: string
  name: string
  dept: string
  role: string
}

type ScreeningFact = {
  uploaderLower: string
  matchScore: number
  invited: boolean
  interviewDone: boolean
  interviewPassed: boolean | null
  interviewScore: number | null
}

function isRecruitingRole(role: string): boolean {
  const r = String(role || '').trim()
  if (!r) return false
  if (/交付/.test(r)) return false
  return /招聘/.test(r)
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

function pct(num: number, den: number): number {
  if (!den) return 0
  return round1((num / den) * 100)
}

function computeQualityScore(
  highQualityRate: number,
  inviteRateAmongQualified: number,
  passRate: number | null
): number | null {
  const passPart = passRate === null ? 0 : passRate
  return round1(0.25 * highQualityRate + 0.25 * inviteRateAmongQualified + 0.5 * passPart)
}

export async function buildRecruiterQualityReport(opts: {
  bizPool: Pool
  adminPool: Pool
  actor: { username: string; displayName: string; uiRole: RecruiterQualityUiRole; dept: string }
  allowedJobCodes: string[] | null
  allowedUploaderLowers: string[] | null
  query: Record<string, unknown>
}): Promise<RecruiterQualityReportResult> {
  const now = new Date()
  const defaultFrom = new Date(now)
  defaultFrom.setDate(defaultFrom.getDate() - 30)
  const dateFrom = parseDateParam(opts.query.dateFrom ?? opts.query.from, defaultFrom)
  const dateTo = parseDateParam(opts.query.dateTo ?? opts.query.to, now)
  const toExclusive = new Date(dateTo)
  toExclusive.setDate(toExclusive.getDate() + 1)

  const deptFilter = String(opts.query.dept ?? opts.query.deptName ?? '').trim()
  const minUploads = Math.max(
    1,
    Math.min(50, Number(opts.query.minUploads ?? DEFAULT_MIN_UPLOADS) || DEFAULT_MIN_UPLOADS)
  )

  const [userRows] = await opts.adminPool.query<RowDataPacket[]>(
    `SELECT username, name, dept, role FROM users WHERE status = '正常' OR status IS NULL OR TRIM(status) = ''`
  )
  const adminUsers: AdminUserRow[] = (userRows || [])
    .map((r) => ({
      username: String(r.username ?? '').trim(),
      name: String(r.name ?? '').trim(),
      dept: String(r.dept ?? '').trim() || '-',
      role: String(r.role ?? '').trim()
    }))
    .filter((u) => u.username)

  const userByLower = new Map<string, AdminUserRow>()
  for (const u of adminUsers) {
    userByLower.set(u.username.toLowerCase(), u)
  }

  let scopedUsers = adminUsers.filter((u) => isRecruitingRole(u.role))
  if (opts.actor.uiRole === 'recruiter') {
    const me = opts.actor.username.trim().toLowerCase()
    scopedUsers = scopedUsers.filter((u) => u.username.toLowerCase() === me)
  } else if (opts.allowedUploaderLowers) {
    const set = new Set(opts.allowedUploaderLowers)
    scopedUsers = scopedUsers.filter((u) => set.has(u.username.toLowerCase()))
  }
  if (deptFilter) {
    scopedUsers = scopedUsers.filter((u) => deptNamesMatch(deptFilter, u.dept))
  }

  const whereParts = ['s.created_at >= ?', 's.created_at < ?']
  const whereParams: unknown[] = [dateFrom, toExclusive]
  if (opts.allowedJobCodes) {
    if (!opts.allowedJobCodes.length) {
      return emptyReport(fmtDate(dateFrom), fmtDate(dateTo), deptFilter, minUploads)
    }
    const ph = opts.allowedJobCodes.map(() => '?').join(', ')
    whereParts.push(`UPPER(TRIM(s.job_code)) IN (${ph})`)
    whereParams.push(...opts.allowedJobCodes.map((c) => String(c).trim().toUpperCase()))
  }
  if (opts.allowedUploaderLowers && opts.actor.uiRole !== 'recruiter') {
    if (!opts.allowedUploaderLowers.length) {
      return emptyReport(fmtDate(dateFrom), fmtDate(dateTo), deptFilter, minUploads)
    }
    const ph = opts.allowedUploaderLowers.map(() => '?').join(', ')
    whereParts.push(`LOWER(TRIM(COALESCE(s.uploader_username,''))) IN (${ph})`)
    whereParams.push(...opts.allowedUploaderLowers)
  }
  if (opts.actor.uiRole === 'recruiter') {
    const me = opts.actor.username.trim().toLowerCase()
    whereParts.push(`LOWER(TRIM(COALESCE(s.uploader_username,''))) = ?`)
    whereParams.push(me || '\0')
  }

  const sql = `SELECT
      LOWER(TRIM(COALESCE(s.uploader_username,''))) AS uploader_lower,
      s.match_score,
      s.pipeline_stage,
      lr.id AS report_id,
      lr.passed AS interview_passed,
      lr.overall_score AS interview_overall_score
    FROM resume_screenings s
    ${LATEST_REPORT_JOIN}
    WHERE ${whereParts.join(' AND ')}
      AND TRIM(COALESCE(s.uploader_username,'')) <> ''`

  let facts: ScreeningFact[] = []
  try {
    const [rows] = await opts.bizPool.query<RowDataPacket[]>(sql, whereParams)
    facts = (rows || []).map((r) => {
      const pip = String(r.pipeline_stage ?? '').trim()
      const hasReport = r.report_id != null
      const invited = pip === 'invited' || pip === 'report_done' || hasReport
      const interviewDone = hasReport || pip === 'report_done'
      let interviewPassed: boolean | null = null
      if (interviewDone && r.interview_passed != null) {
        interviewPassed =
          r.interview_passed === 1 ||
          r.interview_passed === true ||
          String(r.interview_passed) === '1'
      }
      const scoreRaw = r.interview_overall_score
      const interviewScore =
        scoreRaw != null && String(scoreRaw).trim() !== ''
          ? Math.max(0, Math.min(100, Number(scoreRaw) || 0))
          : null
      return {
        uploaderLower: String(r.uploader_lower || '').trim(),
        matchScore: Math.max(0, Math.min(100, Number(r.match_score) || 0)),
        invited,
        interviewDone,
        interviewPassed,
        interviewScore
      }
    })
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code
    if (code === 'ER_NO_SUCH_TABLE') throw new Error('MISSING_SCREENINGS_TABLE')
    if (code === 'ER_BAD_FIELD_ERROR') {
      const sqlFallback = sql.replace(/s\.pipeline_stage,\s*/g, '')
      const [rows] = await opts.bizPool.query<RowDataPacket[]>(sqlFallback, whereParams)
      facts = (rows || []).map((r) => {
        const hasReport = r.report_id != null
        return {
          uploaderLower: String(r.uploader_lower || '').trim(),
          matchScore: Math.max(0, Math.min(100, Number(r.match_score) || 0)),
          invited: hasReport,
          interviewDone: hasReport,
          interviewPassed:
            hasReport && r.interview_passed != null
              ? r.interview_passed === 1 || String(r.interview_passed) === '1'
              : null,
          interviewScore:
            hasReport && r.interview_overall_score != null
              ? Math.max(0, Math.min(100, Number(r.interview_overall_score) || 0))
              : null
        }
      })
    } else {
      throw e
    }
  }

  const agg = new Map<
    string,
    {
      uploadCount: number
      highQualityCount: number
      matchSum: number
      qualifiedCount: number
      qualifiedInvited: number
      invitedCount: number
      interviewDoneCount: number
      interviewPassCount: number
      interviewScoreSum: number
      interviewScoreN: number
    }
  >()

  const ensureAgg = (key: string) => {
    if (!agg.has(key)) {
      agg.set(key, {
        uploadCount: 0,
        highQualityCount: 0,
        matchSum: 0,
        qualifiedCount: 0,
        qualifiedInvited: 0,
        invitedCount: 0,
        interviewDoneCount: 0,
        interviewPassCount: 0,
        interviewScoreSum: 0,
        interviewScoreN: 0
      })
    }
    return agg.get(key)!
  }

  for (const f of facts) {
    if (!f.uploaderLower) continue
    const a = ensureAgg(f.uploaderLower)
    a.uploadCount += 1
    a.matchSum += f.matchScore
    if (f.matchScore >= HIGH_QUALITY_SCORE) a.highQualityCount += 1
    if (f.matchScore >= QUALIFIED_SCORE) {
      a.qualifiedCount += 1
      if (f.invited) a.qualifiedInvited += 1
    }
    if (f.invited) a.invitedCount += 1
    if (f.interviewDone) {
      a.interviewDoneCount += 1
      if (f.interviewPassed) a.interviewPassCount += 1
      if (f.interviewScore !== null) {
        a.interviewScoreSum += f.interviewScore
        a.interviewScoreN += 1
      }
    }
  }

  const displayKeys = new Set<string>()
  for (const u of scopedUsers) displayKeys.add(u.username.toLowerCase())
  for (const k of agg.keys()) displayKeys.add(k)

  const rows: RecruiterQualityRow[] = []
  for (const key of displayKeys) {
    const user = userByLower.get(key)
    if (user && !isRecruitingRole(user.role) && opts.actor.uiRole !== 'recruiter') continue
    const a = agg.get(key)
    const uploadCount = a?.uploadCount ?? 0
    if (uploadCount === 0 && !user) continue
    if (uploadCount === 0 && user && opts.actor.uiRole !== 'admin') continue

    const highQualityCount = a?.highQualityCount ?? 0
    const qualifiedCount = a?.qualifiedCount ?? 0
    const interviewDoneCount = a?.interviewDoneCount ?? 0
    const interviewPassCount = a?.interviewPassCount ?? 0
    const highQualityRate = pct(highQualityCount, uploadCount)
    const inviteRate = pct(a?.qualifiedInvited ?? 0, qualifiedCount)
    const interviewPassRate = interviewDoneCount ? pct(interviewPassCount, interviewDoneCount) : null
    const avgMatchScore = uploadCount ? round1((a?.matchSum ?? 0) / uploadCount) : 0
    const avgInterviewScore =
      a && a.interviewScoreN > 0 ? round1(a.interviewScoreSum / a.interviewScoreN) : null
    const sampleInsufficient = uploadCount < minUploads
    const qualityScore = sampleInsufficient
      ? null
      : computeQualityScore(highQualityRate, inviteRate, interviewPassRate)

    rows.push({
      dept: user?.dept || '（未登记）',
      username: user?.username || key,
      displayName: user?.name || key,
      role: user?.role || '—',
      uploadCount,
      highQualityCount,
      highQualityRate,
      avgMatchScore,
      qualifiedCount,
      invitedCount: a?.invitedCount ?? 0,
      inviteRate,
      interviewDoneCount,
      interviewPassCount,
      interviewPassRate,
      avgInterviewScore,
      qualityScore,
      sampleInsufficient
    })
  }

  rows.sort((a, b) => {
    const qa = a.qualityScore ?? -1
    const qb = b.qualityScore ?? -1
    if (qb !== qa) return qb - qa
    if (b.uploadCount !== a.uploadCount) return b.uploadCount - a.uploadCount
    return a.dept.localeCompare(b.dept, 'zh-CN') || a.displayName.localeCompare(b.displayName, 'zh-CN')
  })

  const summaryUpload = facts.length
  const summaryDone = facts.filter((f) => f.interviewDone).length
  const summaryPass = facts.filter((f) => f.interviewPassed).length
  const scored = rows.filter((r) => r.qualityScore !== null)
  const avgQualityScore = scored.length
    ? round1(scored.reduce((s, r) => s + (r.qualityScore ?? 0), 0) / scored.length)
    : null

  return {
    rows,
    summary: {
      uploadCount: summaryUpload,
      interviewDoneCount: summaryDone,
      interviewPassCount: summaryPass,
      avgQualityScore
    },
    meta: {
      dateFrom: fmtDate(dateFrom),
      dateTo: fmtDate(dateTo),
      deptFilter,
      minUploads,
      thresholds: { highQuality: HIGH_QUALITY_SCORE, qualified: QUALIFIED_SCORE }
    }
  }
}

function emptyReport(
  dateFrom: string,
  dateTo: string,
  deptFilter: string,
  minUploads: number
): RecruiterQualityReportResult {
  return {
    rows: [],
    summary: { uploadCount: 0, interviewDoneCount: 0, interviewPassCount: 0, avgQualityScore: null },
    meta: {
      dateFrom,
      dateTo,
      deptFilter,
      minUploads,
      thresholds: { highQuality: HIGH_QUALITY_SCORE, qualified: QUALIFIED_SCORE }
    }
  }
}

export async function recruiterQualityReportDeptOptions(
  adminPool: Pool,
  actor: { uiRole: RecruiterQualityUiRole; dept: string },
  allowedUploaderLowers: string[] | null
): Promise<string[]> {
  const [userRows] = await adminPool.query<RowDataPacket[]>(
    `SELECT username, dept, role FROM users WHERE username IS NOT NULL AND TRIM(username) <> ''`
  )
  const names = new Set<string>()
  for (const r of userRows || []) {
    const role = String(r.role ?? '').trim()
    if (!isRecruitingRole(role)) continue
    const dept = String(r.dept ?? '').trim()
    if (!dept || dept === '-') continue
    const un = String(r.username ?? '').trim().toLowerCase()
    if (allowedUploaderLowers && !allowedUploaderLowers.includes(un)) continue
    if (actor.uiRole === 'recruiting_manager') {
      const ud = String(actor.dept || '').trim()
      if (ud && ud !== '-' && !deptNamesMatch(ud, dept)) continue
    }
    names.add(dept)
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}
