/**
 * Daily Trend Data - Migrated to Analytics Service
 * 
 * This endpoint now uses the centralized Analytics Service for daily metrics.
 * Weekly rollup is preserved for backward compatibility.
 */

const { getDailyTrend } = require('./analyticsService')

/**
 * Group daily data into weekly buckets (Monday start)
 */
function weekStartingMonday(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`)
  const weekday = date.getUTCDay()
  const offset = weekday === 0 ? -6 : 1 - weekday
  date.setUTCDate(date.getUTCDate() + offset)
  
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Roll up daily data into weekly summaries
 */
function rollupToWeeks(days) {
  if (!days || days.length === 0) return []

  const weekMap = new Map()

  for (const day of days) {
    const weekStart = weekStartingMonday(day.date)
    
    if (!weekMap.has(weekStart)) {
      weekMap.set(weekStart, {
        weekStarting: weekStart,
        spend: 0,
        impressions: 0,
        taps: 0,
        installs: 0,
        installs_tap_through: 0,
        installs_view_through: 0,
        installs_total: 0,
      })
    }

    const week = weekMap.get(weekStart)
    week.spend += day.spend || 0
    week.impressions += day.impressions || 0
    week.taps += day.taps || 0
    week.installs += day.installs || 0
    week.installs_tap_through += day.installs_tap_through || 0
    week.installs_view_through += day.installs_view_through || 0
    week.installs_total += day.installs_total || 0
  }

  const weeks = Array.from(weekMap.values())
  
  // Calculate derived metrics for each week
  return weeks.map(week => {
    const cpa = week.installs_tap_through > 0 ? week.spend / week.installs_tap_through : null
    const cpt = week.taps > 0 ? week.spend / week.taps : null
    const ttr = week.impressions > 0 ? (week.taps / week.impressions) * 100 : null
    const cr = week.taps > 0 ? (week.installs_tap_through / week.taps) * 100 : null

    return {
      ...week,
      cpa,
      cpt,
      ttr,
      cr,
    }
  }).sort((a, b) => a.weekStarting.localeCompare(b.weekStarting))
}

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Earliest date the weekly query must include so the oldest week that can
 * appear in the display range still has its immediately preceding week.
 * Uses the same Monday boundary as rollupToWeeks.
 * Unbounded display (ALL) has no extra lookback.
 */
function comparisonFetchStart(displayStart) {
  if (!displayStart) return null
  return addDays(weekStartingMonday(displayStart), -7)
}

function isWithinDisplayRange(dateStr, displayStart, displayEnd) {
  if (displayStart && dateStr < displayStart) return false
  if (displayEnd && dateStr > displayEnd) return false
  return true
}

/**
 * Attach the immediately preceding week's metrics.
 * Display-range weeks win over the wider fetch so a week that straddles
 * displayStart keeps its period-scoped totals.
 * A missing previous week stays null. A real zero stays zero.
 */
function attachPreviousWeekComparisons(displayWeeks, contextWeeks) {
  const displayByStart = new Map(displayWeeks.map((week) => [week.weekStarting, week]))
  const contextByStart = new Map(contextWeeks.map((week) => [week.weekStarting, week]))

  return displayWeeks.map((week) => {
    const previousStart = addDays(week.weekStarting, -7)
    const previous = displayByStart.get(previousStart) || contextByStart.get(previousStart) || null

    return {
      ...week,
      previous_week_starting: previous ? previous.weekStarting : null,
      previous_spend: previous ? previous.spend : null,
      previous_installs: previous ? previous.installs : null,
      previous_cpa: previous ? previous.cpa : null,
      previous_cpt: previous ? previous.cpt : null,
      previous_ttr: previous ? previous.ttr : null,
    }
  })
}

/**
 * Split a fetch that may include one comparison week into display rows.
 * Comparison-only weeks are used as previous-week context and are not returned.
 */
function buildWeeklyRows(days, { displayStart = null, displayEnd = null } = {}) {
  const fetchedDays = days || []
  const displayDays = fetchedDays.filter((day) =>
    isWithinDisplayRange(day.date, displayStart, displayEnd),
  )
  const displayWeeks = rollupToWeeks(displayDays)
  const contextWeeks = rollupToWeeks(fetchedDays)

  return {
    days: displayDays,
    weeks: attachPreviousWeekComparisons(displayWeeks, contextWeeks),
  }
}

/**
 * Get daily performance metrics with weekly rollup.
 * Daily rows stay inside the selected display range.
 * Weekly comparisons also read the preceding week when a display start is set.
 *
 * P4: organisationId is required for tenant isolation. The widened fetch uses
 * the same organisation-scoped Analytics Service query.
 */
async function getCampaignWeeklyPerformance({
  organisationId,
  campaignName = null,
  startDate = null,
  endDate = null,
  appKey = null,
  appId = null,
} = {}) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const effectiveAppId = appId || appKey
  const fetchStart = comparisonFetchStart(startDate)

  const fetchedDays = await getDailyTrend({
    organisationId,
    startDate: fetchStart,
    endDate,
    appId: effectiveAppId,
    campaignName,
  })

  return buildWeeklyRows(fetchedDays, {
    displayStart: startDate,
    displayEnd: endDate,
  })
}

module.exports = {
  getCampaignWeeklyPerformance,
  weekStartingMonday,
  comparisonFetchStart,
  buildWeeklyRows,
}
