const { sendRouteError } = require('./http/clientError')
const { parseResourceId, readAnalyticsQuery, readFilterText } = require('./http/requestValidation')
const { listApps } = require('./imports')
const { getPeriodCompare } = require('./compareStructured')
const { getCampaignWeeklyPerformance } = require('./campaignWeekly')
const { getAlerts } = require('./alerts')
const { generateInsights } = require('./insightsEngine')
const { updateCampaignSegment } = require('./campaigns')
const { getCampaignBudgetHistory } = require('./campaignBudgetHistory')

/**
 * Dashboard, campaigns, keywords, filters, and core analytics.
 * organisationId comes only from the authenticated tenant middleware.
 */
function registerAnalyticsRoutes(router, requireAuthenticatedTenant) {
  const guard = Array.isArray(requireAuthenticatedTenant)
    ? requireAuthenticatedTenant
    : [requireAuthenticatedTenant]

  router.get('/api/apps', ...guard, async (req, res) => {
    try {
      const apps = await listApps(req.organisationId)
      res.json(apps)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.get('/api/alerts', ...guard, async (req, res) => {
    try {
      const alerts = await getAlerts({
        organisationId: req.organisationId,
        entityType: readFilterText(req.query.entityType, 'entityType', 32),
        entityKey: readFilterText(req.query.entityKey, 'entityKey', 500),
      })
      res.json(alerts)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.patch('/api/campaigns/:id', ...guard, async (req, res) => {
    try {
      const id = parseResourceId(req.params.id, 'campaign ID')

      const { segment } = req.body || {}
      if (!segment) {
        return res.status(400).json({ error: 'segment is required' })
      }

      const campaign = await updateCampaignSegment(req.organisationId, id, segment)
      res.json(campaign)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.get('/api/insights', ...guard, async (req, res) => {
    try {
      const { days, startDate, endDate } = readAnalyticsQuery(req.query, { requireChoice: true })
      const appId = readFilterText(req.query.appId, 'appId')

      const result = await generateInsights({
        organisationId: req.organisationId,
        startDate,
        endDate,
        days,
        appId,
      })

      res.json({
        overallInsight: result.overallInsight || null,
        insights: result.insights || [],
        generatedAt: new Date().toISOString(),
      })
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.get('/api/campaigns/budget-history', ...guard, async (req, res) => {
    try {
      const history = await getCampaignBudgetHistory({
        organisationId: req.organisationId,
        appId: readFilterText(req.query.appId, 'appId'),
        campaignName: readFilterText(req.query.campaignName, 'campaignName'),
      })
      res.json(history)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.get('/api/campaigns/weekly-performance', ...guard, async (req, res) => {
    try {
      const { startDate, endDate } = readAnalyticsQuery(req.query, { requireDates: true })
      const campaignName = readFilterText(req.query.campaignName, 'campaignName')
      const appKey = readFilterText(req.query.appKey, 'appKey')
      const appId = readFilterText(req.query.appId, 'appId')

      const result = await getCampaignWeeklyPerformance({
        organisationId: req.organisationId,
        campaignName,
        startDate,
        endDate,
        appKey,
        appId,
      })

      res.json(result)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.get('/api/compare/period', ...guard, async (req, res) => {
    try {
      const { days, startDate, endDate } = readAnalyticsQuery(req.query, { requireChoice: true })
      const appId = readFilterText(req.query.appId, 'appId')

      const comparison = await getPeriodCompare({
        organisationId: req.organisationId,
        days,
        startDate,
        endDate,
        appId,
      })

      if (comparison.error && !comparison.periods) {
        res.status(404).json({ error: comparison.error })
        return
      }

      res.json(comparison)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })
}

module.exports = { registerAnalyticsRoutes }
