/**
 * Canonical authenticated API client.
 *
 * Clerk session → current session token → Authorization Bearer → backend.
 * Organisation id is never sent. The backend resolves it from the membership.
 * Tokens are not stored or logged here.
 */

let tokenGetter = async () => null

export function setAuthTokenGetter(getter) {
  tokenGetter = typeof getter === 'function' ? getter : async () => null
}

export function clearAuthTokenGetter() {
  tokenGetter = async () => null
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

export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {})
  headers.delete('x-organisation-id')
  const token = await tokenGetter()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(withoutOrganisationIdentity(path), { ...options, headers })
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
