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
  assert.match(appSource, /setUploadTask\(null\)/)
  assert.match(appSource, /uploadTask\.status !== 'duplicate'/)
})
