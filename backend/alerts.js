const { getGoals } = require('./goals')
const { getCampaignSummary, getKeywordSummary } = require('./analyticsService')

/**
 * Performance Alerts Service
 * 
 * Evaluates active goals against current analytics data.
 * Alerts are calculated dynamically, not stored.
 */

/**
 * Calculate date range for a period
 */
function calculatePeriodDates(periodDays) {
  const endDate = new Date()
  endDate.setHours(0, 0, 0, 0) // Start of today
  endDate.setDate(endDate.getDate() - 1) // End of yesterday (latest completed day)

  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - periodDays + 1)

  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
  }
}

/**
 * Parse entity key to extract components
 */
function parseEntityKey(entityKey, entityType) {
  const parts = entityKey.split('|')
  
  if (entityType === 'campaign') {
    // Format: appId|campaignName
    return {
      appId: parts[0] === '-' ? null : parts[0],
      campaignName: parts[1] === '-' ? null : parts[1],
    }
  }
  
  if (entityType === 'keyword') {
    // Format: appId|campaignName|adGroupName|keyword
    return {
      appId: parts[0] === '-' ? null : parts[0],
      campaignName: parts[1] === '-' ? null : parts[1],
      adGroupName: parts[2] === '-' ? null : parts[2],
      keyword: parts[3] === '-' ? null : parts[3],
    }
  }
  
  return {}
}

/**
 * Fetch current metric value for an entity
 * 
 * P4: organisationId is now required for tenant isolation
 */
async function fetchEntityMetrics(organisationId, goal) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const { startDate, endDate } = calculatePeriodDates(goal.periodDays)
  const parsed = parseEntityKey(goal.entityKey, goal.entityType)

  try {
    if (goal.entityType === 'campaign') {
      const campaigns = await getCampaignSummary({
        organisationId,
        startDate,
        endDate,
        appId: parsed.appId,
        compare: false,
      })

      // Find matching campaign by entity_key
      const campaign = campaigns.find(c => c.entity_key === goal.entityKey)
      if (!campaign) return null

      return {
        spend: campaign.spend,
        installs: campaign.installs,
        cpa: campaign.cpa,
        cpt: campaign.cpt,
        ttr: campaign.ttr,
        cr: campaign.cr,
      }
    }

    if (goal.entityType === 'keyword') {
      const keywords = await getKeywordSummary({
        organisationId,
        startDate,
        endDate,
        appId: parsed.appId,
        campaignName: parsed.campaignName,
        compare: false,
      })

      // Find matching keyword by entity_key
      const keyword = keywords.find(k => k.entity_key === goal.entityKey)
      if (!keyword) return null

      return {
        spend: keyword.spend,
        installs: keyword.installs,
        cpa: keyword.cpa,
        cpt: keyword.cpt,
        ttr: keyword.ttr,
        cr: keyword.cr,
      }
    }

    return null
  } catch (err) {
    console.error(`Error fetching metrics for goal ${goal.id}:`, err.message)
    return null
  }
}

/**
 * Evaluate if a goal is breached
 */
function evaluateGoal(goal, currentValue) {
  // Handle null/undefined values (zero denominator cases)
  if (currentValue === null || currentValue === undefined || Number.isNaN(currentValue)) {
    return {
      breached: false,
      reason: 'no_data',
    }
  }

  const threshold = goal.threshold
  const operator = goal.operator

  let breached = false
  if (operator === 'greater_than') {
    breached = currentValue > threshold
  } else if (operator === 'less_than') {
    breached = currentValue < threshold
  }

  if (!breached) {
    return { breached: false }
  }

  // Calculate breach amount
  const breachAmount = operator === 'greater_than'
    ? currentValue - threshold
    : threshold - currentValue

  return {
    breached: true,
    breachAmount,
    breachPercent: threshold > 0 ? (breachAmount / threshold) * 100 : null,
  }
}

/**
 * Get all active alerts
 * 
 * P4: organisationId is now required for tenant isolation
 */
async function getAlerts({ organisationId, entityType = null, entityKey = null } = {}) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  // Fetch active goals (tenant scoped)
  const goals = await getGoals({ organisationId, entityType, entityKey, isActive: true })

  // Evaluate each goal
  const alerts = []

  for (const goal of goals) {
    const metrics = await fetchEntityMetrics(organisationId, goal)
    
    if (!metrics) {
      // Entity not found or no data
      continue
    }

    const currentValue = metrics[goal.metric]
    const evaluation = evaluateGoal(goal, currentValue)

    if (evaluation.breached) {
      const { startDate, endDate } = calculatePeriodDates(goal.periodDays)
      const parsed = parseEntityKey(goal.entityKey, goal.entityType)

      alerts.push({
        goalId: goal.id,
        entityType: goal.entityType,
        entityKey: goal.entityKey,
        entityName: parsed.campaignName || parsed.keyword || 'Unknown',
        metric: goal.metric,
        operator: goal.operator,
        threshold: goal.threshold,
        currentValue,
        breachAmount: evaluation.breachAmount,
        breachPercent: evaluation.breachPercent,
        periodDays: goal.periodDays,
        startDate,
        endDate,
        evaluatedAt: new Date().toISOString(),
      })
    }
  }

  return alerts
}

module.exports = {
  getAlerts,
  calculatePeriodDates,
  parseEntityKey,
  fetchEntityMetrics,
  evaluateGoal,
}
