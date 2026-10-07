export default function InsightsBar({ insights, onViewDetails }) {
  const items = (insights ?? []).slice(0, 4)
  if (!items.length) return null

  return (
    <section className="insights-card" aria-label="Insights">
      <div className="insights-card__header">
        <h2 className="insights-card__title">Detailed insights</h2>
        <span className="insights-card__count">{items.length} highlighted</span>
      </div>
      <ul className="insights-card__list">
        {items.map((item, index) => (
          <li key={`${item.type}-${index}`} className={`insight-row insight-row--${item.tone}`}>
            <span className={`insight-row__icon insight-row__icon--${item.tone}`} aria-hidden="true">
              {item.tone === 'good' ? '✓' : item.tone === 'bad' ? '!' : 'i'}
            </span>
            <span className="insight-row__badge">{item.type}</span>
            <span className="insight-row__text">{item.text}</span>
            <button
              type="button"
              className="insight-row__action"
              onClick={() => onViewDetails?.(item, index)}
            >
              View details
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
