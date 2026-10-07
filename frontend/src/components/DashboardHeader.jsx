import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { ALL_APPS } from '../utils/appFilter'

export default function DashboardHeader() {
  const {
    apps,
    appFilter,
    setAppFilter,
    filterPreset,
    setFilterPresetAndRefresh,
    customStartDate,
    customEndDate,
    applyCustomDateRange,
    periodCompareEnabled,
    setPeriodCompareEnabled,
    periodComparison,
  } = useApp()

  const [rangeStart, setRangeStart] = useState(customStartDate)
  const [rangeEnd, setRangeEnd] = useState(customEndDate)

  const periodLabel = periodComparison?.periods
    ? `${periodComparison.periods.current_period.start_date} → ${periodComparison.periods.current_period.end_date}`
    : null

  return (
    <section className="dashboard-hero">
      <div className="dashboard-hero__left">
        <h1 className="dashboard-hero__title">Performance Dashboard</h1>
        {periodLabel ? <p className="dashboard-hero__period">{periodLabel}</p> : null}
        <p className="dashboard-hero__subtitle">Summary across all selected apps</p>
      </div>

      <div className="dashboard-hero__right">
        <div className="filter-field">
          <label className="filter-field__label" htmlFor="dash-app">
            App
          </label>
          <select
            id="dash-app"
            className="filter-select"
            value={appFilter}
            onChange={(e) => setAppFilter(e.target.value)}
          >
            <option value={ALL_APPS}>All Apps</option>
            {apps.map((app) => (
              <option key={app.app_key} value={app.app_key}>
                {app.app_name}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-field">
          <span className="filter-field__label">Date range</span>
          <div className="filter-period">
            {['7D', '14D', '30D'].map((preset) => (
              <button
                key={preset}
                type="button"
                className={`filter-period__btn ${filterPreset === preset ? 'filter-period__btn--active' : ''}`}
                onClick={() => setFilterPresetAndRefresh(preset)}
              >
                {preset}
              </button>
            ))}
            <button
              type="button"
              className={`filter-period__btn ${filterPreset === 'CUSTOM' ? 'filter-period__btn--active' : ''}`}
              onClick={() => setFilterPresetAndRefresh('CUSTOM')}
            >
              Custom
            </button>
          </div>
        </div>

        {filterPreset === 'CUSTOM' ? (
          <div className="filter-field dashboard-custom-range">
            <input
              type="date"
              className="filter-input"
              value={rangeStart}
              onChange={(e) => setRangeStart(e.target.value)}
            />
            <span className="custom-range__sep">–</span>
            <input
              type="date"
              className="filter-input"
              value={rangeEnd}
              onChange={(e) => setRangeEnd(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => rangeStart && rangeEnd && applyCustomDateRange(rangeStart, rangeEnd)}
            >
              Apply
            </button>
          </div>
        ) : null}

        <div className="filter-field">
          <span className="filter-field__label">Compare</span>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={periodCompareEnabled}
              onChange={(e) => setPeriodCompareEnabled(e.target.checked)}
            />
            <span className="toggle-switch__track" />
            <span className="toggle-switch__text">
              {periodCompareEnabled ? 'On' : 'Off'}
            </span>
          </label>
        </div>
      </div>
    </section>
  )
}
