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

test('fillDailyCounts accepts Date objects from mysql2 DATE columns', () => {
  const daily = fillDailyCounts(
    [{ day: new Date('2026-06-02T00:00:00'), count: 7 }],
    '2026-06-02',
    '2026-06-02'
  )
  assert.deepEqual(daily, [{ date: '2026-06-02', count: 7 }])
})
