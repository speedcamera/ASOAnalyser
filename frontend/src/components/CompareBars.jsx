export default function CompareBars({ title, previous, current, format }) {
  const max = Math.max(previous ?? 0, current ?? 0, 1)
  const prevH = Math.max(8, Math.round(((previous ?? 0) / max) * 100))
  const currH = Math.max(8, Math.round(((current ?? 0) / max) * 100))

  return (
    <div className="compare-card">
      <h3 className="compare-card__title">{title}</h3>
      <div className="compare-card__bars" aria-hidden>
        <div
          className="compare-card__bar compare-card__bar--prev"
          style={{ height: `${prevH}%` }}
        />
        <div
          className="compare-card__bar compare-card__bar--curr"
          style={{ height: `${currH}%` }}
        />
      </div>
      <div className="compare-card__legend">
        <span>
          Previous <strong>{format(previous)}</strong>
        </span>
        <span>
          Current <strong>{format(current)}</strong>
        </span>
      </div>
    </div>
  )
}
