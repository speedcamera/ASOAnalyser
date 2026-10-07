const {
  isDevelopmentFromSecretKey,
  isProductionFromSecretKey,
  isPublishableKey,
} = require('@clerk/shared/keys')

/**
 * Clerk authentication is part of the backend from P5A onward.
 * Startup fails when that authentication is enabled but the keys the
 * official Express SDK reads are missing or not Clerk key material.
 *
 * The secret key is never returned from this module.
 */
function assertClerkConfigured(env = process.env) {
  const publishableKey = env.CLERK_PUBLISHABLE_KEY
  const secretKey = env.CLERK_SECRET_KEY
  const missing = []

  if (!publishableKey) missing.push('CLERK_PUBLISHABLE_KEY')
  if (!secretKey) missing.push('CLERK_SECRET_KEY')

  if (missing.length > 0) {
    throw new Error(
      `Clerk authentication is enabled but required configuration is missing: ${missing.join(', ')}. ` +
        'Add them to the backend environment (see backend/.env.example). ' +
        'CLERK_SECRET_KEY must remain on the server and must never be committed or sent to the frontend.'
    )
  }

  if (!isPublishableKey(publishableKey)) {
    throw new Error(
      'Clerk authentication is enabled but CLERK_PUBLISHABLE_KEY is not a valid Clerk publishable key. ' +
        'Expected a pk_test_ or pk_live_ key from the Clerk Dashboard API keys page.'
    )
  }

  if (!isDevelopmentFromSecretKey(secretKey) && !isProductionFromSecretKey(secretKey)) {
    throw new Error(
      'Clerk authentication is enabled but CLERK_SECRET_KEY is not a valid Clerk secret key. ' +
        'Expected an sk_test_ or sk_live_ key from the Clerk Dashboard API keys page. ' +
        'Do not log or commit this value.'
    )
  }
}

module.exports = { assertClerkConfigured }
