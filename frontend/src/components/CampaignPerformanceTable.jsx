import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CampaignDetailDrawer from './CampaignDetailDrawer'
import EditableSegmentPill from './EditableSegmentPill'
import MetricCompareCell, { formatIntegerMetric } from './MetricCompareCell'
import NotesPanel from './NotesPanel'
import SortableTableHeader from './SortableTableHeader'
import { campaignBudgetPresentation } from '../utils/campaignBudget'
import { bidChangeTone, formatCompareBadge, formatCurrency, formatPercent } from '../utils/format'
import { useTableSort } from '../utils/tableSort'

function formatObservedDate(dateKey) {
  if (!dateKey) return null
  const date = new Date(`${String(dateKey).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return dateKey
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function BudgetCell({ row }) {
  const view = campaignBudgetPresentation(row)

  if (view.kind === 'missing') {
    return (
      <div className="metric-cell">
        <span className="metric-cell__unavailable">Not recorded</span>
      </div>
    )
  }

  if (view.kind === 'changed') {
    const tone = bidChangeTone(view.percent)
    const badge = formatCompareBadge(view.percent)
    return (
      <div className="metric-cell">
        <div className="metric-cell__current">{formatCurrency(view.current)}</div>
        <div className="metric-cell__compare">
          <span className="metric-cell__vs metric-cell__vs--wrap">vs {formatCurrency(view.previous)}</span>
          {badge ? (
            <span className={`metric-cell__badge metric-cell__badge--${tone}`}>{badge}</span>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="metric-cell">
      <div className="metric-cell__current">{formatCurrency(view.current)}</div>
      <div className="metric-cell__compare">
        <span className="metric-cell__vs metric-cell__vs--wrap">{view.detail}</span>
      </div>
      {view.kind === 'outside' && view.lastChange ? (
        <span className="metric-cell__unavailable">
          Last change first observed: {formatObservedDate(view.lastChange)}
        </span>
      ) : null}
    </div>
  )
}

const SORTABLE_COLUMNS = [
  { key: 'spend', label: 'Spend' },
  { key: 'installs', label: 'Installs' },
  { key: 'cpa', label: 'CPA' },
  { key: 'taps', label: 'Taps' },
  { key: 'cr', label: 'CR' },
  { key: 'daily_budget', label: 'Daily Budget', headerClassName: 'campaign-table__budget' },
]

export default function CampaignPerformanceTable({
  rows,
  showCompare,
  emptyMessage = 'No campaign data for this period',
  onSegmentUpdate,
}) {
  const navigate = useNavigate()
  const [notesTarget, setNotesTarget] = useState(null)
  const [detailCampaign, setDetailCampaign] = useState(null)
  const { sortedRows, sort, requestSort } = useTableSort(rows, {
    defaultKey: 'spend',
    defaultDir: 'desc',
  })

  const handleSegmentUpdate = (rowId, newSegment) => {
    if (onSegmentUpdate) {
      onSegmentUpdate(rowId, newSegment)
    }
  }

  function openNotes(row) {
    setNotesTarget({
      entityKey: row.entity_key,
      title: row.campaign_name,
      subtitle: row.app_name ? `App · ${row.app_name}` : null,
    })
  }

  function navigateToKeywords(row) {
    const params = new URLSearchParams()
    params.set('app', row.app_name)
    params.set('campaign', row.campaign_name)
    navigate(`/keywords?${params.toString()}`)
  }

  if (!rows?.length) {
    return <p className="analysis-empty">{emptyMessage}</p>
  }

  return (
    <>
      <div className="analysis-table-wrap campaign-table-wrap">
        <table className="analysis-table campaign-table">
          <thead>
            <tr>
              <th className="campaign-table__name-col">Campaign Name</th>
              <th className="campaign-table__segment-col">Segment</th>
              {SORTABLE_COLUMNS.map((col) => (
                <SortableTableHeader
                  key={col.key}
                  label={col.label}
                  sortKey={col.key}
                  sort={sort}
                  onSort={requestSort}
                  headerClassName={col.headerClassName || ''}
                />
              ))}
              <th className="notes-col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.id}>
                <td className="campaign-table__name">
                  <button
                    type="button"
                    className="campaign-name-link"
                    onClick={() => navigateToKeywords(row)}
                    title={`View keywords for ${row.campaign_name}`}
                  >
                    {row.campaign_name}
                  </button>
                </td>
                <td className="campaign-table__segment">
                  <EditableSegmentPill 
                    campaignId={row.campaign_id}
                    segment={row.segment} 
                    segmentKey={row.segmentKey}
                    onUpdate={(newSegment) => handleSegmentUpdate(row.id, newSegment)}
                  />
                </td>
                <MetricCompareCell
                  current={row.spend}
                  previous={row.previous_spend}
                  percent={row.spend_delta}
                  kind="cost"
                  showCompare={showCompare}
                  formatValue={formatCurrency}
                />
                <MetricCompareCell
                  current={row.installs}
                  previous={row.previous_installs}
                  percent={row.installs_delta}
                  kind="volume"
                  showCompare={showCompare}
                  formatValue={formatIntegerMetric}
                />
                <MetricCompareCell
                  current={row.cpa}
                  previous={row.previous_cpa}
                  percent={row.cpa_delta}
                  kind="cost"
                  showCompare={showCompare}
                  formatValue={formatCurrency}
                />
                <MetricCompareCell
                  current={row.taps}
                  previous={row.previous_taps}
                  percent={row.taps_delta}
                  kind="volume"
                  showCompare={showCompare}
                  formatValue={formatIntegerMetric}
                />
                <MetricCompareCell
                  current={row.cr}
                  previous={row.previous_cr}
                  percent={row.cr_delta}
                  kind="volume"
                  showCompare={showCompare}
                  formatValue={formatPercent}
                />
                <td className="num campaign-table__budget">
                  <BudgetCell row={row} />
                </td>
                <td className="notes-col campaign-table__actions">
                  <button
                    type="button"
                    className="btn btn--ghost notes-trigger"
                    onClick={() => setDetailCampaign(row)}
                  >
                    View Details
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost notes-trigger"
                    onClick={() => openNotes(row)}
                  >
                    Notes
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CampaignDetailDrawer
        open={Boolean(detailCampaign)}
        campaign={detailCampaign}
        onClose={() => setDetailCampaign(null)}
        onOpenNotes={(row) => {
          setDetailCampaign(null)
          openNotes(row)
        }}
      />

      <NotesPanel
        open={Boolean(notesTarget)}
        onClose={() => setNotesTarget(null)}
        entityType="campaign"
        entityKey={notesTarget?.entityKey}
        title={notesTarget?.title}
        subtitle={notesTarget?.subtitle}
      />
    </>
  )
}
