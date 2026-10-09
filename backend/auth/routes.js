const express = require('express')
const { httpError, sendRouteError } = require('../http/clientError')
const { parseOrganisationName } = require('../http/requestValidation')
const { renameOrganisation } = require('./organisationName')

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

    router.patch('/organisation', ...tenantChain, async (req, res) => {
      try {
        if (!req.organisation || req.organisation.role !== 'owner') {
          throw httpError(403, 'You do not have access to this')
        }
        const name = parseOrganisationName(req.body && req.body.name)
        const updated = await renameOrganisation(req.organisationId, name)
        res.json({
          organisation: {
            id: updated.id,
            name: updated.name,
            role: req.organisation.role,
          },
        })
      } catch (err) {
        sendRouteError(req, res, err)
      }
    })
  }

  return router
}

module.exports = { createAuthRouter }
