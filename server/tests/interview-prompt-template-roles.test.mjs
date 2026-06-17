import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALL_INTERVIEW_PROMPT_ROLES,
  canEditPromptTemplate,
  canViewPromptTemplate,
  mergePromptRoleLists,
  normalizePromptRoleKey,
  normalizePromptRoleList
} from '../interviewPromptTemplateRoles.ts'

test('normalizePromptRoleKey maps Chinese and English aliases', () => {
  assert.equal(normalizePromptRoleKey('招聘专员'), 'recruiter')
  assert.equal(normalizePromptRoleKey('recruiter'), 'recruiter')
  assert.equal(normalizePromptRoleKey('平台管理员'), 'admin')
  assert.equal(normalizePromptRoleKey('AI面试官管理员'), 'ai_interviewer_manager')
  assert.equal(normalizePromptRoleKey('招聘经理'), 'recruiting_manager')
})

test('normalizePromptRoleList parses legacy JSON role arrays', () => {
  const roles = normalizePromptRoleList(JSON.stringify(['平台管理员', 'AI面试官管理员']))
  assert.deepEqual(roles, ['admin', 'ai_interviewer_manager'])
})

test('canViewPromptTemplate allows recruiter for legacy Chinese-only visible roles after migration merge', () => {
  const legacyOnly = { visibleRoles: ['平台管理员', 'AI面试官管理员'] }
  const recruiterActor = { uiRole: 'recruiter', roleNames: ['招聘专员'] }
  assert.equal(canViewPromptTemplate(recruiterActor, legacyOnly), false)

  const migrated = {
    visibleRoles: mergePromptRoleLists(
      normalizePromptRoleList(JSON.stringify(['平台管理员', 'AI面试官管理员'])),
      ALL_INTERVIEW_PROMPT_ROLES
    )
  }
  assert.equal(canViewPromptTemplate(recruiterActor, { visibleRoles: migrated }), true)
})

test('canViewPromptTemplate allows admin regardless of template visible roles', () => {
  const tpl = { visibleRoles: ['AI面试官管理员'] }
  assert.equal(canViewPromptTemplate({ uiRole: 'admin', roleNames: [] }, tpl), true)
})

test('canEditPromptTemplate respects editable roles', () => {
  const tpl = { editableRoles: ['admin', 'ai_interviewer_manager'] }
  assert.equal(canEditPromptTemplate({ uiRole: 'recruiter', roleNames: ['招聘专员'] }, tpl), false)
  assert.equal(
    canEditPromptTemplate({ uiRole: 'recruiter', roleNames: ['AI面试官管理员'] }, tpl),
    true
  )
})
