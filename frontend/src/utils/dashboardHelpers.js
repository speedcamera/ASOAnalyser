/**
 * Percentage change — mirrors backend analyticsMetrics.percentChange.
 * Frontend formats only; do not invent alternate business rules here.
 */
export function percentChange(current, previous) {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return null
  }
  const cur = Number(current)
  const prev = Number(previous)
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null
  if (prev === 0) {
    return cur === 0 ? 0 : null
  }
  return ((cur - prev) / prev) * 100
}

/** Numerical movement only (no good/bad interpretation). */
export function changeDirection(current, previous) {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return 'unavailable'
  }
  const cur = Number(current)
  const prev = Number(previous)
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return 'unavailable'
  if (prev === 0 && cur !== 0) return 'unavailable'
  if (cur === prev) return 'unchanged'
  if (cur > prev) return 'increase'
  if (cur < prev) return 'decrease'
  return 'unavailable'
}

export function describeMetricChange(current, previous) {
  const cur =
    current === null || current === undefined || !Number.isFinite(Number(current))
      ? null
      : Number(current)
  const prev =
    previous === null || previous === undefined || !Number.isFinite(Number(previous))
      ? null
      : Number(previous)
  return {
    absolute: cur != null && prev != null ? cur - prev : null,
    percent: percentChange(cur, prev),
    direction: changeDirection(cur, prev),
    isNewActivity: prev === 0 && cur != null && cur > 0,
  }
}

export function computeBrandSplit(campaigns) {
  const brand = { spend: 0, installs: 0, hasSpend: false, hasInstalls: false }
  const nonBrand = { spend: 0, installs: 0, hasSpend: false, hasInstalls: false }

  for (const row of campaigns ?? []) {
    const bucket = row.segment === 'Brand' ? brand : nonBrand
    if (row.current_spend != null) {
      bucket.spend += row.current_spend
      bucket.hasSpend = true
    }
    if (row.current_installs != null) {
      bucket.installs += row.current_installs
      bucket.hasInstalls = true
    }
  }

  const finalize = (bucket) => ({
    spend: bucket.hasSpend ? bucket.spend : null,
    installs: bucket.hasInstalls ? bucket.installs : null,
    cpa:
      bucket.hasSpend && bucket.hasInstalls && bucket.installs > 0
        ? bucket.spend / bucket.installs
        : null,
  })

  return { brand: finalize(brand), nonBrand: finalize(nonBrand) }
}

/**
 * Map API insights to InsightsBar format
 * 
 * This function converts the new AI Insights Engine format to the format
 * expected by the InsightsBar component.
 */
export function mapInsightsToCards(apiInsights) {
  if (!apiInsights || !apiInsights.length) {
    return [{
      type: 'Info',
      text: 'Performance is stable versus the previous period. Adjust filters to explore campaigns and keywords.',
      tone: 'neutral',
    }]
  }

  return apiInsights.map(insight => {
    // Map severity to tone
    const toneMap = {
      positive: 'good',
      info: 'neutral',
      warning: 'bad',
      critical: 'bad',
    }

    // Map insight type to card type
    const typeMap = {
      cpa_increase: 'Alert',
      cpa_decrease: 'Trend',
      spend_increase: 'Trend',
      spend_decrease: 'Trend',
      install_growth: 'Growth',
      install_decline: 'Alert',
      ttr_improvement: 'Growth',
      ttr_decline: 'Alert',
      cr_improvement: 'Growth',
      cr_decline: 'Alert',
    }

    return {
      type: typeMap[insight.type] || 'Info',
      text: insight.summary,
      tone: toneMap[insight.severity] || 'neutral',
    }
  })
}

export function campaignSpendChangePercent(row) {
  return percentChange(row.current_spend, row.previous_spend)
}
