/**
 * Campaign daily budget history.
 *
 * Apple Ads stores Daily Budget on each report row. Those values are rolled
 * into daily_campaign_metrics (organisation_id, app_id, campaign_name, report_date).
 * That table is the canonical history. Change records are derived from it by
 * report date, so import order cannot invent a reverse change.
 *
 * The first recorded budget is an observation, not a change. A missing budget
 * stays null and is never treated as zero.
 */

const { pool } = require('./db')
const { httpError } = require('./http/clientError')
const { percentChange } = require('./analyticsMetrics')

function emptyBudget() {
  return {
    current_daily_budget: null,
    previous_daily_budget: null,
    budget_change: null,
    budget_change_percent: null,
    budget_first_observed_date: null,
    budget_observation_count: 0,
    budget_comparison_status: 'unavailable',
    budget_changed_in_selected_period: false,
    last_budget_change_at: null,
  }
}

function roundMoney(value) {
  if (value === null || value === undefined || value === '') return null
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return null
  return Math.round((num + Number.EPSILON) * 100) / 100
}

function dateKey(value) {
  if (value === null || value === undefined || value === '') return null
  return String(value).slice(0, 10)
}

function inSelectedPeriod(changeDate, periodStartDate, periodEndDate) {
  const start = dateKey(periodStartDate)
  const end = dateKey(periodEndDate)
  const change = dateKey(changeDate)
  if (!start || !end || !change) return false
  return change >= start && change <= end
}

function summarizeRuns(runs, periodStartDate, periodEndDate) {
  if (!runs.length) return emptyBudget()

  const currentRun = runs[runs.length - 1]
  const previousRun = runs.length > 1 ? runs[runs.length - 2] : null
  const current = roundMoney(currentRun.budget)
  const previous = previousRun == null ? null : roundMoney(previousRun.budget)
  const comparable = previous !== null && previous !== undefined
  const parsedCount = Number(currentRun.observation_count)
  const observationCount = Number.isFinite(parsedCount) ? parsedCount : runs.length
  const changeDate = comparable ? currentRun.first_observed_date : null
  let budgetComparisonStatus = 'new'
  if (comparable) budgetComparisonStatus = 'comparable'
  else if (observationCount > 1) budgetComparisonStatus = 'unchanged'

  return {
    current_daily_budget: current,
    previous_daily_budget: comparable ? previous : null,
    budget_change: comparable ? roundMoney(current - previous) : null,
    budget_change_percent: comparable ? percentChange(current, previous) : null,
    budget_first_observed_date: currentRun.first_observed_date,
    budget_observation_count: observationCount,
    budget_comparison_status: budgetComparisonStatus,
    budget_changed_in_selected_period: inSelectedPeriod(changeDate, periodStartDate, periodEndDate),
    last_budget_change_at: changeDate,
  }
}

function toChange(run) {
  const next = roundMoney(run.budget)
  const previous = roundMoney(run.prev_budget)
  return {
    change_date: run.first_observed_date,
    previous_daily_budget: previous,
    new_daily_budget: next,
    budget_change: roundMoney(next - previous),
    budget_change_percent: percentChange(next, previous),
  }
}

/**
 * Distinct budget levels in report-date order.
 * A level starts on the first date its rounded budget differs from the previous recorded day.
 */
async function loadBudgetRuns({ organisationId, appId = null, campaignName = null }) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const result = await pool.query(
    `WITH daily AS (
       SELECT
         app_id,
         campaign_name,
         report_date::text AS report_date,
         ROUND(daily_budget, 2) AS budget
       FROM daily_campaign_metrics
       WHERE organisation_id = $1
         AND daily_budget IS NOT NULL
         AND ($2::text IS NULL OR app_id = $2)
         AND ($3::text IS NULL OR campaign_name = $3)
     ),
     counted AS (
       SELECT
         app_id,
         campaign_name,
         report_date,
         budget,
         COUNT(*) OVER (PARTITION BY app_id, campaign_name) AS observation_count
       FROM daily
     ),
     ordered AS (
       SELECT
         app_id,
         campaign_name,
         report_date,
         budget,
         observation_count,
         LAG(budget) OVER (
           PARTITION BY app_id, campaign_name
           ORDER BY report_date
         ) AS prev_budget
       FROM counted
     )
     SELECT
       app_id,
       campaign_name,
       report_date AS first_observed_date,
       budget,
       observation_count,
       prev_budget
     FROM ordered
     WHERE prev_budget IS NULL OR prev_budget IS DISTINCT FROM budget
     ORDER BY app_id, campaign_name, report_date`,
    [organisationId, appId, campaignName],
  )

  return result.rows
}

function groupRuns(rows) {
  const grouped = new Map()
  for (const row of rows) {
    const key = `${row.app_id}|${row.campaign_name}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(row)
  }
  return grouped
}

async function resolveCampaignBudgets({
  organisationId,
  appId = null,
  periodStartDate = null,
  periodEndDate = null,
}) {
  const grouped = groupRuns(await loadBudgetRuns({ organisationId, appId }))
  const resolved = new Map()
  for (const [key, runs] of grouped) {
    resolved.set(key, summarizeRuns(runs, periodStartDate, periodEndDate))
  }
  return resolved
}

async function attachCampaignBudgetHistory(organisationId, campaigns, periodStartDate, periodEndDate) {
  if (!campaigns?.length) return campaigns || []

  const budgets = await resolveCampaignBudgets({
    organisationId,
    periodStartDate,
    periodEndDate,
  })

  return campaigns.map((campaign) => {
    const key = `${campaign.app_id}|${campaign.campaign_name}`
    const budget = budgets.get(key) || emptyBudget()
    return {
      ...campaign,
      daily_budget: budget.current_daily_budget,
      ...budget,
    }
  })
}

async function getCampaignBudgetHistory({ organisationId, appId, campaignName }) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }
  if (!appId || !campaignName) {
    throw httpError(400, 'appId and campaignName are required')
  }

  const runs = await loadBudgetRuns({ organisationId, appId, campaignName })
  const summary = summarizeRuns(runs, null, null)

  return {
    app_id: appId,
    campaign_name: campaignName,
    ...summary,
    changes: runs.filter((run) => run.prev_budget != null).map(toChange),
  }
}

/**
 * Read-only reconstruction report. History is derived from daily_campaign_metrics,
 * so re-running this does not write rows and cannot duplicate changes.
 */
async function summarizeReconstructableBudgetHistory(organisationId) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }
  const params = [organisationId]
  const orgFilter = 'WHERE organisation_id = $1'

  const result = await pool.query(
    `WITH scoped AS (
       SELECT organisation_id, app_id, campaign_name, report_date, daily_budget
       FROM daily_campaign_metrics
       ${orgFilter}
     ),
     daily AS (
       SELECT
         organisation_id,
         app_id,
         campaign_name,
         report_date,
         ROUND(daily_budget, 2) AS budget
       FROM scoped
       WHERE daily_budget IS NOT NULL
     ),
     ordered AS (
       SELECT
         organisation_id,
         app_id,
         campaign_name,
         budget,
         LAG(budget) OVER (
           PARTITION BY organisation_id, app_id, campaign_name
           ORDER BY report_date
         ) AS prev_budget
       FROM daily
     ),
     runs AS (
       SELECT * FROM ordered
       WHERE prev_budget IS NULL OR prev_budget IS DISTINCT FROM budget
     ),
     identities AS (
       SELECT organisation_id, app_id, campaign_name
       FROM scoped
       GROUP BY organisation_id, app_id, campaign_name
     )
     SELECT
       (SELECT COUNT(*)::int FROM identities) AS campaigns,
       (SELECT COUNT(*)::int FROM identities i
         WHERE NOT EXISTS (
           SELECT 1 FROM daily d
           WHERE d.organisation_id = i.organisation_id
             AND d.app_id = i.app_id
             AND d.campaign_name = i.campaign_name
         )) AS campaigns_without_budget,
       (SELECT COUNT(*)::int FROM (
          SELECT organisation_id, app_id, campaign_name FROM daily
          GROUP BY organisation_id, app_id, campaign_name
        ) s) AS campaigns_with_budget,
       (SELECT COUNT(*)::int FROM runs) AS observations,
       (SELECT COUNT(*)::int FROM runs WHERE prev_budget IS NOT NULL) AS changes`,
    params,
  )

  return result.rows[0]
}

module.exports = {
  attachCampaignBudgetHistory,
  getCampaignBudgetHistory,
  resolveCampaignBudgets,
  summarizeReconstructableBudgetHistory,
}
