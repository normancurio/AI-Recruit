import type { Request } from 'express'

/** GET /api/admin/resume-screenings 列表分页与筛选（简历管理、初面管理共用） */
export type ResumeScreeningsAdminListQuery = {
  projectId: string | null
  page: number
  pageSize: number
  jobCode: string
  /** 与岗位下拉 title 一致，用于岗位「全部」以外时与 job_code 组合匹配 matched_job_title */
  jobTitle: string
  candidate: string
  gender: 'all' | '男' | '女'
  education: string
  hasDegree: 'all' | '1' | '0'
  unified: 'all' | '1' | '0'
  verifiable: 'all' | '1' | '0'
  channel: string
  salary: string
  keyword: string
  /** 与 deriveScreeningFlowLabels 的 flowStage 文案一致 */
  flowStage: '' | '简历筛查完成' | '已发面试邀请' | 'AI面试完成'
  listScore: 'all' | 'high' | 'mid' | 'low'
}

function clampInt(n: unknown, def: number, min: number, max: number): number {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v)) return def
  return Math.min(max, Math.max(min, v))
}

export function parseResumeScreeningsAdminListQuery(req: Request): ResumeScreeningsAdminListQuery {
  const rawPid = String(req.query.projectId ?? req.query.project_id ?? '').trim()
  const projectId = rawPid.length ? rawPid : null
  const page = clampInt(req.query.page, 1, 1, 50_000)
  const pageSize = clampInt(req.query.pageSize ?? req.query.page_size, 20, 5, 100)
  const jobCode = String(req.query.jobCode ?? req.query.job_code ?? '').trim()
  const jobTitle = String(req.query.jobTitle ?? req.query.job_title ?? '').trim()
  const candidate = String(req.query.candidate ?? '').trim()
  const g = String(req.query.gender ?? 'all').trim()
  const gender: 'all' | '男' | '女' = g === '男' || g === '女' ? g : 'all'
  const education = String(req.query.education ?? '').trim()
  const hd = String(req.query.hasDegree ?? req.query.has_degree ?? 'all').trim()
  const hasDegree: 'all' | '1' | '0' = hd === '1' || hd === '0' ? hd : 'all'
  const un = String(req.query.unified ?? '').trim()
  const unified: 'all' | '1' | '0' = un === '1' || un === '0' ? un : 'all'
  const vb = String(req.query.verifiable ?? '').trim()
  const verifiable: 'all' | '1' | '0' = vb === '1' || vb === '0' ? vb : 'all'
  const channel = String(req.query.channel ?? '').trim()
  const salary = String(req.query.salary ?? '').trim()
  const keyword = String(req.query.keyword ?? '').trim()
  const fs = String(req.query.flowStage ?? req.query.flow_stage ?? '').trim()
  const flowStage: ResumeScreeningsAdminListQuery['flowStage'] =
    fs === '简历筛查完成' || fs === '已发面试邀请' || fs === 'AI面试完成' ? fs : ''
  const ls = String(req.query.listScore ?? req.query.list_score ?? 'all').trim().toLowerCase()
  const listScore: ResumeScreeningsAdminListQuery['listScore'] =
    ls === 'high' || ls === 'mid' || ls === 'low' ? ls : 'all'
  return {
    projectId,
    page,
    pageSize,
    jobCode,
    jobTitle,
    candidate,
    gender,
    education,
    hasDegree,
    unified,
    verifiable,
    channel,
    salary,
    keyword,
    flowStage,
    listScore
  }
}

function triTinySql(col: string, sel: 'all' | '1' | '0'): { sql: string; params: unknown[] } {
  if (sel === 'all') return { sql: '', params: [] }
  if (sel === '1') return { sql: ` AND ${col} = 1 `, params: [] }
  return { sql: ` AND ${col} = 0 `, params: [] }
}

function educationWhereSql(edu: string): { sql: string; params: unknown[] } {
  const e = edu.trim()
  if (!e) return { sql: '', params: [] }
  if (e === '高中') {
    return {
      sql: ` AND (prof.education LIKE '%高中%' OR prof.education LIKE '%中等%') `,
      params: []
    }
  }
  if (e === '大专') {
    return {
      sql: ` AND (prof.education LIKE '%大专%' OR prof.education LIKE '%专科%' OR prof.education LIKE '%高职%') `,
      params: []
    }
  }
  if (e === '本科') {
    return {
      sql: ` AND (prof.education LIKE '%本科%' OR prof.education LIKE '%学士%') `,
      params: []
    }
  }
  if (e === '研究生') {
    return {
      sql: ` AND (
          prof.education LIKE '%研究生%'
          OR prof.education LIKE '%硕士%'
          OR prof.education LIKE '%博士%'
          OR LOWER(prof.education) REGEXP 'master|ph[.]?d[.]?'
        ) `,
      params: []
    }
  }
  return { sql: ' AND prof.education LIKE ? ', params: [`%${e}%`] }
}

/**
 * @param hasReportJoin 主查询含 interview_reports 的 lr 别名时为 true；降级 plain 查询为 false（不含 lr）
 */
export function buildResumeScreeningsAdminListWhere(
  q: ResumeScreeningsAdminListQuery,
  hasReportJoin: boolean
): { whereSql: string; whereParams: unknown[] } {
  const parts: string[] = []
  const params: unknown[] = []

  const jc = q.jobCode.trim()
  const jt = q.jobTitle.trim()
  if (jc) {
    if (jt) {
      parts.push(
        ` AND (
            TRIM(s.job_code) = ?
            OR TRIM(COALESCE(s.matched_job_title,'')) = ?
            OR LOWER(TRIM(COALESCE(s.matched_job_title,''))) LIKE LOWER(?)
            OR LOWER(?) LIKE CONCAT('%', LOWER(TRIM(COALESCE(s.matched_job_title,''))), '%')
          ) `
      )
      const like = `%${jt.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`
      params.push(jc, jt, like, jt)
    } else {
      parts.push(' AND TRIM(s.job_code) = ? ')
      params.push(jc)
    }
  }

  const cand = q.candidate.trim()
  if (cand) {
    parts.push(' AND LOWER(TRIM(s.candidate_name)) LIKE LOWER(?) ')
    const esc = cand.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    params.push(`%${esc}%`)
  }

  if (q.gender !== 'all') {
    parts.push(' AND TRIM(COALESCE(prof.gender, \'\')) = ? ')
    params.push(q.gender)
  }

  const eduW = educationWhereSql(q.education)
  parts.push(eduW.sql)
  params.push(...eduW.params)

  const hdW = triTinySql('prof.has_degree', q.hasDegree)
  parts.push(hdW.sql)
  params.push(...hdW.params)
  const unW = triTinySql('prof.is_unified_enrollment', q.unified)
  parts.push(unW.sql)
  params.push(...unW.params)
  const vbW = triTinySql('prof.verifiable', q.verifiable)
  parts.push(vbW.sql)
  params.push(...vbW.params)

  const ch = q.channel.trim()
  if (ch) {
    if (ch === 'Boss 直聘') {
      parts.push(
        ` AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(prof.recruitment_channel,''))),' ',''),'　','') LIKE '%boss%'
          AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(prof.recruitment_channel,''))),' ',''),'　','') LIKE '%直聘%' `
      )
    } else {
      parts.push(' AND prof.recruitment_channel LIKE ? ')
      params.push(`%${ch.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`)
    }
  }

  const sal = q.salary.trim()
  if (sal) {
    parts.push(' AND COALESCE(prof.expected_salary, \'\') LIKE ? ')
    params.push(`%${sal.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`)
  }

  const kw = q.keyword.trim().toLowerCase()
  if (kw) {
    parts.push(
      ` AND LOWER(CONCAT_WS('\\n',
            COALESCE(s.candidate_name,''),
            COALESCE(s.candidate_phone,''),
            COALESCE(s.matched_job_title,''),
            COALESCE(s.job_code,''),
            COALESCE(s.report_summary,''),
            COALESCE(s.status,''),
            COALESCE(s.uploader_username,''),
            COALESCE(TRIM(pn.name),'')
          )) LIKE ? `
    )
    const esc = kw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    params.push(`%${esc}%`)
  }

  if (q.flowStage) {
    if (hasReportJoin) {
      if (q.flowStage === 'AI面试完成') {
        parts.push(` AND (lr.id IS NOT NULL OR TRIM(COALESCE(s.pipeline_stage,'')) = 'report_done') `)
      } else if (q.flowStage === '已发面试邀请') {
        parts.push(` AND TRIM(COALESCE(s.pipeline_stage,'')) = 'invited' AND lr.id IS NULL `)
      } else if (q.flowStage === '简历筛查完成') {
        parts.push(
          ` AND TRIM(COALESCE(s.pipeline_stage,'')) NOT IN ('invited','report_done') AND lr.id IS NULL `
        )
      }
    } else {
      if (q.flowStage === 'AI面试完成') {
        parts.push(` AND TRIM(COALESCE(s.pipeline_stage,'')) = 'report_done' `)
      } else if (q.flowStage === '已发面试邀请') {
        parts.push(` AND TRIM(COALESCE(s.pipeline_stage,'')) = 'invited' `)
      } else if (q.flowStage === '简历筛查完成') {
        parts.push(` AND TRIM(COALESCE(s.pipeline_stage,'')) NOT IN ('invited','report_done') `)
      }
    }
  }

  if (q.listScore !== 'all') {
    if (hasReportJoin) {
      const scoreExpr =
        '(CASE WHEN lr.id IS NOT NULL THEN COALESCE(lr.overall_score, s.match_score) ELSE s.match_score END)'
      if (q.listScore === 'high') parts.push(` AND ${scoreExpr} >= 80 `)
      else if (q.listScore === 'mid') parts.push(` AND ${scoreExpr} >= 60 AND ${scoreExpr} < 80 `)
      else parts.push(` AND ${scoreExpr} < 60 `)
    } else {
      if (q.listScore === 'high') parts.push(' AND COALESCE(s.match_score,0) >= 80 ')
      else if (q.listScore === 'mid') parts.push(' AND COALESCE(s.match_score,0) >= 60 AND COALESCE(s.match_score,0) < 80 ')
      else parts.push(' AND COALESCE(s.match_score,0) < 60 ')
    }
  }

  return { whereSql: parts.join(''), whereParams: params }
}
