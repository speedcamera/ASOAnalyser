import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  exportAnalysisCsv,
  collectAppOptions,
  collectCampaignOptions,
} from '../utils/keywordAnalysis'

export default function FilterBar({ sourceRows = [], analysisRows = [], onFiltersChange, initialFilters = {} }) {
  const {
    filterPreset,
    setFilterPresetAndRefresh,
    periodCompareEnabled,
    setPeriodCompareEnabled,
  } = useApp()

  const [app, setApp] = useState(initialFilters.app || 'all')
  const [search, setSearch] = useState(initialFilters.search || '')
  const [segment, setSegment] = useState(initialFilters.segment || 'all')
  const [campaign, setCampaign] = useState(initialFilters.campaign || 'all')
  const [minSpend, setMinSpend] = useState(initialFilters.minSpend || '')
  const [minInstalls, setMinInstalls] = useState(initialFilters.minInstalls || '')

  const appOptions = useMemo(() => collectAppOptions(sourceRows), [sourceRows])
  const campaignOptions = useMemo(
    () => collectCampaignOptions(sourceRows, app),
    [sourceRows, app],
  )

  function emit(next) {
    onFiltersChange?.({
      app: next?.app ?? app,
      search: next?.search ?? search,
      segment: next?.segment ?? segment,
      campaign: next?.campaign ?? campaign,
      minSpend: next?.minSpend ?? minSpend,
      minInstalls: next?.minInstalls ?? minInstalls,
    })
  }

  function handleAppChange(nextApp) {
    let nextCampaign = campaign
    if (nextApp !== 'all' && campaign !== 'all') {
      const validCampaigns = collectCampaignOptions(sourceRows, nextApp)
      if (!validCampaigns.includes(campaign)) {
        nextCampaign = 'all'
        setCampaign('all')
      }
    }
    setApp(nextApp)
    emit({ app: nextApp, campaign: nextCampaign })
  }

  // Update state when initialFilters change (e.g., from URL params)
  useEffect(() => {
    if (initialFilters.app && initialFilters.app !== app) {
      setApp(initialFilters.app)
    }
    if (initialFilters.campaign && initialFilters.campaign !== campaign) {
      setCampaign(initialFilters.campaign)
    }
    if (initialFilters.search !== undefined && initialFilters.search !== search) {
      setSearch(initialFilters.search)
    }
    if (initialFilters.segment && initialFilters.segment !== segment) {
      setSegment(initialFilters.segment)
    }
    if (initialFilters.minSpend !== undefined && initialFilters.minSpend !== minSpend) {
      setMinSpend(initialFilters.minSpend)
    }
    if (initialFilters.minInstalls !== undefined && initialFilters.minInstalls !== minInstalls) {
      setMinInstalls(initialFilters.minInstalls)
    }
  }, [initialFilters, app, campaign, search, segment, minSpend, minInstalls])

  // Emit initial filters on mount
  useEffect(() => {
    emit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="filter-card">
      <div className="filter-card__row">
        <div className="filter-field">
          <label className="filter-field__label" htmlFor="filter-app">
            App
          </label>
          <select
            id="filter-app"
            className="filter-select"
            value={app}
            onChange={(e) => handleAppChange(e.target.value)}
          >
            <option value="all">All Apps</option>
            {appOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-field">
          <label className="filter-field__label" htmlFor="filter-campaign">
            Campaign
          </label>
          <select
            id="filter-campaign"
            className="filter-select"
            value={campaign}
            onChange={(e) => {
              setCampaign(e.target.value)
              emit({ campaign: e.target.value })
            }}
          >
            <option value="all">All Campaigns</option>
            {campaignOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-field filter-field--search">
          <label className="filter-field__label" htmlFor="filter-search">
            Search
          </label>
          <input
            id="filter-search"
            type="search"
            className="filter-input"
            placeholder="Search keywords…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              emit({ search: e.target.value })
            }}
          />
        </div>

        <div className="filter-field">
          <label className="filter-field__label" htmlFor="filter-segment">
            Segment
          </label>
          <select
            id="filter-segment"
            className="filter-select"
            value={segment}
            onChange={(e) => {
              setSegment(e.target.value)
              emit({ segment: e.target.value })
            }}
          >
            <option value="all">All segments</option>
            <option value="Brand">Brand</option>
            <option value="Generic">Generic</option>
            <option value="Discovery">Discovery</option>
            <option value="Competitor">Competitor</option>
            <option value="Other">Other</option>
            <option value="Unclassified">Unclassified</option>
          </select>
        </div>

        <div className="filter-field filter-field--compact">
          <label className="filter-field__label" htmlFor="filter-min-spend">
            Min spend
          </label>
          <input
            id="filter-min-spend"
            type="number"
            min="0"
            step="0.01"
            className="filter-input filter-input--compact"
            placeholder="0"
            value={minSpend}
            onChange={(e) => {
              setMinSpend(e.target.value)
              emit({ minSpend: e.target.value })
            }}
          />
        </div>

        <div className="filter-field filter-field--compact">
          <label className="filter-field__label" htmlFor="filter-min-installs">
            Min installs
          </label>
          <input
            id="filter-min-installs"
            type="number"
            min="0"
            step="1"
            className="filter-input filter-input--compact"
            placeholder="0"
            value={minInstalls}
            onChange={(e) => {
              setMinInstalls(e.target.value)
              emit({ minInstalls: e.target.value })
            }}
          />
        </div>

        <div className="filter-field filter-field--actions">
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
          <label className="filter-compare">
            <input
              type="checkbox"
              checked={periodCompareEnabled}
              onChange={(e) => setPeriodCompareEnabled(e.target.checked)}
            />
            Compare
          </label>
        </div>

        <div className="filter-field filter-field--export">
          <span className="filter-field__label">&nbsp;</span>
          <button
            type="button"
            className="btn btn--export"
            onClick={() => exportAnalysisCsv(analysisRows)}
            disabled={!analysisRows.length}
          >
            Export Summary
          </button>
        </div>
      </div>
    </div>
  )
}
