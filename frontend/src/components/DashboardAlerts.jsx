import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchAlerts } from '../api'
import { formatCurrency, formatNumber, formatPercent } from '../utils/format'

function formatMetricValue(value, metric) {
  if (value === null || value === undefined) return 'N/A'
  
  switch (metric) {
    case 'spend':
    case 'cpa':
    case 'cpt':
      return formatCurrency(value)
    case 'installs':
      return formatNumber(value, 0)
    case 'ttr':
    case 'cr':
      return formatPercent(value)
    default:
      return value.toFixed(2)
  }
}

function formatOperator(operator) {
  return operator === 'greater_than' ? '>' : '<'
}

function metricLabel(metric) {
  const labels = {
    spend: 'Spend',
    installs: 'Installs',
    cpa: 'CPA',
    cpt: 'CPT',
    ttr: 'TTR',
    cr: 'CR',
  }
  return labels[metric] || metric
}

export default function DashboardAlerts() {
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadAlerts() {
      setLoading(true)
      setError('')
      try {
        const data = await fetchAlerts()
        if (!cancelled) {
          setAlerts(data)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Failed to load alerts')
          setAlerts([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadAlerts()
    return () => { cancelled = true }
  }, [])

  const handleAlertClick = (alert) => {
    if (alert.entityType === 'campaign') {
      navigate('/campaigns')
    } else if (alert.entityType === 'keyword') {
      navigate('/keywords')
    }
  }

  if (!loading && alerts.length === 0) {
    return (
      <div className="alerts-empty">
        <p className="alerts-empty__title">No performance targets set</p>
        <p className="alerts-empty__description">
          Set a target for CPA, installs, spend, TTR, or conversion rate to highlight when 
          performance moves outside your preferred range.
        </p>
      </div>
    )
  }

  return (
    <>
      {loading ? (
        <p className="analysis-empty">Loading alerts…</p>
      ) : error ? (
        <p className="analysis-empty analysis-empty--error">{error}</p>
      ) : (
        <div className="alerts-panel__list">
          {alerts.map((alert, index) => (
            <div
              key={`${alert.goalId}-${index}`}
              className="alert-card"
              onClick={() => handleAlertClick(alert)}
            >
              <div className="alert-card__header">
                <span className="alert-card__badge alert-card__badge--warning">
                  {metricLabel(alert.metric)}
                </span>
                <span className="alert-card__entity-type">
                  {alert.entityType}
                </span>
              </div>

              <div className="alert-card__entity">{alert.entityName}</div>

              <div className="alert-card__condition">
                {metricLabel(alert.metric)} is{' '}
                {formatOperator(alert.operator)}{' '}
                {formatMetricValue(alert.threshold, alert.metric)}
              </div>

              <div className="alert-card__values">
                <div className="alert-card__value-row">
                  <span className="alert-card__label">Current:</span>
                  <span className="alert-card__value alert-card__value--breach">
                    {formatMetricValue(alert.currentValue, alert.metric)}
                  </span>
                </div>
                <div className="alert-card__value-row">
                  <span className="alert-card__label">Threshold:</span>
                  <span className="alert-card__value">
                    {formatMetricValue(alert.threshold, alert.metric)}
                  </span>
                </div>
                <div className="alert-card__value-row">
                  <span className="alert-card__label">Breach:</span>
                  <span className="alert-card__value alert-card__value--breach">
                    {formatMetricValue(Math.abs(alert.breachAmount), alert.metric)}
                    {alert.breachPercent !== null ? (
                      <span className="alert-card__percent">
                        {' '}({alert.breachPercent.toFixed(1)}%)
                      </span>
                    ) : null}
                  </span>
                </div>
              </div>

              <div className="alert-card__period">
                {alert.startDate} → {alert.endDate} ({alert.periodDays} days)
              </div>

              <div className="alert-card__action">
                View {alert.entityType === 'campaign' ? 'Campaign' : 'Keyword'} →
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
