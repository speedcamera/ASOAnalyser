import { describe, expect, it } from 'vitest'
import { customRangeError, inclusiveCalendarDays, MAX_ANALYTICS_DAYS } from './analyticsLimits'

describe('analytics date range', () => {
  it('accepts the 7, 14, and 30 day product windows', () => {
    expect(inclusiveCalendarDays('2026-01-01', '2026-01-07')).toBe(7)
    expect(inclusiveCalendarDays('2026-01-01', '2026-01-14')).toBe(14)
    expect(inclusiveCalendarDays('2026-01-01', '2026-01-30')).toBe(30)
  })

  it('accepts a 90 day range and rejects a longer one', () => {
    expect(customRangeError('2026-01-01', '2026-03-31')).toBe('')
    expect(inclusiveCalendarDays('2026-01-01', '2026-03-31')).toBe(MAX_ANALYTICS_DAYS)
    expect(customRangeError('2026-01-01', '2026-04-01')).toBe('Date range must be 90 days or fewer')
  })

  it('rejects a reversed range', () => {
    expect(customRangeError('2026-02-02', '2026-02-01')).toBe(
      'Start date must be on or before the end date',
    )
  })
})
