import assert from 'node:assert/strict'
import { detectResumeEvalJobType } from '../../shared/resumeEvalPrompt.ts'

const testJd = `国泰海通测试需求
1.了解QC、JIRA等测试管理工具
工作内容：ETF做市策略端、一体化事前风控、商品期货等功能测试。`

assert.equal(detectResumeEvalJobType('中级测试工程师', '深圳招聘团队', testJd), 'engineering')
assert.equal(detectResumeEvalJobType('风控策略运营', '风险部', testJd), 'risk_ops')
assert.equal(detectResumeEvalJobType('后端开发工程师', '技术部', '信贷风控系统开发'), 'engineering')

console.log('resume-eval-job-type tests passed')
