import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchApps,
  fetchBidExperimentSettings,
  fetchBidExperiments,
  fetchCampaignWeeklyPerformance,
  fetchGoals,
  fetchImports,
  fetchInsights,
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

function sessionJwt(expSeconds) {
  const encode = (value) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ exp: expSeconds })}.sig`
}

function expIn(seconds) {
  return Math.floor(Date.now() / 1000) + seconds
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function authorization(call) {
  return new Headers(call[1].headers).get('authorization')
}

describe('session token refresh', () => {
  it('sends a current session token without forcing a refresh', async () => {
    const current = sessionJwt(expIn(50))
    const getter = vi.fn(async () => current)
    setAuthTokenGetter(getter)
    const fetchMock = vi.fn(async () => jsonResponse({ campaigns: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchPeriodCompare({ days: 7, appId: 'app-1' })

    expect(getter).toHaveBeenCalledTimes(1)
    expect(getter.mock.calls[0][0]).toBeUndefined()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/compare/period?days=7&appId=app-1')
    expect(authorization(fetchMock.mock.calls[0])).toBe(`Bearer ${current}`)
  })

  it('replaces an expired session token before the analytics request', async () => {
    const expired = sessionJwt(expIn(-5))
    const fresh = sessionJwt(expIn(60))
    let refreshCalls = 0
    setAuthTokenGetter(async (options) => {
      if (options?.skipCache) {
        refreshCalls += 1
        return fresh
      }
      return expired
    })
    const fetchMock = vi.fn(async () => jsonResponse({ campaigns: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const comparison = await fetchPeriodCompare({ days: 7 })

    expect(comparison).toEqual({ campaigns: [] })
    expect(refreshCalls).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(authorization(fetchMock.mock.calls[0])).toBe(`Bearer ${fresh}`)
    expect(authorization(fetchMock.mock.calls[0])).not.toContain(expired)
  })

  it('fails closed when an expired token cannot be refreshed', async () => {
    const expired = sessionJwt(expIn(-5))
    let refreshCalls = 0
    setAuthTokenGetter(async (options) => {
      if (options?.skipCache) {
        refreshCalls += 1
        return null
      }
      return expired
    })
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'Unauthorized' }, 401))
    vi.stubGlobal('fetch', fetchMock)

    const error = await fetchPeriodCompare({ days: 7 }).catch((err) => err)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(401)
    expect(error.message).toBe('Sign in required')
    expect(refreshCalls).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed when refresh returns the same expired token', async () => {
    const expired = sessionJwt(expIn(-5))
    const getter = vi.fn(async () => expired)
    setAuthTokenGetter(getter)
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const error = await fetchPeriodCompare({ days: 7 }).catch((err) => err)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(401)
    expect(error.message).toBe('Sign in required')
    expect(getter.mock.calls.filter((call) => call[0]?.skipCache)).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retries one idempotent 401 with a newly issued token', async () => {
    const stale = sessionJwt(expIn(40))
    const fresh = sessionJwt(expIn(55))
    let refreshCalls = 0
    setAuthTokenGetter(async (options) => {
      if (options?.skipCache) {
        refreshCalls += 1
        return fresh
      }
      return stale
    })
    const fetchMock = vi.fn(async (_url, init) => {
      const header = new Headers(init.headers).get('authorization')
      if (header === `Bearer ${stale}`) return jsonResponse({ error: 'Unauthorized' }, 401)
      return jsonResponse({ campaigns: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const comparison = await apiFetch(
      '/api/compare/period?days=14&organisationId=14&organisation_id=1',
      { headers: { 'x-organisation-id': '14' } },
    ).then((response) => readApiJson(response, 'Failed to load period comparison'))

    expect(comparison).toEqual({ campaigns: [] })
    expect(refreshCalls).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/compare/period?days=14',
      '/api/compare/period?days=14',
    ])
    for (const call of fetchMock.mock.calls) {
      expect(new Headers(call[1].headers).get('x-organisation-id')).toBeNull()
      expect(String(call[0])).not.toContain('organisation')
    }
    expect(authorization(fetchMock.mock.calls[1])).toBe(`Bearer ${fresh}`)
  })

  it('does not retry an idempotent 401 when the refreshed token is rejected', async () => {
    const stale = sessionJwt(expIn(40))
    const fresh = sessionJwt(expIn(55))
    setAuthTokenGetter(async (options) => (options?.skipCache ? fresh : stale))
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'Unauthorized' }, 401))
    vi.stubGlobal('fetch', fetchMock)

    const error = await fetchPeriodCompare({ days: 7 }).catch((err) => err)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(401)
    expect(error.message).toBe('Sign in required')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(authorization(fetchMock.mock.calls[1])).toBe(`Bearer ${fresh}`)
  })

  it('shares one refresh across concurrent analytics requests', async () => {
    const expired = sessionJwt(expIn(-5))
    const fresh = sessionJwt(expIn(60))
    let refreshCalls = 0
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    setAuthTokenGetter(async (options) => {
      if (options?.skipCache) {
        refreshCalls += 1
        await gate
        return fresh
      }
      return expired
    })
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const pending = Promise.all([
      fetchPeriodCompare({ days: 7, appId: 'app-1' }),
      fetchInsights({ days: 7, appId: 'app-1' }),
      fetchCampaignWeeklyPerformance({
        startDate: '2026-09-14',
        endDate: '2026-09-21',
        appId: 'app-1',
      }),
    ])
    release()
    await pending

    expect(refreshCalls).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/compare/period?days=7&appId=app-1',
      '/api/insights?days=7&appId=app-1',
      '/api/campaigns/weekly-performance?startDate=2026-09-14&endDate=2026-09-21&appId=app-1',
    ])
    for (const call of fetchMock.mock.calls) {
      expect(authorization(call)).toBe(`Bearer ${fresh}`)
      expect(String(call[0])).not.toContain('organisation')
    }
  })

  it('refreshes once across repeated date-filter changes', async () => {
    const expired = sessionJwt(expIn(-5))
    const fresh = sessionJwt(expIn(60))
    let cached = expired
    let refreshCalls = 0
    setAuthTokenGetter(async (options) => {
      if (options?.skipCache) {
        refreshCalls += 1
        cached = fresh
      }
      return cached
    })
    const fetchMock = vi.fn(async () => jsonResponse({ campaigns: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchPeriodCompare({ days: 7 })
    await fetchPeriodCompare({ days: 14 })
    await fetchPeriodCompare({ days: 30 })

    expect(refreshCalls).toBe(1)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/compare/period?days=7',
      '/api/compare/period?days=14',
      '/api/compare/period?days=30',
    ])
    for (const call of fetchMock.mock.calls) {
      expect(authorization(call)).toBe(`Bearer ${fresh}`)
    }
  })

  it('does not refresh a signed-out session', async () => {
    const getter = vi.fn(async () => null)
    setAuthTokenGetter(getter)
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'Unauthorized' }, 401))
    vi.stubGlobal('fetch', fetchMock)

    const error = await fetchPeriodCompare({ days: 7 }).catch((err) => err)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(401)
    expect(error.message).toBe('Sign in required')
    expect(getter).toHaveBeenCalledTimes(1)
    expect(getter.mock.calls[0][0]).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(authorization(fetchMock.mock.calls[0])).toBeNull()
  })

  it('drops an in-flight refresh after sign-out', async () => {
    const expired = sessionJwt(expIn(-5))
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    setAuthTokenGetter(async (options) => {
      if (options?.skipCache) {
        await gate
        return sessionJwt(expIn(60))
      }
      return expired
    })
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const pending = fetchPeriodCompare({ days: 7 })
    clearAuthTokenGetter()
    release()
    const error = await pending.catch((err) => err)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(401)
    expect(error.message).toBe('Sign in required')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not send a token that resolves after sign-out', async () => {
    const current = sessionJwt(expIn(50))
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    setAuthTokenGetter(async () => {
      await gate
      return current
    })
    const fetchMock = vi.fn(async () => jsonResponse({ campaigns: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const pending = fetchPeriodCompare({ days: 7, appId: 'app-1' })
    clearAuthTokenGetter()
    release()
    const error = await pending.catch((err) => err)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(401)
    expect(error.message).toBe('Sign in required')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not retry a 401 when sign-out happens during refresh', async () => {
    const stale = sessionJwt(expIn(40))
    const fresh = sessionJwt(expIn(55))
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    let markRefreshStarted
    const refreshStarted = new Promise((resolve) => {
      markRefreshStarted = resolve
    })
    setAuthTokenGetter(async (options) => {
      if (options?.skipCache) {
        markRefreshStarted()
        await gate
        return fresh
      }
      return stale
    })
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'Unauthorized' }, 401))
    vi.stubGlobal('fetch', fetchMock)

    const pending = apiFetch('/api/compare/period?days=7&organisationId=14', {
      headers: { 'x-organisation-id': '14' },
    }).then((response) => readApiJson(response, 'Failed to load period comparison'))
    await refreshStarted
    clearAuthTokenGetter()
    release()
    const error = await pending.catch((err) => err)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(401)
    expect(error.message).toBe('Sign in required')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/compare/period?days=7')
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('x-organisation-id')).toBeNull()
    expect(authorization(fetchMock.mock.calls[0])).toBe(`Bearer ${stale}`)
  })

  it('drops a caller-supplied Authorization header when Clerk has no token', async () => {
    setAuthTokenGetter(async () => null)
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'Unauthorized' }, 401))
    vi.stubGlobal('fetch', fetchMock)

    const error = await apiFetch('/api/imports?organisationId=9&organisation_id=3', {
      headers: {
        Authorization: 'Bearer caller-supplied',
        'x-organisation-id': '9',
      },
    }).then((response) => readApiJson(response, 'Imports could not be loaded')).catch((err) => err)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(401)
    expect(error.message).toBe('Sign in required')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/imports')
    const headers = new Headers(fetchMock.mock.calls[0][1].headers)
    expect(headers.get('authorization')).toBeNull()
    expect(headers.get('x-organisation-id')).toBeNull()
  })

  it('replaces a caller-supplied Authorization header with the Clerk token', async () => {
    const current = sessionJwt(expIn(50))
    setAuthTokenGetter(async () => current)
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/api/apps', {
      headers: { Authorization: 'Bearer caller-supplied' },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(authorization(fetchMock.mock.calls[0])).toBe(`Bearer ${current}`)
  })

  it('refreshes a campaign update once and does not repeat it', async () => {
    const expired = sessionJwt(expIn(-5))
    const fresh = sessionJwt(expIn(60))
    let refreshCalls = 0
    setAuthTokenGetter(async (options) => {
      if (options?.skipCache) {
        refreshCalls += 1
        return fresh
      }
      return expired
    })
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'Unauthorized' }, 401))
    vi.stubGlobal('fetch', fetchMock)

    const error = await updateCampaignSegment(4, 'Brand').catch((err) => err)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(401)
    expect(refreshCalls).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/campaigns/4')
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH')
    expect(authorization(fetchMock.mock.calls[0])).toBe(`Bearer ${fresh}`)
  })
})
