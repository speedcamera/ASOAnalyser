/**
 * HTTP security baseline.
 *
 * CORS allows the configured frontend origin. Development also allows the
 * Vite app at http://localhost:5173. Production does not assume localhost.
 *
 * Helmet is applied to API responses. Content-Security-Policy is omitted:
 * this process does not serve the Clerk UI. A future host that serves the
 * frontend HTML must follow Clerk's current CSP requirements for script,
 * connect, frame, worker, and image sources. Do not add a restrictive CSP
 * here until that host is checked, because a wrong policy disables sign-in.
 *
 * Cross-Origin-Resource-Policy is cross-origin so a browser on another
 * origin can read responses that CORS has already allowed. Credentials are
 * not enabled. The frontend sends Authorization: Bearer, not cookies.
 *
 * HSTS is enabled only when NODE_ENV=production. The development server is
 * plain HTTP behind the Vite proxy, and a development HSTS header can force
 * later requests onto HTTPS.
 */

const cors = require('cors')
const helmet = require('helmet')

const DEV_FRONTEND_ORIGIN = 'http://localhost:5173'

function isProduction(env) {
  return env.NODE_ENV === 'production'
}

function parseOriginList(value) {
  if (typeof value !== 'string') return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeOrigin(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.username || url.password) return null
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.pathname !== '/' || url.search || url.hash) return null
  return url.origin
}

function assertHttpSecurityConfigured(env = process.env) {
  if (!isProduction(env)) return

  const raw = parseOriginList(env.FRONTEND_ORIGIN)
  if (raw.length === 0 || raw.includes('*')) {
    throw new Error(
      'NODE_ENV=production requires FRONTEND_ORIGIN to be set to the frontend origin. ' +
        'localhost is not used automatically in production. ' +
        'Set FRONTEND_ORIGIN to one or more absolute http or https origins, separated by commas. ' +
        'A wildcard is not allowed. See backend/.env.example.'
    )
  }

  if (raw.some((item) => normalizeOrigin(item) === null)) {
    throw new Error(
      'FRONTEND_ORIGIN must be a comma-separated list of absolute http or https origins, ' +
        'without paths, queries, hashes, or credentials.'
    )
  }
}

function allowedFrontendOrigins(env = process.env) {
  const configured = parseOriginList(env.FRONTEND_ORIGIN)
    .map(normalizeOrigin)
    .filter(Boolean)
  if (isProduction(env)) return [...new Set(configured)]
  return [...new Set([...configured, DEV_FRONTEND_ORIGIN])]
}

function createCorsMiddleware(env = process.env) {
  const allowed = new Set(allowedFrontendOrigins(env))
  return cors({
    origin(origin, callback) {
      if (!origin || allowed.has(origin)) {
        callback(null, true)
        return
      }
      callback(null, false)
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
    maxAge: 600,
  })
}

function createSecurityHeaders(env = process.env) {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: isProduction(env) ? undefined : false,
  })
}

module.exports = {
  DEV_FRONTEND_ORIGIN,
  allowedFrontendOrigins,
  assertHttpSecurityConfigured,
  createCorsMiddleware,
  createSecurityHeaders,
}
