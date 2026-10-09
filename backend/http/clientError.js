/**
 * Client-facing HTTP errors.
 *
 * Unexpected failures always use the same 500 body. Validation and
 * not-found errors opt in with httpError(), which sets expose. A status
 * code alone is not enough: database and library errors must not be copied
 * onto the response.
 */

const GENERIC_SERVER_ERROR = 'The server could not complete this request'
const CLIENT_STATUSES = new Set([400, 401, 403, 404, 413, 429])

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  err.expose = true
  return err
}

function redact(value) {
  if (typeof value !== 'string' || value.length === 0) return undefined
  let text = value
  const secrets = [
    process.env.CLERK_SECRET_KEY,
    process.env.CLERK_PUBLISHABLE_KEY,
    process.env.DATABASE_URL,
  ]
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 8) {
      text = text.split(secret).join('[redacted]')
    }
  }
  text = text.replace(/bearer\s+\S+/gi, 'Bearer [redacted]')
  if (text.length > 500) text = `${text.slice(0, 500)}…`
  return text
}

function requestPath(req) {
  const raw = (req && (req.originalUrl || req.url)) || ''
  const path = String(raw).split('?')[0]
  if (!path) return undefined
  return path.length > 200 ? `${path.slice(0, 200)}…` : path
}

function isJsonParseError(err) {
  return Boolean(
    err &&
      (err.type === 'entity.parse.failed' ||
        (err instanceof SyntaxError && Number(err.status) === 400))
  )
}

function isMulterError(err) {
  return Boolean(err && err.name === 'MulterError')
}

function isCsvParseError(err) {
  return Boolean(
    err &&
      (err.name === 'CsvError' ||
        (typeof err.code === 'string' && err.code.startsWith('CSV_')))
  )
}

function isSafeClientMessage(message) {
  if (typeof message !== 'string') return false
  const text = message.trim()
  if (!text || text.length > 300 || text !== message) return false
  if (/[\r\n]/.test(text)) return false
  const lower = text.toLowerCase()
  if (
    lower.includes('password authentication') ||
    lower.includes('syntax error at or near') ||
    lower.includes('postgresql://') ||
    lower.includes('postgres://') ||
    lower.includes('node_modules') ||
    lower.includes('/home/') ||
    lower.includes('/users/') ||
    lower.includes('clerk_secret') ||
    lower.includes('database_url') ||
    text.includes('sk_test_') ||
    text.includes('sk_live_') ||
    text.includes('pk_test_') ||
    text.includes('pk_live_') ||
    /\s+at\s+.+:\d+:\d+/.test(text)
  ) {
    return false
  }
  return true
}

function exposedClientError(err) {
  if (!err || err.expose !== true) return null
  const status = Number(err.status)
  if (!CLIENT_STATUSES.has(status)) return null
  if (!isSafeClientMessage(err.message)) return null
  return {
    status,
    error: err.message,
    logMessage: err.message,
  }
}

function knownClientError(err) {
  if (isJsonParseError(err)) {
    return {
      status: 400,
      error: 'Request body must be valid JSON',
      logMessage: 'Invalid JSON body',
    }
  }

  if (err && err.type === 'entity.too.large') {
    return {
      status: 413,
      error: 'Request body is too large',
      logMessage: 'Request body is too large',
    }
  }

  if (isMulterError(err)) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const error = 'CSV file exceeds the maximum allowed size'
      return { status: 413, error, logMessage: error }
    }
    const error = 'Upload could not be accepted'
    return { status: 400, error, logMessage: error }
  }

  if (isCsvParseError(err)) {
    const code = typeof err.code === 'string' ? err.code : 'CSV_PARSE'
    return {
      status: 400,
      error: 'The CSV file could not be parsed',
      logMessage: `CSV parse failed (${code})`,
    }
  }

  return exposedClientError(err)
}

function publicError(err) {
  const known = knownClientError(err)
  if (known) {
    return {
      status: known.status,
      body: { error: known.error },
      logMessage: known.logMessage,
    }
  }

  return {
    status: 500,
    body: { error: GENERIC_SERVER_ERROR },
    logMessage: redact(err instanceof Error ? err.message : undefined) || 'Unexpected failure',
  }
}

function logRequestError(err, req, outcome) {
  const organisationId =
    req && Number.isInteger(req.organisationId) ? req.organisationId : undefined
  const code = err && typeof err.code === 'string' ? err.code.slice(0, 64) : undefined
  console.error('Request failed', {
    method: req && req.method,
    path: requestPath(req),
    organisationId,
    status: outcome.status,
    code,
    message: outcome.logMessage,
  })
}

function sendRouteError(req, res, err) {
  if (res.headersSent) return
  const outcome = publicError(err)
  logRequestError(err, req, outcome)
  res.status(outcome.status).json(outcome.body)
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    next(err)
    return
  }
  sendRouteError(req, res, err)
}

module.exports = {
  GENERIC_SERVER_ERROR,
  errorHandler,
  httpError,
  publicError,
  sendRouteError,
}
