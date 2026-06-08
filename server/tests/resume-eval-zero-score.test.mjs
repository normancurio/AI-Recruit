import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const serverSource = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')

test('parse uses server job type and retries suspicious zero scores', () => {
  assert.match(serverSource, /resolveResumeEvalJobType/)
  assert.match(serverSource, /shouldRetryResumeEvalParse/)
  assert.match(serverSource, /normalizeResumeEvalDimensionsForJobType/)
  assert.match(serverSource, /ensureDimensionEvidenceMinimum/)
  assert.match(serverSource, /job_type: jobType/)
  assert.match(serverSource, /parseResumeEvalToScreeningResult\(text, params\.resumeText, \{/)
})

test('total score trusts dimension average when model returns zero total', () => {
  assert.match(
    serverSource,
    /rawInRange && rawTotal === 0 && input\.dimensionScore != null && input\.dimensionScore > 0/
  )
})
