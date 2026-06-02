import assert from 'node:assert/strict'
import test from 'node:test'
import { stripChinesePersonNameSuffix } from '../candidateNameNormalize.ts'
import { guessCandidateNameFromFilename } from '../resumeFilenameName.ts'

test('stripChinesePersonNameSuffix removes gender and ethnicity tail', () => {
  assert.equal(stripChinesePersonNameSuffix('宋亚双男汉'), '宋亚双')
  assert.equal(stripChinesePersonNameSuffix('张鑫男'), '张鑫')
  assert.equal(stripChinesePersonNameSuffix('许胜性别'), '许胜')
  assert.equal(stripChinesePersonNameSuffix('李明女汉'), '李明')
  assert.equal(stripChinesePersonNameSuffix('王五'), '王五')
})

test('guessCandidateNameFromFilename still returns clean Shenpu names', () => {
  assert.equal(guessCandidateNameFromFilename('申朴-Java-宋亚双-上海.pdf'), '宋亚双')
  assert.equal(guessCandidateNameFromFilename('申朴-Java-许胜-上海.pdf'), '许胜')
})
