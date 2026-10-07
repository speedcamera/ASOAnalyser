export default function OverallSummary({ overallInsight, period, selectedApp }) {
  if (!overallInsight) return null

  const appName = selectedApp?.app_name || 'All Apps'
  const severityColor = getSeverityColor(overallInsight.severity)
  const hasKeyDrivers = overallInsight.keyDrivers && overallInsight.keyDrivers.length > 0

  return (
    <section className="overall-summary-grid" aria-label="Overall Performance Summary">
      {/* Main Summary Tile */}
      <div className="overall-summary__main-tile">
        <div className="overall-summary__header">
          <h2 className="overall-summary__title">{overallInsight.title}</h2>
          <span className={`overall-summary__badge overall-summary__badge--${severityColor}`}>
            {formatSeverity(overallInsight.severity)}
          </span>
        </div>

        <p className="overall-summary__summary">{overallInsight.summary}</p>
        
        {overallInsight.explanation ? (
          <p className="overall-summary__explanation">{overallInsight.explanation}</p>
        ) : null}

        <div className="overall-summary__meta">
          <span className="overall-summary__period">{period}</span>
          <span className="overall-summary__separator">•</span>
          <span className="overall-summary__app">{appName}</span>
        </div>
      </div>

      {/* Key Drivers Tile */}
      <div className="overall-summary__drivers-tile">
        <h3 className="overall-summary__drivers-label">Key drivers</h3>
        {hasKeyDrivers ? (
          <div className="overall-summary__drivers-list">
            {overallInsight.keyDrivers.map((driver, index) => {
              const sentiment = getDriverSentiment(driver.metric, driver.direction)
              return (
                <div 
                  key={`${driver.metric}-${index}`}
                  className={`driver-row driver-row--${sentiment}`}
                >
                  <span className="driver-row__icon" aria-hidden="true">
                    {driver.direction === 'up' ? '↑' : '↓'}
                  </span>
                  <span className="driver-row__label">{driver.label}</span>
                  <span className="driver-row__value">
                    {driver.percentageChange > 0 ? '+' : ''}{driver.percentageChange.toFixed(1)}%
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="overall-summary__no-drivers">No significant movements above threshold</p>
        )}
      </div>
    </section>
  )
}

function getSeverityColor(severity) {
  const colors = {
    positive: 'good',
    warning: 'bad',
    critical: 'bad',
    neutral: 'neutral',
    info: 'neutral',
  }
  return colors[severity] || 'neutral'
}

function formatSeverity(severity) {
  const labels = {
    positive: 'Positive',
    warning: 'Warning',
    critical: 'Critical',
    neutral: 'Stable',
    info: 'Info',
  }
  return labels[severity] || severity
}

/**
 * Determine semantic sentiment for a metric movement
 * Returns 'favorable', 'unfavorable', or 'neutral'
 */
function getDriverSentiment(metric, direction) {
  // Higher is better metrics
  const higherIsBetter = ['installs', 'cr', 'ttr', 'taps', 'impressions']
  
  // Lower is better metrics
  const lowerIsBetter = ['cpa', 'cpt']
  
  // Neutral metrics (context-dependent)
  const neutral = ['spend']
  
  if (higherIsBetter.includes(metric)) {
    return direction === 'up' ? 'favorable' : 'unfavorable'
  }
  
  if (lowerIsBetter.includes(metric)) {
    return direction === 'down' ? 'favorable' : 'unfavorable'
  }
  
  return 'neutral'
}
