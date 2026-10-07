import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchApps,
  fetchBidExperimentSettings,
  fetchBidExperiments,
  fetchCampaignWeeklyPerformance,
  fetchGoals,
  fetchImports,
  fetchPeriodCompare,
  updateCampaignSegment,
} from '../api'
import {
  ApiError,
  apiFetch,
  canLoadApplication,
  clearAuthTokenGetter,
  readApiJson,
  setAuthTokenGetter,
  tenantStateKey,
} from './apiClient'

afterEach(() => {
  clearAuthTokenGetter()
  vi.unstubAllGlobals()
})

describe('auth session gate', () => {
  it('does not load the application while Clerk is unresolved', () => {
    expect(canLoadApplication({ isLoaded: false, isSignedIn: false })).toBe(false)
    expect(canLoadApplication({ isLoaded: false, isSignedIn: true })).toBe(false)
  })

  it('does not load the application when signed out', () => {
    expect(canLoadApplication({ isLoaded: true, isSignedIn: false })).toBe(false)
  })

  it('loads the application only after a signed-in session is ready', () => {
    expect(canLoadApplication({ isLoaded: true, isSignedIn: true })).toBe(true)
  })

  it('changes the tenant state key when the Clerk user changes', () => {
    expect(tenantStateKey('user_a')).not.toBe(tenantStateKey('user_b'))
    expect(tenantStateKey(null)).toBe('signed-out')
  })
})

describe('authenticated API client', () => {
  it('sends the Clerk session token and does not send an organisation id', async () => {
    setAuthTokenGetter(async () => 'session-token')
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/api/imports?organisationId=1', {
      headers: { 'x-organisation-id': '1' },
    })

    expect(fetchMock.mock.calls[0][0]).toBe('/api/imports')
    const headers = new Headers(fetchMock.mock.calls[0][1].headers)
    expect(headers.get('authorization')).toBe('Bearer session-token')
    expect(headers.get('x-organisation-id')).toBeNull()
  })

  it('omits Authorization after sign-out', async () => {
    setAuthTokenGetter(async () => 'session-token')
    clearAuthTokenGetter()
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/api/imports')

    const headers = new Headers(fetchMock.mock.calls[0][1].headers)
    expect(headers.get('authorization')).toBeNull()
  })

  it('shows upload validation, size, and rate-limit messages', async () => {
    const malformed = await readApiJson(
      new Response(JSON.stringify({ error: 'CSV is missing required Apple Ads columns' }), {
        status: 400,
      }),
      'Upload failed',
    ).catch((err) => err)
    const tooBig = await readApiJson(
      new Response(JSON.stringify({ error: 'CSV file exceeds the maximum allowed size' }), {
        status: 413,
      }),
      'Upload failed',
    ).catch((err) => err)
    const tooManyRows = await readApiJson(
      new Response(JSON.stringify({ error: 'CSV contains more rows than the maximum allowed' }), {
        status: 413,
      }),
      'Upload failed',
    ).catch((err) => err)
    const limited = await readApiJson(
      new Response(JSON.stringify({ error: 'Too many upload attempts. Try again later.' }), {
        status: 429,
      }),
      'Upload failed',
    ).catch((err) => err)

    expect(malformed.message).toBe('CSV is missing required Apple Ads columns')
    expect(tooBig.message).toBe('CSV file exceeds the maximum allowed size')
    expect(tooManyRows.message).toBe('CSV contains more rows than the maximum allowed')
    expect(limited.message).toBe('Too many upload attempts. Try again later.')
  })

  it('hides internal details of an unexpected upload failure', async () => {
    const error = await readApiJson(
      new Response(
        JSON.stringify({
          error: 'duplicate key value violates unique constraint',
          stack: 'Error\n    at /home/app/imports.js:1:1',
        }),
        { status: 500 },
      ),
      'Upload failed',
    ).catch((err) => err)

    expect(error.message).toBe('The server could not complete this request')
    expect(error.message).not.toContain('duplicate key')
    expect(error.message).not.toContain('/home/')
  })

  it('maps 401 to a sign-in error instead of a generic import failure', async () => {
    const error = await readApiJson(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      'Failed to load imports',
    ).catch((err) => err)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(401)
    expect(error.message).toBe('Sign in required')
    expect(error.message).not.toBe('Failed to load imports')
  })

  it('loads imports through the authenticated client', async () => {
    setAuthTokenGetter(async () => 'session-token')
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([{ id: 1, original_name: 'report.csv' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const imports = await fetchImports()

    expect(imports).toEqual([{ id: 1, original_name: 'report.csv' }])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/imports')
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('authorization')).toBe(
      'Bearer session-token',
    )
  })

  it('loads dashboard, campaign, and keyword analytics through the authenticated client', async () => {
    setAuthTokenGetter(async () => 'session-token')
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ campaigns: [], keywords: [], weeks: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchApps()
    await fetchPeriodCompare({ days: 7, appId: 'app-1' })
    await fetchCampaignWeeklyPerformance({
      startDate: '2026-09-14',
      endDate: '2026-09-21',
      appId: 'app-1',
    })
    await updateCampaignSegment(4, 'Brand')

    const urls = fetchMock.mock.calls.map((call) => call[0])
    expect(urls).toEqual([
      '/api/apps',
      '/api/compare/period?days=7&appId=app-1',
      '/api/campaigns/weekly-performance?startDate=2026-09-14&endDate=2026-09-21&appId=app-1',
      '/api/campaigns/4',
    ])
    for (const call of fetchMock.mock.calls) {
      const headers = new Headers(call[1].headers)
      expect(headers.get('authorization')).toBe('Bearer session-token')
      expect(String(call[0])).not.toContain('organisationId')
      expect(headers.get('x-organisation-id')).toBeNull()
    }
    expect(tenantStateKey('user_73')).not.toBe(tenantStateKey('user_33'))
  })

  it('loads goals, annotations, and bid history through the authenticated client', async () => {
    setAuthTokenGetter(async () => 'session-token')
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ experiments: [], defaultObservationDays: 7 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchGoals()
    await fetchBidExperiments({ appId: 'app-1', keywordText: 'brand' })
    await fetchBidExperimentSettings()

    const urls = fetchMock.mock.calls.map((call) => call[0])
    expect(urls).toEqual([
      '/api/goals',
      '/api/bid-experiments?appId=app-1&keywordText=brand',
      '/api/bid-experiment-settings',
    ])
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain('organisationId')
      expect(new Headers(call[1].headers).get('authorization')).toBe('Bearer session-token')
    }
  })
})
