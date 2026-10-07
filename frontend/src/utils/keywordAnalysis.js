import { percentChange, describeMetricChange } from './dashboardHelpers'
import { buildKeywordEntityKey, resolveAppId } from './entityKeys'

export function formatAppName(name) {
  if (!name) return 'Unknown App'
  return String(name)
}

export function formatCampaignName(name) {
  if (!name || name === '(No campaign name)') return 'Unknown Campaign'
  return String(name)
}

function deriveCpa(spend, installs, explicit) {
  if (explicit != null) return explicit
  if (spend != null && installs != null && installs > 0) return spend / installs
  return null
}

function deriveCpt(spend, taps, explicit) {
  if (explicit != null) return explicit
  if (spend != null && taps != null && taps > 0) return spend / taps
  return null
}

function deriveCr(installs, taps, explicit) {
  if (explicit != null) return explicit
  if (installs != null && taps != null && taps > 0) return (installs / taps) * 100
  return null
}

export function mapPeriodKeywordRow(row) {
  const spend = row.current_spend
  const impressions = row.current_impressions ?? null
  const taps = row.current_taps ?? null
  const installs = row.current_installs
  const cpa = deriveCpa(spend, installs, row.current_cpa)
  const cpt = deriveCpt(spend, taps, row.current_cpt)
  const cr = deriveCr(installs, taps, row.current_cr)

  const previousSpend = row.previous_spend
  const previousImpressions = row.previous_impressions ?? null
  const previousTaps = row.previous_taps ?? null
  const previousInstalls = row.previous_installs
  const previousCpa = deriveCpa(previousSpend, previousInstalls, row.previous_cpa)
  const previousCpt = deriveCpt(previousSpend, previousTaps, row.previous_cpt)
  const previousCr = deriveCr(previousInstalls, previousTaps, row.previous_cr)

  return {
    id: row.group_key ?? `${row.keyword}-${row.campaign_name}-${row.ad_group_name}`,
    keyword: row.keyword ?? 'N/A',
    campaign_name: formatCampaignName(row.campaign_name),
    campaign_name_raw: row.campaign_name ?? '',
    ad_group_name: row.ad_group_name ?? null,
    segment: row.segment || 'Unclassified',
    match_type: row.match_type ?? null,
    status: row.status ?? null,
    comparison_status: row.comparison_status ?? 'comparable',
    spend,
    impressions,
    taps,
    installs,
    cpa,
    cpt,
    cr,
    previous_spend: previousSpend,
    previous_impressions: previousImpressions,
    previous_taps: previousTaps,
    previous_installs: previousInstalls,
    previous_cpa: previousCpa,
    previous_cpt: previousCpt,
    previous_cr: previousCr,
    spend_delta: percentChange(spend, previousSpend),
    impressions_delta: percentChange(impressions, previousImpressions),
    taps_delta: percentChange(taps, previousTaps),
    installs_delta: percentChange(installs, previousInstalls),
    cpa_delta: percentChange(cpa, previousCpa),
    cpt_delta: percentChange(cpt, previousCpt),
    cr_delta: percentChange(cr, previousCr),
    current_bid: row.current_bid,
    previous_bid: row.previous_bid,
    bid_change: row.bid_change,
    bid_change_percent: row.bid_change_percent,
    bid_history_available: row.bid_history_available,
    bid_changed_in_selected_period: row.bid_changed_in_selected_period ?? false,
    last_bid_change_at: row.last_bid_change_at ?? null,
    app_name: formatAppName(row.app_name),
    app_id: row.app_id ?? null,
    app_key: row.app_key ?? null,
    entity_key: buildKeywordEntityKey({
      appId: resolveAppId(row),
      campaignName: row.campaign_name,
      adGroupName: row.ad_group_name,
      keyword: row.keyword,
    }),
    period_compare: true,
  }
}

export function mapImportKeywordRow(row) {
  const spend = row.total_spend
  const impressions = row.total_impressions ?? null
  const taps = row.total_taps ?? null
  const installs = row.total_installs
  const cpa = deriveCpa(spend, installs, row.average_cpa)
  const cpt = deriveCpt(spend, taps, row.average_cpt)
  const cr = deriveCr(installs, taps, row.conversion_rate)

  return {
    id: `${row.keyword}-${row.campaign_name}-${row.ad_group_name}`,
    keyword: row.keyword ?? 'N/A',
    campaign_name: formatCampaignName(row.campaign_name),
    campaign_name_raw: row.campaign_name ?? '',
    ad_group_name: row.ad_group_name ?? null,
    segment: row.segment || 'Unclassified',
    match_type: row.match_type ?? null,
    status: row.status ?? null,
    spend,
    impressions,
    taps,
    installs,
    cpa,
    cpt,
    cr,
    current_bid: row.keyword_max_cpt_bid ?? null,
    previous_spend: null,
    previous_impressions: null,
    previous_taps: null,
    previous_installs: null,
    previous_cpa: null,
    previous_cpt: null,
    previous_cr: null,
    spend_delta: null,
    impressions_delta: null,
    taps_delta: null,
    installs_delta: null,
    cpa_delta: null,
    cpt_delta: null,
    cr_delta: null,
    previous_bid: null,
    bid_change: null,
    bid_change_percent: null,
    app_name: formatAppName(row.app_name),
    app_id: row.app_id ?? null,
    app_key: row.app_key ?? null,
    entity_key: buildKeywordEntityKey({
      appId: resolveAppId(row),
      campaignName: row.campaign_name,
      adGroupName: row.ad_group_name,
      keyword: row.keyword,
    }),
    period_compare: false,
  }
}

/**
 * Deterministic insight lines from existing period values.
 * Factual movement only — no improved/declined judgements.
 */
export function buildKeywordPerformanceInsights(keyword) {
  if (!keyword?.period_compare) return []
  
  // Skip insights for new keywords - they don't have historical comparison yet
  if (keyword.comparison_status === 'new') return []

  const specs = [
    { label: 'Spend', key: 'spend' },
    { label: 'Impressions', key: 'impressions' },
    { label: 'Taps', key: 'taps' },
    { label: 'Installs', key: 'installs' },
    { label: 'CPA', key: 'cpa' },
    { label: 'CPT', key: 'cpt' },
    { label: 'Conversion Rate', key: 'cr' },
  ]

  const insights = []
  for (const spec of specs) {
    const current = keyword[spec.key]
    const previous = keyword[`previous_${spec.key}`]
    const change = describeMetricChange(current, previous)
    if (change.isNewActivity) {
      insights.push({
        text: `${spec.label} shows new activity versus the previous period.`,
        metric: spec.label,
        delta: null,
      })
      continue
    }
    const delta = change.percent
    if (delta == null || !Number.isFinite(delta) || Math.abs(delta) < 0.05) continue

    const abs = Math.abs(delta)
    const pct = abs.toFixed(abs >= 10 ? 0 : 1).replace(/\.0$/, '')
    const verb = delta > 0 ? 'increased' : 'decreased'
    insights.push({
      text: `${spec.label} ${verb} by ${pct}%.`,
      metric: spec.label,
      delta,
    })
  }
  return insights
}

export function collectAppOptions(rows) {
  const names = new Set()
  for (const row of rows ?? []) {
    names.add(row.app_name ?? 'Unknown App')
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

export function collectCampaignOptions(rows, appName = 'all') {
  const names = new Set()
  for (const row of rows ?? []) {
    if (appName !== 'all' && (row.app_name ?? 'Unknown App') !== appName) {
      continue
    }
    names.add(row.campaign_name ?? 'Unknown Campaign')
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

export function filterAnalysisRows(rows, { app, search, segment, campaign, minSpend, minInstalls }) {
  const q = search.trim().toLowerCase()

  return rows.filter((row) => {
    if (app && app !== 'all') {
      if ((row.app_name ?? 'Unknown App') !== app) return false
    }
    if (campaign && campaign !== 'all') {
      if ((row.campaign_name ?? 'Unknown Campaign') !== campaign) return false
    }
    if (segment !== 'all') {
      const rowSeg = row.segment || 'Unclassified'
      if (rowSeg !== segment) return false
    }
    if (q && !String(row.keyword).toLowerCase().includes(q)) {
      return false
    }
    if (minSpend !== '' && minSpend != null) {
      const min = Number(minSpend)
      if (!Number.isNaN(min) && (row.spend ?? 0) < min) return false
    }
    if (minInstalls !== '' && minInstalls != null) {
      const min = Number(minInstalls)
      if (!Number.isNaN(min) && (row.installs ?? 0) < min) return false
    }
    return true
  })
}

export function exportAnalysisCsv(rows) {
  const headers = [
    'Keyword',
    'Campaign Name',
    'Ad Group Name',
    'Segment',
    'Spend',
    'Installs',
    'CPA',
    'Current Bid',
    'Prev Bid',
    'Bid Change',
    'Bid %',
  ]

  const lines = rows.map((r) =>
    [
      r.keyword,
      r.campaign_name,
      r.ad_group_name ?? '',
      r.segment,
      r.spend ?? '',
      r.installs ?? '',
      r.cpa ?? '',
      r.current_bid ?? '',
      r.previous_bid ?? '',
      r.bid_change ?? '',
      r.bid_change_percent ?? '',
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  )

  const csv = [headers.join(','), ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'keyword-bid-analysis.csv'
  a.click()
  URL.revokeObjectURL(url)
}
