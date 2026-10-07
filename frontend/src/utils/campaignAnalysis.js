import { percentChange } from './dashboardHelpers'
import { buildCampaignEntityKey, resolveAppId } from './entityKeys'

export function mapCampaignPerformanceRow(row, showCompare) {
  // Segment now comes from the database instead of being derived
  const segment = row.segment || 'Other'
  const spend = row.current_spend
  const installs = row.current_installs
  const cpa = row.current_cpa
  const taps = row.current_taps
  const cr = row.current_cr
  const previousSpend = row.previous_spend
  const previousInstalls = row.previous_installs
  const previousCpa = row.previous_cpa
  const previousTaps = row.previous_taps
  const previousCr = row.previous_cr

  return {
    id: row.group_key ?? row.campaign_name,
    campaign_id: row.campaign_id ?? null,
    campaign_name: row.campaign_name ?? 'N/A',
    segment,
    segmentKey: segment.toLowerCase(),
    app_name: row.app_name,
    app_id: row.app_id ?? null,
    app_key: row.app_key ?? null,
    entity_key: buildCampaignEntityKey({
      appId: resolveAppId(row),
      campaignName: row.campaign_name,
    }),
    spend,
    installs,
    cpa,
    taps,
    cr,
    daily_budget: row.current_daily_budget ?? row.daily_budget ?? null,
    current_daily_budget: row.current_daily_budget ?? row.daily_budget ?? null,
    previous_daily_budget: row.previous_daily_budget ?? null,
    budget_change: row.budget_change ?? null,
    budget_change_percent: row.budget_change_percent ?? null,
    budget_first_observed_date: row.budget_first_observed_date ?? null,
    budget_observation_count: row.budget_observation_count ?? null,
    budget_comparison_status: row.budget_comparison_status ?? (
      row.current_daily_budget == null && row.daily_budget == null ? 'unavailable' : 'new'
    ),
    budget_changed_in_selected_period: Boolean(row.budget_changed_in_selected_period),
    last_budget_change_at: row.last_budget_change_at ?? null,
    previous_spend: previousSpend,
    previous_installs: previousInstalls,
    previous_cpa: previousCpa,
    previous_taps: previousTaps,
    previous_cr: previousCr,
    spend_delta: showCompare ? percentChange(spend, previousSpend) : null,
    installs_delta: showCompare ? percentChange(installs, previousInstalls) : null,
    cpa_delta: showCompare ? percentChange(cpa, previousCpa) : null,
    taps_delta: showCompare ? percentChange(taps, previousTaps) : null,
    cr_delta: showCompare ? percentChange(cr, previousCr) : null,
  }
}

export function exportCampaignPerformanceCsv(rows, showCompare) {
  const headers = [
    'Campaign Name',
    'Segment',
    'Spend',
    ...(showCompare ? ['Previous Spend'] : []),
    'Installs',
    ...(showCompare ? ['Previous Installs'] : []),
    'CPA',
    ...(showCompare ? ['Previous CPA'] : []),
    'Taps',
    ...(showCompare ? ['Previous Taps'] : []),
    'CR',
    ...(showCompare ? ['Previous CR'] : []),
    'Daily Budget',
    'Previous Daily Budget',
    'Budget Change',
    'Budget First Observed',
  ]

  const lines = rows.map((r) => {
    const base = [
      r.campaign_name,
      r.segment,
      r.spend ?? '',
      ...(showCompare ? [r.previous_spend ?? ''] : []),
      r.installs ?? '',
      ...(showCompare ? [r.previous_installs ?? ''] : []),
      r.cpa ?? '',
      ...(showCompare ? [r.previous_cpa ?? ''] : []),
      r.taps ?? '',
      ...(showCompare ? [r.previous_taps ?? ''] : []),
      r.cr ?? '',
      ...(showCompare ? [r.previous_cr ?? ''] : []),
      r.daily_budget ?? '',
      r.previous_daily_budget ?? '',
      r.budget_change ?? '',
      r.budget_first_observed_date ?? '',
    ]
    return base.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')
  })

  const csv = [headers.join(','), ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'campaign-performance.csv'
  a.click()
  URL.revokeObjectURL(url)
}
