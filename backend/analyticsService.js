const { pool } = require('./db')
const {
  calculateDerivedMetrics,
  percentChange: calcChange,
} = require('./analyticsMetrics')
const { attachCampaignBudgetHistory } = require('./campaignBudgetHistory')

/**
 * Centralized Analytics Service
 * 
 * All functions query structured daily tables and use standardized metric calculations.
 * Default install attribution: installs_tap_through
 * 
 * Common filters:
 * - appId: filter by specific app
 * - startDate: YYYY-MM-DD format
 * - endDate: YYYY-MM-DD format
 * - compare: boolean - include previous period comparison
 */

// Entity key generation for annotations
function part(value) {
  if (value === null || value === undefined || value === '') return '-'
  return String(value).trim()
}

function buildCampaignEntityKey(appId, campaignName) {
  return `${part(appId)}|${part(campaignName)}`
}

function buildKeywordEntityKey(appId, campaignName, adGroupName, keyword) {
  return `${part(appId)}|${part(campaignName)}|${part(adGroupName)}|${part(keyword)}`
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Build WHERE clause and params for common filters
 * 
 * P4: organisationId is now MANDATORY for all customer-data queries.
 * This enforces tenant isolation at the query level.
 */
function buildFilters({ organisationId, startDate, endDate, appId, campaignName }, baseParams = []) {
  if (!organisationId) {
    throw new Error('organisationId is required for all analytics queries')
  }

  const conditions = []
  const params = [...baseParams]
  let paramIndex = baseParams.length + 1

  // Tenant scope MUST be first filter
  conditions.push(`organisation_id = $${paramIndex++}`)
  params.push(organisationId)

  if (startDate) {
    conditions.push(`report_date >= $${paramIndex++}`)
    params.push(startDate)
  }

  if (endDate) {
    conditions.push(`report_date <= $${paramIndex++}`)
    params.push(endDate)
  }

  if (appId) {
    conditions.push(`app_id = $${paramIndex++}`)
    params.push(appId)
  }

  if (campaignName) {
    conditions.push(`campaign_name = $${paramIndex++}`)
    params.push(campaignName)
  }

  return {
    where: conditions.length ? `AND ${conditions.join(' AND ')}` : '',
    params,
    paramIndex,
  }
}

/**
 * Resolve period windows for comparison
 * Async version that can query database for latest date
 */
async function resolvePeriods({ organisationId, startDate, endDate, days }) {
  if (startDate && endDate) {
    const start = new Date(`${startDate}T00:00:00Z`)
    const end = new Date(`${endDate}T00:00:00Z`)
    const periodDays = Math.round((end - start) / 86400000) + 1

    const prevEnd = addDays(startDate, -1)
    const prevStart = addDays(prevEnd, -(periodDays - 1))

    return {
      current_period: { start_date: startDate, end_date: endDate },
      previous_period: { start_date: prevStart, end_date: prevEnd },
    }
  }

  if (days) {
    if (!organisationId) {
      throw new Error('organisationId is required')
    }
    // Latest date is tenant-scoped. Another organisation's newest day must not
    // move this organisation's window.
    let currentEnd = endDate
    if (!currentEnd) {
      const result = await pool.query(
        'SELECT MAX(report_date) as latest FROM daily_campaign_metrics WHERE organisation_id = $1',
        [organisationId]
      )
      const latest = result.rows[0]?.latest
      if (latest) {
        currentEnd = latest.toISOString().split('T')[0]
      } else {
        currentEnd = new Date().toISOString().split('T')[0]
      }
    }
    
    const currentStart = addDays(currentEnd, -(days - 1))
    const previousEnd = addDays(currentStart, -1)
    const previousStart = addDays(previousEnd, -(days - 1))

    return {
      current_period: { start_date: currentStart, end_date: currentEnd },
      previous_period: { start_date: previousStart, end_date: previousEnd },
    }
  }

  return null
}

/**
 * Get dashboard summary (overall metrics)
 * 
 * P4: organisationId is now required for tenant isolation
 */
async function getDashboardSummary({ organisationId, startDate, endDate, days, appId, compare = false }) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const periods = compare ? await resolvePeriods({ organisationId, startDate, endDate, days }) : null

  const currentStart = periods ? periods.current_period.start_date : startDate
  const currentEnd = periods ? periods.current_period.end_date : endDate

  const { where, params } = buildFilters({ organisationId, startDate: currentStart, endDate: currentEnd, appId })

  const currentResult = await pool.query(
    `SELECT 
      SUM(spend) as spend,
      SUM(impressions) as impressions,
      SUM(taps) as taps,
      SUM(COALESCE(NULLIF(installs_tap_through, 0), installs)) as installs_tap_through,
      SUM(installs_view_through) as installs_view_through,
      SUM(COALESCE(NULLIF(installs_total, 0), installs)) as installs_total
    FROM daily_campaign_metrics
    WHERE 1=1 ${where}`,
    params
  )

  const currentMetrics = calculateDerivedMetrics({
    spend: parseFloat(currentResult.rows[0].spend) || 0,
    impressions: parseInt(currentResult.rows[0].impressions) || 0,
    taps: parseInt(currentResult.rows[0].taps) || 0,
    installs_tap_through: parseInt(currentResult.rows[0].installs_tap_through) || 0,
    installs_view_through: parseInt(currentResult.rows[0].installs_view_through) || 0,
    installs_total: parseInt(currentResult.rows[0].installs_total) || 0,
  })

  if (!compare || !periods) {
    return {
      current: currentMetrics,
      previous: null,
      periods: null,
    }
  }

  const { where: prevWhere, params: prevParams } = buildFilters({
    organisationId,
    startDate: periods.previous_period.start_date,
    endDate: periods.previous_period.end_date,
    appId,
  })

  const previousResult = await pool.query(
    `SELECT 
      SUM(spend) as spend,
      SUM(impressions) as impressions,
      SUM(taps) as taps,
      SUM(COALESCE(NULLIF(installs_tap_through, 0), installs)) as installs_tap_through,
      SUM(installs_view_through) as installs_view_through,
      SUM(COALESCE(NULLIF(installs_total, 0), installs)) as installs_total
    FROM daily_campaign_metrics
    WHERE 1=1 ${prevWhere}`,
    prevParams
  )

  const previousMetrics = calculateDerivedMetrics({
    spend: parseFloat(previousResult.rows[0].spend) || 0,
    impressions: parseInt(previousResult.rows[0].impressions) || 0,
    taps: parseInt(previousResult.rows[0].taps) || 0,
    installs_tap_through: parseInt(previousResult.rows[0].installs_tap_through) || 0,
    installs_view_through: parseInt(previousResult.rows[0].installs_view_through) || 0,
    installs_total: parseInt(previousResult.rows[0].installs_total) || 0,
  })

  return {
    current: currentMetrics,
    previous: previousMetrics,
    periods,
    changes: {
      spend_change: calcChange(currentMetrics.spend, previousMetrics.spend),
      cpa_change: calcChange(currentMetrics.cpa, previousMetrics.cpa),
      installs_change: calcChange(currentMetrics.installs, previousMetrics.installs),
    },
  }
}

/**
 * Get campaign summary (list of campaigns with metrics)
 * 
 * P4: organisationId is now required for tenant isolation
 */
async function getCampaignSummary({ organisationId, startDate, endDate, days, appId, compare = false, limit = null }) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const periods = compare ? await resolvePeriods({ organisationId, startDate, endDate, days }) : null

  const currentStart = periods ? periods.current_period.start_date : startDate
  const currentEnd = periods ? periods.current_period.end_date : endDate

  let sql
  let params

  if (compare && periods) {
    const { where, params: filterParams } = buildFilters({ organisationId, appId }, [
      periods.previous_period.start_date,
      periods.previous_period.end_date,
      periods.current_period.start_date,
      periods.current_period.end_date,
    ])

    sql = `
      SELECT 
        d.campaign_name,
        d.app_id,
        d.app_name,
        c.id as campaign_id,
        COALESCE(c.segment, 'Other') as segment,
        CASE WHEN d.report_date >= $3 AND d.report_date <= $4 THEN 'current' ELSE 'previous' END as period,
        SUM(d.spend) as spend,
        SUM(d.impressions) as impressions,
        SUM(d.taps) as taps,
        SUM(COALESCE(NULLIF(d.installs_tap_through, 0), d.installs)) as installs_tap_through,
        SUM(d.installs_view_through) as installs_view_through,
        SUM(COALESCE(NULLIF(d.installs_total, 0), d.installs)) as installs_total,
        MAX(d.daily_budget) as daily_budget
      FROM daily_campaign_metrics d
      LEFT JOIN campaigns c ON c.app_id = d.app_id AND c.campaign_name = d.campaign_name AND c.organisation_id = d.organisation_id
      WHERE ((d.report_date >= $1 AND d.report_date <= $2)
         OR (d.report_date >= $3 AND d.report_date <= $4))
      ${where.replace(/\bapp_id\b/g, 'd.app_id').replace(/\borganisation_id\b/g, 'd.organisation_id')}
      GROUP BY d.campaign_name, d.app_id, d.app_name, c.id, c.segment, period
      ORDER BY d.campaign_name, d.app_id, period
    `
    params = filterParams
  } else {
    const { where, params: filterParams } = buildFilters({ organisationId, startDate: currentStart, endDate: currentEnd, appId })

    sql = `
      SELECT 
        d.campaign_name,
        d.app_id,
        d.app_name,
        c.id as campaign_id,
        COALESCE(c.segment, 'Other') as segment,
        SUM(d.spend) as spend,
        SUM(d.impressions) as impressions,
        SUM(d.taps) as taps,
        SUM(COALESCE(NULLIF(d.installs_tap_through, 0), d.installs)) as installs_tap_through,
        SUM(d.installs_view_through) as installs_view_through,
        SUM(COALESCE(NULLIF(d.installs_total, 0), d.installs)) as installs_total,
        MAX(d.daily_budget) as daily_budget
      FROM daily_campaign_metrics d
      LEFT JOIN campaigns c ON c.app_id = d.app_id AND c.campaign_name = d.campaign_name AND c.organisation_id = d.organisation_id
      WHERE 1=1 ${where.replace(/\bapp_id\b/g, 'd.app_id').replace(/\borganisation_id\b/g, 'd.organisation_id')}
      GROUP BY d.campaign_name, d.app_id, d.app_name, c.id, c.segment
      ORDER BY spend DESC
    `
    params = filterParams
  }

  if (limit) {
    sql += ` LIMIT ${limit}`
  }

  const result = await pool.query(sql, params)

  let campaigns

  if (!compare) {
    campaigns = result.rows.map(row => ({
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      segment: row.segment,
      app_id: row.app_id,
      app_key: `id:${row.app_id.toLowerCase()}`,
      app_name: row.app_name,
      entity_key: buildCampaignEntityKey(row.app_id, row.campaign_name),
      ...calculateDerivedMetrics({
        spend: parseFloat(row.spend) || 0,
        impressions: parseInt(row.impressions) || 0,
        taps: parseInt(row.taps) || 0,
        installs_tap_through: parseInt(row.installs_tap_through) || 0,
        installs_view_through: parseInt(row.installs_view_through) || 0,
        installs_total: parseInt(row.installs_total) || 0,
      }),
    }))
  } else {

  // Group by campaign for comparison
  const grouped = new Map()

  for (const row of result.rows) {
    const key = `${row.app_id}|${row.campaign_name}`
    if (!grouped.has(key)) {
      grouped.set(key, {
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        segment: row.segment,
        app_id: row.app_id,
        app_name: row.app_name,
        entity_key: buildCampaignEntityKey(row.app_id, row.campaign_name),
        current: null,
        previous: null,
      })
    }

    const metrics = calculateDerivedMetrics({
      spend: parseFloat(row.spend) || 0,
      impressions: parseInt(row.impressions) || 0,
      taps: parseInt(row.taps) || 0,
      installs_tap_through: parseInt(row.installs_tap_through) || 0,
      installs_view_through: parseInt(row.installs_view_through) || 0,
      installs_total: parseInt(row.installs_total) || 0,
    })

    grouped.get(key)[row.period] = metrics
  }

  campaigns = Array.from(grouped.values())
    .map(item => ({
      campaign_id: item.campaign_id,
      campaign_name: item.campaign_name,
      segment: item.segment,
      app_id: item.app_id,
      app_key: `id:${item.app_id.toLowerCase()}`,
      app_name: item.app_name,
      entity_key: item.entity_key,
      previous_spend: item.previous?.spend ?? null,
      current_spend: item.current?.spend ?? null,
      spend_change: calcChange(item.current?.spend, item.previous?.spend),
      previous_installs: item.previous?.installs ?? null,
      current_installs: item.current?.installs ?? null,
      previous_cpa: item.previous?.cpa ?? null,
      current_cpa: item.current?.cpa ?? null,
      cpa_change: calcChange(item.current?.cpa, item.previous?.cpa),
      previous_cpt: item.previous?.cpt ?? null,
      current_cpt: item.current?.cpt ?? null,
      previous_taps: item.previous?.taps ?? null,
      current_taps: item.current?.taps ?? null,
      previous_ttr: item.previous?.ttr ?? null,
      current_ttr: item.current?.ttr ?? null,
      previous_cr: item.previous?.cr ?? null,
      current_cr: item.current?.cr ?? null,
    }))
    .sort((a, b) => (b.current_spend ?? 0) - (a.current_spend ?? 0))
  }

  return attachCampaignBudgetHistory(organisationId, campaigns, currentStart, currentEnd)
}

/**
 * Resolve point-in-time bids for keywords.
 * 
 * For each keyword, finds the latest non-null bid from ANY bid_strategy:
 * - Current bid: latest non-null keyword_max_cpt_bid where report_date <= currentEndDate
 * - Previous bid: latest non-null keyword_max_cpt_bid where report_date <= previousEndDate
 * 
 * Note: Does NOT filter by bid_strategy - picks latest bid across all strategies.
 * This matches user expectation of seeing one bid per keyword (not per bid_strategy).
 */
/**
 * Resolve keyword bids for comparison periods
 * 
 * Uses keyword_bid_history instead of daily_keyword_metrics because Apple Search Ads
 * retrospectively applies the current bid to all historical dates in CSV exports.
 * 
 * Current Bid: Most recent observed bid from keyword_bid_history
 * Previous Bid: Most recent DIFFERENT observed bid before current bid
 * Bid Changed In Period: Whether the most recent bid change falls within the analysis period
 * 
 * P4: organisationId is now required for tenant isolation
 */
async function resolveKeywordBids(organisationId, keywordIdentities, currentEndDate, previousEndDate, appIdFilter = null, campaignFilter = null, periodStartDate = null) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  if (!keywordIdentities || keywordIdentities.length === 0) {
    return new Map()
  }

  const { resolveKeywordBidsFromHistory } = require('./keywordBidHistory')
  
  // Use bid history for genuine bid change tracking
  // Pass period start date to determine if bid change happened within the selected period
  const bidsMap = await resolveKeywordBidsFromHistory({
    organisationId,
    keywordIdentities,
    periodStartDate,
    periodEndDate: currentEndDate,
  })
  
  return bidsMap
}

/**
 * Get keyword summary (list of keywords with metrics)
 * 
 * P4: organisationId is now required for tenant isolation
 */
async function getKeywordSummary({ organisationId, startDate, endDate, days, appId, campaignName = null, compare = false, limit = null }) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const periods = compare ? await resolvePeriods({ organisationId, startDate, endDate, days }) : null

  const currentStart = periods ? periods.current_period.start_date : startDate
  const currentEnd = periods ? periods.current_period.end_date : endDate

  let sql
  let params

  if (compare && periods) {
    const { where, params: filterParams } = buildFilters({ organisationId, appId, campaignName }, [
      periods.previous_period.start_date,
      periods.previous_period.end_date,
      periods.current_period.start_date,
      periods.current_period.end_date,
    ])

    sql = `
      SELECT 
        k.keyword_text,
        k.campaign_name,
        k.ad_group_name,
        k.app_id,
        k.app_name,
        c.segment as segment,
        c.id as campaign_db_id,
        CASE WHEN k.report_date >= $3 AND k.report_date <= $4 THEN 'current' ELSE 'previous' END as period,
        SUM(k.spend) as spend,
        SUM(k.impressions) as impressions,
        SUM(k.taps) as taps,
        SUM(COALESCE(NULLIF(k.installs_tap_through, 0), k.installs)) as installs_tap_through,
        SUM(k.installs_view_through) as installs_view_through,
        SUM(COALESCE(NULLIF(k.installs_total, 0), k.installs)) as installs_total
      FROM daily_keyword_metrics k
      LEFT JOIN campaigns c ON c.app_id = k.app_id AND c.campaign_name = k.campaign_name AND c.organisation_id = k.organisation_id
      WHERE ((k.report_date >= $1 AND k.report_date <= $2)
          OR (k.report_date >= $3 AND k.report_date <= $4))
      ${where.replace(/\bapp_id\b/g, 'k.app_id').replace(/\bcampaign_name\b/g, 'k.campaign_name').replace(/\borganisation_id\b/g, 'k.organisation_id')}
      GROUP BY k.keyword_text, k.campaign_name, k.ad_group_name, k.app_id, k.app_name, c.segment, c.id, period
      ORDER BY k.keyword_text, k.campaign_name, period
    `
    params = filterParams
  } else {
    const { where, params: filterParams } = buildFilters({
      organisationId,
      startDate: currentStart,
      endDate: currentEnd,
      appId,
      campaignName,
    })

    sql = `
      SELECT 
        k.keyword_text,
        k.campaign_name,
        k.ad_group_name,
        k.app_id,
        k.app_name,
        c.segment as segment,
        c.id as campaign_db_id,
        MAX(k.keyword_max_cpt_bid) as keyword_max_cpt_bid,
        SUM(k.spend) as spend,
        SUM(k.impressions) as impressions,
        SUM(k.taps) as taps,
        SUM(COALESCE(NULLIF(k.installs_tap_through, 0), k.installs)) as installs_tap_through,
        SUM(k.installs_view_through) as installs_view_through,
        SUM(COALESCE(NULLIF(k.installs_total, 0), k.installs)) as installs_total
      FROM daily_keyword_metrics k
      LEFT JOIN campaigns c ON c.app_id = k.app_id AND c.campaign_name = k.campaign_name AND c.organisation_id = k.organisation_id
      WHERE 1=1 ${where.replace(/\bapp_id\b/g, 'k.app_id').replace(/\bcampaign_name\b/g, 'k.campaign_name').replace(/\borganisation_id\b/g, 'k.organisation_id')}
      GROUP BY k.keyword_text, k.campaign_name, k.ad_group_name, k.app_id, k.app_name, c.segment, c.id
      ORDER BY spend DESC
    `
    params = filterParams
  }

  if (limit) {
    sql += ` LIMIT ${limit}`
  }

  const result = await pool.query(sql, params)

  if (!compare) {
    return result.rows.map(row => ({
      keyword: row.keyword_text,
      campaign_name: row.campaign_name,
      ad_group_name: row.ad_group_name,
      segment: row.campaign_db_id == null ? null : (row.segment ?? 'Other'),
      app_id: row.app_id,
      app_key: `id:${row.app_id.toLowerCase()}`,
      app_name: row.app_name,
      entity_key: buildKeywordEntityKey(row.app_id, row.campaign_name, row.ad_group_name, row.keyword_text),
      keyword_max_cpt_bid: row.keyword_max_cpt_bid ? parseFloat(row.keyword_max_cpt_bid) : null,
      ...calculateDerivedMetrics({
        spend: parseFloat(row.spend) || 0,
        impressions: parseInt(row.impressions) || 0,
        taps: parseInt(row.taps) || 0,
        installs_tap_through: parseInt(row.installs_tap_through) || 0,
        installs_view_through: parseInt(row.installs_view_through) || 0,
        installs_total: parseInt(row.installs_total) || 0,
      }),
    }))
  }

  // Group by keyword for comparison (without bid_strategy - one row per keyword)
  const grouped = new Map()

  for (const row of result.rows) {
    const key = `${row.app_id}|${row.campaign_name}|${row.ad_group_name}|${row.keyword_text}`
    if (!grouped.has(key)) {
      const segment =
        row.campaign_db_id == null ? null : (row.segment ?? 'Other')
      grouped.set(key, {
        keyword: row.keyword_text,
        campaign_name: row.campaign_name,
        ad_group_name: row.ad_group_name,
        segment,
        app_id: row.app_id,
        app_name: row.app_name,
        entity_key: buildKeywordEntityKey(row.app_id, row.campaign_name, row.ad_group_name, row.keyword_text),
        current: null,
        previous: null,
      })
    }

    const metrics = calculateDerivedMetrics({
      spend: parseFloat(row.spend) || 0,
      impressions: parseInt(row.impressions) || 0,
      taps: parseInt(row.taps) || 0,
      installs_tap_through: parseInt(row.installs_tap_through) || 0,
      installs_view_through: parseInt(row.installs_view_through) || 0,
      installs_total: parseInt(row.installs_total) || 0,
    })

    const item = grouped.get(key)
    item[row.period] = metrics
  }

  // Resolve point-in-time bids for all keywords
  const keywordIdentities = Array.from(grouped.values()).map(item => ({
    app_id: item.app_id,
    campaign_name: item.campaign_name,
    ad_group_name: item.ad_group_name,
    keyword_text: item.keyword,
  }))

  const bids = await resolveKeywordBids(
    organisationId,
    keywordIdentities,
    periods.current_period.end_date,
    periods.previous_period.end_date,
    appId,
    campaignName,
    periods.current_period.start_date
  )

  return Array.from(grouped.values())
    .map(item => {
      const key = `${item.app_id}|${item.campaign_name}|${item.ad_group_name}|${item.keyword}`
      const bidInfo = bids.get(key) || { currentBid: null, previousBid: null }
      
      const currentBid = bidInfo.currentBid
      const previousBid = bidInfo.previousBid
      
      // Determine comparison status
      // "new": has current data but no previous data (new keyword)
      // "comparable": has both current and previous data
      // "unavailable": insufficient data for comparison
      let comparisonStatus = 'unavailable'
      const hasPreviousData = item.previous !== null && (
        item.previous.spend > 0 || 
        item.previous.impressions > 0 || 
        item.previous.taps > 0 || 
        item.previous.installs > 0
      )
      const hasCurrentData = item.current !== null && (
        item.current.spend > 0 || 
        item.current.impressions > 0 || 
        item.current.taps > 0 || 
        item.current.installs > 0
      )
      
      if (hasCurrentData && !hasPreviousData) {
        comparisonStatus = 'new'
      } else if (hasCurrentData && hasPreviousData) {
        comparisonStatus = 'comparable'
      }
      
      // Calculate bid change using canonical rules
      let bidChangeAmount = null
      let bidChangePercent = null
      
      if (currentBid !== null && previousBid !== null) {
        bidChangeAmount = currentBid - previousBid
        if (previousBid === 0) {
          bidChangePercent = currentBid === 0 ? 0 : null
        } else {
          bidChangePercent = ((currentBid - previousBid) / previousBid) * 100
        }
      }
      
      return {
        keyword: item.keyword,
        campaign_name: item.campaign_name,
        ad_group_name: item.ad_group_name,
        segment: item.segment,
        app_id: item.app_id,
        app_key: `id:${item.app_id.toLowerCase()}`,
        app_name: item.app_name,
        entity_key: item.entity_key,
        comparison_status: comparisonStatus,
        keyword_max_cpt_bid: currentBid,
        current_bid: currentBid,
        previous_bid: previousBid,
        bid_change: bidChangeAmount,
        bid_change_percent: bidChangePercent,
        bid_history_available: bidInfo.bidHistoryAvailable || false,
        bid_changed_in_selected_period: bidInfo.bidChangedInSelectedPeriod || false,
        last_bid_change_at: bidInfo.lastBidChangeAt || null,
        previous_spend: item.previous?.spend ?? null,
        current_spend: item.current?.spend ?? null,
        spend_change: calcChange(item.current?.spend, item.previous?.spend),
        previous_impressions: item.previous?.impressions ?? null,
        current_impressions: item.current?.impressions ?? null,
        previous_taps: item.previous?.taps ?? null,
        current_taps: item.current?.taps ?? null,
        previous_installs: item.previous?.installs ?? null,
        current_installs: item.current?.installs ?? null,
        previous_cpa: item.previous?.cpa ?? null,
        current_cpa: item.current?.cpa ?? null,
        cpa_change: calcChange(item.current?.cpa, item.previous?.cpa),
        previous_cpt: item.previous?.cpt ?? null,
        current_cpt: item.current?.cpt ?? null,
        previous_cr: item.previous?.cr ?? null,
        current_cr: item.current?.cr ?? null,
      }
    })
    .sort((a, b) => (b.current_spend ?? 0) - (a.current_spend ?? 0))
}

/**
 * Get daily trend (time series data)
 */
/**
 * Get daily trend data
 * 
 * P4: organisationId is now required for tenant isolation
 */
async function getDailyTrend({ organisationId, startDate, endDate, appId, campaignName = null }) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const { where, params } = buildFilters({ organisationId, startDate, endDate, appId, campaignName })

  const result = await pool.query(
    `SELECT 
      report_date as date,
      SUM(spend) as spend,
      SUM(impressions) as impressions,
      SUM(taps) as taps,
      SUM(COALESCE(NULLIF(installs_tap_through, 0), installs)) as installs_tap_through,
      SUM(installs_view_through) as installs_view_through,
      SUM(COALESCE(NULLIF(installs_total, 0), installs)) as installs_total
    FROM daily_campaign_metrics
    WHERE 1=1 ${where}
    GROUP BY report_date
    ORDER BY report_date ASC`,
    params
  )

  return result.rows.map(row => ({
    date: row.date.toISOString().split('T')[0],
    ...calculateDerivedMetrics({
      spend: parseFloat(row.spend) || 0,
      impressions: parseInt(row.impressions) || 0,
      taps: parseInt(row.taps) || 0,
      installs_tap_through: parseInt(row.installs_tap_through) || 0,
      installs_view_through: parseInt(row.installs_view_through) || 0,
      installs_total: parseInt(row.installs_total) || 0,
    }),
  }))
}

/**
 * Get period comparison (overall + campaigns + keywords)
 */
async function getPeriodComparison({ organisationId, days, startDate, endDate, appId }) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }
  const periods = await resolvePeriods({ organisationId, days, startDate, endDate })

  if (!periods) {
    return {
      error: 'Could not determine comparison periods',
      periods: null,
      overall: null,
      campaigns: [],
      keywords: [],
    }
  }

  const [overall, campaigns, keywords, apps] = await Promise.all([
    getDashboardSummary({
      organisationId,
      startDate: periods.current_period.start_date,
      endDate: periods.current_period.end_date,
      appId,
      compare: true,
    }),
    getCampaignSummary({
      organisationId,
      startDate: periods.current_period.start_date,
      endDate: periods.current_period.end_date,
      appId,
      compare: true,
    }),
    getKeywordSummary({
      organisationId,
      startDate: periods.current_period.start_date,
      endDate: periods.current_period.end_date,
      appId,
      compare: true,
    }),
    getAppBreakdown({
      organisationId,
      startDate: periods.current_period.start_date,
      endDate: periods.current_period.end_date,
    }),
  ])

  return {
    periods,
    overall: {
      previous_spend: overall.previous?.spend ?? null,
      current_spend: overall.current?.spend ?? null,
      spend_change: overall.changes?.spend_change ?? null,
      previous_installs: overall.previous?.installs ?? null,
      current_installs: overall.current?.installs ?? null,
      previous_cpa: overall.previous?.cpa ?? null,
      current_cpa: overall.current?.cpa ?? null,
      cpa_change: overall.changes?.cpa_change ?? null,
      previous_average_cpt: overall.previous?.cpt ?? null,
      current_average_cpt: overall.current?.cpt ?? null,
      previous_ttr: overall.previous?.ttr ?? null,
      current_ttr: overall.current?.ttr ?? null,
      previous_cr: overall.previous?.cr ?? null,
      current_cr: overall.current?.cr ?? null,
    },
    campaigns,
    keywords,
    apps,
    top_campaigns: campaigns.slice(0, 10),
    top_keywords: keywords.slice(0, 10),
  }
}

/**
 * Get app breakdown
 */
/**
 * Get app breakdown
 * 
 * P4: organisationId is now required for tenant isolation
 */
async function getAppBreakdown({ organisationId, startDate, endDate, days }) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const periods = await resolvePeriods({ organisationId, startDate, endDate, days })

  if (!periods) {
    return []
  }

  const result = await pool.query(
    `SELECT 
      app_id,
      app_name,
      CASE WHEN report_date >= $4 AND report_date <= $5 THEN 'current' ELSE 'previous' END as period,
      SUM(spend) as spend,
      SUM(impressions) as impressions,
      SUM(taps) as taps,
      SUM(COALESCE(NULLIF(installs_tap_through, 0), installs)) as installs_tap_through,
      SUM(installs_view_through) as installs_view_through,
      SUM(COALESCE(NULLIF(installs_total, 0), installs)) as installs_total
    FROM daily_campaign_metrics
    WHERE organisation_id = $1
      AND ((report_date >= $2 AND report_date <= $3)
       OR (report_date >= $4 AND report_date <= $5))
    GROUP BY app_id, app_name, period
    ORDER BY app_id, period`,
    [
      organisationId,
      periods.previous_period.start_date,
      periods.previous_period.end_date,
      periods.current_period.start_date,
      periods.current_period.end_date,
    ]
  )

  const grouped = new Map()

  for (const row of result.rows) {
    if (!grouped.has(row.app_id)) {
      grouped.set(row.app_id, {
        app_key: row.app_id,
        app_id: row.app_id,
        app_name: row.app_name,
        current: null,
        previous: null,
      })
    }

    const metrics = calculateDerivedMetrics({
      spend: parseFloat(row.spend) || 0,
      impressions: parseInt(row.impressions) || 0,
      taps: parseInt(row.taps) || 0,
      installs_tap_through: parseInt(row.installs_tap_through) || 0,
      installs_view_through: parseInt(row.installs_view_through) || 0,
      installs_total: parseInt(row.installs_total) || 0,
    })

    grouped.get(row.app_id)[row.period] = metrics
  }

  return Array.from(grouped.values())
    .map(item => ({
      app_key: item.app_key,
      app_id: item.app_id,
      app_name: item.app_name,
      previous_spend: item.previous?.spend ?? null,
      current_spend: item.current?.spend ?? null,
      spend_change: calcChange(item.current?.spend, item.previous?.spend),
      previous_installs: item.previous?.installs ?? null,
      current_installs: item.current?.installs ?? null,
      previous_cpa: item.previous?.cpa ?? null,
      current_cpa: item.current?.cpa ?? null,
    }))
    .sort((a, b) => (b.current_spend ?? 0) - (a.current_spend ?? 0))
}

/**
 * Get top campaigns (by spend)
 */
/**
 * Get top campaigns (by spend)
 * 
 * P4: organisationId is now required for tenant isolation
 */
async function getTopCampaigns({ organisationId, startDate, endDate, appId, limit = 10 }) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }
  return getCampaignSummary({ organisationId, startDate, endDate, appId, compare: false, limit })
}

/**
 * Get top keywords (by spend)
 * 
 * P4: organisationId is now required for tenant isolation
 */
async function getTopKeywords({ organisationId, startDate, endDate, appId, limit = 10 }) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }
  return getKeywordSummary({ organisationId, startDate, endDate, appId, compare: false, limit })
}

/**
 * Get list of all apps with activity
 * 
 * P4: organisationId is now required for tenant isolation
 */
async function getAppsList(organisationId) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const result = await pool.query(`
    SELECT DISTINCT app_id, app_name
    FROM daily_campaign_metrics
    WHERE organisation_id = $1
      AND app_id IS NOT NULL AND app_id != ''
    ORDER BY app_id
  `, [organisationId])

  return result.rows.map(row => ({
    app_id: row.app_id,
    app_name: row.app_name || row.app_id,
    app_key: `id:${row.app_id.toLowerCase()}`,
  }))
}

module.exports = {
  getDashboardSummary,
  getCampaignSummary,
  getKeywordSummary,
  getDailyTrend,
  getPeriodComparison,
  getAppBreakdown,
  getTopCampaigns,
  getTopKeywords,
  getAppsList,
  resolvePeriods,
}
