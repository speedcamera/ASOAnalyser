import { useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { buildPeriodCompareHint } from '../utils/periodLabels'
import PeriodCompareHover from './PeriodCompareHover'
import KpiSparkline from './KpiSparkline'
import {
  compareArrow,
  compareDeltaTone,
  formatCompareBadge,
  formatCurrency,
  formatNumber,
  formatPercent,
} from '../utils/format'

const ICONS = {
  spend: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2Zm1 14.9V18h-2v-1.1A3.5 3.5 0 0 1 8 13.5h1.7c0 .94.76 1.7 1.7 1.7h.9c.72 0 1.3-.58 1.3-1.3 0-.55-.35-1.03-.87-1.2l-2.16-.72A3 3 0 0 1 9 9.3c0-1.4 1.03-2.56 2.4-2.78V5h2v1.52A3.2 3.2 0 0 1 16 9.7h-1.7c0-.94-.76-1.7-1.7-1.7h-.7c-.72 0-1.3.58-1.3 1.3 0 .55.35 1.03.87 1.2l2.16.72A3 3 0 0 1 15 14.7c0 1.4-1.03 2.56-2.4 2.78Z"
      />
    </svg>
  ),
  installs: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2 4 6v6c0 5.25 3.4 10.15 8 11.35C16.6 22.15 20 17.25 20 12V6l-8-4Zm0 2.18L18 7.1v4.9c0 4.18-2.61 8.1-6 9.2-3.39-1.1-6-5.02-6-9.2V7.1l6-2.92Zm-1 4.32v5.09l-1.8-1.8-.9.9L12 16l3.7-3.7-.9-.9-1.8 1.8V8.5h-2Z"
      />
    </svg>
  ),
  cpa: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3 17.25 9.25 11 13 14.75 20.25 7.5 21.75 9 13 17.75 9.25 14 4.5 18.75 3 17.25Z"
      />
    </svg>
  ),
  cpt: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M11 7h2v2h-2V7Zm0 4h2v6h-2v-6Zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8Z"
      />
    </svg>
  ),
  impressions: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7Zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9Zm0-7A2.5 2.5 0 1 0 12 14a2.5 2.5 0 0 0 0-5Z"
      />
    </svg>
  ),
  taps: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9 11.24V7.5a2.5 2.5 0 0 1 5 0v.09c1.4-.24 2.5-1.43 2.5-2.84C16.5 2.97 14.53 1 12.25 1S8 2.97 8 5.25c0 1.06.44 2.02 1.14 2.71-.07.17-.14.34-.14.53v2.75L5.5 13V21h12.25l2.55-8.62A2 2 0 0 0 18.4 10H13v1.24H9Z"
      />
    </svg>
  ),
  percent: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0-5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0-5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM5.5 19.5 18.5 5l1.4 1.4-13 14.5-1.4-1.4Z"
      />
    </svg>
  ),
}

export default function KpiCard({
  label,
  value,
  previousValue = null,
  changePercent = null,
  metricKind = 'volume',
  showCompare = true,
  formatKind = 'currency',
  icon = 'percent',
  sparklineDays = null,
  sparklineMetricKey = null,
  sparklineLoading = false,
  compact = false,
  /** When true, arrows/badges are neutral (no good/bad interpretation). */
  neutralMovement = false,
  /** Optional override badge text (e.g. "New activity"). */
  changeLabel = null,
}) {
  const { periodComparison, periodCompareEnabled } = useApp()

  const hint = useMemo(() => {
    if (!showCompare || !periodCompareEnabled) return null
    return buildPeriodCompareHint(periodComparison?.periods)
  }, [showCompare, periodCompareEnabled, periodComparison])

  const toneKind = metricKind === 'cost' ? 'cost' : 'volume'
  const tone =
    !showCompare || changePercent === null || changeLabel
      ? 'neutral'
      : neutralMovement
        ? 'neutral'
        : compareDeltaTone(changePercent, toneKind)

  const previousText =
    previousValue === null || previousValue === undefined
      ? null
      : formatKpiValue(previousValue, formatKind)

  const badge = !showCompare
    ? null
    : changeLabel
      ? changeLabel
      : formatCompareBadge(changePercent)
  const arrow =
    showCompare && !changeLabel ? compareArrow(changePercent) : ''
  const showSparkline = Array.isArray(sparklineDays) && sparklineMetricKey

  return (
    <PeriodCompareHover enabled={Boolean(hint)} hint={hint} className="period-compare-hover--block">
      <div className={`kpi kpi--dashboard${compact ? ' kpi--compact' : ''}`}>
        <div className="kpi__top">
          <div className="kpi__label">{label}</div>
          <span className="kpi__icon" aria-hidden="true">
            {ICONS[icon] ?? ICONS.percent}
          </span>
        </div>
        <div className="kpi__value">{value}</div>
        <div className="kpi__footer">
          {showCompare && (previousText || badge) ? (
            <div className="kpi__compare">
              {arrow ? <span className={`kpi__trend kpi__trend--${tone}`}>{arrow}</span> : null}
              {badge ? <span className={`kpi__badge kpi__badge--${tone}`}>{badge}</span> : null}
              {previousText && !changeLabel ? (
                <span className="kpi__vs">vs {previousText}</span>
              ) : null}
            </div>
          ) : (
            <div className="kpi__compare kpi__compare--empty" />
          )}
          {showSparkline ? (
            <KpiSparkline
              days={sparklineDays}
              metricKey={sparklineMetricKey}
              formatKind={formatKind}
              label={label}
              tone={tone}
              loading={sparklineLoading}
            />
          ) : null}
        </div>
      </div>
    </PeriodCompareHover>
  )
}

export function formatKpiValue(value, kind) {
  if (value === null || value === undefined) return 'N/A'
  if (kind === 'currency') return formatCurrency(value)
  if (kind === 'percent') return formatPercent(value)
  if (kind === 'integer') return formatNumber(value, 0)
  return formatNumber(value)
}
