import assert from 'node:assert/strict'
import test from 'node:test'
import { guessCandidateNameFromFilename, isFilenameEnglishNoiseToken } from '../resumeFilenameName.ts'

test('guessCandidateNameFromFilename prefers Chinese name over Java tech prefix', () => {
  assert.equal(guessCandidateNameFromFilename('Java-赵远成-上海.pdf'), '赵远成')
  assert.equal(guessCandidateNameFromFilename('java-赵远成-上海.pdf'), '赵远成')
  assert.equal(guessCandidateNameFromFilename('申朴-Java-宋亚双-上海.pdf'), '宋亚双')
  assert.equal(guessCandidateNameFromFilename('申朴-测试-韩福成-北京.pdf'), '韩福成')
})

test('guessCandidateNameFromFilename ignores city stop words', () => {
  assert.equal(guessCandidateNameFromFilename('Python-李明-北京.pdf'), '李明')
})

test('guessCandidateNameFromFilename still accepts real English names', () => {
  assert.equal(guessCandidateNameFromFilename('John-Smith-resume.pdf'), 'John')
})

test('guessCandidateNameFromFilename picks person name before city in Shenpu role-name-city pattern', () => {
  assert.equal(guessCandidateNameFromFilename('申朴-需求分析-侯海洋-郑州.pdf'), '侯海洋')
  assert.equal(guessCandidateNameFromFilename('申朴-实施交付-李鹏-郑州.pdf'), '李鹏')
  assert.equal(guessCandidateNameFromFilename('申朴-需求分析-龙云飞-郑州.pdf'), '龙云飞')
})

test('guessCandidateNameFromFilename ignores generic resume labels without a person name', () => {
  assert.equal(guessCandidateNameFromFilename('应届毕业生个人简历 (1).docx'), '')
})

test('isFilenameEnglishNoiseToken blocks common stack keywords', () => {
  assert.equal(isFilenameEnglishNoiseToken('Java'), true)
  assert.equal(isFilenameEnglishNoiseToken('Python'), true)
  assert.equal(isFilenameEnglishNoiseToken('John'), false)
})
