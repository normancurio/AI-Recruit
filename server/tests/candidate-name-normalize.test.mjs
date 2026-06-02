import assert from 'node:assert/strict'
import test from 'node:test'
import { stripChinesePersonNameSuffix, isResumeSectionMisidentifiedName } from '../candidateNameNormalize.ts'
import { guessCandidateNameFromFilename } from '../resumeFilenameName.ts'

test('stripChinesePersonNameSuffix removes gender and ethnicity tail', () => {
  assert.equal(stripChinesePersonNameSuffix('宋亚双男汉'), '宋亚双')
  assert.equal(stripChinesePersonNameSuffix('张鑫男'), '张鑫')
  assert.equal(stripChinesePersonNameSuffix('许胜性别'), '许胜')
  assert.equal(stripChinesePersonNameSuffix('李明女汉'), '李明')
  assert.equal(stripChinesePersonNameSuffix('王五'), '王五')
})

test('stripChinesePersonNameSuffix removes resume section labels', () => {
  assert.equal(stripChinesePersonNameSuffix('男刘璋'), '刘璋')
  assert.equal(stripChinesePersonNameSuffix('肖鹏求职意向'), '肖鹏')
  assert.equal(stripChinesePersonNameSuffix('代应豪专业技能'), '代应豪')
  assert.equal(stripChinesePersonNameSuffix('赵思宇学校'), '赵思宇')
})

test('isResumeSectionMisidentifiedName flags section and city tokens', () => {
  assert.equal(isResumeSectionMisidentifiedName('资质技能'), true)
  assert.equal(isResumeSectionMisidentifiedName('北京市'), true)
  assert.equal(isResumeSectionMisidentifiedName('河北省邯郸市'), true)
  assert.equal(isResumeSectionMisidentifiedName('男刘璋'), true)
  assert.equal(isResumeSectionMisidentifiedName('朱振宇'), false)
})

test('guessCandidateNameFromFilename still returns clean Shenpu names', () => {
  assert.equal(guessCandidateNameFromFilename('申朴-Java-宋亚双-上海.pdf'), '宋亚双')
  assert.equal(guessCandidateNameFromFilename('申朴-Java-许胜-上海.pdf'), '许胜')
})
