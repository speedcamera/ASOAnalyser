import { useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { buildPeriodCompareHint } from '../utils/periodLabels'
import PeriodCompareHover from './PeriodCompareHover'
import {
  compareDeltaTone,
  formatCompareBadge,
  formatNumber,
} from '../utils/format'

export default function MetricCompareCell({
  current,
  previous,
  percent,
  kind = 'volume',
  showCompare = false,
  compareHint = null,
  formatValue = (v) => String(v),
  currentUnavailableLabel = null,
  previousUnavailableLabel = null,
}) {
  const { periodComparison, periodCompareEnabled } = useApp()

  const hint = useMemo(() => {
    if (compareHint) return compareHint
    if (!showCompare || !periodCompareEnabled) return null
    return buildPeriodCompareHint(periodComparison?.periods)
  }, [compareHint, showCompare, periodCompareEnabled, periodComparison])

  const currentMissing = current === null || current === undefined
  const currentText = currentMissing
    ? currentUnavailableLabel || 'N/A'
    : formatValue(current)

  const content = !showCompare ? (
    <div className="metric-cell">
      <div className="metric-cell__current">
        {currentMissing && currentUnavailableLabel ? (
          <span className="metric-cell__unavailable">{currentText}</span>
        ) : (
          currentText
        )}
      </div>
    </div>
  ) : (
    (() => {
      const previousMissing = previous === null || previous === undefined
      const previousText = previousMissing
        ? previousUnavailableLabel || 'N/A'
        : formatValue(previous)
      const previousIsPhrase = previousMissing && Boolean(previousUnavailableLabel)

      const tone = compareDeltaTone(percent, kind)
      const badgeText = formatCompareBadge(percent)

      return (
        <div className="metric-cell">
          <div className="metric-cell__current">
            {currentMissing && currentUnavailableLabel ? (
              <span className="metric-cell__unavailable">{currentText}</span>
            ) : (
              currentText
            )}
          </div>
          <div className="metric-cell__compare">
            <span className={`metric-cell__vs${previousIsPhrase ? ' metric-cell__vs--wrap' : ''}`}>
              vs {previousText}
            </span>
            {badgeText ? (
              <span className={`metric-cell__badge metric-cell__badge--${tone}`}>
                {badgeText}
              </span>
            ) : null}
          </div>
        </div>
      )
    })()
  )

  return (
    <td className="num">
      <PeriodCompareHover
        enabled={Boolean(hint)}
        hint={hint}
        className="period-compare-hover--block"
      >
        {content}
      </PeriodCompareHover>
    </td>
  )
}

export function formatIntegerMetric(v) {
  return formatNumber(v, 0)
}
