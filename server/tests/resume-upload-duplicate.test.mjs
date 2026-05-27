import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const serverSource = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')

test('duplicate resume upload is a prompt state, not failed', () => {
  assert.match(serverSource, /type ResumeScreenTaskStatus = 'queued' \| 'running' \| 'done' \| 'failed' \| 'duplicate'/)
  assert.match(serverSource, /const duplicate = e instanceof ResumeScreenTaskError && e\.statusCode === 409/)
  assert.match(serverSource, /status: duplicate \? 'duplicate' : 'failed'/)
  assert.match(serverSource, /uploadStage: duplicate \? '该简历已存在，无需重复上传' : '原始简历提取失败'/)
})

test('duplicate resume upload shows existing-copy text in admin UI', () => {
  assert.match(appSource, /status: 'queued' \| 'running' \| 'done' \| 'failed' \| 'duplicate'/)
  assert.match(appSource, /uploadTaskDuplicate/)
  assert.match(appSource, /简历已存在/)
  assert.match(appSource, /已存在/)
})

test('duplicate resume upload uses modal prompt without adding a placeholder row', () => {
  assert.match(appSource, /setScreeningAdminMsg\(\{\s*title: '简历已存在'/)
  assert.match(appSource, /setUploadTasks\(\(prev\) => prev\.filter\(\(t\) => t\.taskId !== duplicate\.taskId\)\)/)
  assert.match(appSource, /task\.status !== 'duplicate'/)
})

test('resume upload UI keeps multiple parsing rows stable', () => {
  assert.match(appSource, /const \[uploadTasks, setUploadTasks\] = useState<ResumeUploadTask\[\]>\(\[\]\)/)
  assert.match(appSource, /const uploadTask = uploadTasks\[0\] \|\| null/)
  assert.match(appSource, /for \(const task of uploadTasks\)/)
  assert.match(appSource, /id: `upload-task:\$\{task\.taskId\}`/)
  assert.match(appSource, /return \[\.\.\.placeholders, \.\.\.decorated\]/)
  assert.doesNotMatch(appSource, /setUploadTask\(null\)/)
})

test('resume upload rejects template/file labels as candidate names', () => {
  assert.match(serverSource, /NON_PERSON_CANDIDATE_NAME_RE/)
  assert.match(serverSource, /RESUME_SECTION_TITLE_NAME_RE/)
  assert.match(serverSource, /工作背景\|工作经历\|工作经验/)
  assert.match(serverSource, /申朴简历/)
  assert.match(serverSource, /简历\|模板\|测试\|岗位\|项目/)
  assert.match(serverSource, /if \(NON_PERSON_CANDIDATE_NAME_RE\.test\(n\)\) return ''/)
})

test('resume upload candidate name uses resume content before filename fallback', () => {
  assert.match(serverSource, /const contactBlockName = t\.match/)
  assert.match(serverSource, /\(\?:电话\|手机\|邮箱\|生日\|现居\|院校\)/)
  assert.match(serverSource, /for \(let i = parts\.length - 1; i >= 0; i -= 1\) candidates\.push\(parts\[i\]!\)/)
  assert.doesNotMatch(serverSource, /if \(i > 0\) candidates\.push\(parts\[i - 1\]!\)/)
  assert.match(serverSource, /return resume \|\| ai \|\| file \|\| '候选人'/)
})
