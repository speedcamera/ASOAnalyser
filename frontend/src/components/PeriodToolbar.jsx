import { useApp } from '../context/AppContext'
import { ALL_APPS } from '../utils/appFilter'

export default function PeriodToolbar() {
  const {
    apps,
    appFilter,
    setAppFilter,
    filterPreset,
    setFilterPresetAndRefresh,
    periodCompareEnabled,
    setPeriodCompareEnabled,
  } = useApp()

  return (
    <div className="filter-card filter-card--compact">
      <div className="filter-card__row">
        <div className="filter-field">
          <span className="filter-field__label">Period</span>
          <div className="filter-period">
            {['7D', '14D', '30D', 'ALL'].map((preset) => (
              <button
                key={preset}
                type="button"
                className={`filter-period__btn ${filterPreset === preset ? 'filter-period__btn--active' : ''}`}
                onClick={() => setFilterPresetAndRefresh(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-field">
          <label className="filter-field__label" htmlFor="toolbar-app">
            App
          </label>
          <select
            id="toolbar-app"
            className="filter-select"
            value={appFilter}
            onChange={(e) => setAppFilter(e.target.value)}
          >
            <option value={ALL_APPS}>All apps</option>
            {apps.map((app) => (
              <option key={app.app_key} value={app.app_key}>
                {app.app_name}
              </option>
            ))}
          </select>
        </div>
        <label className="filter-compare">
          <input
            type="checkbox"
            checked={periodCompareEnabled}
            onChange={(e) => setPeriodCompareEnabled(e.target.checked)}
          />
          Compare periods
        </label>
      </div>
    </div>
  )
}
