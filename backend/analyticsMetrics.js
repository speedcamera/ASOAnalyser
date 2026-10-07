/**
 * Standardized metric calculations from absolute values.
 * All formulas use installs_tap_through by default for CPA and CR.
 *
 * Totals (spend, impressions, taps, installs): genuine zero activity may be 0.
 * Derived metrics (cpt, cpa, ttr, cr): unavailable when denominator is 0 → null
 * (never Infinity/NaN/0-as-missing).
 */

const CHANGE_DIRECTION = {
  INCREASE: 'increase',
  DECREASE: 'decrease',
  UNCHANGED: 'unchanged',
  UNAVAILABLE: 'unavailable',
}

/**
 * Percentage change with explicit zero / missing rules.
 *
 * - Both available, previous ≠ 0 → normal %
 * - previous = 0 and current = 0 → 0 (unchanged)
 * - previous = 0 and current ≠ 0 → null (no finite %; treat as new activity in UI)
 * - either missing → null
 */
function percentChange(current, previous) {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return null
  }
  const cur = typeof current === 'number' ? current : Number(current)
  const prev = typeof previous === 'number' ? previous : Number(previous)
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null
  if (prev === 0) {
    return cur === 0 ? 0 : null
  }
  return ((cur - prev) / prev) * 100
}

/**
 * Numerical movement only — never good/bad / improved/declined.
 */
function changeDirection(current, previous) {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return CHANGE_DIRECTION.UNAVAILABLE
  }
  const cur = typeof current === 'number' ? current : Number(current)
  const prev = typeof previous === 'number' ? previous : Number(previous)
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return CHANGE_DIRECTION.UNAVAILABLE
  if (prev === 0 && cur !== 0) return CHANGE_DIRECTION.UNAVAILABLE
  if (cur === prev) return CHANGE_DIRECTION.UNCHANGED
  if (cur > prev) return CHANGE_DIRECTION.INCREASE
  if (cur < prev) return CHANGE_DIRECTION.DECREASE
  return CHANGE_DIRECTION.UNAVAILABLE
}

/**
 * Canonical comparison descriptor for a single metric.
 */
function describeMetricChange(current, previous) {
  const cur =
    current === null || current === undefined
      ? null
      : Number.isFinite(Number(current))
        ? Number(current)
        : null
  const prev =
    previous === null || previous === undefined
      ? null
      : Number.isFinite(Number(previous))
        ? Number(previous)
        : null

  const percent = percentChange(cur, prev)
  const direction = changeDirection(cur, prev)
  const absolute = cur != null && prev != null ? cur - prev : null
  const isNewActivity = prev === 0 && cur != null && cur > 0

  return {
    absolute,
    percent,
    direction,
    is_new_activity: isNewActivity,
  }
}

/**
 * Calculate derived metrics from aggregated absolute values.
 * @param {Object} totals - { spend, impressions, taps, installs_tap_through, ... }
 * @returns {Object} - { cpa, cpt, ttr, cr, ... }
 */
function calculateDerivedMetrics(totals) {
  const spend = totals.spend ?? 0
  const impressions = totals.impressions ?? 0
  const taps = totals.taps ?? 0
  const installsTapThrough = totals.installs_tap_through ?? 0
  const installsTotal = totals.installs_total ?? 0

  // CPA = spend / tap-through installs (primary attribution)
  const cpa = installsTapThrough > 0 ? spend / installsTapThrough : null

  // CPT = spend / taps
  const cpt = taps > 0 ? spend / taps : null

  // TTR = (taps / impressions) * 100
  const ttr = impressions > 0 ? (taps / impressions) * 100 : null

  // CR = (tap-through installs / taps) * 100
  const cr = taps > 0 ? (installsTapThrough / taps) * 100 : null

  return {
    spend,
    impressions,
    taps,
    installs: installsTapThrough, // Legacy compatibility - map to tap-through
    installs_tap_through: installsTapThrough,
    installs_view_through: totals.installs_view_through ?? 0,
    installs_total: installsTotal,
    cpa,
    cpt,
    ttr,
    cr,
    // Alternative CPA using total installs (optional, for future toggle)
    cpa_total: installsTotal > 0 ? spend / installsTotal : null,
  }
}


module.exports = {
  CHANGE_DIRECTION,
  percentChange,
  changeDirection,
  describeMetricChange,
  calculateDerivedMetrics,
}
