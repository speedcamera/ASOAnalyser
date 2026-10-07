export default function MiniSparkline({ title, values }) {
  const points = (values ?? []).filter((v) => v !== null && v !== undefined)
  if (points.length < 2) {
    return (
      <div className="chart-card">
        <div className="chart-card__header">
          <h3 className="chart-card__title">{title}</h3>
        </div>
        <p className="chart-card__empty">Not enough data for this period</p>
      </div>
    )
  }

  const width = 320
  const height = 120
  const max = Math.max(...points)
  const min = Math.min(...points)
  const range = max - min || 1

  const coords = points.map((value, index) => {
    const x = (index / (points.length - 1)) * width
    const y = height - ((value - min) / range) * (height - 16) - 8
    return { x, y }
  })

  const line = coords.map((p) => `${p.x},${p.y}`).join(' ')
  const area = `0,${height} ${line} ${width},${height}`

  return (
    <div className="chart-card">
      <div className="chart-card__header">
        <h3 className="chart-card__title">{title}</h3>
      </div>
      <svg
        className="chart-card__svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${title} trend`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={`grad-${title.replace(/\s+/g, '-')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <polygon
          points={area}
          fill={`url(#grad-${title.replace(/\s+/g, '-')})`}
        />
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}
