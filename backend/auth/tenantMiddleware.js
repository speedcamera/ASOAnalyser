const {
  createRequireAuthenticatedUser,
  requireAuthenticatedUser,
} = require('./middleware')
const {
  createRequireOrganisationContext,
  requireOrganisationContext,
} = require('./organisationContext')

/**
 * Shared middleware for protected application routes.
 *
 * clerkMiddleware() has already verified the session. This chain resolves
 * the local user and then that user's organisation. It does not read an
 * organisation id from the query, body, headers, or route parameters.
 *
 * Development Organisation is not a fallback. The P5B bootstrap rule runs
 * only inside organisation resolution, and only for the configured Clerk
 * user who has no membership yet.
 *
 * Imports, dashboard, campaigns, keywords, goals, annotations, and bid
 * experiments use this chain. There is no Development Organisation fallback.
 */
function createRequireAuthenticatedTenant(deps = {}) {
  const userMiddleware = deps.requireAuthenticatedUser
    || ((deps.getAuthFn || deps.resolveUser)
      ? createRequireAuthenticatedUser({
          getAuthFn: deps.getAuthFn,
          resolveUser: deps.resolveUser,
        })
      : requireAuthenticatedUser)

  const hasOrganisationDeps = Boolean(
    deps.pool || deps.env || deps.selectMemberships || deps.resolveOrganisationForUser
  )
  const organisationMiddleware = deps.requireOrganisationContext
    || (hasOrganisationDeps
      ? createRequireOrganisationContext({
          pool: deps.pool,
          env: deps.env,
          selectMemberships: deps.selectMemberships,
          resolveOrganisationForUser: deps.resolveOrganisationForUser,
        })
      : requireOrganisationContext)

  return [userMiddleware, organisationMiddleware]
}

const requireAuthenticatedTenant = createRequireAuthenticatedTenant()

module.exports = {
  createRequireAuthenticatedTenant,
  requireAuthenticatedTenant,
}
