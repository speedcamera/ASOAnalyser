import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchBidExperiment,
  fetchBidExperiments,
  fetchBidExperimentSettings,
  updateBidExperimentSettings,
} from '../api'
import { na } from '../utils/display'
import { formatCurrency, formatNumber, formatPercent } from '../utils/format'
import KeywordOverviewPanel from './KeywordOverviewPanel'

const STATUS_LABELS = {
  observing: 'Observing',
  completed: 'Completed',
  interrupted: 'Interrupted',
  insufficient_data: 'Insufficient data',
}

const TOOLTIPS = {
  observationWindow: 'The number of days analysed after the bid change.',
  interrupted: 'A later bid change ended this observation early.',
  actualObservation: 'The number of days actually analysed.',
  typicalRange:
    'The usual CPA band from historical days before this bid change (middle half of past daily CPAs).',
}

function formatTypicalRange(low, high, formatValue) {
  if (low == null || high == null) return '—'
  return `${formatValue(low)}–${formatValue(high)}`
}

function rangeStatusClass(status) {
  if (!status) return 'bid-typical-range__status--neutral'
  if (status.startsWith('Above')) return 'bid-typical-range__status--above'
  if (status.startsWith('Below')) return 'bid-typical-range__status--below'
  if (status.startsWith('Within')) return 'bid-typical-range__status--within'
  return 'bid-typical-range__status--neutral'
}

function TypicalRangePanel({ baseline }) {
  if (!baseline) return null
  const { typical_low: low, typical_high: high, current, status } = baseline

  return (
    <section className="bid-experiment-detail__section">
      <h4 className="bid-experiment-detail__section-title">
        Typical Range
        <InfoTip text={TOOLTIPS.typicalRange} />
      </h4>
      <dl className="bid-typical-range">
        <div>
          <dt>Typical CPA</dt>
          <dd>{formatTypicalRange(low, high, formatCurrency)}</dd>
        </div>
        <div>
          <dt>Current CPA</dt>
          <dd>{na(current, formatCurrency)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd className={`bid-typical-range__status ${rangeStatusClass(status)}`}>
            {status || '—'}
          </dd>
        </div>
      </dl>
    </section>
  )
}

function formatDisplayDate(dateKey) {
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

function formatPct(value) {
  if (value == null || Number.isNaN(value)) return 'N/A'
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatNumber(value, 1)}%`
}

function InfoTip({ text }) {
  return (
    <span className="bid-info-tip" tabIndex={0} aria-label={text}>
      <span className="bid-info-tip__icon" aria-hidden="true">
        i
      </span>
      <span className="bid-info-tip__bubble" role="tooltip">
        {text}
      </span>
    </span>
  )
}

function BidArrow({ direction }) {
  const up = direction === 'increase'
  return (
    <span
      className={`bid-arrow ${up ? 'bid-arrow--up' : 'bid-arrow--down'}`}
      aria-label={up ? 'Increase' : 'Decrease'}
    >
      {up ? '↑' : '↓'}
    </span>
  )
}

function StatusBadge({ status, withTooltip = false }) {
  const label = STATUS_LABELS[status] || status
  return (
    <span className={`bid-status bid-status--${status}`}>
      {label}
      {withTooltip && status === 'interrupted' ? (
        <InfoTip text={TOOLTIPS.interrupted} />
      ) : null}
    </span>
  )
}

function WindowPill({ days }) {
  if (days == null) return null
  return (
    <span className="bid-window-pill" title={TOOLTIPS.observationWindow}>
      {days}d
    </span>
  )
}

function MetricDeltaRow({ label, delta, formatValue }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="num">{na(delta?.before, formatValue)}</td>
      <td className="num">{na(delta?.after, formatValue)}</td>
      <td className="num">{formatPct(delta?.change_percent)}</td>
    </tr>
  )
}

function SkeletonBlock({ className = '' }) {
  return <div className={`bid-skeleton ${className}`} aria-hidden="true" />
}

function TimelineSkeleton() {
  return (
    <div className="bid-history-timeline bid-history-timeline--skeleton" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="bid-history-timeline__item bid-history-timeline__item--skeleton">
          <SkeletonBlock className="bid-skeleton--dot" />
          <div className="bid-history-timeline__content">
            <SkeletonBlock className="bid-skeleton--line bid-skeleton--line-sm" />
            <SkeletonBlock className="bid-skeleton--line" />
            <SkeletonBlock className="bid-skeleton--line bid-skeleton--line-xs" />
          </div>
        </div>
      ))}
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="bid-experiment-detail bid-experiment-detail--skeleton" aria-busy="true">
      <SkeletonBlock className="bid-skeleton--line bid-skeleton--title" />
      <SkeletonBlock className="bid-skeleton--line bid-skeleton--line-sm" />
      <div className="bid-experiment-detail__section">
        <SkeletonBlock className="bid-skeleton--line bid-skeleton--line-xs" />
        <div className="bid-experiment-detail__meta">
          <SkeletonBlock className="bid-skeleton--tile" />
          <SkeletonBlock className="bid-skeleton--tile" />
          <SkeletonBlock className="bid-skeleton--tile" />
          <SkeletonBlock className="bid-skeleton--tile" />
        </div>
      </div>
      <SkeletonBlock className="bid-skeleton--table" />
    </div>
  )
}

function SettingsSkeleton() {
  return (
    <div className="bid-history__settings bid-history__settings--skeleton" aria-busy="true">
      <SkeletonBlock className="bid-skeleton--line bid-skeleton--line-sm" />
      <SkeletonBlock className="bid-skeleton--select" />
      <SkeletonBlock className="bid-skeleton--line" />
    </div>
  )
}

function StatusLifecycle({ status }) {
  const steps = [
    { key: 'created', label: 'Created', done: true },
    {
      key: 'observing',
      label: 'Observing',
      done: true,
      current: status === 'observing',
    },
    {
      key: 'end',
      label:
        status === 'interrupted'
          ? 'Interrupted'
          : status === 'insufficient_data'
            ? 'Insufficient data'
            : status === 'observing'
              ? 'Completed'
              : STATUS_LABELS[status] || 'Completed',
      done: status !== 'observing',
      current: status !== 'observing',
      tone:
        status === 'interrupted'
          ? 'interrupted'
          : status === 'insufficient_data'
            ? 'insufficient'
            : status === 'completed'
              ? 'completed'
              : 'pending',
    },
  ]

  return (
    <ol className="bid-lifecycle" aria-label="Experiment lifecycle">
      {steps.map((step, index) => (
        <li
          key={step.key}
          className={[
            'bid-lifecycle__step',
            step.done ? 'bid-lifecycle__step--done' : '',
            step.current ? 'bid-lifecycle__step--current' : '',
            step.tone ? `bid-lifecycle__step--${step.tone}` : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className="bid-lifecycle__dot" aria-hidden="true" />
          <span className="bid-lifecycle__label">{step.label}</span>
          {index < steps.length - 1 ? (
            <span className="bid-lifecycle__connector" aria-hidden="true">
              ↓
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

function BidHistoryTimeline({ experiments, selectedId, onSelect, onViewOverview }) {
  if (!experiments.length) {
    return (
      <div className="bid-history__empty-state">
        <p className="bid-history__empty-title">No bid changes detected</p>
        <p className="bid-history__empty">
          No bid changes have been detected for this keyword.
        </p>
        <p className="bid-history__empty-hint">
          Bid experiments are automatically created whenever the keyword&apos;s Max CPT changes.
        </p>
        <p className="bid-history__empty-hint">
          You can still analyse this keyword&apos;s performance from the Overview tab.
        </p>
        {onViewOverview ? (
          <button type="button" className="btn btn--ghost bid-history__empty-cta" onClick={onViewOverview}>
            View Overview
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <ol className="bid-history-timeline">
      {experiments.map((exp) => {
        const selected = String(exp.id) === String(selectedId)
        return (
          <li key={exp.id}>
            <button
              type="button"
              className={`bid-history-timeline__item ${selected ? 'bid-history-timeline__item--selected' : ''}`}
              onClick={() => onSelect(exp.id)}
              aria-current={selected ? 'true' : undefined}
            >
              <div className="bid-history-timeline__accent" aria-hidden="true" />
              <div className="bid-history-timeline__content">
                <div className="bid-history-timeline__row">
                  <strong>{formatDisplayDate(exp.change_date)}</strong>
                  <div className="bid-history-timeline__badges">
                    <WindowPill days={exp.requested_observation_days} />
                    <StatusBadge status={exp.status} />
                  </div>
                </div>
                <div className="bid-history-timeline__bids">
                  <BidArrow direction={exp.direction} />
                  <span>
                    {formatCurrency(exp.previous_max_cpt_bid)} →{' '}
                    {formatCurrency(exp.new_max_cpt_bid)}
                  </span>
                  <span className="bid-history-timeline__pct">
                    {formatPct(exp.bid_change_percent)}
                  </span>
                </div>
              </div>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function ExperimentDetail({ detail, loading }) {
  if (loading) return <DetailSkeleton />
  if (!detail) {
    return (
      <div className="bid-history__empty-state bid-history__empty-state--panel">
        <p className="bid-history__empty">Select an experiment to view before and after results.</p>
      </div>
    )
  }

  const isIncrease = detail.direction === 'increase'
  const title = isIncrease ? 'Bid Increase' : 'Bid Decrease'

  return (
    <div className="bid-experiment-detail">
      <header className="bid-experiment-detail__header">
        <div>
          <h3 className="bid-experiment-detail__title">
            <BidArrow direction={detail.direction} />
            {title}
          </h3>
          <p className="bid-experiment-detail__date">{formatDisplayDate(detail.change_date)}</p>
          <p className="bid-experiment-detail__subtitle">
            {detail.campaign_name}
            {detail.ad_group_name ? ` · ${detail.ad_group_name}` : ''}
          </p>
        </div>
        <div className="bid-history-timeline__badges">
          <WindowPill days={detail.requested_observation_days} />
          <StatusBadge status={detail.status} withTooltip />
        </div>
      </header>

      <StatusLifecycle status={detail.status} />

      <TypicalRangePanel baseline={detail.baselines?.cpa} />

      <section className="bid-experiment-detail__section">
        <h4 className="bid-experiment-detail__section-title">Bid Change</h4>
        <dl className="bid-experiment-detail__meta">
          <div>
            <dt>Previous Bid</dt>
            <dd>{formatCurrency(detail.previous_max_cpt_bid)}</dd>
          </div>
          <div>
            <dt>New Bid</dt>
            <dd>{formatCurrency(detail.new_max_cpt_bid)}</dd>
          </div>
          <div>
            <dt>Direction</dt>
            <dd className="bid-experiment-detail__direction">
              <BidArrow direction={detail.direction} />
              {detail.direction}
            </dd>
          </div>
          <div>
            <dt>Change</dt>
            <dd>
              {formatCurrency(detail.bid_change_amount)} ({formatPct(detail.bid_change_percent)})
            </dd>
          </div>
        </dl>
      </section>

      <section className="bid-experiment-detail__section">
        <h4 className="bid-experiment-detail__section-title">
          Observation
          <InfoTip text={TOOLTIPS.observationWindow} />
        </h4>
        <dl className="bid-experiment-detail__meta">
          <div>
            <dt>
              Requested Window
              <InfoTip text={TOOLTIPS.observationWindow} />
            </dt>
            <dd>{detail.requested_observation_days} days</dd>
          </div>
          <div>
            <dt>
              Actual Observation
              <InfoTip text={TOOLTIPS.actualObservation} />
            </dt>
            <dd>
              {detail.actual_observation_days != null
                ? `${detail.actual_observation_days} days`
                : 'N/A'}
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <StatusBadge status={detail.status} withTooltip />
            </dd>
          </div>
        </dl>
        {(detail.status_reason || detail.interruption_reason) && (
          <p className="bid-experiment-detail__note">
            {detail.interruption_reason || detail.status_reason}
          </p>
        )}
      </section>

      <section className="bid-experiment-detail__section">
        <h4 className="bid-experiment-detail__section-title">Results</h4>
        <div className="bid-experiment-detail__windows">
          <div>
            <h5>Before</h5>
            <p>
              {formatDisplayDate(detail.before.start_date)} →{' '}
              {formatDisplayDate(detail.before.end_date)}
            </p>
            <p className="bid-experiment-detail__window-meta">
              {detail.before.data_days} data day{detail.before.data_days === 1 ? '' : 's'} ·{' '}
              {detail.before.calendar_days} calendar
            </p>
          </div>
          <div>
            <h5>After</h5>
            <p>
              {formatDisplayDate(detail.after.start_date)} →{' '}
              {detail.after.end_date ? formatDisplayDate(detail.after.end_date) : '—'}
            </p>
            <p className="bid-experiment-detail__window-meta">
              {detail.after.data_days} data day{detail.after.data_days === 1 ? '' : 's'} ·{' '}
              {detail.after.calendar_days} calendar
            </p>
          </div>
        </div>

        <div className="analysis-table-wrap">
          <table className="analysis-table bid-experiment-metrics">
            <thead>
              <tr>
                <th>Metric</th>
                <th className="num">Before</th>
                <th className="num">After</th>
                <th className="num">Δ %</th>
              </tr>
            </thead>
            <tbody>
              <MetricDeltaRow label="Spend" delta={detail.deltas.spend} formatValue={formatCurrency} />
              <MetricDeltaRow
                label="Impressions"
                delta={detail.deltas.impressions}
                formatValue={(v) => formatNumber(v, 0)}
              />
              <MetricDeltaRow
                label="Taps"
                delta={detail.deltas.taps}
                formatValue={(v) => formatNumber(v, 0)}
              />
              <MetricDeltaRow
                label="Installs"
                delta={detail.deltas.installs}
                formatValue={(v) => formatNumber(v, 0)}
              />
              <MetricDeltaRow label="CPT" delta={detail.deltas.cpt} formatValue={formatCurrency} />
              <MetricDeltaRow label="CPA" delta={detail.deltas.cpa} formatValue={formatCurrency} />
              <MetricDeltaRow label="TTR" delta={detail.deltas.ttr} formatValue={formatPercent} />
              <MetricDeltaRow label="CR" delta={detail.deltas.cr} formatValue={formatPercent} />
            </tbody>
          </table>
        </div>
      </section>

      <p className="bid-experiment-detail__disclaimer">
        Descriptive comparison only. Metric deltas are not success/failure verdicts.
      </p>
    </div>
  )
}

export default function KeywordDetailDrawer({ open, keyword, onClose }) {
  const [tab, setTab] = useState('overview')
  const [settings, setSettings] = useState(null)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsMessage, setSettingsMessage] = useState('')
  const [experiments, setExperiments] = useState([])
  const [listLoading, setListLoading] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const timelineScrollRef = useRef(null)
  const savedScrollTop = useRef(0)
  const wasOpenRef = useRef(false)

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true)
    try {
      const data = await fetchBidExperimentSettings()
      setSettings(data)
    } finally {
      setSettingsLoading(false)
    }
  }, [])

  const loadExperiments = useCallback(async () => {
    if (!keyword?.app_id || (!keyword?.campaign_name_raw && !keyword?.campaign_name)) return
    setListLoading(true)
    setError('')
    try {
      const data = await fetchBidExperiments({
        appId: keyword.app_id,
        campaignName: keyword.campaign_name_raw || keyword.campaign_name,
        adGroupName: keyword.ad_group_name ?? '',
        keywordText: keyword.keyword,
        limit: 100,
      })
      // Newest first (API already orders DESC; keep explicit for UX contract)
      const sorted = [...(data.experiments || [])].sort((a, b) =>
        String(b.change_date).localeCompare(String(a.change_date)),
      )
      setExperiments(sorted)
      if (sorted.length) {
        setSelectedId(sorted[0].id)
      } else {
        setSelectedId(null)
        setDetail(null)
      }
    } catch (err) {
      setError(err.message || 'Failed to load bid history')
      setExperiments([])
    } finally {
      setListLoading(false)
    }
  }, [keyword])

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false
      return
    }

    // Fresh open → Overview first. While drawer stays open, keep the selected tab.
    if (!wasOpenRef.current) {
      setTab('overview')
    }
    wasOpenRef.current = true

    setSettingsMessage('')
    setSelectedId(null)
    setDetail(null)
    savedScrollTop.current = 0
    loadSettings().catch((err) => setError(err.message))
    loadExperiments()
  }, [open, keyword, loadSettings, loadExperiments])

  useEffect(() => {
    if (!open || !selectedId) return
    let cancelled = false
    setDetailLoading(true)
    fetchBidExperiment(selectedId)
      .then((data) => {
        if (!cancelled) setDetail(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load experiment')
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, selectedId])

  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Restore timeline scroll after selection re-render
  useEffect(() => {
    const el = timelineScrollRef.current
    if (!el) return
    el.scrollTop = savedScrollTop.current
  }, [selectedId, detailLoading, experiments])

  if (!open || !keyword) return null

  function handleSelectExperiment(id) {
    if (timelineScrollRef.current) {
      savedScrollTop.current = timelineScrollRef.current.scrollTop
    }
    setSelectedId(id)
  }

  async function handleSettingsChange(e) {
    const days = Number.parseInt(e.target.value, 10)
    setSettingsSaving(true)
    setSettingsMessage('')
    setError('')
    try {
      const updated = await updateBidExperimentSettings({ defaultObservationDays: days })
      setSettings(updated)
      setSettingsMessage('Default saved. Existing experiments keep their original window.')
    } catch (err) {
      setError(err.message || 'Failed to save setting')
    } finally {
      setSettingsSaving(false)
    }
  }

  return (
    <div className="notes-overlay" role="presentation" onClick={onClose}>
      <aside
        className="campaign-detail-drawer keyword-detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Keyword details"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="campaign-detail-drawer__header">
          <div>
            <p className="campaign-detail-drawer__eyebrow">Keyword details</p>
            <h2 className="campaign-detail-drawer__title">{keyword.keyword}</h2>
            <p className="campaign-detail-drawer__subtitle">
              {[keyword.campaign_name, keyword.ad_group_name, keyword.app_name]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="keyword-detail-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'overview'}
            className={`keyword-detail-tabs__tab ${tab === 'overview' ? 'keyword-detail-tabs__tab--active' : ''}`}
            onClick={() => setTab('overview')}
          >
            Overview
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'bid-history'}
            className={`keyword-detail-tabs__tab ${tab === 'bid-history' ? 'keyword-detail-tabs__tab--active' : ''}`}
            onClick={() => setTab('bid-history')}
          >
            Bid History
          </button>
        </div>

        <div className="campaign-detail-drawer__body">
          {error ? <p className="bid-history__error">{error}</p> : null}

          {tab === 'overview' ? (
            <KeywordOverviewPanel keyword={keyword} />
          ) : (
            <div className="bid-history">
              {settingsLoading ? (
                <SettingsSkeleton />
              ) : (
                <section className="bid-history__settings">
                  <label htmlFor="bid-observation-default">
                    Default observation window
                    <InfoTip text={TOOLTIPS.observationWindow} />
                  </label>
                  <select
                    id="bid-observation-default"
                    className="filter-select"
                    value={settings?.defaultObservationDays ?? 7}
                    disabled={!settings || settingsSaving}
                    onChange={handleSettingsChange}
                  >
                    {(settings?.allowedObservationDays || [3, 7, 14, 30]).map((d) => (
                      <option key={d} value={d}>
                        {d} days
                      </option>
                    ))}
                  </select>
                  <p className="bid-history__helper">
                    Used for newly detected bid changes. Existing experiments keep their original
                    window.
                  </p>
                  {settingsSaving ? <p className="bid-history__loading">Saving…</p> : null}
                  {settingsMessage ? (
                    <p className="bid-history__success">{settingsMessage}</p>
                  ) : null}
                </section>
              )}

              <div className="bid-history__layout">
                <div className="bid-history__timeline-pane">
                  <h3 className="bid-history__pane-title">Experiments</h3>
                  {listLoading ? (
                    <TimelineSkeleton />
                  ) : (
                    <div
                      className="bid-history-timeline-scroll"
                      ref={timelineScrollRef}
                      onScroll={(e) => {
                        savedScrollTop.current = e.currentTarget.scrollTop
                      }}
                    >
                      <BidHistoryTimeline
                        experiments={experiments}
                        selectedId={selectedId}
                        onSelect={handleSelectExperiment}
                        onViewOverview={() => setTab('overview')}
                      />
                    </div>
                  )}
                </div>
                <div className="bid-history__detail-pane">
                  <h3 className="bid-history__pane-title">Details</h3>
                  <ExperimentDetail detail={detail} loading={detailLoading || listLoading} />
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
