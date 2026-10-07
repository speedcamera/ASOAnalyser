import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  alignTrendSeries,
  buildTrendPoints,
  buildTrendSummary,
  buildYTicks,
  formatAxisDate,
  formatFullDate,
  formatMetricValue,
  sumTrendValues,
} from '../utils/trendChart'
import { formatCompareBadge } from '../utils/format'

const PAD = { top: 16, right: 16, bottom: 36, left: 52 }

function valueToY(value, minY, maxY, plotTop, plotHeight) {
  if (value == null) return null
  const range = maxY - minY || 1
  return plotTop + plotHeight - ((value - minY) / range) * plotHeight
}

function indexToX(index, count, plotLeft, plotWidth) {
  if (count <= 1) return plotLeft + plotWidth / 2
  return plotLeft + (index / (count - 1)) * plotWidth
}

/** Build path segments that break on nulls (no fake zero connections). */
function buildPathSegments(slots, key, minY, maxY, plotLeft, plotTop, plotWidth, plotHeight) {
  const segments = []
  let current = []

  slots.forEach((slot, index) => {
    const value = slot[key]
    if (value == null) {
      if (current.length) {
        segments.push(current)
        current = []
      }
      return
    }
    const x = indexToX(index, slots.length, plotLeft, plotWidth)
    const y = valueToY(value, minY, maxY, plotTop, plotHeight)
    current.push({ x, y, index, value, date: key === 'current' ? slot.currentDate : slot.previousDate })
  })

  if (current.length) segments.push(current)
  return segments
}

function pathFromSegment(segment) {
  return segment
    .map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')
}

function DayTooltipBlock({ label, day }) {
  if (!day) {
    return (
      <div className="trend-chart__tooltip-block">
        {label ? <div className="trend-chart__tooltip-period">{label}</div> : null}
        <div className="trend-chart__tooltip-row">
          <span>No data</span>
          <strong>N/A</strong>
        </div>
      </div>
    )
  }

  return (
    <div className="trend-chart__tooltip-block">
      {label ? <div className="trend-chart__tooltip-period">{label}</div> : null}
      <div className="trend-chart__tooltip-date">{formatFullDate(day.date)}</div>
      <div className="trend-chart__tooltip-row">
        <span>Spend</span>
        <strong>{formatMetricValue(day.spend, 'currency')}</strong>
      </div>
      <div className="trend-chart__tooltip-row">
        <span>Installs</span>
        <strong>{formatMetricValue(day.installs, 'integer')}</strong>
      </div>
      <div className="trend-chart__tooltip-row">
        <span>CPA</span>
        <strong>{formatMetricValue(day.cpa, 'currency')}</strong>
      </div>
      <div className="trend-chart__tooltip-row">
        <span>CPT</span>
        <strong>{formatMetricValue(day.cpt, 'currency')}</strong>
      </div>
    </div>
  )
}

export default function TrendChart({
  title,
  days = [],
  previousDays = [],
  /** @deprecated prefer days */
  weeks,
  /** @deprecated prefer previousDays */
  previousWeeks,
  metricKey = 'spend',
  formatKind = 'currency',
  toneKind = 'cost',
  showCompare = false,
  loading = false,
  yAxisLabel = '',
  summaryTotal = null,
  summaryPreviousTotal = null,
}) {
  const uid = useId()
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(420)
  const [hoverIndex, setHoverIndex] = useState(null)

  const currentDays = days.length ? days : (weeks ?? [])
  const compareDays = previousDays.length ? previousDays : (previousWeeks ?? [])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined

    function measure() {
      setWidth(Math.max(280, Math.floor(el.clientWidth)))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const currentPoints = useMemo(
    () => buildTrendPoints(currentDays, metricKey),
    [currentDays, metricKey],
  )
  const previousPoints = useMemo(
    () => (showCompare ? buildTrendPoints(compareDays, metricKey) : []),
    [compareDays, metricKey, showCompare],
  )

  const slots = useMemo(
    () => alignTrendSeries(currentPoints, previousPoints),
    [currentPoints, previousPoints],
  )

  const chartTotal = summaryTotal ?? sumTrendValues(currentPoints)
  const chartPreviousTotal = showCompare
    ? (summaryPreviousTotal ?? sumTrendValues(previousPoints))
    : null
  const summary = buildTrendSummary({
    currentTotal: chartTotal,
    previousTotal: chartPreviousTotal,
    toneKind,
  })

  const height = 240
  const plotLeft = PAD.left
  const plotTop = PAD.top
  const plotWidth = width - PAD.left - PAD.right
  const plotHeight = height - PAD.top - PAD.bottom

  const allValues = slots.flatMap((s) => [s.current, s.previous].filter((v) => v != null))
  const dataMax = allValues.length ? Math.max(...allValues, 0) : 0
  const yTicks = buildYTicks(dataMax * 1.08 || 1)
  const minY = 0
  const maxY = yTicks[yTicks.length - 1] || 1

  const currentSegments = buildPathSegments(
    slots,
    'current',
    minY,
    maxY,
    plotLeft,
    plotTop,
    plotWidth,
    plotHeight,
  )
  const previousSegments = showCompare
    ? buildPathSegments(slots, 'previous', minY, maxY, plotLeft, plotTop, plotWidth, plotHeight)
    : []

  const labelStep = Math.max(1, Math.ceil(slots.length / 6))

  function onMove(event) {
    if (!slots.length) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    let nearest = 0
    let best = Infinity
    for (let i = 0; i < slots.length; i++) {
      const px = indexToX(i, slots.length, plotLeft, plotWidth)
      const dist = Math.abs(px - x)
      if (dist < best) {
        best = dist
        nearest = i
      }
    }
    setHoverIndex(nearest)
  }

  if (loading) {
    return (
      <div className="trend-chart">
        <div className="trend-chart__header">
          <h3 className="trend-chart__title">{title}</h3>
        </div>
        <p className="trend-chart__state">Loading trend…</p>
      </div>
    )
  }

  if (currentPoints.length < 1 && previousPoints.length < 1) {
    return (
      <div className="trend-chart">
        <div className="trend-chart__header">
          <h3 className="trend-chart__title">{title}</h3>
        </div>
        <p className="trend-chart__state">No dated trend data for this period</p>
      </div>
    )
  }

  const hover = hoverIndex != null ? slots[hoverIndex] : null
  const hoverX =
    hoverIndex != null ? indexToX(hoverIndex, slots.length, plotLeft, plotWidth) : null

  return (
    <div className="trend-chart" ref={wrapRef}>
      <div className="trend-chart__header">
        <div>
          <h3 className="trend-chart__title">{title}</h3>
          <div className="trend-chart__summary">
            <span className="trend-chart__summary-total">
              {formatMetricValue(summary.total, formatKind)}
            </span>
            <span className={`trend-chart__summary-change trend-chart__summary-change--${summary.tone}`}>
              {showCompare
                ? `${formatCompareBadge(summary.changePercent) ?? 'N/A'} vs prev`
                : 'Period total'}
            </span>
          </div>
        </div>
        <div className="trend-chart__legend">
          <span className="trend-chart__legend-item">
            <i className="trend-chart__swatch trend-chart__swatch--current" />
            Current
          </span>
          {showCompare ? (
            <span className="trend-chart__legend-item">
              <i className="trend-chart__swatch trend-chart__swatch--previous" />
              Previous
            </span>
          ) : null}
        </div>
      </div>

      <div className="trend-chart__plot-wrap">
        <svg
          className="trend-chart__svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={title}
          onMouseMove={onMove}
          onMouseLeave={() => setHoverIndex(null)}
        >
          {yTicks.map((tick) => {
            const y = valueToY(tick, minY, maxY, plotTop, plotHeight)
            return (
              <g key={`${uid}-y-${tick}`}>
                <line
                  x1={plotLeft}
                  x2={plotLeft + plotWidth}
                  y1={y}
                  y2={y}
                  className="trend-chart__grid"
                />
                <text x={plotLeft - 8} y={y + 3} textAnchor="end" className="trend-chart__axis-text">
                  {formatKind === 'currency'
                    ? formatMetricValue(tick, 'currency').replace(/\.00$/, '')
                    : formatMetricValue(tick, 'integer')}
                </text>
              </g>
            )
          })}

          <text
            x={14}
            y={plotTop + plotHeight / 2}
            className="trend-chart__axis-label"
            transform={`rotate(-90 14 ${plotTop + plotHeight / 2})`}
            textAnchor="middle"
          >
            {yAxisLabel}
          </text>

          {slots.map((slot, index) => {
            if (index % labelStep !== 0 && index !== slots.length - 1) return null
            const x = indexToX(index, slots.length, plotLeft, plotWidth)
            return (
              <text
                key={`${uid}-x-${index}`}
                x={x}
                y={height - 10}
                textAnchor="middle"
                className="trend-chart__axis-text"
              >
                {formatAxisDate(slot.labelDate)}
              </text>
            )
          })}

          {previousSegments.map((segment, i) => (
            <path
              key={`${uid}-prev-${i}`}
              d={pathFromSegment(segment)}
              className="trend-chart__line trend-chart__line--previous"
              fill="none"
            />
          ))}
          {currentSegments.map((segment, i) => (
            <path
              key={`${uid}-curr-${i}`}
              d={pathFromSegment(segment)}
              className="trend-chart__line trend-chart__line--current"
              fill="none"
            />
          ))}

          {slots.map((slot, index) => {
            const x = indexToX(index, slots.length, plotLeft, plotWidth)
            return (
              <g key={`${uid}-pts-${index}`}>
                {slot.previous != null && showCompare ? (
                  <circle
                    cx={x}
                    cy={valueToY(slot.previous, minY, maxY, plotTop, plotHeight)}
                    r={hoverIndex === index ? 4.5 : 3}
                    className="trend-chart__dot trend-chart__dot--previous"
                  />
                ) : null}
                {slot.current != null ? (
                  <circle
                    cx={x}
                    cy={valueToY(slot.current, minY, maxY, plotTop, plotHeight)}
                    r={hoverIndex === index ? 4.5 : 3}
                    className="trend-chart__dot trend-chart__dot--current"
                  />
                ) : null}
              </g>
            )
          })}

          {hover && hoverX != null ? (
            <line
              x1={hoverX}
              x2={hoverX}
              y1={plotTop}
              y2={plotTop + plotHeight}
              className="trend-chart__hover-line"
            />
          ) : null}
        </svg>

        {hover && hoverX != null ? (
          <div
            className="trend-chart__tooltip"
            style={{
              left: Math.min(Math.max(hoverX, 88), width - 88),
            }}
          >
            {showCompare ? (
              <>
                <DayTooltipBlock label="Current" day={hover.currentDay} />
                <DayTooltipBlock label="Previous" day={hover.previousDay} />
              </>
            ) : (
              <DayTooltipBlock day={hover.currentDay || hover.previousDay} />
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
