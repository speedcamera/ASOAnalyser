import { useMemo, useState } from 'react'
import CampaignPerformanceTable from '../components/CampaignPerformanceTable'
import CampaignsToolbar from '../components/CampaignsToolbar'
import WelcomeUpload from '../components/WelcomeUpload'
import { useApp } from '../context/AppContext'
import { ALL_APPS, filterByApp } from '../utils/appFilter'
import {
  exportCampaignPerformanceCsv,
  mapCampaignPerformanceRow,
} from '../utils/campaignAnalysis'

export default function Campaigns() {
  const {
    periodComparison,
    imports,
    importsStatus,
    appFilter,
    comparingPeriod,
    periodCompareEnabled,
    filterPreset,
    customStartDate,
    customEndDate,
  } = useApp()

  const [segmentOverrides, setSegmentOverrides] = useState({})

  const showCompare =
    periodCompareEnabled &&
    filterPreset !== 'ALL' &&
    Boolean(periodComparison?.campaigns)
  const needsDate =
    filterPreset === 'ALL' || (filterPreset === 'CUSTOM' && (!customStartDate || !customEndDate))

  const tableRows = useMemo(() => {
    const campaigns = filterByApp(periodComparison?.campaigns ?? [], appFilter)
    return campaigns.map((row) => {
      const mapped = mapCampaignPerformanceRow(row, showCompare)
      // Apply local segment override if exists
      if (segmentOverrides[mapped.id]) {
        return {
          ...mapped,
          segment: segmentOverrides[mapped.id],
          segmentKey: segmentOverrides[mapped.id].toLowerCase(),
        }
      }
      return mapped
    })
  }, [periodComparison, appFilter, showCompare, segmentOverrides])

  const handleSegmentUpdate = (rowId, newSegment) => {
    // Update local state to immediately reflect the change
    setSegmentOverrides(prev => ({
      ...prev,
      [rowId]: newSegment,
    }))
  }

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
      <div className="content-shell campaigns-toolbar-shell">
        <CampaignsToolbar
          onExport={() => exportCampaignPerformanceCsv(tableRows, showCompare)}
          exportDisabled={!tableRows.length}
        />
      </div>

      <div className="content-shell">
        <section className="analysis-card campaign-performance-card">
        <div className="analysis-card__header campaign-performance-card__header">
          <div>
            <h1 className="analysis-card__title">Campaign Performance</h1>
            <p className="analysis-card__subtitle">
              {showCompare
                ? 'Current period metrics with change versus the previous equivalent period.'
                : 'Current period metrics only. Turn on period comparison to see deltas.'}
            </p>
          </div>
          <button
            type="button"
            className="btn btn--export"
            onClick={() => exportCampaignPerformanceCsv(tableRows, showCompare)}
            disabled={!tableRows.length}
          >
            Export CSV
          </button>
        </div>

        {comparingPeriod ? (
          <p className="analysis-empty">Loading campaign performance…</p>
        ) : needsDate ? (
          <p className="analysis-empty">
            Select <strong>7D</strong>, <strong>14D</strong>, <strong>30D</strong>, or apply a{' '}
            <strong>Custom</strong> date range to view campaigns.
          </p>
        ) : !periodComparison ? (
          <p className="analysis-empty">
            No campaign data for this period. Upload CSV reports on History.
          </p>
        ) : (
          <CampaignPerformanceTable
            rows={tableRows}
            showCompare={showCompare}
            emptyMessage="No campaigns match the current filters"
            onSegmentUpdate={handleSegmentUpdate}
          />
        )}
        </section>
      </div>
    </>
  )
}
