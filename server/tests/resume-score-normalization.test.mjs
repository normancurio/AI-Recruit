import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')

test('resume score parser does not clamp invalid model totals up to 100', () => {
  assert.match(source, /function normalizeResumeEvalTotalScore/)
  assert.match(source, /rawTotal >= 0 && rawTotal <= 100/)
  assert.doesNotMatch(source, /const totalScore = clampResumeScore\(Number\(parsed\.total_score\)\)/)
})

test('resume score parser caps scores when model says not recommended or hard gate failed', () => {
  assert.match(source, /decision === '不建议推进'/)
  assert.match(source, /hardGatePassed === false/)
  assert.match(source, /Math\.min\(score, 59\)/)
  assert.match(source, /Math\.min\(score, 49\)/)
})
