const { sendRouteError } = require('./http/clientError')
const {
  parseBoundedInteger,
  parseResourceId,
  readFilterText,
  MAX_PAGE_OFFSET,
} = require('./http/requestValidation')
const {
  listAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
} = require('./annotations')
const {
  getGoals,
  createGoal,
  updateGoal,
  deleteGoal,
} = require('./goals')
const {
  listBidExperiments,
  getBidExperimentById,
  getBidExperimentSettings,
  setDefaultObservationDays,
} = require('./bidExperiments')

/**
 * Goals, annotations, and bid experiments.
 * organisationId comes only from the authenticated tenant middleware.
 */
function registerFeatureRoutes(router, requireAuthenticatedTenant) {
  const guard = Array.isArray(requireAuthenticatedTenant)
    ? requireAuthenticatedTenant
    : [requireAuthenticatedTenant]

  router.get('/api/annotations', ...guard, async (req, res) => {
    try {
      const annotations = await listAnnotations({
        organisationId: req.organisationId,
        entityType: req.query.entityType,
        entityKey: req.query.entityKey,
      })
      res.json(annotations)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.post('/api/annotations', ...guard, async (req, res) => {
    try {
      const annotation = await createAnnotation(req.organisationId, req.body || {})
      res.status(201).json(annotation)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.put('/api/annotations/:id', ...guard, async (req, res) => {
    try {
      const annotation = await updateAnnotation(req.organisationId, req.params.id, req.body || {})
      res.json(annotation)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.delete('/api/annotations/:id', ...guard, async (req, res) => {
    try {
      const result = await deleteAnnotation(req.organisationId, req.params.id)
      res.json(result)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.get('/api/goals', ...guard, async (req, res) => {
    try {
      const goals = await getGoals({
        organisationId: req.organisationId,
        entityType: req.query.entityType || null,
        entityKey: req.query.entityKey || null,
        isActive: req.query.isActive ? req.query.isActive === 'true' : null,
      })
      res.json(goals)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.post('/api/goals', ...guard, async (req, res) => {
    try {
      const goal = await createGoal(req.organisationId, req.body || {})
      res.json(goal)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.put('/api/goals/:id', ...guard, async (req, res) => {
    try {
      const id = parseResourceId(req.params.id, 'goal id')
      const goal = await updateGoal(req.organisationId, id, req.body || {})
      res.json(goal)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.delete('/api/goals/:id', ...guard, async (req, res) => {
    try {
      const id = parseResourceId(req.params.id, 'goal id')
      const result = await deleteGoal(req.organisationId, id)
      res.json(result)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.get('/api/bid-experiments', ...guard, async (req, res) => {
    try {
      const result = await listBidExperiments({
        organisationId: req.organisationId,
        appId: readFilterText(req.query.appId, 'appId'),
        campaignName: readFilterText(req.query.campaignName, 'campaignName'),
        adGroupName: readFilterText(req.query.adGroupName, 'adGroupName', 300, { blank: 'keep' }),
        keywordText: readFilterText(req.query.keywordText, 'keywordText'),
        keywordIdentityKey: readFilterText(req.query.keywordIdentityKey, 'keywordIdentityKey', 1000),
        status: readFilterText(req.query.status, 'status', 32),
        limit: parseBoundedInteger(req.query.limit, {
          name: 'limit',
          min: 1,
          max: 200,
          fallback: 50,
        }),
        offset: parseBoundedInteger(req.query.offset, {
          name: 'offset',
          min: 0,
          max: MAX_PAGE_OFFSET,
          fallback: 0,
        }),
      })
      res.json(result)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.get('/api/bid-experiments/:id', ...guard, async (req, res) => {
    try {
      const id = parseResourceId(req.params.id, 'experiment id')
      const experiment = await getBidExperimentById(req.organisationId, id)
      if (!experiment) {
        res.status(404).json({ error: 'Bid experiment not found' })
        return
      }
      res.json(experiment)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.get('/api/bid-experiment-settings', ...guard, async (req, res) => {
    try {
      const settings = await getBidExperimentSettings(req.organisationId)
      res.json(settings)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.patch('/api/bid-experiment-settings', ...guard, async (req, res) => {
    try {
      const value = await setDefaultObservationDays(
        req.organisationId,
        req.body?.defaultObservationDays,
      )
      res.json({
        defaultObservationDays: value,
        allowedObservationDays: [3, 7, 14, 30],
      })
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })
}

module.exports = { registerFeatureRoutes }
