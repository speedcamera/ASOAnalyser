/** Matches the backend beta window. The API remains authoritative. */
export const MAX_ANALYTICS_DAYS = 90
export const MAX_NOTE_TEXT = 2000
export const MAX_GOAL_THRESHOLD = 1_000_000_000_000

export function inclusiveCalendarDays(startDate, endDate) {
  const start = Date.parse(`${startDate}T00:00:00.000Z`)
  const end = Date.parse(`${endDate}T00:00:00.000Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return Math.round((end - start) / 86400000) + 1
}

export function customRangeError(startDate, endDate) {
  if (!startDate || !endDate) return 'Choose a start and end date'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return 'Choose a valid date range'
  }
  if (startDate > endDate) return 'Start date must be on or before the end date'
  const days = inclusiveCalendarDays(startDate, endDate)
  if (days == null || days > MAX_ANALYTICS_DAYS) {
    return `Date range must be ${MAX_ANALYTICS_DAYS} days or fewer`
  }
  return ''
}
