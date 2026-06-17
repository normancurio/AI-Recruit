import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const serverSource = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')

test('server uses shared resume eval prompt and smart clip', () => {
  assert.match(serverSource, /from '\.\.\/shared\/resumeEvalPrompt'/)
  assert.match(serverSource, /from '\.\.\/shared\/resumeTextClip'/)
  assert.match(serverSource, /clipResumeTextForAi/)
  assert.match(serverSource, /buildResumeEvalUserPrompt/)
  assert.match(serverSource, /const def = kind === 'resume' \? 15000 : 3500/)
})

test('re-eval API endpoint exists', () => {
  assert.match(serverSource, /app\.post\('\/api\/admin\/resume-screenings\/:id\/re-eval'/)
  assert.match(serverSource, /async function reEvaluateResumeScreeningById/)
})

test('report modal deduplicates summary and offers re-eval', () => {
  assert.match(appSource, /function reportSummaryBodyText/)
  assert.match(appSource, /function reportHasStructuredSections/)
  assert.match(appSource, /re-eval/)
  assert.match(appSource, /重新 AI 评估/)
})
