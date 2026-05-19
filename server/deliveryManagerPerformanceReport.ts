import type { Pool, RowDataPacket } from 'mysql2/promise'

export type DeliveryPerformanceUiRole = 'admin' | 'delivery_manager' | 'recruiter' | 'recruiting_manager'

const LATEST_REPORT_JOIN = `LEFT JOIN interview_reports lr ON lr.id = (
  SELECT ir.id
  FROM interview_reports ir
  WHERE CONVERT(TRIM(ir.job_code) USING utf8mb4) COLLATE utf8mb4_unicode_ci =
        CONVERT(TRIM(s.job_code) USING utf8mb4) COLLATE utf8mb4_unicode_ci
    AND (
      (
        TRIM(COALESCE(ir.candidate_phone, '')) <> ''
        AND TRIM(COALESCE(s.candidate_phone, '')) <> ''
        AND CONVERT(TRIM(ir.candidate_phone) USING utf8mb4) COLLATE utf8mb4_unicode_ci =
            CONVERT(TRIM(s.candidate_phone) USING utf8mb4) COLLATE utf8mb4_unicode_ci
      )
      OR (
        CONVERT(TRIM(ir.candidate_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci =
        CONVERT(TRIM(s.candidate_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci
      )
    )
  ORDER BY ir.updated_at DESC, ir.id DESC
  LIMIT 1
)`

type AdminUserRow = {
  username: string
  name: string
  dept: string
  role: string
}

type ProjectJobRow = {
  projectId: string
  projectName: string
  projectDept: string
  manager: string
  managerKey: string
  jobCode: string
  jobTitle: string
  demand: number
}

type ScreeningFact = {
  jobCode: string
  createdAt: Date | null
  jobCreatedAt: Date | null
  invited: boolean
  interviewDone: boolean
  interviewPassed: boolean
}

type ManagerAgg = {
  projectIds: Set<string>
  jobCodes: Set<string>
  demandCount: number
  resumeCount: number
  invitedCount: number
  interviewDoneCount: number
  interviewPassCount: number
  firstPushHours: number[]
  riskJobCodes: Set<string>
  detail: Map<
    string,
    {
      projectName: string
      jobTitle: string
      demand: number
      resumeCount: number
      invitedCount: number
      interviewDoneCount: number
      interviewPassCount: number
      firstPushHours: number | null
      risk: boolean
    }
  >
}

export type DeliveryManagerPerformanceRow = {
  manager: string
  username: string
  dept: string
  projectCount: number
  jobCount: number
  demandCount: number
  resumeCount: number
  invitedCount: number
  interviewDoneCount: number
  interviewPassCount: number
  completionRate: number
  inviteRate: number
  interviewRate: number
  passRate: number | null
  avgFirstPushHours: number | null
  riskJobCount: number
  performanceScore: number
  details: Array<{
    jobCode: string
    projectName: string
    jobTitle: string
    demand: number
    resumeCount: number
    invitedCount: number
    interviewDoneCount: number
    interviewPassCount: number
    firstPushHours: number | null
    risk: boolean
  }>
}

export type DeliveryManagerPerformanceResult = {
  rows: DeliveryManagerPerformanceRow[]
  summary: {
    projectCount: number
    jobCount: number
    demandCount: number
    resumeCount: number
    invitedCount: number
    interviewDoneCount: number
    interviewPassCount: number
    completionRate: number
    riskJobCount: number
    avgPerformanceScore: number | null
  }
  meta: {
    dateFrom: string
    dateTo: string
    managerFilter: string
    scoring: {
      completionWeight: number
      passRateWeight: number
      interviewRateWeight: number
      timelinessWeight: number
      riskControlWeight: number
    }
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

function pct(num: number, den: number): number {
  if (!den) return 0
  return round1((num / den) * 100)
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n))
}

function managerKey(v: string): string {
  return String(v || '').trim().toLowerCase()
}

function isDeliveryRole(role: string): boolean {
  return /交付/.test(String(role || '').trim())
}

function newAgg(): ManagerAgg {
  return {
    projectIds: new Set(),
    jobCodes: new Set(),
    demandCount: 0,
    resumeCount: 0,
    invitedCount: 0,
    interviewDoneCount: 0,
    interviewPassCount: 0,
    firstPushHours: [],
    riskJobCodes: new Set(),
    detail: new Map()
  }
}

function computePerformanceScore(input: {
  completionRate: number
  passRate: number | null
  interviewRate: number
  avgFirstPushHours: number | null
  riskJobCount: number
  jobCount: number
}): number {
  const completion = clampPct(input.completionRate)
  const pass = input.passRate == null ? 0 : clampPct(input.passRate)
  const interview = clampPct(input.interviewRate)
  const timeliness =
    input.avgFirstPushHours == null
      ? 0
      : input.avgFirstPushHours <= 24
        ? 100
        : input.avgFirstPushHours <= 72
          ? 80
          : input.avgFirstPushHours <= 168
            ? 60
            : 30
  const riskControl = input.jobCount ? clampPct(((input.jobCount - input.riskJobCount) / input.jobCount) * 100) : 100
  return round1(completion * 0.4 + pass * 0.2 + interview * 0.15 + timeliness * 0.15 + riskControl * 0.1)
}

export async function buildDeliveryManagerPerformanceReport(opts: {
  bizPool: Pool
  adminPool: Pool
  actor: { username: string; displayName: string; uiRole: DeliveryPerformanceUiRole; dept: string }
  query: Record<string, unknown>
}): Promise<DeliveryManagerPerformanceResult> {
  const now = new Date()
  const defaultFrom = new Date(now)
  defaultFrom.setDate(defaultFrom.getDate() - 30)
  const dateFrom = parseDateParam(opts.query.dateFrom ?? opts.query.from, defaultFrom)
  const dateTo = parseDateParam(opts.query.dateTo ?? opts.query.to, now)
  const toExclusive = new Date(dateTo)
  toExclusive.setDate(toExclusive.getDate() + 1)
  const managerFilter = String(opts.query.manager ?? '').trim()

  const [adminRows] = await opts.adminPool.query<RowDataPacket[]>(
    `SELECT username, name, dept, role FROM users WHERE status = '正常' OR status IS NULL OR TRIM(status) = ''`
  )
  const deliveryUsers: AdminUserRow[] = (adminRows || [])
    .map((r) => ({
      username: String(r.username ?? '').trim(),
      name: String(r.name ?? '').trim(),
      dept: String(r.dept ?? '').trim() || '-',
      role: String(r.role ?? '').trim()
    }))
    .filter((u) => u.username && isDeliveryRole(u.role))

  const userByName = new Map<string, AdminUserRow>()
  const userByUsername = new Map<string, AdminUserRow>()
  for (const u of deliveryUsers) {
    if (u.name) userByName.set(managerKey(u.name), u)
    if (u.username) userByUsername.set(managerKey(u.username), u)
  }

  const [deptRows] = await opts.adminPool.query<RowDataPacket[]>(
    `SELECT name, manager FROM depts WHERE TRIM(COALESCE(name, '')) <> ''`
  )
  const managerByDept = new Map<string, string>()
  for (const r of deptRows || []) {
    const dept = String(r.name ?? '').trim()
    const manager = String(r.manager ?? '').trim()
    if (dept && manager && manager !== '-') managerByDept.set(managerKey(dept), manager)
  }

  const [jobRows] = await opts.bizPool.query<RowDataPacket[]>(
    `SELECT
       p.id AS project_id,
       p.name AS project_name,
       p.dept AS project_dept,
       p.manager AS manager,
       j.job_code,
       j.title AS job_title,
       j.demand,
       j.created_at AS job_created_at
     FROM projects p
     INNER JOIN jobs j ON CONVERT(TRIM(j.project_id) USING utf8mb4) COLLATE utf8mb4_unicode_ci =
                          CONVERT(TRIM(p.id) USING utf8mb4) COLLATE utf8mb4_unicode_ci
     WHERE TRIM(COALESCE(p.manager, '')) <> ''
        OR TRIM(COALESCE(p.dept, '')) <> ''`
  )

  let projectJobs: ProjectJobRow[] = (jobRows || [])
    .map((r) => {
      const projectDept = String(r.project_dept ?? '').trim()
      const rawManager = String(r.manager ?? '').trim()
      const fallbackManager = managerByDept.get(managerKey(projectDept)) || projectDept
      const manager = rawManager || fallbackManager
      return {
        projectId: String(r.project_id ?? '').trim(),
        projectName: String(r.project_name ?? '').trim() || '-',
        projectDept,
        manager,
        managerKey: managerKey(manager),
        jobCode: String(r.job_code ?? '').trim().toUpperCase(),
        jobTitle: String(r.job_title ?? '').trim() || String(r.job_code ?? '').trim(),
        demand: Math.max(0, Math.floor(Number(r.demand) || 0))
      }
    })
    .filter((r) => r.projectId && r.manager && r.jobCode)

  if (opts.actor.uiRole === 'delivery_manager') {
    const names = new Set([managerKey(opts.actor.displayName), managerKey(opts.actor.username)].filter(Boolean))
    projectJobs = projectJobs.filter((r) => names.has(r.managerKey))
  }
  if (managerFilter) {
    const mf = managerKey(managerFilter)
    projectJobs = projectJobs.filter((r) => r.managerKey.includes(mf) || managerKey(r.manager).includes(mf))
  }

  if (!projectJobs.length) {
    return emptyReport(fmtDate(dateFrom), fmtDate(dateTo), managerFilter)
  }

  const jobCodes = [...new Set(projectJobs.map((r) => r.jobCode))]
  const ph = jobCodes.map(() => '?').join(', ')
  const [factRows] = await opts.bizPool.query<RowDataPacket[]>(
    `SELECT
       UPPER(TRIM(s.job_code)) AS job_code,
       s.created_at AS screening_created_at,
       j.created_at AS job_created_at,
       s.pipeline_stage,
       inv.id AS invitation_id,
       lr.id AS report_id,
       lr.passed AS interview_passed
     FROM resume_screenings s
     LEFT JOIN jobs j ON CONVERT(UPPER(TRIM(j.job_code)) USING utf8mb4) COLLATE utf8mb4_unicode_ci =
                         CONVERT(UPPER(TRIM(s.job_code)) USING utf8mb4) COLLATE utf8mb4_unicode_ci
     LEFT JOIN interview_invitations inv ON inv.resume_screening_id = s.id
     ${LATEST_REPORT_JOIN}
     WHERE s.created_at >= ?
       AND s.created_at < ?
       AND UPPER(TRIM(s.job_code)) IN (${ph})`,
    [dateFrom, toExclusive, ...jobCodes]
  )

  const facts: ScreeningFact[] = (factRows || []).map((r) => {
    const pip = String(r.pipeline_stage ?? '').trim()
    const hasReport = r.report_id != null
    const hasInvite = r.invitation_id != null
    return {
      jobCode: String(r.job_code ?? '').trim().toUpperCase(),
      createdAt: r.screening_created_at ? new Date(r.screening_created_at as Date) : null,
      jobCreatedAt: r.job_created_at ? new Date(r.job_created_at as Date) : null,
      invited: hasInvite || pip === 'invited' || pip === 'report_done' || hasReport,
      interviewDone: hasReport || pip === 'report_done',
      interviewPassed:
        hasReport &&
        (r.interview_passed === 1 || r.interview_passed === true || String(r.interview_passed) === '1')
    }
  })

  const factsByJob = new Map<string, ScreeningFact[]>()
  for (const f of facts) {
    if (!factsByJob.has(f.jobCode)) factsByJob.set(f.jobCode, [])
    factsByJob.get(f.jobCode)!.push(f)
  }

  const aggs = new Map<string, ManagerAgg>()
  const managerDisplay = new Map<string, string>()
  for (const pj of projectJobs) {
    if (!aggs.has(pj.managerKey)) aggs.set(pj.managerKey, newAgg())
    managerDisplay.set(pj.managerKey, pj.manager)
    const a = aggs.get(pj.managerKey)!
    a.projectIds.add(pj.projectId)
    a.jobCodes.add(pj.jobCode)
    a.demandCount += pj.demand
    const jf = factsByJob.get(pj.jobCode) || []
    const resumeCount = jf.length
    const invitedCount = jf.filter((f) => f.invited).length
    const interviewDoneCount = jf.filter((f) => f.interviewDone).length
    const interviewPassCount = jf.filter((f) => f.interviewPassed).length
    const first = jf
      .filter((f) => f.createdAt && f.jobCreatedAt)
      .sort((x, y) => (x.createdAt!.getTime() || 0) - (y.createdAt!.getTime() || 0))[0]
    const firstPushHours =
      first?.createdAt && first.jobCreatedAt
        ? Math.max(0, round1((first.createdAt.getTime() - first.jobCreatedAt.getTime()) / 36e5))
        : null
    const risk = pj.demand > interviewPassCount && (resumeCount === 0 || interviewDoneCount === 0 || interviewPassCount === 0)
    if (risk) a.riskJobCodes.add(pj.jobCode)
    if (firstPushHours != null) a.firstPushHours.push(firstPushHours)
    a.resumeCount += resumeCount
    a.invitedCount += invitedCount
    a.interviewDoneCount += interviewDoneCount
    a.interviewPassCount += interviewPassCount
    a.detail.set(pj.jobCode, {
      projectName: pj.projectName,
      jobTitle: pj.jobTitle,
      demand: pj.demand,
      resumeCount,
      invitedCount,
      interviewDoneCount,
      interviewPassCount,
      firstPushHours,
      risk
    })
  }

  const rows: DeliveryManagerPerformanceRow[] = []
  for (const [key, a] of aggs) {
    const display = managerDisplay.get(key) || key
    const user = userByName.get(key) || userByUsername.get(key)
    const avgFirstPushHours = a.firstPushHours.length
      ? round1(a.firstPushHours.reduce((s, n) => s + n, 0) / a.firstPushHours.length)
      : null
    const completionRate = pct(a.interviewPassCount, a.demandCount)
    const inviteRate = pct(a.invitedCount, a.resumeCount)
    const interviewRate = pct(a.interviewDoneCount, a.resumeCount)
    const passRate = a.interviewDoneCount ? pct(a.interviewPassCount, a.interviewDoneCount) : null
    const riskJobCount = a.riskJobCodes.size
    const performanceScore = computePerformanceScore({
      completionRate,
      passRate,
      interviewRate,
      avgFirstPushHours,
      riskJobCount,
      jobCount: a.jobCodes.size
    })
    rows.push({
      manager: user?.name || display,
      username: user?.username || '',
      dept: user?.dept || '-',
      projectCount: a.projectIds.size,
      jobCount: a.jobCodes.size,
      demandCount: a.demandCount,
      resumeCount: a.resumeCount,
      invitedCount: a.invitedCount,
      interviewDoneCount: a.interviewDoneCount,
      interviewPassCount: a.interviewPassCount,
      completionRate,
      inviteRate,
      interviewRate,
      passRate,
      avgFirstPushHours,
      riskJobCount,
      performanceScore,
      details: [...a.detail.entries()]
        .map(([jobCode, d]) => ({ jobCode, ...d }))
        .sort((x, y) => Number(y.risk) - Number(x.risk) || y.demand - x.demand || x.jobCode.localeCompare(y.jobCode))
    })
  }

  rows.sort((a, b) => b.performanceScore - a.performanceScore || b.demandCount - a.demandCount)

  const totals = rows.reduce(
    (acc, r) => {
      acc.projectCount += r.projectCount
      acc.jobCount += r.jobCount
      acc.demandCount += r.demandCount
      acc.resumeCount += r.resumeCount
      acc.invitedCount += r.invitedCount
      acc.interviewDoneCount += r.interviewDoneCount
      acc.interviewPassCount += r.interviewPassCount
      acc.riskJobCount += r.riskJobCount
      return acc
    },
    {
      projectCount: 0,
      jobCount: 0,
      demandCount: 0,
      resumeCount: 0,
      invitedCount: 0,
      interviewDoneCount: 0,
      interviewPassCount: 0,
      riskJobCount: 0
    }
  )
  const avgPerformanceScore = rows.length
    ? round1(rows.reduce((s, r) => s + r.performanceScore, 0) / rows.length)
    : null

  return {
    rows,
    summary: {
      ...totals,
      completionRate: pct(totals.interviewPassCount, totals.demandCount),
      avgPerformanceScore
    },
    meta: {
      dateFrom: fmtDate(dateFrom),
      dateTo: fmtDate(dateTo),
      managerFilter,
      scoring: {
        completionWeight: 40,
        passRateWeight: 20,
        interviewRateWeight: 15,
        timelinessWeight: 15,
        riskControlWeight: 10
      }
    }
  }
}

function emptyReport(dateFrom: string, dateTo: string, managerFilter: string): DeliveryManagerPerformanceResult {
  return {
    rows: [],
    summary: {
      projectCount: 0,
      jobCount: 0,
      demandCount: 0,
      resumeCount: 0,
      invitedCount: 0,
      interviewDoneCount: 0,
      interviewPassCount: 0,
      completionRate: 0,
      riskJobCount: 0,
      avgPerformanceScore: null
    },
    meta: {
      dateFrom,
      dateTo,
      managerFilter,
      scoring: {
        completionWeight: 40,
        passRateWeight: 20,
        interviewRateWeight: 15,
        timelinessWeight: 15,
        riskControlWeight: 10
      }
    }
  }
}
