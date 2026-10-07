export function buildPeriodCompareHint(periods) {
  if (!periods?.current_period || !periods?.previous_period) return null

  const { current_period: current, previous_period: previous } = periods
  return `Current: ${current.start_date} → ${current.end_date} · Previous: ${previous.start_date} → ${previous.end_date}`
}

export function buildWeekCompareHint(weekStarting, previousWeekStarting) {
  if (!weekStarting || !previousWeekStarting) return null
  return `Week ${weekStarting} vs prior week ${previousWeekStarting}`
}
