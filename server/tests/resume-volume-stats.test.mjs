import assert from 'node:assert/strict'
import test from 'node:test'
import { fillDailyCounts } from '../resumeVolumeStatsReport.ts'

test('fillDailyCounts fills missing days with zero', () => {
  const daily = fillDailyCounts(
    [
      { day: '2026-06-01', count: 3 },
      { day: '2026-06-03', count: 5 }
    ],
    '2026-06-01',
    '2026-06-03'
  )
  assert.deepEqual(daily, [
    { date: '2026-06-01', count: 3 },
    { date: '2026-06-02', count: 0 },
    { date: '2026-06-03', count: 5 }
  ])
})
