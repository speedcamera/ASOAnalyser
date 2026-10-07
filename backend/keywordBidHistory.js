/**
 * Keyword Bid History
 * 
 * Tracks observed keyword bid changes at import time.
 * 
 * Apple Search Ads CSVs contain "Keyword Max Bid", but this value represents the CURRENT bid
 * at report generation time. Apple retrospectively applies the current bid to all historical
 * dates in the CSV. This makes daily_keyword_metrics.keyword_max_cpt_bid unreliable for
 * detecting genuine bid changes.
 * 
 * This module records bid observations as snapshots when CSVs are imported, allowing accurate
 * tracking of when bids actually changed.
 */

const { pool } = require('./db')

/**
 * Record bid observations from an import
 * 
 * Groups keyword bids from the import and creates history entries only when:
 * - This is the first observation for the keyword
 * - The bid amount differs from the most recent stored observation
 * 
 * Uses report_snapshot_date (max report date from CSV) as the effective observation date
 * to prevent old reports imported later from creating false bid changes.
 * 
 * @param {Object} params
 * @param {number} params.organisationId - Organisation ID
 * @param {number} params.importId - Import ID
 * @param {Date} params.observedAt - Import timestamp (for audit)
 * @param {Date|string} params.reportSnapshotDate - Latest report date from CSV (effective observation date)
 * @param {Array} params.keywordBids - Array of {app_id, campaign_name, ad_group_name, keyword_text, bid_amount}
 * @returns {Promise<{recorded: number, skipped: number}>}
 */
async function recordBidObservations({ organisationId, importId, observedAt, reportSnapshotDate, keywordBids }) {
  if (!organisationId) {
    throw new Error('organisationId is required for bid history')
  }
  
  if (!keywordBids || keywordBids.length === 0) {
    return { recorded: 0, skipped: 0 }
  }
  
  let recorded = 0
  let skipped = 0
  
  // Group bids by keyword identity (one entry per unique keyword in this import)
  const uniqueBids = new Map()
  
  for (const bid of keywordBids) {
    const key = `${bid.app_id}|${bid.campaign_name}|${bid.ad_group_name}|${bid.keyword_text}`
    
    // If we've seen this keyword multiple times in this import with different bids,
    // keep the last one (most recent row in CSV)
    uniqueBids.set(key, bid)
  }
  
  // Process each unique keyword
  for (const bid of uniqueBids.values()) {
    if (!bid.bid_amount || bid.bid_amount <= 0) {
      skipped++
      continue
    }
    
    // Check if this bid differs from the most recent observation (by effective date)
    const lastObservation = await pool.query(
      `SELECT bid_amount, 
              COALESCE(report_snapshot_date, observed_at::date) as effective_date
       FROM keyword_bid_history
       WHERE organisation_id = $1
         AND app_id = $2
         AND campaign_name = $3
         AND ad_group_name = $4
         AND keyword_text = $5
       ORDER BY COALESCE(report_snapshot_date, observed_at::date) DESC, observed_at DESC, id DESC
       LIMIT 1`,
      [organisationId, bid.app_id, bid.campaign_name, bid.ad_group_name, bid.keyword_text]
    )
    
    const lastBid = lastObservation.rows.length > 0 
      ? parseFloat(lastObservation.rows[0].bid_amount)
      : null
    
    const lastEffectiveDate = lastObservation.rows.length > 0
      ? lastObservation.rows[0].effective_date
      : null
    
    const currentBid = parseFloat(bid.bid_amount)
    const currentEffectiveDate = reportSnapshotDate ? new Date(reportSnapshotDate) : new Date(observedAt)
    
    // Only record if this is a new observation or the bid has changed
    // Also check that this observation isn't older than the most recent one (protect against old report reimports)
    const isNewerObservation = !lastEffectiveDate || currentEffectiveDate >= new Date(lastEffectiveDate)
    const bidHasChanged = lastBid === null || Math.abs(currentBid - lastBid) > 0.001
    
    if (bidHasChanged && isNewerObservation) {
      await pool.query(
        `INSERT INTO keyword_bid_history (
          organisation_id,
          app_id,
          campaign_name,
          ad_group_name,
          keyword_text,
          bid_amount,
          currency,
          observed_at,
          report_snapshot_date,
          import_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          organisationId,
          bid.app_id,
          bid.campaign_name,
          bid.ad_group_name,
          bid.keyword_text,
          currentBid,
          bid.currency || 'GBP',
          observedAt,
          reportSnapshotDate || null,
          importId,
        ]
      )
      
      recorded++
    } else {
      skipped++
    }
  }
  
  return { recorded, skipped }
}

/**
 * Get current and previous bids for keywords using bid history
 * 
 * @param {Object} params
 * @param {number} params.organisationId - Organisation ID
 * @param {Array} params.keywordIdentities - Array of {app_id, campaign_name, ad_group_name, keyword_text}
 * @param {Date|string} params.periodStartDate - Start date of analysis period (optional, for period-aware change detection)
 * @param {Date|string} params.periodEndDate - End date of analysis period (optional, for period-aware change detection)
 * @returns {Promise<Map>} Map of keyword keys to {currentBid, previousBid, bidHistoryAvailable, bidChangedInSelectedPeriod, lastBidChangeAt}
 */
async function resolveKeywordBidsFromHistory({ organisationId, keywordIdentities, periodStartDate, periodEndDate }) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }
  
  if (!keywordIdentities || keywordIdentities.length === 0) {
    return new Map()
  }
  
  const bidsMap = new Map()
  
  for (const identity of keywordIdentities) {
    const key = `${identity.app_id}|${identity.campaign_name}|${identity.ad_group_name}|${identity.keyword_text}`
    
    // Get the two most recent distinct bid observations (ordered by effective date)
    const result = await pool.query(
      `SELECT 
         bid_amount, 
         observed_at,
         report_snapshot_date,
         COALESCE(report_snapshot_date, observed_at::date) as effective_date
       FROM keyword_bid_history
       WHERE organisation_id = $1
         AND app_id = $2
         AND campaign_name = $3
         AND ad_group_name = $4
         AND keyword_text = $5
       ORDER BY COALESCE(report_snapshot_date, observed_at::date) DESC, observed_at DESC, id DESC
       LIMIT 2`,
      [organisationId, identity.app_id, identity.campaign_name, identity.ad_group_name, identity.keyword_text]
    )
    
    if (result.rows.length === 0) {
      // No bid history available
      bidsMap.set(key, {
        currentBid: null,
        previousBid: null,
        bidHistoryAvailable: false,
        bidChangedInSelectedPeriod: false,
        lastBidChangeAt: null,
      })
    } else if (result.rows.length === 1) {
      // Only one observation - no previous bid to compare
      const effectiveDate = result.rows[0].effective_date
      
      bidsMap.set(key, {
        currentBid: parseFloat(result.rows[0].bid_amount),
        previousBid: null,
        bidHistoryAvailable: true,
        bidChangedInSelectedPeriod: false,
        lastBidChangeAt: effectiveDate,
      })
    } else {
      // We have current and previous observations
      const currentBid = parseFloat(result.rows[0].bid_amount)
      const previousBid = parseFloat(result.rows[1].bid_amount)
      const currentEffectiveDate = result.rows[0].effective_date
      const previousEffectiveDate = result.rows[1].effective_date
      
      // Check if the most recent bid change falls within the selected period
      // Use string comparison to avoid timezone conversion issues
      let bidChangedInPeriod = false
      if (periodStartDate && periodEndDate && previousEffectiveDate) {
        // Normalize dates to YYYY-MM-DD strings for comparison
        const normalizeDate = (date) => {
          if (date instanceof Date) {
            return date.toISOString().split('T')[0]
          }
          if (typeof date === 'string') {
            // Extract YYYY-MM-DD from ISO string or return as-is if already in that format
            return date.split('T')[0]
          }
          return date
        }
        
        const periodStartNorm = normalizeDate(periodStartDate)
        const periodEndNorm = normalizeDate(periodEndDate)
        const changeNorm = normalizeDate(currentEffectiveDate)
        
        // Both boundaries are inclusive
        bidChangedInPeriod = changeNorm >= periodStartNorm && changeNorm <= periodEndNorm
      }
      
      bidsMap.set(key, {
        currentBid,
        // Only include previous bid if it's different from current
        previousBid: Math.abs(currentBid - previousBid) > 0.001 ? previousBid : null,
        bidHistoryAvailable: true,
        bidChangedInSelectedPeriod: bidChangedInPeriod,
        lastBidChangeAt: currentEffectiveDate,
      })
    }
  }
  
  return bidsMap
}

/**
 * Get bid history timeline for a keyword
 * 
 * @param {Object} params
 * @param {number} params.organisationId - Organisation ID
 * @param {string} params.appId - App ID
 * @param {string} params.campaignName - Campaign name
 * @param {string} params.adGroupName - Ad group name
 * @param {string} params.keywordText - Keyword text
 * @param {number} params.limit - Max number of observations to return
 * @returns {Promise<Array>} Array of {bid_amount, observed_at, import_id}
 */
async function getKeywordBidTimeline({ organisationId, appId, campaignName, adGroupName, keywordText, limit = 50 }) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }
  
  const result = await pool.query(
    `SELECT bid_amount, observed_at, import_id
     FROM keyword_bid_history
     WHERE organisation_id = $1
       AND app_id = $2
       AND campaign_name = $3
       AND ad_group_name = $4
       AND keyword_text = $5
     ORDER BY observed_at DESC, id DESC
     LIMIT $6`,
    [organisationId, appId, campaignName, adGroupName, keywordText, limit]
  )
  
  return result.rows.map(row => ({
    bidAmount: parseFloat(row.bid_amount),
    observedAt: row.observed_at,
    importId: row.import_id,
  }))
}

module.exports = {
  recordBidObservations,
  resolveKeywordBidsFromHistory,
  getKeywordBidTimeline,
}
