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

test('shenpu resume generation route loads current project template before generating', () => {
  const routeStart = source.indexOf("app.post('/api/admin/resume-screenings/:id/shenpu-resume'")
  assert.notEqual(routeStart, -1)

  const nextRoute = source.indexOf('\napp.', routeStart + 1)
  const routeSource = source.slice(routeStart, nextRoute === -1 ? undefined : nextRoute)

  assert.match(routeSource, /LEFT JOIN projects p ON \$\{resumeScreeningsProjectIdMatchSql\('p', 'j'\)\}/)
  assert.match(routeSource, /const projectTemplate = await loadProjectShenpuResumeTemplate\(row\)/)
  assert.match(routeSource, /template: projectTemplate/)
})

test('shenpu resume download refuses stale pdf when current project template is word', () => {
  const routeStart = source.indexOf("app.get('/api/admin/resume-screenings/:id/shenpu-resume'")
  assert.notEqual(routeStart, -1)

  const nextRoute = source.indexOf('\napp.', routeStart + 1)
  const routeSource = source.slice(routeStart, nextRoute === -1 ? undefined : nextRoute)

  assert.match(routeSource, /const projectTemplate = await loadProjectShenpuResumeTemplate\(r\)/)
  assert.match(routeSource, /shouldBeWord && !storedIsWord/)
  assert.match(routeSource, /请重新生成申朴简历/)
})
