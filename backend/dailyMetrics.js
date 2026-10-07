const { pool } = require('./db')
const {
  findColumnByAliases,
  resolveAppIdentity,
} = require('./appIdentity')
const { ensureCampaign } = require('./campaigns')

const DATE_ALIASES = ['date']
const CAMPAIGN_NAME_ALIASES = ['campaign name', 'campaign']
const AD_GROUP_ALIASES = ['ad group name', 'ad group']
const KEYWORD_ALIASES = ['keyword']
const BID_STRATEGY_ALIASES = ['bid strategy']
const DAILY_BUDGET_ALIASES = ['daily budget', 'budget']
const KEYWORD_MAX_CPT_BID_ALIASES = [
  'keyword max bid',        // Current Apple Search Ads format (Aug 2026+)
  'keyword max cpt bid',    // Legacy Apple Search Ads format
  'max cpt bid',            // Fallback
  'max bid'                 // Fallback
]

const METRIC_ALIASES = {
  spend: ['spend', 'local spend amount', 'amount spent'],
  impressions: ['impressions'],
  taps: ['taps'],
  // Legacy fallback (will be deprecated)
  installs: ['installs'],
  // Apple Search Ads install attribution types
  installs_tap_through: ['installs (tap-through)'],
  installs_view_through: ['installs (view-through)'],
  installs_total: ['installs (total)', 'total installs'],
  new_downloads: ['new downloads'],
  redownloads: ['redownloads'],
}

function isEmpty(value) {
  if (value === null || value === undefined) return true
  if (typeof value === 'string' && value.trim() === '') return true
  return false
}

function parseNumeric(value) {
  if (isEmpty(value)) return null
  if (typeof value === 'number' && !Number.isNaN(value)) return value

  let str = String(value).trim()
  if (str === '' || str === '-' || str === '—') return null

  str = str.replace(/[$£€¥₹,\s]/g, '').replace(/%$/, '')
  const num = Number.parseFloat(str)
  return Number.isNaN(num) ? null : num
}

function parseDate(value) {
  if (isEmpty(value)) return null

  const str = String(value).trim()

  let match = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) {
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  }

  match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (match) {
    const part1 = Number(match[1])
    const part2 = Number(match[2])
    const year = Number(match[3])

    if (part1 > 12) {
      return new Date(Date.UTC(year, part2 - 1, part1))
    }
    if (part2 > 12) {
      return new Date(Date.UTC(year, part1 - 1, part2))
    }

    return new Date(Date.UTC(year, part2 - 1, part1))
  }

  const date = new Date(str)
  return Number.isNaN(date.getTime()) ? null : date
}

function toDateKey(date) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeText(value) {
  if (isEmpty(value)) return ''
  return String(value).trim()
}

function findMetricColumn(headers, aliases) {
  return findColumnByAliases(headers, aliases)
}

function detectMetricColumns(headers) {
  const detected = {}
  for (const [key, aliases] of Object.entries(METRIC_ALIASES)) {
    detected[key] = findMetricColumn(headers, aliases)
  }
  return detected
}

/**
 * Build daily campaign records from raw import rows.
 * Groups by (app_id, date, campaign_name) and aggregates metrics.
 */
function buildDailyCampaignRecords(rows, headers) {
  const dateColumn = findColumnByAliases(headers, DATE_ALIASES)
  const campaignColumn = findColumnByAliases(headers, CAMPAIGN_NAME_ALIASES)
  const budgetColumn = findColumnByAliases(headers, DAILY_BUDGET_ALIASES)

  if (!dateColumn || !campaignColumn) {
    return []
  }

  const metricColumns = detectMetricColumns(headers)
  const groups = new Map()

  for (const row of rows) {
    const parsedDate = parseDate(row.data[dateColumn])
    if (!parsedDate) continue

    const dateKey = toDateKey(parsedDate)
    const app = resolveAppIdentity(row.data, headers)
    const campaignName = normalizeText(row.data[campaignColumn])

    if (!campaignName) continue

    const groupKey = `${app.app_id}|${dateKey}|${campaignName}`

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        app_id: app.app_id,
        app_name: app.app_name,
        campaign_name: campaignName,
        report_date: dateKey,
        rows: [],
      })
    }

    groups.get(groupKey).rows.push(row)
  }

  const records = []

  for (const group of groups.values()) {
    let spend = 0
    let impressions = 0
    let taps = 0
    let installs = 0
    let installsTapThrough = 0
    let installsViewThrough = 0
    let installsTotal = 0
    let maxBudget = null

    for (const row of group.rows) {
      const spendVal = parseNumeric(row.data[metricColumns.spend])
      const impressionsVal = parseNumeric(row.data[metricColumns.impressions])
      const tapsVal = parseNumeric(row.data[metricColumns.taps])

      if (spendVal !== null) spend += spendVal
      if (impressionsVal !== null) impressions += impressionsVal
      if (tapsVal !== null) taps += tapsVal

      // Parse three install attribution types
      const tapThroughVal = metricColumns.installs_tap_through
        ? parseNumeric(row.data[metricColumns.installs_tap_through]) ?? 0
        : 0
      const viewThroughVal = metricColumns.installs_view_through
        ? parseNumeric(row.data[metricColumns.installs_view_through]) ?? 0
        : 0
      const totalVal = metricColumns.installs_total
        ? parseNumeric(row.data[metricColumns.installs_total]) ?? 0
        : 0

      installsTapThrough += tapThroughVal
      installsViewThrough += viewThroughVal
      installsTotal += totalVal

      // Legacy installs column for backward compatibility
      let legacyInstallsVal = null
      if (metricColumns.installs) {
        legacyInstallsVal = parseNumeric(row.data[metricColumns.installs])
      } else if (metricColumns.new_downloads || metricColumns.redownloads) {
        const newDl = metricColumns.new_downloads
          ? parseNumeric(row.data[metricColumns.new_downloads]) ?? 0
          : 0
        const reDl = metricColumns.redownloads
          ? parseNumeric(row.data[metricColumns.redownloads]) ?? 0
          : 0
        legacyInstallsVal = newDl + reDl
      }
      if (legacyInstallsVal !== null) installs += legacyInstallsVal

      // If CSV doesn't have specific types, use legacy as total
      if (installsTotal === 0 && legacyInstallsVal !== null) {
        installsTotal += legacyInstallsVal
      }

      if (budgetColumn) {
        const budgetVal = parseNumeric(row.data[budgetColumn])
        if (budgetVal !== null && (maxBudget === null || budgetVal > maxBudget)) {
          maxBudget = budgetVal
        }
      }
    }

    records.push({
      app_id: group.app_id,
      app_name: group.app_name,
      campaign_name: group.campaign_name,
      report_date: group.report_date,
      spend,
      impressions,
      taps,
      installs,
      installs_tap_through: installsTapThrough,
      installs_view_through: installsViewThrough,
      installs_total: installsTotal,
      daily_budget: maxBudget,
    })
  }

  return records
}

/**
 * Build daily keyword records from raw import rows.
 * Groups by (app_id, date, campaign_name, ad_group_name, keyword_text, bid_strategy).
 */
function buildDailyKeywordRecords(rows, headers) {
  const dateColumn = findColumnByAliases(headers, DATE_ALIASES)
  const campaignColumn = findColumnByAliases(headers, CAMPAIGN_NAME_ALIASES)
  const adGroupColumn = findColumnByAliases(headers, AD_GROUP_ALIASES)
  const keywordColumn = findColumnByAliases(headers, KEYWORD_ALIASES)
  const bidStrategyColumn = findColumnByAliases(headers, BID_STRATEGY_ALIASES)
  const maxCptBidColumn = findColumnByAliases(headers, KEYWORD_MAX_CPT_BID_ALIASES)

  if (!dateColumn || !campaignColumn || !keywordColumn) {
    return []
  }

  const metricColumns = detectMetricColumns(headers)
  const groups = new Map()

  for (const row of rows) {
    const parsedDate = parseDate(row.data[dateColumn])
    if (!parsedDate) continue

    const dateKey = toDateKey(parsedDate)
    const app = resolveAppIdentity(row.data, headers)
    const campaignName = normalizeText(row.data[campaignColumn])
    const adGroupName = adGroupColumn ? normalizeText(row.data[adGroupColumn]) : ''
    const keywordText = normalizeText(row.data[keywordColumn])
    const bidStrategy = bidStrategyColumn ? normalizeText(row.data[bidStrategyColumn]) : ''

    if (!keywordText) continue

    const groupKey = `${app.app_id}|${dateKey}|${campaignName}|${adGroupName}|${keywordText}|${bidStrategy}`

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        app_id: app.app_id,
        app_name: app.app_name,
        campaign_name: campaignName,
        ad_group_name: adGroupName,
        keyword_text: keywordText,
        bid_strategy: bidStrategy,
        report_date: dateKey,
        rows: [],
      })
    }

    groups.get(groupKey).rows.push(row)
  }

  const records = []

  for (const group of groups.values()) {
    let spend = 0
    let impressions = 0
    let taps = 0
    let installs = 0
    let installsTapThrough = 0
    let installsViewThrough = 0
    let installsTotal = 0
    let maxCptBid = null

    for (const row of group.rows) {
      const spendVal = parseNumeric(row.data[metricColumns.spend])
      const impressionsVal = parseNumeric(row.data[metricColumns.impressions])
      const tapsVal = parseNumeric(row.data[metricColumns.taps])

      if (spendVal !== null) spend += spendVal
      if (impressionsVal !== null) impressions += impressionsVal
      if (tapsVal !== null) taps += tapsVal

      // Parse three install attribution types
      const tapThroughVal = metricColumns.installs_tap_through
        ? parseNumeric(row.data[metricColumns.installs_tap_through]) ?? 0
        : 0
      const viewThroughVal = metricColumns.installs_view_through
        ? parseNumeric(row.data[metricColumns.installs_view_through]) ?? 0
        : 0
      const totalVal = metricColumns.installs_total
        ? parseNumeric(row.data[metricColumns.installs_total]) ?? 0
        : 0

      installsTapThrough += tapThroughVal
      installsViewThrough += viewThroughVal
      installsTotal += totalVal

      // Legacy installs column for backward compatibility
      let legacyInstallsVal = null
      if (metricColumns.installs) {
        legacyInstallsVal = parseNumeric(row.data[metricColumns.installs])
      } else if (metricColumns.new_downloads || metricColumns.redownloads) {
        const newDl = metricColumns.new_downloads
          ? parseNumeric(row.data[metricColumns.new_downloads]) ?? 0
          : 0
        const reDl = metricColumns.redownloads
          ? parseNumeric(row.data[metricColumns.redownloads]) ?? 0
          : 0
        legacyInstallsVal = newDl + reDl
      }
      if (legacyInstallsVal !== null) installs += legacyInstallsVal

      // If CSV doesn't have specific types, use legacy as total
      if (installsTotal === 0 && legacyInstallsVal !== null) {
        installsTotal += legacyInstallsVal
      }

      if (maxCptBidColumn) {
        const bidVal = parseNumeric(row.data[maxCptBidColumn])
        if (bidVal !== null && (maxCptBid === null || bidVal > maxCptBid)) {
          maxCptBid = bidVal
        }
      }
    }

    records.push({
      app_id: group.app_id,
      app_name: group.app_name,
      campaign_id: null,
      campaign_name: group.campaign_name,
      ad_group_name: group.ad_group_name,
      keyword_id: null,
      keyword_text: group.keyword_text,
      bid_strategy: group.bid_strategy,
      report_date: group.report_date,
      spend,
      impressions,
      taps,
      installs,
      installs_tap_through: installsTapThrough,
      installs_view_through: installsViewThrough,
      installs_total: installsTotal,
      keyword_max_cpt_bid: maxCptBid,
    })
  }

  return records
}

/**
 * UPSERT daily campaign metrics into the database.
 * Accepts optional client for transaction support.
 */
async function upsertDailyCampaignMetrics(records, client = null, organisationId) {
  if (!records || records.length === 0) return 0

  const tenantId = typeof organisationId === 'number' ? organisationId : Number(organisationId)
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error('organisationId is required')
  }

  const db = client || pool

  const sql = `
    INSERT INTO daily_campaign_metrics (
      app_id, app_name, campaign_name, report_date,
      spend, impressions, taps, installs, 
      installs_tap_through, installs_view_through, installs_total,
      daily_budget, organisation_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (organisation_id, app_id, report_date, campaign_name)
    DO UPDATE SET
      spend = EXCLUDED.spend,
      impressions = EXCLUDED.impressions,
      taps = EXCLUDED.taps,
      installs = EXCLUDED.installs,
      installs_tap_through = EXCLUDED.installs_tap_through,
      installs_view_through = EXCLUDED.installs_view_through,
      installs_total = EXCLUDED.installs_total,
      daily_budget = EXCLUDED.daily_budget,
      app_name = COALESCE(EXCLUDED.app_name, daily_campaign_metrics.app_name),
      organisation_id = COALESCE(EXCLUDED.organisation_id, daily_campaign_metrics.organisation_id),
      updated_at = NOW()
  `

  let count = 0
  for (const record of records) {
    // Ensure campaign exists in campaigns table (auto-classifies if new)
    await ensureCampaign(record.app_id, record.campaign_name, db, tenantId)
    
    await db.query(sql, [
      record.app_id,
      record.app_name,
      record.campaign_name,
      record.report_date,
      record.spend,
      record.impressions,
      record.taps,
      record.installs,
      record.installs_tap_through,
      record.installs_view_through,
      record.installs_total,
      record.daily_budget,
      tenantId,
    ])
    count++
  }

  return count
}

/**
 * UPSERT daily keyword metrics into the database.
 * Accepts optional client for transaction support.
 */
async function upsertDailyKeywordMetrics(records, client = null, organisationId) {
  if (!records || records.length === 0) return 0

  const tenantId = typeof organisationId === 'number' ? organisationId : Number(organisationId)
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error('organisationId is required')
  }

  const db = client || pool

  const sql = `
    INSERT INTO daily_keyword_metrics (
      app_id, app_name, campaign_id, campaign_name, ad_group_name,
      keyword_id, keyword_text, bid_strategy, report_date,
      spend, impressions, taps, installs,
      installs_tap_through, installs_view_through, installs_total,
      keyword_max_cpt_bid, organisation_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    ON CONFLICT (organisation_id, app_id, report_date, campaign_name, ad_group_name, keyword_text, bid_strategy)
    DO UPDATE SET
      spend = EXCLUDED.spend,
      impressions = EXCLUDED.impressions,
      taps = EXCLUDED.taps,
      installs = EXCLUDED.installs,
      installs_tap_through = EXCLUDED.installs_tap_through,
      installs_view_through = EXCLUDED.installs_view_through,
      installs_total = EXCLUDED.installs_total,
      keyword_max_cpt_bid = EXCLUDED.keyword_max_cpt_bid,
      campaign_id = COALESCE(EXCLUDED.campaign_id, daily_keyword_metrics.campaign_id),
      keyword_id = COALESCE(EXCLUDED.keyword_id, daily_keyword_metrics.keyword_id),
      app_name = COALESCE(EXCLUDED.app_name, daily_keyword_metrics.app_name),
      organisation_id = COALESCE(EXCLUDED.organisation_id, daily_keyword_metrics.organisation_id),
      updated_at = NOW()
  `

  let count = 0
  for (const record of records) {
    await db.query(sql, [
      record.app_id,
      record.app_name,
      record.campaign_id,
      record.campaign_name,
      record.ad_group_name,
      record.keyword_id,
      record.keyword_text,
      record.bid_strategy,
      record.report_date,
      record.spend,
      record.impressions,
      record.taps,
      record.installs,
      record.installs_tap_through,
      record.installs_view_through,
      record.installs_total,
      record.keyword_max_cpt_bid,
      tenantId,
    ])
    count++
  }

  return count
}

module.exports = {
  parseDate,
  buildDailyCampaignRecords,
  buildDailyKeywordRecords,
  upsertDailyCampaignMetrics,
  upsertDailyKeywordMetrics,
}
