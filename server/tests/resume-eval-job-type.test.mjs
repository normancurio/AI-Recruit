import assert from 'node:assert/strict'
import { detectResumeEvalJobType } from '../../shared/resumeEvalJobDetect.ts'

const testJd = `国泰海通测试需求
1.了解QC、JIRA等测试管理工具
工作内容：ETF做市策略端、一体化事前风控、商品期货等功能测试。`

assert.equal(detectResumeEvalJobType('中级测试工程师', '深圳招聘团队', testJd), 'engineering')
assert.equal(detectResumeEvalJobType('风控策略运营', '风险部', testJd), 'risk_ops')
assert.equal(detectResumeEvalJobType('后端开发工程师', '技术部', '信贷风控系统开发'), 'engineering')

assert.equal(detectResumeEvalJobType('高级产品经理', '产品部', 'Axure 原型设计'), 'product')
assert.equal(detectResumeEvalJobType('中级JAVA 开发工程师', '', ''), 'engineering')
assert.equal(detectResumeEvalJobType('项目经理', '交付部', 'PMP 项目管理'), 'professional')
assert.equal(detectResumeEvalJobType('UI设计师', '设计部', '视觉设计 Figma'), 'professional')
assert.equal(detectResumeEvalJobType('运营专员', '', '用户增长 运营推广'), 'professional')
assert.equal(detectResumeEvalJobType('未知岗位', '', ''), 'professional')

import { finalizeResumeEvalDimensionScores } from '../../shared/resumeEvalDimensions.ts'
const riskDim = {
  risk_fit: { score: 0, evidence: ['证据点：技术/岗位匹配｜摘录：掌握 sql'] },
  data_skill: { score: 70, evidence: ['证据点：数据能力｜摘录：SQL 数据库增删改查'] },
  depth: { score: 60, evidence: [] },
  impact: { score: 50, evidence: [] },
  stability_growth: { score: 80, evidence: [] },
  education_fit: { score: 60, evidence: [] },
}
const eng = finalizeResumeEvalDimensionScores(riskDim, 'engineering')
assert.ok(eng.tech_fit && eng.tech_fit.score >= 45)
assert.equal(eng.risk_fit, undefined)

const engAsPm = finalizeResumeEvalDimensionScores(
  {
    tech_fit: { score: 30, evidence: ['证据点：工具｜摘录：Axure'] },
    code_quality: { score: 35, evidence: [] },
    engineering_depth: { score: 40, evidence: ['证据点：产品｜摘录：负责需求分析'] },
    impact: { score: 60, evidence: [] },
    stability_growth: { score: 40, evidence: [] },
    education_fit: { score: 50, evidence: [] },
  },
  'product'
)
assert.ok(engAsPm.product_fit)
assert.equal(engAsPm.code_quality, undefined)
assert.equal(engAsPm.tech_fit, undefined)

const engAsPro = finalizeResumeEvalDimensionScores(
  {
    tech_fit: { score: 30, evidence: ['证据点：工具｜摘录：PMP 项目管理'] },
    code_quality: { score: 35, evidence: [] },
    engineering_depth: { score: 40, evidence: ['证据点：项目｜摘录：负责交付实施'] },
    impact: { score: 60, evidence: [] },
    stability_growth: { score: 40, evidence: [] },
    education_fit: { score: 50, evidence: [] },
  },
  'professional'
)
assert.ok(engAsPro.role_fit)
assert.equal(engAsPro.code_quality, undefined)
assert.equal(engAsPro.tech_fit, undefined)

console.log('resume-eval-job-type tests passed')
