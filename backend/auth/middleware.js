const { getAuth } = require('@clerk/express')
const { resolveLocalUser } = require('./localUser')

function unauthorized(res) {
  res.status(401).json({ error: 'Unauthorized' })
}

/**
 * Application authentication middleware.
 *
 * Clerk middleware has already verified the session. This step reads that
 * verified state, resolves the local user, and sets req.user.
 * It does not create organisations or memberships. Organisation context
 * is a later middleware and is not applied by this step.
 */
function createRequireAuthenticatedUser({
  getAuthFn = getAuth,
  resolveUser = resolveLocalUser,
} = {}) {
  return async function requireAuthenticatedUser(req, res, next) {
    let auth
    try {
      auth = getAuthFn(req, { acceptsToken: 'session_token' })
    } catch (err) {
      console.error('Authentication could not be verified', err.code || '')
      unauthorized(res)
      return
    }

    const clerkUserId = auth && auth.isAuthenticated === true ? auth.userId : null
    if (typeof clerkUserId !== 'string' || clerkUserId.length === 0) {
      unauthorized(res)
      return
    }

    try {
      const user = await resolveUser(clerkUserId)
      req.user = {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        authProvider: user.authProvider,
        authProviderUserId: user.authProviderUserId,
      }
      next()
    } catch (err) {
      console.error('Authenticated user could not be resolved', err.code || err.status || '')
      unauthorized(res)
    }
  }
}

const requireAuthenticatedUser = createRequireAuthenticatedUser()

module.exports = {
  createRequireAuthenticatedUser,
  requireAuthenticatedUser,
}
