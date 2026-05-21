import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')

test('upload task state does not drive the shenpu resume column', () => {
  const displayStart = source.indexOf('const displayResumes = useMemo(() => {')
  const displayEnd = source.indexOf('const hasDisplayResumes', displayStart)
  assert.notEqual(displayStart, -1)
  assert.notEqual(displayEnd, -1)
  const displayResumesSource = source.slice(displayStart, displayEnd)

  assert.doesNotMatch(displayResumesSource, /uploadTask\.shenpu/)
})

test('shenpu resume table cell does not render original-resume upload progress', () => {
  const headerStart = source.indexOf('cols.byId.shenpuResume')
  assert.notEqual(headerStart, -1)
  const cellStart = source.indexOf('<td className="px-2 py-3 text-xs">', headerStart)
  const actionCellStart = source.indexOf('<td\n                                className={`w-[12.5rem]', cellStart)
  assert.notEqual(cellStart, -1)
  assert.notEqual(actionCellStart, -1)
  const shenpuCellSource = source.slice(cellStart, actionCellStart)

  assert.doesNotMatch(shenpuCellSource, /isResumeUploading|uploadTaskRowFailed|uploadPct/)
  assert.match(shenpuCellSource, /resume\.shenpuResumeStatus === 'generating'/)
})
