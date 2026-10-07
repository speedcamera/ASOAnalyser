import { useCallback, useEffect, useState } from 'react'
import { createGoal, deleteGoal, fetchGoals, updateGoal } from '../api'
import { MAX_GOAL_THRESHOLD } from '../analyticsLimits'

const METRIC_OPTIONS = [
  { value: 'spend', label: 'Spend' },
  { value: 'installs', label: 'Installs' },
  { value: 'cpa', label: 'CPA' },
  { value: 'cpt', label: 'CPT' },
  { value: 'ttr', label: 'TTR' },
  { value: 'cr', label: 'CR' },
]

const OPERATOR_OPTIONS = [
  { value: 'greater_than', label: 'Greater than' },
  { value: 'less_than', label: 'Less than' },
]

const PERIOD_OPTIONS = [
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
]

const EMPTY_FORM = {
  metric: 'cpa',
  operator: 'greater_than',
  threshold: '',
  periodDays: 7,
}

function formatOperator(operator) {
  return operator === 'greater_than' ? '>' : '<'
}

function formatMetricLabel(metric) {
  return METRIC_OPTIONS.find(m => m.value === metric)?.label ?? metric
}

export default function GoalManagementPanel({ open, entityType, entityKey, entityName, onClose }) {
  const [goals, setGoals] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)

  const loadGoals = useCallback(async () => {
    if (!entityType || !entityKey) return
    setLoading(true)
    setError('')
    try {
      const data = await fetchGoals({ entityType, entityKey })
      setGoals(data)
    } catch (err) {
      setError(err.message || 'Failed to load goals')
      setGoals([])
    } finally {
      setLoading(false)
    }
  }, [entityType, entityKey])

  useEffect(() => {
    if (!open) return
    setForm(EMPTY_FORM)
    setEditingId(null)
    loadGoals()
  }, [open, loadGoals])

  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    const threshold = parseFloat(form.threshold)
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > MAX_GOAL_THRESHOLD) {
      setError('Threshold must be a non-negative number')
      return
    }

    try {
      const body = {
        entityType,
        entityKey,
        metric: form.metric,
        operator: form.operator,
        threshold,
        periodDays: form.periodDays,
      }

      if (editingId) {
        await updateGoal(editingId, body)
      } else {
        await createGoal(body)
      }

      setForm(EMPTY_FORM)
      setEditingId(null)
      loadGoals()
    } catch (err) {
      setError(err.message || 'Failed to save goal')
    }
  }

  const handleEdit = (goal) => {
    setForm({
      metric: goal.metric,
      operator: goal.operator,
      threshold: goal.threshold.toString(),
      periodDays: goal.periodDays,
    })
    setEditingId(goal.id)
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this goal?')) return
    setError('')
    try {
      await deleteGoal(id)
      loadGoals()
    } catch (err) {
      setError(err.message || 'Failed to delete goal')
    }
  }

  const handleToggleActive = async (goal) => {
    setError('')
    try {
      await updateGoal(goal.id, { isActive: !goal.isActive })
      loadGoals()
    } catch (err) {
      setError(err.message || 'Failed to update goal')
    }
  }

  const handleCancel = () => {
    setForm(EMPTY_FORM)
    setEditingId(null)
  }

  if (!open) return null

  return (
    <div className="notes-overlay" role="presentation" onClick={onClose}>
      <aside
        className="notes-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Performance Goals"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="notes-panel__header">
          <div>
            <h2 className="notes-panel__title">Performance Goals</h2>
            <p className="notes-panel__entity">{entityName}</p>
          </div>
          <button type="button" className="btn btn--ghost notes-panel__close" onClick={onClose}>
            Close
          </button>
        </header>

        <form className="notes-panel__form" onSubmit={handleSubmit}>
          <div className="notes-panel__form-row">
            <label htmlFor="goal-metric">Metric</label>
            <select
              id="goal-metric"
              className="input"
              value={form.metric}
              onChange={(e) => setForm({ ...form, metric: e.target.value })}
              required
            >
              {METRIC_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="notes-panel__form-row">
            <label htmlFor="goal-operator">Operator</label>
            <select
              id="goal-operator"
              className="input"
              value={form.operator}
              onChange={(e) => setForm({ ...form, operator: e.target.value })}
              required
            >
              {OPERATOR_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="notes-panel__form-row">
            <label htmlFor="goal-threshold">Threshold</label>
            <input
              type="number"
              id="goal-threshold"
              className="input"
              min="0"
              step="any"
              value={form.threshold}
              onChange={(e) => setForm({ ...form, threshold: e.target.value })}
              placeholder="e.g., 5.00"
              required
            />
          </div>

          <div className="notes-panel__form-row">
            <label htmlFor="goal-period">Period</label>
            <select
              id="goal-period"
              className="input"
              value={form.periodDays}
              onChange={(e) => setForm({ ...form, periodDays: Number.parseInt(e.target.value, 10) })}
              required
            >
              {PERIOD_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="notes-panel__form-actions">
            {editingId ? (
              <button type="button" className="btn btn--ghost" onClick={handleCancel}>
                Cancel
              </button>
            ) : null}
            <button type="submit" className="btn btn--primary">
              {editingId ? 'Update Goal' : 'Add Goal'}
            </button>
          </div>
        </form>

        {error ? <p className="notes-panel__error">{error}</p> : null}

        <div className="notes-panel__list">
          {loading ? (
            <p className="notes-panel__empty">Loading goals…</p>
          ) : goals.length === 0 ? (
            <p className="notes-panel__empty">No performance goals set.</p>
          ) : (
            goals.map(goal => (
              <div key={goal.id} className="notes-panel__item">
                <div className="notes-panel__item-content">
                  <div className="notes-panel__item-meta">
                    <span className={`goal-badge goal-badge--${goal.metric}`}>
                      {formatMetricLabel(goal.metric)}
                    </span>
                    {!goal.isActive ? (
                      <span className="goal-badge goal-badge--inactive">Inactive</span>
                    ) : null}
                  </div>
                  <div className="notes-panel__item-text">
                    Alert when {formatMetricLabel(goal.metric)} is{' '}
                    {formatOperator(goal.operator)} {goal.threshold.toFixed(2)}{' '}
                    over {goal.periodDays} days
                  </div>
                </div>
                <div className="notes-panel__item-actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => handleEdit(goal)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => handleToggleActive(goal)}
                  >
                    {goal.isActive ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => handleDelete(goal.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  )
}
