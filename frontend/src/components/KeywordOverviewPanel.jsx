import { useMemo } from 'react'
import { useApp } from '../context/AppContext'
import KpiCard, { formatKpiValue } from './KpiCard'
import { na } from '../utils/display'
import { describeMetricChange } from '../utils/dashboardHelpers'
import { buildKeywordPerformanceInsights } from '../utils/keywordAnalysis'
import {
  compareArrow,
  formatCurrency,
  formatNumber,
  formatPercent,
} from '../utils/format'

const KPI_METRICS = [
  { key: 'spend', label: 'Spend', kind: 'cost', format: 'currency', icon: 'spend' },
  { key: 'impressions', label: 'Impressions', kind: 'volume', format: 'integer', icon: 'impressions' },
  { key: 'taps', label: 'Taps', kind: 'volume', format: 'integer', icon: 'taps' },
  { key: 'installs', label: 'Installs', kind: 'volume', format: 'integer', icon: 'installs' },
  { key: 'cpt', label: 'CPT', kind: 'cost', format: 'currency', icon: 'cpt' },
  { key: 'cpa', label: 'CPA', kind: 'cost', format: 'currency', icon: 'cpa' },
  { key: 'cr', label: 'Conversion Rate', kind: 'volume', format: 'percent', icon: 'percent' },
]

const COMPARE_METRICS = [
  { key: 'spend', label: 'Spend', formatValue: formatCurrency },
  { key: 'impressions', label: 'Impressions', formatValue: (v) => formatNumber(v, 0) },
  { key: 'taps', label: 'Taps', formatValue: (v) => formatNumber(v, 0) },
  { key: 'installs', label: 'Installs', formatValue: (v) => formatNumber(v, 0) },
  { key: 'cpa', label: 'CPA', formatValue: formatCurrency },
  { key: 'cpt', label: 'CPT', formatValue: formatCurrency },
  { key: 'cr', label: 'Conversion Rate', formatValue: formatPercent },
]

const DIRECTION_LABELS = {
  increase: 'Increase',
  decrease: 'Decrease',
  unchanged: 'Unchanged',
  unavailable: 'Unavailable',
}

function periodDayCount(filterPreset, customStartDate, customEndDate, periods) {
  if (filterPreset === '7D') return 7
  if (filterPreset === '14D') return 14
  if (filterPreset === '30D') return 30
  if (filterPreset === 'CUSTOM' && periods?.current_period) {
    const start = new Date(`${periods.current_period.start_date}T00:00:00Z`)
    const end = new Date(`${periods.current_period.end_date}T00:00:00Z`)
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      return Math.round((end - start) / 86400000) + 1
    }
  }
  if (filterPreset === 'CUSTOM' && customStartDate && customEndDate) {
    const start = new Date(`${customStartDate}T00:00:00Z`)
    const end = new Date(`${customEndDate}T00:00:00Z`)
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      return Math.round((end - start) / 86400000) + 1
    }
  }
  return null
}

function formatDisplayDate(dateKey) {
  if (!dateKey) return '—'
  const date = new Date(`${String(dateKey).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return dateKey
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function movementLabel(change) {
  if (change.isNewActivity) return 'New activity'
  return DIRECTION_LABELS[change.direction] || 'Unavailable'
}

function formatMovementPercent(change) {
  if (change.isNewActivity) return null
  if (change.percent == null || !Number.isFinite(change.percent)) return '—'
  if (Math.abs(change.percent) < 0.05) return '0%'
  return `${formatNumber(Math.abs(change.percent), Math.abs(change.percent) >= 10 ? 0 : 1)}%`
}

export default function KeywordOverviewPanel({ keyword }) {
  const {
    filterPreset,
    customStartDate,
    customEndDate,
    periodComparison,
    periodCompareEnabled,
  } = useApp()

  const showCompare = Boolean(
    keyword?.period_compare && periodCompareEnabled && filterPreset !== 'ALL',
  )

  const periodLabel = useMemo(() => {
    if (filterPreset === 'CUSTOM' && customStartDate && customEndDate) {
      return `${customStartDate} → ${customEndDate}`
    }
    const map = {
      '7D': 'Last 7 Days',
      '14D': 'Last 14 Days',
      '30D': 'Last 30 Days',
      ALL: 'All Time',
    }
    return map[filterPreset] || 'Selected Period'
  }, [filterPreset, customStartDate, customEndDate])

  const dayCount = useMemo(
    () =>
      periodDayCount(
        filterPreset,
        customStartDate,
        customEndDate,
        periodComparison?.periods,
      ),
    [filterPreset, customStartDate, customEndDate, periodComparison],
  )

  const currentWindowLabel = dayCount != null ? `Current ${dayCount} Days` : 'Current Period'
  const previousWindowLabel = dayCount != null ? `Previous ${dayCount} Days` : 'Previous Period'

  const dateRangeLabel = useMemo(() => {
    const periods = periodComparison?.periods
    if (showCompare && periods?.current_period) {
      return `${formatDisplayDate(periods.current_period.start_date)} → ${formatDisplayDate(periods.current_period.end_date)}`
    }
    if (filterPreset === 'CUSTOM' && customStartDate && customEndDate) {
      return `${formatDisplayDate(customStartDate)} → ${formatDisplayDate(customEndDate)}`
    }
    if (filterPreset === 'ALL') return 'All Time'
    return periodLabel
  }, [
    showCompare,
    periodComparison,
    filterPreset,
    customStartDate,
    customEndDate,
    periodLabel,
  ])

  const insights = useMemo(
    () => (showCompare ? buildKeywordPerformanceInsights(keyword) : []),
    [keyword, showCompare],
  )

  if (!keyword) return null

  const isNew = keyword.comparison_status === 'new'

  return (
    <div className="keyword-overview">
      {isNew && showCompare ? (
        <section className="keyword-overview__section keyword-overview__new-notice">
          <div className="keyword-overview__new-notice-content">
            <div className="keyword-overview__new-badge">New</div>
            <div className="keyword-overview__new-text">
              <p>
                This keyword is new. There is not enough historical data yet to compare
                its performance with an earlier period. Comparisons will appear
                automatically as more data is collected.
              </p>
            </div>
          </div>
        </section>
      ) : null}
      
      <section className="keyword-overview__section">
        <div className="keyword-overview__section-head">
          <h3 className="keyword-overview__section-title">Current Performance</h3>
          <p className="keyword-overview__section-meta">{periodLabel}</p>
        </div>
        <div className="kpi-row kpi-row--keyword-overview">
          {KPI_METRICS.map((metric) => {
            const current = keyword[metric.key]
            const previous = keyword[`previous_${metric.key}`]
            const change = describeMetricChange(current, previous)
            return (
              <KpiCard
                key={metric.key}
                label={metric.label}
                value={formatKpiValue(current, metric.format)}
                previousValue={previous}
                changePercent={showCompare ? change.percent : null}
                metricKind={metric.kind}
                formatKind={metric.format}
                showCompare={showCompare}
                icon={metric.icon}
                compact
                neutralMovement
                changeLabel={
                  showCompare && change.isNewActivity ? 'New activity' : null
                }
              />
            )
          })}
        </div>
      </section>

      {showCompare ? (
        <section className="keyword-overview__section">
          <div className="keyword-overview__section-head">
            <h3 className="keyword-overview__section-title">Period Comparison</h3>
            <p className="keyword-overview__section-meta">
              {currentWindowLabel} <span className="keyword-overview__vs">vs</span>{' '}
              {previousWindowLabel}
            </p>
          </div>
          <div className="analysis-table-wrap">
            <table className="analysis-table keyword-overview-compare">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th className="num">{previousWindowLabel}</th>
                  <th className="num">{currentWindowLabel}</th>
                  <th className="num">Change</th>
                  <th>Movement</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE_METRICS.map((metric) => {
                  const current = keyword[metric.key]
                  const previous = keyword[`previous_${metric.key}`]
                  const change = describeMetricChange(current, previous)
                  const arrow = change.isNewActivity
                    ? ''
                    : compareArrow(
                        change.percent != null && Math.abs(change.percent) >= 0.05
                          ? change.percent
                          : null,
                      )
                  const pctText = formatMovementPercent(change)
                  return (
                    <tr key={metric.key}>
                      <td>{metric.label}</td>
                      <td className="num">
                        {isNew ? (
                          <span className="keyword-overview-new-indicator">—</span>
                        ) : (
                          na(previous, metric.formatValue)
                        )}
                      </td>
                      <td className="num">{na(current, metric.formatValue)}</td>
                      <td className="num">
                        <span className="keyword-overview-compare__delta keyword-overview-compare__delta--neutral">
                          {isNew ? (
                            '—'
                          ) : change.isNewActivity ? (
                            'New activity'
                          ) : (
                            <>
                              {arrow ? <span aria-hidden="true">{arrow} </span> : null}
                              {pctText}
                            </>
                          )}
                        </span>
                      </td>
                      <td>
                        <span className="keyword-overview-compare__status keyword-overview-compare__status--neutral">
                          {isNew ? 'New' : movementLabel(change)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="keyword-overview__section">
        <h3 className="keyword-overview__section-title">Keyword Summary</h3>
        <dl className="keyword-overview-summary">
          <div>
            <dt>Campaign</dt>
            <dd>{keyword.campaign_name || '—'}</dd>
          </div>
          <div>
            <dt>Ad Group</dt>
            <dd>{keyword.ad_group_name || '—'}</dd>
          </div>
          <div>
            <dt>Keyword</dt>
            <dd>{keyword.keyword || '—'}</dd>
          </div>
          <div>
            <dt>Match Type</dt>
            <dd>{keyword.match_type || '—'}</dd>
          </div>
          <div>
            <dt>Current Max CPT</dt>
            <dd>{na(keyword.current_bid, formatCurrency)}</dd>
          </div>
          <div>
            <dt>Current Status</dt>
            <dd>{keyword.status || '—'}</dd>
          </div>
          <div className="keyword-overview-summary__wide">
            <dt>Date Range Analysed</dt>
            <dd>{dateRangeLabel}</dd>
          </div>
        </dl>
      </section>

      {insights.length > 0 ? (
        <section className="keyword-overview__section">
          <h3 className="keyword-overview__section-title">Performance Insights</h3>
          <ul className="keyword-overview-insights">
            {insights.map((insight) => (
              <li key={insight.metric} className="keyword-overview-insights__item">
                {insight.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
