import { formatNoteTimestamp } from '../utils/entityKeys'
import { formatCurrency, formatNumber, formatPercent } from '../utils/format'

function formatMetricValue(value, metric) {
  if (value === null || value === undefined) return 'N/A'
  
  switch (metric) {
    case 'spend':
    case 'cpa':
    case 'cpt':
      return formatCurrency(value)
    case 'installs':
    case 'taps':
    case 'impressions':
      return formatNumber(value, 0)
    case 'ttr':
    case 'cr':
      return formatPercent(value)
    default:
      return value.toFixed(2)
  }
}

function getSeverityBadge(severity) {
  const labels = {
    positive: 'Positive',
    warning: 'Warning',
    critical: 'Critical',
    info: 'Info',
  }
  return labels[severity] || severity
}

function getSeverityColor(severity) {
  const colors = {
    positive: 'good',
    warning: 'bad',
    critical: 'bad',
    info: 'neutral',
  }
  return colors[severity] || 'neutral'
}

export default function InsightDetailsDrawer({
  open,
  insight,
  dateRange,
  selectedApp,
  onClose,
  onViewCampaigns,
  onViewKeywords,
}) {
  if (!open || !insight) return null

  const appName = selectedApp?.app_name || 'All Apps'
  const startDate = dateRange?.startDate
  const endDate = dateRange?.endDate
  
  // Check if this is a full API insight or simplified card
  const isFullInsight = insight.explanation !== undefined
  const severityColor = isFullInsight ? getSeverityColor(insight.severity) : (insight.tone || 'neutral')

  return (
    <div className="notes-overlay" role="presentation" onClick={onClose}>
      <aside
        className="notes-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Insight Details"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="notes-panel__header">
          <div>
            <h2 className="notes-panel__title">
              {isFullInsight ? insight.title : 'Insight Details'}
            </h2>
            <p className="notes-panel__entity">
              <span className={`insight-row__badge insight-row__badge--${severityColor}`}>
                {isFullInsight ? getSeverityBadge(insight.severity) : insight.type}
              </span>
            </p>
          </div>
          <button type="button" className="btn btn--ghost notes-panel__close" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="notes-panel__content">
          <div className="insight-details">
            <section className="insight-details__section">
              <h3 className="insight-details__heading">Summary</h3>
              <p className={`insight-details__text insight-details__text--${severityColor}`}>
                {isFullInsight ? insight.summary : insight.text}
              </p>
            </section>

            {isFullInsight && insight.explanation ? (
              <section className="insight-details__section">
                <h3 className="insight-details__heading">Why this changed</h3>
                <p className="insight-details__explanation">
                  {insight.explanation}
                </p>
              </section>
            ) : null}

            {isFullInsight && (insight.currentValue !== null || insight.previousValue !== null) ? (
              <section className="insight-details__section">
                <h3 className="insight-details__heading">Performance Metrics</h3>
                <dl className="insight-details__meta">
                  {insight.previousValue !== null && insight.previousValue !== undefined ? (
                    <div className="insight-details__meta-row">
                      <dt className="insight-details__label">Previous {insight.metric?.toUpperCase()}</dt>
                      <dd className="insight-details__value">
                        {formatMetricValue(insight.previousValue, insight.metric)}
                      </dd>
                    </div>
                  ) : null}
                  {insight.currentValue !== null && insight.currentValue !== undefined ? (
                    <div className="insight-details__meta-row">
                      <dt className="insight-details__label">Current {insight.metric?.toUpperCase()}</dt>
                      <dd className="insight-details__value insight-details__value--current">
                        {formatMetricValue(insight.currentValue, insight.metric)}
                      </dd>
                    </div>
                  ) : null}
                  {insight.percentageChange !== null && insight.percentageChange !== undefined ? (
                    <div className="insight-details__meta-row">
                      <dt className="insight-details__label">Change</dt>
                      <dd className={`insight-details__value insight-details__value--${insight.percentageChange > 0 ? 'increase' : 'decrease'}`}>
                        {insight.percentageChange > 0 ? '+' : ''}{insight.percentageChange.toFixed(1)}%
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </section>
            ) : null}

            <section className="insight-details__section">
              <h3 className="insight-details__heading">Context</h3>
              <dl className="insight-details__meta">
                <div className="insight-details__meta-row">
                  <dt className="insight-details__label">App Filter</dt>
                  <dd className="insight-details__value">{appName}</dd>
                </div>
                {startDate && endDate ? (
                  <div className="insight-details__meta-row">
                    <dt className="insight-details__label">Date Range</dt>
                    <dd className="insight-details__value">
                      {startDate} → {endDate}
                    </dd>
                  </div>
                ) : null}
                <div className="insight-details__meta-row">
                  <dt className="insight-details__label">Generated</dt>
                  <dd className="insight-details__value">
                    {isFullInsight && insight.generatedAt 
                      ? formatNoteTimestamp(insight.generatedAt) 
                      : formatNoteTimestamp(new Date())}
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          <div className="notes-panel__actions">
            <button type="button" className="btn btn--secondary" onClick={onViewCampaigns}>
              View Campaigns
            </button>
            <button type="button" className="btn btn--secondary" onClick={onViewKeywords}>
              View Keywords
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}
