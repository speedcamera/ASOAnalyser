const { pool } = require('./db')
const { httpError } = require('./http/clientError')
const { parseBoundedInteger, MAX_PAGE_OFFSET } = require('./http/requestValidation')
const {
  calculateDerivedMetrics,
  percentChange,
} = require('./analyticsMetrics')
const {
  DEFAULT_BASELINE_LOOKBACK_DAYS,
  buildMetricBaseline,
} = require('./baselineStats')

/**
 * Bid Experiments — descriptive detection of Max CPT bid changes.
 *
 * Bid-change tolerance:
 * - Max CPT bids are treated as currency values.
 * - Values are rounded to 2 decimal places (cents) before comparison.
 * - Equal after rounding ⇒ no experiment (covers 1.2 vs 1.20 and float noise).
 * - A one-penny change (e.g. 1.20 → 1.21) is a genuine experiment.
 *
 * change_date semantics:
 * - The report_date of the first daily row that shows the new bid.
 * - Before window: [change_date - N, change_date) — excludes change_date.
 * - After window: starts ON change_date (daily row reflects the bid in effect that day).
 * - Missing calendar days are omitted from aggregates (not treated as zero).
 *
 * Metrics are calculated dynamically from daily_keyword_metrics — not stored.
 */

const ALLOWED_OBSERVATION_DAYS = [3, 7, 14, 30]
const DEFAULT_OBSERVATION_DAYS = 7
const SETTINGS_KEY = 'bid_experiment_default_observation_days'
const MIN_DATA_DAYS = 2

const STATUSES = {
  OBSERVING: 'observing',
  COMPLETED: 'completed',
  INTERRUPTED: 'interrupted',
  INSUFFICIENT_DATA: 'insufficient_data',
}

function part(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

/**
 * Stable keyword identity matching daily_keyword_metrics uniqueness
 * (app_id, campaign_name, ad_group_name, keyword_text, bid_strategy).
 */
function buildKeywordIdentityKey({
  appId,
  campaignName,
  adGroupName,
  keywordText,
  bidStrategy,
}) {
  return [
    part(appId),
    part(campaignName),
    part(adGroupName),
    part(keywordText),
    part(bidStrategy),
  ].join('|')
}

function parseIdentityKey(key) {
  const [appId, campaignName, adGroupName, keywordText, bidStrategy = ''] = String(key).split('|')
  return { appId, campaignName, adGroupName, keywordText, bidStrategy }
}

/** Round currency bid to cents. Returns null for invalid/null. */
function normalizeBid(value) {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100) / 100
}

function bidsEqual(a, b) {
  const na = normalizeBid(a)
  const nb = normalizeBid(b)
  if (na === null || nb === null) return false
  return na === nb
}

function toDateKey(value) {
  if (!value) return null
  if (typeof value === 'string') return value.slice(0, 10)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function calendarDaysBetween(startKey, endKeyInclusive) {
  if (!startKey || !endKeyInclusive) return 0
  const start = new Date(`${startKey}T00:00:00Z`)
  const end = new Date(`${endKeyInclusive}T00:00:00Z`)
  return Math.round((end - start) / 86400000) + 1
}

function validateObservationDays(days) {
  let n = Number.NaN
  if (typeof days === 'number' && Number.isInteger(days)) n = days
  else if (typeof days === 'string' && /^[0-9]+$/.test(days.trim())) n = Number(days.trim())
  if (!ALLOWED_OBSERVATION_DAYS.includes(n)) {
    throw httpError(
      400,
      `defaultObservationDays must be one of: ${ALLOWED_OBSERVATION_DAYS.join(', ')}`,
    )
  }
  return n
}

function observationSettingsKey(organisationId) {
  return `${SETTINGS_KEY}:${organisationId}`
}

async function getDefaultObservationDays(organisationId) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }
  const result = await pool.query(
    `SELECT setting_value FROM application_settings WHERE setting_key = $1`,
    [observationSettingsKey(organisationId)],
  )
  if (result.rows.length === 0) return DEFAULT_OBSERVATION_DAYS
  const n = Number.parseInt(result.rows[0].setting_value, 10)
  return ALLOWED_OBSERVATION_DAYS.includes(n) ? n : DEFAULT_OBSERVATION_DAYS
}

async function setDefaultObservationDays(organisationId, days) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }
  const value = validateObservationDays(days)
  await pool.query(
    `INSERT INTO application_settings (setting_key, setting_value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (setting_key) DO UPDATE SET
       setting_value = EXCLUDED.setting_value,
       updated_at = NOW()`,
    [observationSettingsKey(organisationId), String(value)],
  )
  return value
}

async function getBidExperimentSettings(organisationId) {
  const defaultObservationDays = await getDefaultObservationDays(organisationId)
  return {
    defaultObservationDays,
    allowedObservationDays: [...ALLOWED_OBSERVATION_DAYS],
  }
}

async function getLatestReportDate(organisationId, appId = null) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }
  const params = [organisationId]
  let sql = `SELECT MAX(report_date) AS latest FROM daily_keyword_metrics WHERE organisation_id = $1`
  if (appId) {
    sql += ` AND app_id = $2`
    params.push(appId)
  }
  const result = await pool.query(sql, params)
  return toDateKey(result.rows[0]?.latest)
}

/**
 * Detect bid experiments for the given keyword identity keys (or all if empty).
 * Idempotent upsert. Does not scan on every HTTP request when keys are provided.
 */
/**
 * Detect bid experiments from daily keyword metrics
 * 
 * P4.1: CRITICAL FIX - Must operate per organisation to prevent cross-tenant detection.
 * For background/startup tasks, must be called once per organisation.
 */
async function detectBidExperiments({ organisationId = null, identityKeys = null, observationDays = null } = {}) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const requestedDays = observationDays ?? (await getDefaultObservationDays(organisationId))
  validateObservationDays(requestedDays)

  let sql = `
    SELECT
      app_id,
      MAX(app_name) AS app_name,
      campaign_name,
      ad_group_name,
      keyword_text,
      COALESCE(bid_strategy, '') AS bid_strategy,
      report_date,
      MAX(keyword_max_cpt_bid) AS keyword_max_cpt_bid
    FROM daily_keyword_metrics
    WHERE organisation_id = $1
      AND keyword_max_cpt_bid IS NOT NULL
  `
  const params = [organisationId]

  if (identityKeys && identityKeys.length > 0) {
    // Filter by composing identity in SQL
    const placeholders = identityKeys.map((_, i) => `$${i + params.length + 1}`)
    sql += `
      AND (
        app_id || '|' || campaign_name || '|' || COALESCE(ad_group_name, '') || '|' ||
        keyword_text || '|' || COALESCE(bid_strategy, '')
      ) IN (${placeholders.join(', ')})
    `
    params.push(...identityKeys)
  }

  sql += `
    GROUP BY app_id, campaign_name, ad_group_name, keyword_text, COALESCE(bid_strategy, ''), report_date
    ORDER BY app_id, campaign_name, ad_group_name, keyword_text, COALESCE(bid_strategy, ''), report_date ASC
  `

  const result = await pool.query(sql, params)
  const byIdentity = new Map()

  for (const row of result.rows) {
    const key = buildKeywordIdentityKey({
      appId: row.app_id,
      campaignName: row.campaign_name,
      adGroupName: row.ad_group_name,
      keywordText: row.keyword_text,
      bidStrategy: row.bid_strategy,
    })
    if (!byIdentity.has(key)) {
      byIdentity.set(key, {
        app_id: row.app_id,
        app_name: row.app_name,
        campaign_name: row.campaign_name,
        ad_group_name: row.ad_group_name,
        keyword_text: row.keyword_text,
        bid_strategy: part(row.bid_strategy),
        days: [],
      })
    }
    const bid = normalizeBid(row.keyword_max_cpt_bid)
    if (bid === null) continue
    byIdentity.get(key).days.push({
      report_date: toDateKey(row.report_date),
      bid,
    })
  }

  let created = 0
  let skipped = 0
  const createdRows = []

  // organisationId is now passed as parameter and used in query above
  // All detected experiments belong to that organisation

  for (const [identityKey, group] of byIdentity) {
    let previousBid = null
    const changes = []

    for (const day of group.days) {
      if (previousBid === null) {
        previousBid = day.bid
        continue
      }
      if (bidsEqual(previousBid, day.bid)) {
        previousBid = day.bid
        continue
      }
      changes.push({
        change_date: day.report_date,
        previous_max_cpt_bid: previousBid,
        new_max_cpt_bid: day.bid,
      })
      previousBid = day.bid
    }

    for (let i = 0; i < changes.length; i++) {
      const change = changes[i]
      const nextChange = changes[i + 1] || null
      const direction =
        change.new_max_cpt_bid > change.previous_max_cpt_bid ? 'increase' : 'decrease'
      const amount = normalizeBid(change.new_max_cpt_bid - change.previous_max_cpt_bid)
      const pct =
        change.previous_max_cpt_bid !== 0
          ? ((change.new_max_cpt_bid - change.previous_max_cpt_bid) /
              change.previous_max_cpt_bid) *
            100
          : null

      let status = STATUSES.OBSERVING
      let interruptionDate = null
      let actualDays = null

      if (nextChange) {
        status = STATUSES.INTERRUPTED
        interruptionDate = nextChange.change_date
        // Clean after days: change_date .. day before next change
        const lastClean = addDays(nextChange.change_date, -1)
        actualDays = Math.max(0, calendarDaysBetween(change.change_date, lastClean))
      }

      const upsert = await pool.query(
        `INSERT INTO bid_experiments (
           app_id, app_name, campaign_name, ad_group_name, keyword_text, bid_strategy,
           keyword_identity_key, change_date,
           previous_max_cpt_bid, new_max_cpt_bid, bid_change_amount, bid_change_percent,
           direction, requested_observation_days, actual_observation_days,
           status, interruption_date, organisation_id, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW()
         )
         ON CONFLICT (organisation_id, keyword_identity_key, change_date, previous_max_cpt_bid, new_max_cpt_bid)
         DO UPDATE SET
           app_name = COALESCE(EXCLUDED.app_name, bid_experiments.app_name),
           interruption_date = COALESCE(EXCLUDED.interruption_date, bid_experiments.interruption_date),
           actual_observation_days = COALESCE(EXCLUDED.actual_observation_days, bid_experiments.actual_observation_days),
           status = CASE
             WHEN EXCLUDED.status = 'interrupted' THEN 'interrupted'
             ELSE bid_experiments.status
           END,
           updated_at = NOW()
         RETURNING id, (xmax = 0) AS inserted`,
        [
          group.app_id,
          group.app_name,
          group.campaign_name,
          group.ad_group_name,
          group.keyword_text,
          group.bid_strategy,
          identityKey,
          change.change_date,
          change.previous_max_cpt_bid,
          change.new_max_cpt_bid,
          amount,
          pct,
          direction,
          requestedDays,
          actualDays,
          status,
          interruptionDate,
          organisationId,
        ],
      )

      if (upsert.rows[0]?.inserted) {
        created++
        createdRows.push(upsert.rows[0].id)
      } else {
        skipped++
      }
    }
  }

  return { created, skipped, scannedIdentities: byIdentity.size, createdIds: createdRows }
}

/**
 * Detect experiments for keyword records just upserted from an import.
 * Scans only affected identity keys. Uses current default observation days for NEW inserts only
 * (ON CONFLICT preserves existing requested_observation_days via not updating that column).
 * 
 * P4.1: Now requires organisationId to prevent cross-tenant detection
 */
async function detectBidExperimentsForKeywordRecords(organisationId, records) {
  if (!organisationId) {
    throw new Error('organisationId is required for detectBidExperimentsForKeywordRecords')
  }

  if (!records || records.length === 0) {
    return { created: 0, skipped: 0, scannedIdentities: 0 }
  }

  const keys = new Set()
  for (const r of records) {
    keys.add(
      buildKeywordIdentityKey({
        appId: r.app_id,
        campaignName: r.campaign_name,
        adGroupName: r.ad_group_name,
        keywordText: r.keyword_text,
        bidStrategy: r.bid_strategy,
      }),
    )
  }

  return detectBidExperiments({ organisationId, identityKeys: [...keys] })
}

async function backfillBidExperiments() {
  console.log('Backfilling bid experiments from daily_keyword_metrics...')
  const organisations = await pool.query(
    `SELECT DISTINCT organisation_id
     FROM daily_keyword_metrics
     WHERE organisation_id IS NOT NULL
     ORDER BY organisation_id`,
  )

  let created = 0
  let skipped = 0
  let scannedIdentities = 0
  for (const row of organisations.rows) {
    const result = await detectBidExperiments({ organisationId: row.organisation_id })
    created += result.created
    skipped += result.skipped
    scannedIdentities += result.scannedIdentities
  }

  console.log(
    `Bid experiment backfill complete: created=${created}, existing=${skipped}, identities=${scannedIdentities}`,
  )
  return { created, skipped, scannedIdentities }
}

/**
 * Query keyword daily metrics for experiment analysis
 * 
 * P4.1: CRITICAL - Must filter by organisation_id to prevent tenant data leakage.
 * Two organisations can have identical keyword identities (app_id, campaign_name, etc).
 */
async function queryKeywordDailyRows({
  organisationId,
  appId,
  campaignName,
  adGroupName,
  keywordText,
  bidStrategy,
  startDate,
  endDate,
}) {
  if (!organisationId) {
    throw new Error('organisationId is required for queryKeywordDailyRows')
  }

  if (!startDate || !endDate || startDate > endDate) return []

  const result = await pool.query(
    `SELECT
       report_date,
       SUM(spend) AS spend,
       SUM(impressions) AS impressions,
       SUM(taps) AS taps,
       SUM(COALESCE(NULLIF(installs_tap_through, 0), installs)) AS installs_tap_through,
       SUM(installs_view_through) AS installs_view_through,
       SUM(COALESCE(NULLIF(installs_total, 0), installs)) AS installs_total
     FROM daily_keyword_metrics
     WHERE organisation_id = $1
       AND app_id = $2
       AND campaign_name = $3
       AND COALESCE(ad_group_name, '') = $4
       AND keyword_text = $5
       AND COALESCE(bid_strategy, '') = $6
       AND report_date >= $7
       AND report_date <= $8
     GROUP BY report_date
     ORDER BY report_date ASC`,
    [
      organisationId,
      appId,
      campaignName,
      part(adGroupName),
      keywordText,
      part(bidStrategy),
      startDate,
      endDate,
    ],
  )

  return result.rows
}

/**
 * Daily CPA samples for historical baseline.
 * Valid day = installs_tap_through > 0 (CPA is defined).
 * Window is exclusive of change_date: [lookbackStart, changeDate).
 */
/**
 * Fetch historical CPA samples for baseline
 * 
 * P4.1: Must pass organisationId to prevent tenant data leakage
 */
async function fetchHistoricalCpaSamples(organisationId, identity, changeDate, lookbackDays = DEFAULT_BASELINE_LOOKBACK_DAYS) {
  if (!organisationId) {
    throw new Error('organisationId is required for fetchHistoricalCpaSamples')
  }

  const lookbackEnd = addDays(changeDate, -1)
  const lookbackStart = addDays(changeDate, -lookbackDays)
  if (!lookbackEnd || lookbackStart > lookbackEnd) {
    return {
      samples: [],
      lookback_days: lookbackDays,
      lookback_start: lookbackStart,
      lookback_end: lookbackEnd,
    }
  }

  const rows = await queryKeywordDailyRows({
    organisationId,
    ...identity,
    startDate: lookbackStart,
    endDate: lookbackEnd,
  })

  const samples = []
  for (const row of rows) {
    const spend = parseFloat(row.spend) || 0
    const installsTap = parseInt(row.installs_tap_through, 10) || 0
    if (installsTap > 0) {
      samples.push(spend / installsTap)
    }
  }

  return {
    samples,
    lookback_days: lookbackDays,
    lookback_start: lookbackStart,
    lookback_end: lookbackEnd,
  }
}

/**
 * Aggregate keyword metrics for a time window
 * 
 * P4.1: Must pass organisationId to prevent tenant data leakage
 */
async function aggregateKeywordWindow({
  organisationId,
  appId,
  campaignName,
  adGroupName,
  keywordText,
  bidStrategy,
  startDate,
  endDate,
}) {
  if (!organisationId) {
    throw new Error('organisationId is required for aggregateKeywordWindow')
  }

  if (!startDate || !endDate || startDate > endDate) {
    return {
      start_date: startDate,
      end_date: endDate,
      calendar_days: 0,
      data_days: 0,
      metrics: null,
      day_dates: [],
    }
  }

  const rows = await queryKeywordDailyRows({
    organisationId,
    appId,
    campaignName,
    adGroupName,
    keywordText,
    bidStrategy,
    startDate,
    endDate,
  })

  let spend = 0
  let impressions = 0
  let taps = 0
  let installsTap = 0
  let installsView = 0
  let installsTotal = 0
  const dayDates = []

  for (const row of rows) {
    dayDates.push(toDateKey(row.report_date))
    spend += parseFloat(row.spend) || 0
    impressions += parseInt(row.impressions, 10) || 0
    taps += parseInt(row.taps, 10) || 0
    installsTap += parseInt(row.installs_tap_through, 10) || 0
    installsView += parseInt(row.installs_view_through, 10) || 0
    installsTotal += parseInt(row.installs_total, 10) || 0
  }

  const metrics =
    dayDates.length === 0
      ? null
      : calculateDerivedMetrics({
          spend,
          impressions,
          taps,
          installs_tap_through: installsTap,
          installs_view_through: installsView,
          installs_total: installsTotal,
        })

  return {
    start_date: startDate,
    end_date: endDate,
    calendar_days: calendarDaysBetween(startDate, endDate),
    data_days: dayDates.length,
    metrics,
    day_dates: dayDates,
  }
}

function resolveWindows(experiment, latestReportDate) {
  const n = experiment.requested_observation_days
  const changeDate = toDateKey(experiment.change_date)

  const beforeEnd = addDays(changeDate, -1)
  const beforeStart = addDays(changeDate, -n)

  let afterStart = changeDate
  let afterEnd = addDays(changeDate, n - 1)
  let interruptionReason = null

  if (experiment.interruption_date) {
    const interrupt = toDateKey(experiment.interruption_date)
    const lastClean = addDays(interrupt, -1)
    if (lastClean < afterEnd) {
      afterEnd = lastClean
    }
    interruptionReason =
      'Observation window was shortened because another bid change occurred.'
  }

  return {
    beforeStart,
    beforeEnd,
    afterStart,
    afterEnd,
    interruptionReason,
    latestReportDate,
  }
}

function buildAnalysisPayload(
  experiment,
  before,
  after,
  statusInfo,
  interruptionReason,
  historicalBaseline = null,
) {
  const beforeMetrics = before.metrics
  const afterMetrics = after.metrics

  const metricKeys = ['spend', 'impressions', 'taps', 'installs', 'cpt', 'cpa', 'ttr', 'cr']
  const deltas = {}
  for (const key of metricKeys) {
    const b = beforeMetrics ? beforeMetrics[key] : null
    const a = afterMetrics ? afterMetrics[key] : null
    deltas[key] = {
      before: b ?? null,
      after: a ?? null,
      change: b != null && a != null ? a - b : null,
      change_percent: percentChange(a ?? null, b ?? null),
    }
  }

  let status = statusInfo.status
  let statusReason = statusInfo.reason

  const beforeInsufficient = before.data_days < MIN_DATA_DAYS
  const afterInsufficient = after.data_days < MIN_DATA_DAYS
  const datasetPastWindow =
    statusInfo.status === STATUSES.COMPLETED || statusInfo.status === STATUSES.INTERRUPTED

  if (
    beforeInsufficient ||
    (datasetPastWindow && afterInsufficient) ||
    (statusInfo.status === STATUSES.INTERRUPTED && afterInsufficient)
  ) {
    if (status !== STATUSES.OBSERVING) {
      status = STATUSES.INSUFFICIENT_DATA
      statusReason = beforeInsufficient
        ? 'Before window has insufficient data days (minimum 2).'
        : 'After window has insufficient data days (minimum 2).'
    }
  }

  const unavailable = []
  if (beforeMetrics) {
    if (beforeMetrics.cpt === null) unavailable.push('before.cpt')
    if (beforeMetrics.cpa === null) unavailable.push('before.cpa')
    if (beforeMetrics.ttr === null) unavailable.push('before.ttr')
    if (beforeMetrics.cr === null) unavailable.push('before.cr')
  } else {
    unavailable.push('before.metrics')
  }
  if (afterMetrics) {
    if (afterMetrics.cpt === null) unavailable.push('after.cpt')
    if (afterMetrics.cpa === null) unavailable.push('after.cpa')
    if (afterMetrics.ttr === null) unavailable.push('after.ttr')
    if (afterMetrics.cr === null) unavailable.push('after.cr')
  } else {
    unavailable.push('after.metrics')
  }

  // Current CPA for baseline comparison = after-window CPA (observed period).
  const currentCpa = afterMetrics?.cpa ?? null
  const cpaBaseline = buildMetricBaseline(
    historicalBaseline?.samples || [],
    currentCpa,
  )

  return {
    id: experiment.id,
    app_id: experiment.app_id,
    app_name: experiment.app_name,
    campaign_name: experiment.campaign_name,
    ad_group_name: experiment.ad_group_name,
    keyword_text: experiment.keyword_text,
    bid_strategy: experiment.bid_strategy,
    keyword_identity_key: experiment.keyword_identity_key,
    change_date: toDateKey(experiment.change_date),
    previous_max_cpt_bid: normalizeBid(experiment.previous_max_cpt_bid),
    new_max_cpt_bid: normalizeBid(experiment.new_max_cpt_bid),
    bid_change_amount: normalizeBid(experiment.bid_change_amount),
    bid_change_percent:
      experiment.bid_change_percent != null
        ? parseFloat(experiment.bid_change_percent)
        : null,
    direction: experiment.direction,
    requested_observation_days: experiment.requested_observation_days,
    actual_observation_days: statusInfo.actual_observation_days,
    status,
    status_reason: statusReason,
    interruption_date: experiment.interruption_date
      ? toDateKey(experiment.interruption_date)
      : null,
    interruption_reason: interruptionReason,
    before: {
      start_date: before.start_date,
      end_date: before.end_date,
      calendar_days: before.calendar_days,
      data_days: before.data_days,
      metrics: beforeMetrics,
    },
    after: {
      start_date: after.start_date,
      end_date: after.end_date,
      calendar_days: after.calendar_days,
      data_days: after.data_days,
      metrics: afterMetrics,
    },
    deltas,
    /**
     * Historical baselines. Primary UI should use typical_low/high + status.
     * statistics (median, q1, q3, iqr) are for secondary/advanced views.
     * confidence: High | Medium | Low | Insufficient
     */
    baselines: {
      confidence: cpaBaseline.confidence,
      lookback_days: historicalBaseline?.lookback_days ?? DEFAULT_BASELINE_LOOKBACK_DAYS,
      lookback_start: historicalBaseline?.lookback_start ?? null,
      lookback_end: historicalBaseline?.lookback_end ?? null,
      cpa: {
        typical_low: cpaBaseline.typical_low,
        typical_high: cpaBaseline.typical_high,
        current: cpaBaseline.current,
        status: cpaBaseline.status,
        confidence: cpaBaseline.confidence,
        statistics: cpaBaseline.statistics,
      },
    },
    data_quality: {
      before_data_days: before.data_days,
      after_data_days: after.data_days,
      missing_before_data: beforeInsufficient,
      missing_after_data: afterInsufficient,
      unavailable_metrics: unavailable,
      min_data_days: MIN_DATA_DAYS,
    },
  }
}

/**
 * Analyze a bid experiment
 * 
 * P4.1: CRITICAL FIX - Now requires experiment.organisation_id to prevent tenant data leakage.
 * All queries for daily_keyword_metrics must be scoped by organisation_id.
 */
async function analyzeExperiment(experiment) {
  if (!experiment.organisation_id) {
    throw new Error('experiment.organisation_id is required for analyzeExperiment')
  }

  const latestReportDate = await getLatestReportDate(experiment.organisation_id, experiment.app_id)
  const windows = resolveWindows(experiment, latestReportDate)
  const changeDate = toDateKey(experiment.change_date)
  const plannedEnd = addDays(changeDate, experiment.requested_observation_days - 1)

  let afterEnd = windows.afterEnd
  if (!experiment.interruption_date && latestReportDate && latestReportDate < afterEnd) {
    afterEnd = latestReportDate
  }
  if (afterEnd < windows.afterStart) {
    afterEnd = null
  }

  const identity = {
    organisationId: experiment.organisation_id,
    appId: experiment.app_id,
    campaignName: experiment.campaign_name,
    adGroupName: experiment.ad_group_name,
    keywordText: experiment.keyword_text,
    bidStrategy: experiment.bid_strategy,
  }

  const [before, after, historicalBaseline] = await Promise.all([
    aggregateKeywordWindow({
      ...identity,
      startDate: windows.beforeStart,
      endDate: windows.beforeEnd,
    }),
    aggregateKeywordWindow({
      ...identity,
      startDate: windows.afterStart,
      endDate: afterEnd,
    }),
    fetchHistoricalCpaSamples(experiment.organisation_id, identity, changeDate),
  ])

  const statusInfo = (() => {
    if (experiment.interruption_date) {
      const lastClean = addDays(toDateKey(experiment.interruption_date), -1)
      const actual = Math.max(0, calendarDaysBetween(changeDate, lastClean))
      if (after.data_days < MIN_DATA_DAYS || before.data_days < MIN_DATA_DAYS) {
        return {
          status: STATUSES.INSUFFICIENT_DATA,
          actual_observation_days: actual,
          reason:
            before.data_days < MIN_DATA_DAYS
              ? 'Before window has insufficient data days (minimum 2).'
              : 'After window has insufficient data days (minimum 2).',
        }
      }
      return {
        status: STATUSES.INTERRUPTED,
        actual_observation_days: actual,
        reason: windows.interruptionReason,
      }
    }

    if (!latestReportDate || latestReportDate < plannedEnd) {
      return {
        status: STATUSES.OBSERVING,
        actual_observation_days: latestReportDate
          ? Math.max(0, calendarDaysBetween(changeDate, latestReportDate))
          : 0,
        reason:
          'Full observation window has not elapsed relative to available report data.',
      }
    }

    if (before.data_days < MIN_DATA_DAYS || after.data_days < MIN_DATA_DAYS) {
      return {
        status: STATUSES.INSUFFICIENT_DATA,
        actual_observation_days: experiment.requested_observation_days,
        reason:
          before.data_days < MIN_DATA_DAYS
            ? 'Before window has insufficient data days (minimum 2).'
            : 'After window has insufficient data days (minimum 2).',
      }
    }

    return {
      status: STATUSES.COMPLETED,
      actual_observation_days: experiment.requested_observation_days,
      reason: null,
    }
  })()

  return buildAnalysisPayload(
    experiment,
    before,
    after,
    statusInfo,
    windows.interruptionReason,
    historicalBaseline,
  )
}

/**
 * List bid experiments
 * 
 * P4: organisationId is now required for tenant isolation
 */
async function listBidExperiments({
  organisationId,
  appId = null,
  campaignName = null,
  adGroupName = null,
  keywordText = null,
  keywordIdentityKey = null,
  status = null,
  limit = 50,
  offset = 0,
} = {}) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const conditions = []
  const params = []
  let i = 1

  // Tenant scope MUST be first filter
  conditions.push(`organisation_id = $${i++}`)
  params.push(organisationId)

  if (appId) {
    conditions.push(`app_id = $${i++}`)
    params.push(appId)
  }
  if (campaignName) {
    conditions.push(`campaign_name = $${i++}`)
    params.push(campaignName)
  }
  if (adGroupName != null) {
    conditions.push(`COALESCE(ad_group_name, '') = $${i++}`)
    params.push(part(adGroupName))
  }
  if (keywordText) {
    conditions.push(`keyword_text = $${i++}`)
    params.push(keywordText)
  }
  if (keywordIdentityKey) {
    conditions.push(`keyword_identity_key = $${i++}`)
    params.push(keywordIdentityKey)
  }

  if (status && !Object.values(STATUSES).includes(status)) {
    throw httpError(400, 'Invalid status')
  }
  if (status) {
    conditions.push(`status = $${i++}`)
    params.push(status)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const lim = parseBoundedInteger(limit, { name: 'limit', min: 1, max: 200, fallback: 50 })
  const off = parseBoundedInteger(offset, {
    name: 'offset',
    min: 0,
    max: MAX_PAGE_OFFSET,
    fallback: 0,
  })

  const result = await pool.query(
    `SELECT *
     FROM bid_experiments
     ${where}
     ORDER BY change_date DESC, id DESC
     LIMIT ${lim} OFFSET ${off}`,
    params,
  )

  // Summaries only — resolve status lightly without full metrics for each
  const latestByApp = new Map()
  const summaries = []

  for (const row of result.rows) {
    if (!latestByApp.has(row.app_id)) {
      latestByApp.set(row.app_id, await getLatestReportDate(organisationId, row.app_id))
    }
    const latest = latestByApp.get(row.app_id)
    const changeDate = toDateKey(row.change_date)
    const plannedEnd = addDays(changeDate, row.requested_observation_days - 1)

    let resolvedStatus = row.status
    let actualDays = row.actual_observation_days

    if (row.interruption_date) {
      resolvedStatus = STATUSES.INTERRUPTED
      actualDays = Math.max(
        0,
        calendarDaysBetween(changeDate, addDays(toDateKey(row.interruption_date), -1)),
      )
    } else if (!latest || latest < plannedEnd) {
      resolvedStatus = STATUSES.OBSERVING
      actualDays = latest ? Math.max(0, calendarDaysBetween(changeDate, latest)) : 0
    } else {
      resolvedStatus = STATUSES.COMPLETED
      actualDays = row.requested_observation_days
    }

    if (status && resolvedStatus !== status) continue

    summaries.push({
      id: row.id,
      app_id: row.app_id,
      app_name: row.app_name,
      campaign_name: row.campaign_name,
      ad_group_name: row.ad_group_name,
      keyword_text: row.keyword_text,
      bid_strategy: row.bid_strategy,
      keyword_identity_key: row.keyword_identity_key,
      change_date: changeDate,
      previous_max_cpt_bid: normalizeBid(row.previous_max_cpt_bid),
      new_max_cpt_bid: normalizeBid(row.new_max_cpt_bid),
      bid_change_amount: normalizeBid(row.bid_change_amount),
      bid_change_percent:
        row.bid_change_percent != null ? parseFloat(row.bid_change_percent) : null,
      direction: row.direction,
      requested_observation_days: row.requested_observation_days,
      actual_observation_days: actualDays,
      status: resolvedStatus,
      interruption_date: row.interruption_date
        ? toDateKey(row.interruption_date)
        : null,
    })
  }

  return {
    experiments: summaries,
    limit: lim,
    offset: off,
  }
}

/**
 * Get bid experiment by ID
 * 
 * P4: organisationId is now required for IDOR protection
 */
async function getBidExperimentById(organisationId, id) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const result = await pool.query(
    `SELECT * FROM bid_experiments WHERE id = $1 AND organisation_id = $2`,
    [id, organisationId]
  )
  if (result.rows.length === 0) return null
  return analyzeExperiment(result.rows[0])
}

module.exports = {
  ALLOWED_OBSERVATION_DAYS,
  DEFAULT_OBSERVATION_DAYS,
  SETTINGS_KEY,
  MIN_DATA_DAYS,
  STATUSES,
  buildKeywordIdentityKey,
  parseIdentityKey,
  normalizeBid,
  bidsEqual,
  validateObservationDays,
  getDefaultObservationDays,
  setDefaultObservationDays,
  getBidExperimentSettings,
  detectBidExperiments,
  detectBidExperimentsForKeywordRecords,
  backfillBidExperiments,
  listBidExperiments,
  getBidExperimentById,
  analyzeExperiment,
  // exported for unit tests
  addDays,
  calendarDaysBetween,
  percentChange,
  toDateKey,
  part,
}
