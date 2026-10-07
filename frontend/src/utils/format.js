export function formatNumber(value, decimals = 2) {
  if (value === null || value === undefined) return '—'
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function formatPercent(value) {
  if (value === null || value === undefined) return '—'
  return `${formatNumber(value, 2)}%`
}

export function formatCurrency(value) {
  if (value === null || value === undefined) return '—'
  return Number(value).toLocaleString('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function formatChange(value, formatter = formatNumber) {
  if (value === null || value === undefined) return '—'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${formatter(value)}`
}

export function changeTone(change) {
  if (change === null || change === undefined || change === '—') return 'neutral'
  const text = String(change).trim()
  if (text.startsWith('+')) return 'up'
  if (text.startsWith('-')) return 'down'
  return 'neutral'
}

export function formatPercentDelta(value) {
  if (value === null || value === undefined) return 'N/A'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${formatNumber(value, 1)}%`
}

/** Installs, taps, CR, TTR: higher = good (green), lower = bad (red) */
export function volumeDeltaTone(percent) {
  if (percent === null || percent === undefined) return 'neutral'
  if (percent > 0) return 'good'
  if (percent < 0) return 'bad'
  return 'neutral'
}

/** Spend, CPA, CPT: lower = good (green), higher = bad (red) */
export function costDeltaTone(percent) {
  if (percent === null || percent === undefined) return 'neutral'
  if (percent < 0) return 'good'
  if (percent > 0) return 'bad'
  return 'neutral'
}

/** @deprecated Use costDeltaTone — same rules */
export function cpaDeltaTone(percent) {
  return costDeltaTone(percent)
}

/** Bid % change: directional only (up = red, down = green), not good/bad */
export function bidChangeTone(percent) {
  if (percent === null || percent === undefined) return 'neutral'
  if (percent > 0) return 'bad'
  if (percent < 0) return 'good'
  return 'neutral'
}

export function compareDeltaTone(percent, kind) {
  if (kind === 'cost') return costDeltaTone(percent)
  if (kind === 'volume') return volumeDeltaTone(percent)
  if (kind === 'bid') return bidChangeTone(percent)
  return 'neutral'
}

export function compareArrow(percent) {
  if (percent === null || percent === undefined || percent === 0) return ''
  return percent > 0 ? '▲' : '▼'
}

export function formatCompareBadge(percent) {
  if (percent === null || percent === undefined) return null
  const arrow = compareArrow(percent)
  return `${arrow} ${formatNumber(Math.abs(percent), 1)}%`.trim()
}
