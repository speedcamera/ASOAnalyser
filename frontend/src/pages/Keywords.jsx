import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import FilterBar from '../components/FilterBar'
import KeywordBidTable from '../components/KeywordBidTable'
import WelcomeUpload from '../components/WelcomeUpload'
import { useApp } from '../context/AppContext'
import {
  filterAnalysisRows,
  mapImportKeywordRow,
  mapPeriodKeywordRow,
} from '../utils/keywordAnalysis'

export default function Keywords() {
  const {
    keywordSummary,
    imports,
    importsStatus,
    periodComparison,
    periodCompareEnabled,
    filterPreset,
    comparingPeriod,
  } = useApp()

  const [searchParams] = useSearchParams()
  const [filters, setFilters] = useState({
    app: 'all',
    search: '',
    segment: 'all',
    campaign: 'all',
    minSpend: '',
    minInstalls: '',
  })
  const [urlFiltersApplied, setUrlFiltersApplied] = useState(false)

  const sourceRows = useMemo(() => {
    const usePeriod =
      periodCompareEnabled && filterPreset !== 'ALL' && periodComparison?.keywords

    const raw = usePeriod
      ? periodComparison.keywords
      : keywordSummary?.keywords ?? []

    const mapper = usePeriod ? mapPeriodKeywordRow : mapImportKeywordRow
    return raw.map(mapper)
  }, [
    periodCompareEnabled,
    filterPreset,
    periodComparison,
    keywordSummary,
  ])

  // Apply URL params to filters on mount (only once)
  useEffect(() => {
    if (urlFiltersApplied || sourceRows.length === 0) return

    const urlApp = searchParams.get('app')
    const urlCampaign = searchParams.get('campaign')

    if (urlApp || urlCampaign) {
      setFilters(prev => {
        const next = { ...prev }
        
        // Set app first if provided
        if (urlApp) {
          next.app = urlApp
        }
        
        // Set campaign if provided (only if it's valid for the selected app)
        if (urlCampaign) {
          next.campaign = urlCampaign
        }
        
        return next
      })
      setUrlFiltersApplied(true)
    } else {
      setUrlFiltersApplied(true)
    }
  }, [searchParams, sourceRows, urlFiltersApplied])

  const filteredRows = useMemo(
    () => filterAnalysisRows(sourceRows, filters),
    [sourceRows, filters],
  )

  const emptyMessage =
    comparingPeriod
      ? 'Loading keyword data…'
      : sourceRows.length === 0
        ? 'Upload CSV data on History and enable period comparison (7D / 14D / 30D) for bid analysis.'
        : 'No keywords match the current filters.'

  if (importsStatus === 'loading' && imports.length === 0) {
    return (
      <div className="content-shell">
        <p className="analysis-empty">Loading…</p>
      </div>
    )
  }

  if (importsStatus === 'ready' && imports.length === 0) {
    return (
      <div className="content-shell">
        <WelcomeUpload />
      </div>
    )
  }

  return (
    <>
      <FilterBar
        sourceRows={sourceRows}
        analysisRows={filteredRows}
        onFiltersChange={setFilters}
        initialFilters={filters}
      />
      <div className="content-shell">
        <section className="analysis-card">
          <div className="analysis-card__header">
            <div>
              <h1 className="analysis-card__title">Keyword &amp; Bid Analysis</h1>
              <p className="analysis-card__subtitle">
                {filteredRows.length} keyword{filteredRows.length === 1 ? '' : 's'}
                {periodComparison?.periods
                  ? ` · ${periodComparison.periods.current_period.start_date} → ${periodComparison.periods.current_period.end_date}`
                  : ''}
              </p>
            </div>
          </div>
          <KeywordBidTable
            rows={filteredRows}
            emptyMessage={emptyMessage}
            showCompare={
              periodCompareEnabled &&
              filterPreset !== 'ALL' &&
              Boolean(periodComparison?.keywords)
            }
          />
        </section>
      </div>
    </>
  )
}
