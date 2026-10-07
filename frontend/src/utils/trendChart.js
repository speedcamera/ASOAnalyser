import { formatCurrency, formatNumber, formatPercentDelta, costDeltaTone, volumeDeltaTone } from './format'
import { percentChange } from './dashboardHelpers'

export function parseTrendDate(value) {
  if (!value) return null
  const time = Date.parse(value)
  if (Number.isNaN(time)) return null
  return time
}

/** @deprecated Use parseTrendDate */
export const parseWeekDate = parseTrendDate

function dayDateKey(day) {
  return day?.date || day?.weekStarting || null
}

/** Build ascending dated points; skip invalid dates; keep null metrics as gaps. */
export function buildTrendPoints(days, metricKey) {
  return [...(days ?? [])]
    .map((day) => {
      const date = dayDateKey(day)
      const time = parseTrendDate(date)
      if (time == null) return null
      const raw = day[metricKey]
      const value =
        raw === null || raw === undefined || Number.isNaN(Number(raw))
          ? null
          : Number(raw)
      return {
        date,
        time,
        value,
        spend: day.spend ?? null,
        installs: day.installs ?? null,
        taps: day.taps ?? null,
        impressions: day.impressions ?? null,
        cpa: day.cpa ?? null,
        cpt: day.cpt ?? null,
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time)
}

export function sumTrendValues(points) {
  let total = 0
  let has = false
  for (const point of points ?? []) {
    if (point.value == null) continue
    total += point.value
    has = true
  }
  return has ? total : null
}

export function formatAxisDate(dateKey) {
  if (!dateKey) return ''
  const date = new Date(`${dateKey}T00:00:00`)
  if (Number.isNaN(date.getTime())) return String(dateKey)
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** e.g. "11 July 2026" */
export function formatFullDate(dateKey) {
  if (!dateKey) return ''
  const date = new Date(`${dateKey}T00:00:00`)
  if (Number.isNaN(date.getTime())) return String(dateKey)
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function formatMetricValue(value, formatKind) {
  if (value === null || value === undefined) return 'N/A'
  if (formatKind === 'currency') return formatCurrency(value)
  if (formatKind === 'integer') return formatNumber(value, 0)
  return formatNumber(value)
}

export function formatDailyMetric(value, formatKind) {
  return formatMetricValue(value, formatKind)
}

export function buildTrendSummary({ currentTotal, previousTotal, toneKind }) {
  const changePercent = percentChange(currentTotal, previousTotal)
  const tone =
    changePercent == null
      ? 'neutral'
      : toneKind === 'cost'
        ? costDeltaTone(changePercent)
        : volumeDeltaTone(changePercent)

  return {
    total: currentTotal,
    previousTotal,
    changePercent,
    changeLabel: changePercent == null ? 'N/A' : formatPercentDelta(changePercent),
    tone,
  }
}

/**
 * Align current/previous series for overlay plotting by day index.
 * X labels prefer current period dates (fallback to previous).
 * Each slot still represents one calendar day per series.
 */
export function alignTrendSeries(currentPoints, previousPoints = []) {
  const len = Math.max(currentPoints.length, previousPoints.length, 0)
  const slots = []
  for (let i = 0; i < len; i++) {
    const current = currentPoints[i] ?? null
    const previous = previousPoints[i] ?? null
    slots.push({
      index: i,
      labelDate: current?.date ?? previous?.date ?? null,
      current: current?.value ?? null,
      previous: previous?.value ?? null,
      currentDate: current?.date ?? null,
      previousDate: previous?.date ?? null,
      currentDay: current,
      previousDay: previous,
    })
  }
  return slots
}

/** Y-axis ticks for domain; nice rounded steps. */
export function buildYTicks(maxValue, count = 4) {
  if (!maxValue || maxValue <= 0) return [0]
  const rawStep = maxValue / (count - 1)
  const magnitude = 10 ** Math.floor(Math.log10(rawStep || 1))
  const niceStep = Math.ceil(rawStep / magnitude) * magnitude
  const ticks = []
  for (let i = 0; i < count; i++) {
    ticks.push(i * niceStep)
  }
  if (ticks[ticks.length - 1] < maxValue) {
    ticks.push(ticks[ticks.length - 1] + niceStep)
  }
  return ticks
}
