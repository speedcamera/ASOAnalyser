const { httpError } = require('./clientError')

/**
 * Counts upload attempts for one authenticated local user.
 *
 * The key is req.user.id, set by authentication before this middleware runs.
 * It is not the client-supplied organisation id, and it is not an IP address.
 * Unauthenticated requests never reach this limiter.
 */
function createUploadRateLimit({ max, windowMs, now = Date.now } = {}) {
  if (!Number.isInteger(max) || max < 1) {
    throw new Error('Upload rate limit max must be a positive integer')
  }
  if (!Number.isInteger(windowMs) || windowMs < 1) {
    throw new Error('Upload rate limit window must be a positive integer')
  }

  const buckets = new Map()

  return function uploadRateLimit(req, res, next) {
    const userId = req.user && req.user.id
    if (!Number.isInteger(userId) || userId <= 0) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const current = now()
    for (const [key, bucket] of buckets) {
      if (current - bucket.start >= windowMs) buckets.delete(key)
    }

    let bucket = buckets.get(userId)
    if (!bucket) {
      bucket = { start: current, count: 0 }
      buckets.set(userId, bucket)
    }

    bucket.count += 1
    if (bucket.count > max) {
      next(httpError(429, 'Too many upload attempts. Try again later.'))
      return
    }

    next()
  }
}

module.exports = { createUploadRateLimit }
