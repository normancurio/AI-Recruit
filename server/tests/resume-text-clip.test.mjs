import assert from 'node:assert/strict'
import test from 'node:test'
import { clipResumeTextForAi } from '../../shared/resumeTextClip.ts'

test('clipResumeTextForAi keeps work section when resume exceeds limit', () => {
  const head = '张三\n手机：13800000000\n'.padEnd(12000, '个人简介文字')
  const work = '工作经历\n上海某某公司 全栈工程师 2019-2023\n对接过外汇买卖、贵金属衍生、贵金属租赁等代客业务系统。'
  const resume = head + '\n' + work
  const clipped = clipResumeTextForAi(resume, 15000)
  assert.match(clipped, /外汇买卖/)
  assert.match(clipped, /工作经历|上海某某公司/)
})

test('clipResumeTextForAi returns compact text unchanged when short', () => {
  const short = '姓名：李四\n工作经历\n某公司 Java 开发'
  assert.equal(clipResumeTextForAi(short, 15000), short.replace(/\s+/g, ' ').trim())
})
