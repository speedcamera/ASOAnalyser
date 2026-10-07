import { useId, useMemo, useState } from 'react'
import {
  buildTrendPoints,
  formatFullDate,
  formatMetricValue,
} from '../utils/trendChart'

const WIDTH = 96
const HEIGHT = 36
const PAD_X = 4
const PAD_Y = 4

function buildSegments(points) {
  const plotted = points
    .map((point, index) => {
      if (point.value == null) return null
      return { ...point, index }
    })
    .filter(Boolean)

  if (plotted.length < 1) return { segments: [], plotted: [] }

  const values = plotted.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const coords = plotted.map((point, i) => {
    const x =
      plotted.length === 1
        ? WIDTH / 2
        : PAD_X + (i / (plotted.length - 1)) * (WIDTH - PAD_X * 2)
    const y =
      HEIGHT - PAD_Y - ((point.value - min) / range) * (HEIGHT - PAD_Y * 2)
    return { ...point, x, y }
  })

  const segments = []
  let current = []
  for (const coord of coords) {
    current.push(coord)
  }
  if (current.length) segments.push(current)

  return { segments, plotted: coords }
}

export default function KpiSparkline({
  days = [],
  /** @deprecated prefer days */
  weeks,
  metricKey = 'spend',
  formatKind = 'currency',
  label = 'Trend',
  tone = 'neutral',
  loading = false,
}) {
  const uid = useId()
  const [hoverIndex, setHoverIndex] = useState(null)

  const sourceDays = days.length ? days : (weeks ?? [])

  const points = useMemo(
    () => buildTrendPoints(sourceDays, metricKey),
    [sourceDays, metricKey],
  )

  const { segments, plotted } = useMemo(() => buildSegments(points), [points])

  if (loading) {
    return (
      <div className="kpi-sparkline kpi-sparkline--empty" aria-label={`${label} trend loading`}>
        <span className="kpi-sparkline__empty-text">Updating…</span>
      </div>
    )
  }

  if (points.length < 2 || plotted.length < 2) {
    return (
      <div className="kpi-sparkline kpi-sparkline--empty" aria-label={`${label} trend unavailable`}>
        <span className="kpi-sparkline__empty-text">No trend</span>
      </div>
    )
  }

  const hover = hoverIndex != null ? plotted[hoverIndex] : null

  function nearestIndex(clientX, rect) {
    const x = ((clientX - rect.left) / rect.width) * WIDTH
    let best = 0
    let dist = Infinity
    plotted.forEach((point, i) => {
      const d = Math.abs(point.x - x)
      if (d < dist) {
        dist = d
        best = i
      }
    })
    return best
  }

  return (
    <div
      className={`kpi-sparkline kpi-sparkline--${tone}`}
      onMouseEnter={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
    >
      <svg
        className="kpi-sparkline__svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${label} daily trend over ${points.length} days`}
        onMouseMove={(e) => {
          e.stopPropagation()
          const rect = e.currentTarget.getBoundingClientRect()
          setHoverIndex(nearestIndex(e.clientX, rect))
        }}
        onMouseLeave={() => setHoverIndex(null)}
        onFocus={() => setHoverIndex(plotted.length - 1)}
        onBlur={() => setHoverIndex(null)}
        tabIndex={0}
      >
        {segments.map((segment, i) => (
          <polyline
            key={`${uid}-seg-${i}`}
            points={segment.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {hover ? (
          <circle
            cx={hover.x}
            cy={hover.y}
            r="3.5"
            className="kpi-sparkline__hover-dot"
          />
        ) : null}
      </svg>

      {hover ? (
        <div className="kpi-sparkline__tooltip" role="tooltip">
          <div className="kpi-sparkline__tooltip-date">{formatFullDate(hover.date)}</div>
          <div className="kpi-sparkline__tooltip-row">
            <span>Spend</span>
            <strong>{formatMetricValue(hover.spend, 'currency')}</strong>
          </div>
          <div className="kpi-sparkline__tooltip-row">
            <span>Installs</span>
            <strong>{formatMetricValue(hover.installs, 'integer')}</strong>
          </div>
          <div className="kpi-sparkline__tooltip-row">
            <span>CPA</span>
            <strong>{formatMetricValue(hover.cpa, 'currency')}</strong>
          </div>
          <div className="kpi-sparkline__tooltip-row">
            <span>CPT</span>
            <strong>{formatMetricValue(hover.cpt, 'currency')}</strong>
          </div>
        </div>
      ) : null}
    </div>
  )
}
