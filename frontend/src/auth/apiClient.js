/**
 * Canonical authenticated API client.
 *
 * Clerk session → current session token → Authorization Bearer → backend.
 * Organisation id is never sent. The backend resolves it from the membership.
 * Tokens are not stored or logged here.
 *
 * Clerk's getToken() cache can still hand out a session JWT that the API
 * rejects: the API request has no refresh cookie, so an expired bearer token
 * becomes 401 rather than a server-side refresh. A token inside the margin
 * below is replaced once, through getToken({ skipCache: true }). Concurrent
 * callers share that one refresh. A following 401 retries one idempotent read
 * with a newer token. A signed-out or unchanged session fails closed.
 */

/**
 * Clerk's session verification allows about five seconds of clock skew.
 * Refresh a little before that, so a cached JWT is not already expired on
 * the API. This does not change the token lifetime.
 */
const SESSION_TOKEN_REFRESH_MARGIN_MS = 10_000

let tokenGetter = async () => null
let tokenGeneration = 0
let freshTokenRequest = null

export function setAuthTokenGetter(getter) {
  tokenGetter = typeof getter === 'function' ? getter : async () => null
}

export function clearAuthTokenGetter() {
  tokenGeneration += 1
  tokenGetter = async () => null
  freshTokenRequest = null
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function canLoadApplication(auth) {
  return auth?.isLoaded === true && auth?.isSignedIn === true
}

export function tenantStateKey(userId) {
  return userId ? String(userId) : 'signed-out'
}

const DETAIL_STATUSES = new Set([400, 413, 429])

function messageForStatus(status, fallback) {
  if (status === 401) return 'Sign in required'
  if (status === 403) return 'You do not have access to this'
  if (status === 404) return 'Not found'
  if (status === 413) return 'The upload is too large'
  if (status === 429) return 'Too many upload attempts. Try again later.'
  if (status >= 500) return 'The server could not complete this request'
  return fallback
}

function safeClientDetail(value) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (!text || text.length > 300 || text !== value || /[\r\n]/.test(text)) return ''
  return text
}

function withoutOrganisationIdentity(path) {
  const url = new URL(path, 'http://local')
  url.searchParams.delete('organisationId')
  url.searchParams.delete('organisation_id')
  const query = url.searchParams.toString()
  return `${url.pathname}${query ? `?${query}` : ''}`
}

function textOrNull(token) {
  return typeof token === 'string' && token.length > 0 ? token : null
}

function sessionTokenExpiryMs(token) {
  const segment = typeof token === 'string' ? token.split('.')[1] : ''
  if (!segment) return null
  try {
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padLength = (4 - (padded.length % 4)) % 4
    const payload = JSON.parse(atob(padded + '='.repeat(padLength)))
    if (!payload || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null
    return payload.exp * 1000
  } catch {
    return null
  }
}

function sessionTokenNearExpiry(token, now = Date.now()) {
  const expiry = sessionTokenExpiryMs(token)
  if (expiry == null) return false
  return expiry <= now + SESSION_TOKEN_REFRESH_MARGIN_MS
}

function requestFreshSessionToken() {
  if (freshTokenRequest) return freshTokenRequest
  const generation = tokenGeneration
  let pending
  pending = (async () => {
    try {
      const token = textOrNull(await tokenGetter({ skipCache: true }))
      return generation === tokenGeneration ? token : null
    } finally {
      if (freshTokenRequest === pending) freshTokenRequest = null
    }
  })()
  freshTokenRequest = pending
  return pending
}

function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })
}

function isIdempotentMethod(method) {
  const name = typeof method === 'string' && method.length > 0 ? method : 'GET'
  return name.toUpperCase() === 'GET' || name.toUpperCase() === 'HEAD'
}

function requestHeaders(options, token) {
  const headers = new Headers(options.headers || {})
  headers.delete('x-organisation-id')
  headers.delete('Authorization')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return headers
}

function generationIsCurrent(generation) {
  return generation === tokenGeneration
}

export async function apiFetch(path, options = {}) {
  const url = withoutOrganisationIdentity(path)
  const generation = tokenGeneration
  let token = textOrNull(await tokenGetter())
  if (!generationIsCurrent(generation)) return unauthorizedResponse()

  if (token && sessionTokenNearExpiry(token)) {
    const fresh = await requestFreshSessionToken()
    if (!generationIsCurrent(generation)) return unauthorizedResponse()
    if (!fresh || fresh === token || sessionTokenNearExpiry(fresh)) return unauthorizedResponse()
    token = fresh
  }

  const response = await fetch(url, {
    ...options,
    headers: requestHeaders(options, token),
  })

  if (response.status !== 401 || !token || !isIdempotentMethod(options.method)) {
    return response
  }
  if (!generationIsCurrent(generation)) return response

  const fresh = await requestFreshSessionToken()
  if (
    !generationIsCurrent(generation) ||
    !fresh ||
    fresh === token ||
    sessionTokenNearExpiry(fresh)
  ) {
    return response
  }

  return fetch(url, {
    ...options,
    headers: requestHeaders(options, fresh),
  })
}

export async function readApiJson(response, fallback) {
  if (!response.ok) {
    let detail = ''
    if (DETAIL_STATUSES.has(response.status)) {
      try {
        const body = await response.json()
        detail = safeClientDetail(body?.error)
      } catch {
        detail = ''
      }
    }
    throw new ApiError(detail || messageForStatus(response.status, fallback), response.status)
  }
  return response.json()
}
