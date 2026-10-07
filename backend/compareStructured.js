/**
 * Dashboard Period Comparison - Migrated to Analytics Service
 * 
 * This endpoint now uses the centralized Analytics Service for all calculations.
 * Response shape is preserved for frontend compatibility.
 */

const {
  getDashboardSummary,
  getCampaignSummary,
  getKeywordSummary,
  getAppBreakdown,
  getAppsList,
  resolvePeriods,
} = require('./analyticsService')

/**
 * Get period comparison data for Dashboard
 * Now powered by Analytics Service with consistent calculations
 * 
 * P4: organisationId is now required for tenant isolation
 */
async function getPeriodCompare({ organisationId, days, startDate, endDate, appId }) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  // Use Analytics Service to resolve period windows
  const periods = await resolvePeriods({ organisationId, days, startDate, endDate })
  
  if (!periods) {
    return {
      error: 'Could not determine comparison periods',
      periods: null,
      overall: null,
      campaigns: [],
      keywords: [],
      apps: [],
      app_breakdown: [],
      top_campaigns: [],
      top_keywords: [],
    }
  }

  const currentStart = periods.current_period.start_date
  const currentEnd = periods.current_period.end_date

  // Use Analytics Service functions in parallel for efficiency
  const [summary, campaigns, keywords, appBreakdown, apps] = await Promise.all([
    getDashboardSummary({ 
      organisationId,
      startDate: currentStart, 
      endDate: currentEnd, 
      days,
      appId, 
      compare: true 
    }),
    getCampaignSummary({ 
      organisationId,
      startDate: currentStart, 
      endDate: currentEnd, 
      days,
      appId, 
      compare: true 
    }),
    getKeywordSummary({ 
      organisationId,
      startDate: currentStart, 
      endDate: currentEnd, 
      days,
      appId, 
      compare: true 
    }),
    getAppBreakdown({ 
      organisationId,
      startDate: currentStart, 
      endDate: currentEnd, 
      days 
    }),
    getAppsList(organisationId),
  ])

  // Transform summary to match existing API shape
  // getDashboardSummary returns { current: {...}, previous: {...}, changes: {...} }
  const overall = {
    scope: 'overall',
    previous_spend: summary.previous?.spend ?? null,
    current_spend: summary.current?.spend ?? null,
    spend_change: summary.changes?.spend_change ?? null,
    previous_impressions: summary.previous?.impressions ?? null,
    current_impressions: summary.current?.impressions ?? null,
    previous_taps: summary.previous?.taps ?? null,
    current_taps: summary.current?.taps ?? null,
    previous_installs: summary.previous?.installs ?? null,
    current_installs: summary.current?.installs ?? null,
    previous_cpa: summary.previous?.cpa ?? null,
    current_cpa: summary.current?.cpa ?? null,
    cpa_change: summary.changes?.cpa_change ?? null,
    previous_average_cpt: summary.previous?.cpt ?? null,
    current_average_cpt: summary.current?.cpt ?? null,
    previous_cr: summary.previous?.cr ?? null,
    current_cr: summary.current?.cr ?? null,
    previous_ttr: summary.previous?.ttr ?? null,
    current_ttr: summary.current?.ttr ?? null,
  }

  return {
    periods,
    overall,
    apps,
    app_breakdown: appBreakdown,
    campaigns,
    keywords,
    top_campaigns: campaigns.slice(0, 10),
    top_keywords: keywords.slice(0, 10),
  }
}

module.exports = { getPeriodCompare }
