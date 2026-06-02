import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractTermsMentionedInResumeRisk,
  filterContradictoryResumeRisks,
  riskContradictsResume,
  sanitizeDimensionEvidenceList
} from '../resumeRiskContradiction.ts'

test('extractTermsMentionedInResumeRisk pulls examples after 如', () => {
  const terms = extractTermsMentionedInResumeRisk(
    '缺乏明确的金融市场业务模块经验，如外汇买卖、贵金属衍生等代客业务系统'
  )
  assert.ok(terms.includes('外汇买卖'))
  assert.ok(terms.includes('贵金属衍生'))
})

test('riskContradictsResume when resume already mentions cited missing skill', () => {
  const resume =
    '对接过外汇买卖、贵金属衍生、贵金属租赁等代客业务系统，精熟金融租赁系统的月结和年结。'
  const risk = '缺乏明确的金融市场业务模块经验，如外汇买卖、贵金属衍生等'
  assert.equal(riskContradictsResume(risk, resume), true)
})

test('filterContradictoryResumeRisks removes contradictions but keeps others', () => {
  const resume = '对接过外汇买卖、贵金属衍生、贵金属租赁等代客业务系统。'
  const filtered = filterContradictoryResumeRisks(
    [
      { risk: '缺乏明确的金融市场业务模块经验，如外汇买卖、贵金属衍生等', interview_question: 'Q1' },
      { risk: '近期项目以反洗钱为主，需核验对目标岗位核心模块的独立负责深度', interview_question: 'Q2' }
    ],
    resume
  )
  assert.equal(filtered.length, 1)
  assert.match(filtered[0].risk, /反洗钱/)
})

test('sanitizeDimensionEvidenceList drops excerpts not found in resume', () => {
  const resume = '对接过外汇买卖、贵金属衍生、贵金属租赁等代客业务系统。'
  const kept = sanitizeDimensionEvidenceList(
    [
      '证据点：金融代客｜摘录：对接过外汇买卖、贵金属衍生',
      '证据点：编造经历｜摘录：从未出现的外星项目开发'
    ],
    resume
  )
  assert.equal(kept.length, 1)
  assert.match(kept[0], /外汇买卖/)
})
