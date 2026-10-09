import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCampaignWeeklyPerformance } from '../api'
import { clearAuthTokenGetter, setAuthTokenGetter } from '../auth/apiClient'
import { hasWeeklyPerformanceRange } from './Dashboard'

afterEach(() => {
  clearAuthTokenGetter()
  vi.unstubAllGlobals()
})

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

async function loadWeeklyPerformance(dateRange) {
  if (!hasWeeklyPerformanceRange(dateRange)) return null
  return fetchCampaignWeeklyPerformance({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  })
}

describe('weekly performance date guard', () => {
  it('does not request weekly performance when neither date is available', async () => {
    setAuthTokenGetter(async () => 'session-token')
    const fetchMock = vi.fn(async () => jsonResponse({ days: [], weeks: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await loadWeeklyPerformance({ startDate: null, endDate: null })
    await loadWeeklyPerformance({ startDate: '', endDate: '' })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not request weekly performance when only one date is available', async () => {
    setAuthTokenGetter(async () => 'session-token')
    const fetchMock = vi.fn(async () => jsonResponse({ days: [], weeks: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await loadWeeklyPerformance({ startDate: '2026-09-14', endDate: null })
    await loadWeeklyPerformance({ startDate: null, endDate: '2026-09-21' })
    await loadWeeklyPerformance({ startDate: '2026-09-14', endDate: '' })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requests weekly performance once both dates are available', async () => {
    setAuthTokenGetter(async () => 'session-token')
    const fetchMock = vi.fn(async () => jsonResponse({ days: [], weeks: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await loadWeeklyPerformance({ startDate: null, endDate: null })
    const result = await loadWeeklyPerformance({
      startDate: '2026-09-14',
      endDate: '2026-09-21',
    })

    expect(result).toEqual({ days: [], weeks: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/campaigns/weekly-performance?startDate=2026-09-14&endDate=2026-09-21',
    )
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('organisation')
  })

  it('requests weekly performance with the updated dates when the range changes', async () => {
    setAuthTokenGetter(async () => 'session-token')
    const fetchMock = vi.fn(async () => jsonResponse({ days: [], weeks: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await loadWeeklyPerformance({
      startDate: '2026-09-14',
      endDate: '2026-09-21',
    })
    await loadWeeklyPerformance({
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    })

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/campaigns/weekly-performance?startDate=2026-09-14&endDate=2026-09-21',
      '/api/campaigns/weekly-performance?startDate=2026-09-01&endDate=2026-09-30',
    ])
  })
})
