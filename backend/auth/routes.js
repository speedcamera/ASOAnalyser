const express = require('express')

function createAuthRouter({
  requireAuthenticatedUser,
  requireOrganisationContext,
  requireAuthenticatedTenant,
}) {
  const router = express.Router()

  router.get('/me', requireAuthenticatedUser, (req, res) => {
    const user = req.user
    if (!user || user.id == null) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    res.json({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
    })
  })

  const tenantChain = requireAuthenticatedTenant
    || (requireOrganisationContext
      ? [requireAuthenticatedUser, requireOrganisationContext]
      : null)

  if (tenantChain) {
    router.get('/context', ...tenantChain, (req, res) => {
      const user = req.user
      const organisation = req.organisation
      if (!user || user.id == null || req.organisationId == null || !organisation) {
        res.status(500).json({ error: 'Organisation could not be resolved' })
        return
      }

      res.json({
        user: {
          id: user.id,
          email: user.email,
        },
        organisation: {
          id: organisation.id,
          name: organisation.name,
          role: organisation.role,
        },
      })
    })
  }

  return router
}

module.exports = { createAuthRouter }
