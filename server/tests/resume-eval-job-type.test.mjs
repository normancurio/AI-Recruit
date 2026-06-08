import assert from 'node:assert/strict'
import { detectResumeEvalJobType } from '../../shared/resumeEvalPrompt.ts'

const testJd = `国泰海通测试需求
1.了解QC、JIRA等测试管理工具
工作内容：ETF做市策略端、一体化事前风控、商品期货等功能测试。`

assert.equal(detectResumeEvalJobType('中级测试工程师', '深圳招聘团队', testJd), 'engineering')
assert.equal(detectResumeEvalJobType('风控策略运营', '风险部', testJd), 'risk_ops')
assert.equal(detectResumeEvalJobType('后端开发工程师', '技术部', '信贷风控系统开发'), 'engineering')

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

console.log('resume-eval-job-type tests passed')
