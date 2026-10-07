require('dotenv').config()

const { assertClerkConfigured } = require('./auth/clerkConfig')
const { assertHttpSecurityConfigured, createCorsMiddleware, createSecurityHeaders } = require('./http/security')
const { assertCsvUploadConfigured } = require('./http/csvLimits')
const { errorHandler } = require('./http/clientError')

try {
  assertClerkConfigured()
  assertHttpSecurityConfigured()
  assertCsvUploadConfigured()
} catch (err) {
  console.error(err.message)
  process.exit(1)
}

const express = require('express')
const { clerkMiddleware } = require('@clerk/express')
const { requireAuthenticatedUser } = require('./auth/middleware')
const { createAuthRouter } = require('./auth/routes')
const { logBootstrapConfiguration } = require('./auth/organisationContext')
const { requireAuthenticatedTenant } = require('./auth/tenantMiddleware')
const { assertSchemaReady } = require('./db')
const { registerImportRoutes } = require('./importRoutes')
const { registerAnalyticsRoutes } = require('./analyticsRoutes')
const { registerFeatureRoutes } = require('./featureRoutes')

const app = express()

const PORT = process.env.PORT || 3001

// Security headers and CORS do not authenticate. Clerk still verifies the
// session before any route handler. Apple Ads routes use
// requireAuthenticatedTenant. Organisation id comes from the authenticated
// membership, not from a Development Organisation fallback.
app.use(createSecurityHeaders())
app.use(createCorsMiddleware())
app.use(clerkMiddleware())
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.use(
  '/api/auth',
  createAuthRouter({
    requireAuthenticatedUser,
    requireAuthenticatedTenant,
  })
)

registerAnalyticsRoutes(app, requireAuthenticatedTenant)
registerFeatureRoutes(app, requireAuthenticatedTenant)
registerImportRoutes(app, requireAuthenticatedTenant)

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// Last middleware. Route catches use sendRouteError and do not call next(err).
// This handler covers multer, JSON parsing, and anything else passed to next.
app.use(errorHandler)

if (require.main === module) {
  logBootstrapConfiguration()
  const productionBind = process.env.NODE_ENV === 'production'
  assertSchemaReady()
    .then(() => {
      const onListening = () => {
        const hostLabel = productionBind ? '127.0.0.1' : 'localhost'
        console.log(`Server running on http://${hostLabel}:${PORT}`)
      }
      if (productionBind) {
        app.listen(PORT, '127.0.0.1', onListening)
      } else {
        app.listen(PORT, onListening)
      }
    })
    .catch((err) => {
      if (err && err.code === 'SCHEMA_NOT_READY') {
        console.error(err.message)
      } else {
        console.error('Failed to start server', err && err.code ? err.code : '')
      }
      process.exit(1)
    })
}

module.exports = { app }
