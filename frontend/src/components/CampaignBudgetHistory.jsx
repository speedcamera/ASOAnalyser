import { useEffect, useState } from 'react'
import { fetchCampaignBudgetHistory } from '../api'
import { formatChange, formatCurrency, formatNumber } from '../utils/format'

function formatObservedDate(dateKey) {
  if (!dateKey) return '—'
  const date = new Date(`${String(dateKey).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return dateKey
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function formatSignedPercent(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${formatNumber(value, 1)}%`
}

export default function CampaignBudgetHistory({ appId, campaignName }) {
  const [history, setHistory] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setHistory(null)

    fetchCampaignBudgetHistory({ appId, campaignName })
      .then((result) => {
        if (!cancelled) setHistory(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Budget history could not be loaded')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [appId, campaignName])

  return (
    <section className="campaign-budget-history">
      <div className="campaign-budget-history__head">
        <h3 className="campaign-budget-history__title">Budget History</h3>
        <p className="campaign-budget-history__meta">
          Changes are ordered by report date. The first recorded budget is not a change.
        </p>
      </div>

      {loading ? <p className="analysis-empty">Loading budget history…</p> : null}
      {error ? <p className="analysis-empty">{error}</p> : null}

      {!loading && !error && history?.budget_comparison_status === 'unavailable' ? (
        <p className="campaign-budget-history__empty">Not recorded</p>
      ) : null}

      {!loading && !error && history && history.budget_comparison_status !== 'unavailable' && !history.changes?.length ? (
        <p className="campaign-budget-history__empty">No daily budget changes detected.</p>
      ) : null}

      {!loading && !error && history?.changes?.length ? (
        <div className="analysis-table-wrap">
          <table className="analysis-table campaign-budget-history__table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Previous Budget</th>
                <th>New Budget</th>
                <th>Change</th>
                <th>Change %</th>
              </tr>
            </thead>
            <tbody>
              {history.changes.map((change) => (
                <tr key={`${change.change_date}-${change.new_daily_budget}`}>
                  <td>{formatObservedDate(change.change_date)}</td>
                  <td className="num">{formatCurrency(change.previous_daily_budget)}</td>
                  <td className="num">{formatCurrency(change.new_daily_budget)}</td>
                  <td className="num">{formatChange(change.budget_change, formatCurrency)}</td>
                  <td className="num">{formatSignedPercent(change.budget_change_percent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
