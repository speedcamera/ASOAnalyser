/**
 * Presentation labels for missing values in the Keywords comparison table.
 * These do not change calculated metrics. A numeric zero stays a number.
 */

export const NOT_RECORDED = 'Not recorded'
export const NO_INSTALLS = 'No installs'
export const NO_PRIOR_DATA = 'No prior data'

function isMissing(value) {
  return value === null || value === undefined
}

/**
 * Label for a missing current-period metric. Null means the number is shown.
 * Zero installs make CPA unavailable. A recorded zero stays a number.
 */
export function currentMetricLabel(metric, { current, installs } = {}) {
  if (!isMissing(current)) return null
  if (metric === 'cpa' && installs === 0) return NO_INSTALLS
  return NOT_RECORDED
}

/**
 * Label for a missing previous-period comparison. Null means the number is shown.
 * Zero previous installs make CPA unavailable even though the period was recorded.
 * A missing previous period is "No prior data".
 */
export function previousMetricLabel(metric, { previous, previousInstalls } = {}) {
  if (!isMissing(previous)) return null
  if (metric === 'cpa' && previousInstalls === 0) return NO_INSTALLS
  return NO_PRIOR_DATA
}

/** Missing bid fields. A recorded bid of zero is not missing. */
export function missingBidLabel(bid) {
  if (!isMissing(bid)) return null
  return NOT_RECORDED
}

/**
 * Bid change and bid % need a previous recorded bid.
 * The first recorded bid is not a change, and a change is not calculated from zero.
 * Returns the unavailable label, or null when the numeric change should be shown.
 */
export function bidChangeUnavailableLabel(previousBid, bidChange) {
  if (isMissing(previousBid) || isMissing(bidChange)) return NOT_RECORDED
  return null
}
