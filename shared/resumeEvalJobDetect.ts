import type { ResumeEvalJobType } from './resumeEvalPrompt.ts'

const RISK_JOB_RE = /风控|反欺诈|信用|催收|合规|授信|风险/
const RISK_OPS_TITLE_RE = /风控|反欺诈|信用|催收|合规|授信|风险运营|策略运营|风控建模|风控研发/

const PRODUCT_TITLE_RE = /产品经理|product manager/i
const PRODUCT_JD_RE = /产品经理|原型设计|产品原型|需求说明书|Axure|墨刀|PRD|产品规划|用户故事/i

/** 研发/测试/运维/算法等 — 可用 tech_fit / code_quality */
const ENGINEERING_TITLE_RE =
  /(?:java|python|go|c\+\+|php|h5|react|vue|ios|android|安卓|嵌入式|前端|后端|全栈|测试|运维|架构|算法|机器学习|大数据|数据库|dba|devops|abap|mes|算子库|信息安全|系统(?:架构|分析|性能)|程序开发|技术经理|产品工程师|机械工程师|机器人|电气|软件算法|开发工程师|开发师|研发工程师|应用程序开发|风控研发|风控建模)/i

const ENGINEERING_JD_RE =
  /(?:java|spring|微服务|开发语言|代码|编程|接口开发|系统开发|软件工程|单元测试|ci\/cd|kubernetes|docker|hive|spark|etl|数仓|sql优化|性能调优)/i

/** 非写代码岗：项目/设计/运营/职能/实施/BA 等 */
const PROFESSIONAL_TITLE_RE =
  /项目经理|项目助理|交付经理|需求分析|业务分析|BA\b|UI|UED|美工|原画|交互设计|设计师|产品运营|数据运营|新媒体运营|运营专员|市场专员|招聘|HRBP|人事|行政|财务|文案|客服|客户服务|实施顾问|实施交付|业务顾问|解决方案|策划|培训|薪酬|成本估价|服务台|质量分析师|技术支持|技术顾问/i

const PROFESSIONAL_JD_RE =
  /项目管理|PMP|原型|需求文档|视觉设计|交互设计|运营推广|用户增长|招聘|人事|行政|财务|实施|交付|客户成功|商务|文案|策划案/i

/** 测试岗 JD 里「事前风控」等产品模块名不算风控运营岗 */
const ENGINEERING_TEST_TITLE_RE = /测试(?:工程师|开发|员|岗)?|软件测试|移动测试|大数据测试|质量保障|test engineer/i

export function isEngineeringJobTitle(title: string): boolean {
  const t = String(title || '').trim()
  if (!t) return false
  if (PROFESSIONAL_TITLE_RE.test(t) || PRODUCT_TITLE_RE.test(t) || RISK_OPS_TITLE_RE.test(t)) return false
  if (ENGINEERING_TEST_TITLE_RE.test(t)) return true
  return ENGINEERING_TITLE_RE.test(t)
}

export function isProfessionalJobTitle(title: string): boolean {
  return PROFESSIONAL_TITLE_RE.test(String(title || '').trim())
}

export function isProductJobTitle(title: string): boolean {
  const t = String(title || '').trim()
  if (/产品运营|产品工程师|产品开发工程师/.test(t)) return false
  return PRODUCT_TITLE_RE.test(t) || /需求分析|业务分析|BA\b/.test(t)
}

export function detectResumeEvalJobType(jobTitle: string, department: string, jdText: string): ResumeEvalJobType {
  const title = String(jobTitle || '').trim()
  const blob = `${title} ${department} ${jdText}`

  if (ENGINEERING_TEST_TITLE_RE.test(title) && !RISK_OPS_TITLE_RE.test(title)) {
    return 'engineering'
  }
  if (isProductJobTitle(title)) return 'product'
  if (RISK_OPS_TITLE_RE.test(title)) return 'risk_ops'
  if (isEngineeringJobTitle(title)) return 'engineering'
  if (isProfessionalJobTitle(title)) return 'professional'

  if (PRODUCT_JD_RE.test(blob) && !ENGINEERING_JD_RE.test(blob) && !ENGINEERING_TITLE_RE.test(title)) {
    return 'product'
  }
  if (RISK_JOB_RE.test(blob) && !ENGINEERING_TEST_TITLE_RE.test(title)) return 'risk_ops'
  if (ENGINEERING_JD_RE.test(blob) || ENGINEERING_TITLE_RE.test(blob)) return 'engineering'
  if (PROFESSIONAL_JD_RE.test(blob)) return 'professional'

  return 'professional'
}
