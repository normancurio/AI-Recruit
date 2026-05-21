import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')

test('shenpu resume generation route uses collation-safe job_code join', () => {
  const routeStart = source.indexOf("app.post('/api/admin/resume-screenings/:id/shenpu-resume'")
  assert.notEqual(routeStart, -1)

  const nextRoute = source.indexOf('\napp.', routeStart + 1)
  const routeSource = source.slice(routeStart, nextRoute === -1 ? undefined : nextRoute)

  assert.match(routeSource, /resumeScreeningsJobCodeMatchSql\('j', 's'\)/)
  assert.doesNotMatch(routeSource, /LEFT JOIN jobs j ON\s+j\.job_code\s*=\s*s\.job_code/)
})
