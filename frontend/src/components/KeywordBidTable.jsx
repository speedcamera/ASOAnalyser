import { Fragment, useState } from 'react'
import KeywordDetailDrawer from './KeywordDetailDrawer'
import MetricCompareCell, { formatIntegerMetric } from './MetricCompareCell'
import NotesPanel from './NotesPanel'
import PeriodCompareHover from './PeriodCompareHover'
import SortableTableHeader from './SortableTableHeader'
import { useApp } from '../context/AppContext'
import { buildPeriodCompareHint } from '../utils/periodLabels'
import { bidChangeTone, formatChange, formatCurrency, formatNumber } from '../utils/format'
import {
  bidChangeUnavailableLabel,
  currentMetricLabel,
  missingBidLabel,
  previousMetricLabel,
} from '../utils/keywordUnavailable'
import { useTableSort } from '../utils/tableSort'

const SORTABLE_COLUMNS = [
  { key: 'spend', label: 'Spend' },
  { key: 'installs', label: 'Installs' },
  { key: 'cpa', label: 'CPA' },
  { key: 'current_bid', label: 'Current Bid' },
  { key: 'previous_bid', label: 'Prev Bid' },
  { key: 'bid_change', label: 'Bid Change' },
  { key: 'bid_change_percent', label: 'Bid %' },
]

function CampaignName({ name }) {
  if (name == null || name === '') return null
  return String(name).split(/(_|-)/).map((part, index) =>
    part === '_' || part === '-' ? (
      <Fragment key={index}>
        {part}
        <wbr />
      </Fragment>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  )
}

function BidMetricCell({ children, showCompare }) {
  const { periodComparison, periodCompareEnabled } = useApp()
  const hint =
    showCompare && periodCompareEnabled
      ? buildPeriodCompareHint(periodComparison?.periods)
      : null

  return (
    <td className="num">
      <PeriodCompareHover
        enabled={Boolean(hint)}
        hint={hint}
        className="period-compare-hover--block"
      >
        {children}
      </PeriodCompareHover>
    </td>
  )
}

function BidValueCell({ value }) {
  const unavailable = missingBidLabel(value)
  return (
    <td className="num">
      <div className="metric-cell">
        <div className="metric-cell__current">
          {unavailable ? (
            <span className="metric-cell__unavailable">{unavailable}</span>
          ) : (
            formatCurrency(value)
          )}
        </div>
      </div>
    </td>
  )
}

export default function KeywordBidTable({ rows, emptyMessage, showCompare = false }) {
  const [notesTarget, setNotesTarget] = useState(null)
  const [detailKeyword, setDetailKeyword] = useState(null)
  const { sortedRows, sort, requestSort } = useTableSort(rows, {
    defaultKey: 'spend',
    defaultDir: 'desc',
  })

  if (!rows?.length) {
    return <p className="analysis-empty">{emptyMessage}</p>
  }

  return (
    <>
      <div className="analysis-table-wrap">
        <table className="analysis-table keyword-table">
          <thead>
            <tr>
              <th>Keyword</th>
              <th>Campaign Name</th>
              <th>Segment</th>
              {SORTABLE_COLUMNS.map((col) => (
                <SortableTableHeader
                  key={col.key}
                  label={col.label}
                  sortKey={col.key}
                  sort={sort}
                  onSort={requestSort}
                />
              ))}
              <th className="notes-col">Notes</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              // Use neutral tone if bid change happened outside selected period
              const bidToneBase = bidChangeTone(row.bid_change_percent)
              const bidTone = !row.bid_changed_in_selected_period && row.bid_change !== null ? 'neutral' : bidToneBase
              const bidChangeUnavailable = bidChangeUnavailableLabel(row.previous_bid, row.bid_change)
              const bidPercentUnavailable = bidChangeUnavailableLabel(
                row.previous_bid,
                row.bid_change_percent,
              )

              return (
                <tr key={row.id}>
                  <td className="analysis-table__keyword">
                    <button
                      type="button"
                      className="keyword-link"
                      onClick={() => setDetailKeyword(row)}
                    >
                      {row.keyword}
                    </button>
                  </td>
                  <td className="analysis-table__campaign">
                    <CampaignName name={row.campaign_name} />
                  </td>
                  <td>
                    <span className="segment-pill">{row.segment}</span>
                  </td>
                  <MetricCompareCell
                    current={row.spend}
                    previous={row.previous_spend}
                    percent={row.spend_delta}
                    kind="cost"
                    showCompare={showCompare}
                    formatValue={formatCurrency}
                    currentUnavailableLabel={currentMetricLabel('spend', {
                      current: row.spend,
                    })}
                    previousUnavailableLabel={previousMetricLabel('spend', {
                      previous: row.previous_spend,
                      previousInstalls: row.previous_installs,
                    })}
                  />
                  <MetricCompareCell
                    current={row.installs}
                    previous={row.previous_installs}
                    percent={row.installs_delta}
                    kind="volume"
                    showCompare={showCompare}
                    formatValue={formatIntegerMetric}
                    currentUnavailableLabel={currentMetricLabel('installs', {
                      current: row.installs,
                      installs: row.installs,
                    })}
                    previousUnavailableLabel={previousMetricLabel('installs', {
                      previous: row.previous_installs,
                      previousInstalls: row.previous_installs,
                    })}
                  />
                  <MetricCompareCell
                    current={row.cpa}
                    previous={row.previous_cpa}
                    percent={row.cpa_delta}
                    kind="cost"
                    showCompare={showCompare}
                    formatValue={formatCurrency}
                    currentUnavailableLabel={currentMetricLabel('cpa', {
                      current: row.cpa,
                      installs: row.installs,
                    })}
                    previousUnavailableLabel={previousMetricLabel('cpa', {
                      previous: row.previous_cpa,
                      previousInstalls: row.previous_installs,
                    })}
                  />
                  <BidValueCell value={row.current_bid} />
                  <BidValueCell value={row.previous_bid} />
                  <BidMetricCell showCompare={showCompare}>
                    {bidChangeUnavailable ? (
                      <span className="analysis-table__unavailable">
                        {bidChangeUnavailable}
                      </span>
                    ) : row.bid_changed_in_selected_period ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                        <span className={`analysis-table__delta analysis-table__delta--${bidTone}`}>
                          {formatChange(row.bid_change, formatCurrency)}
                        </span>
                        {row.last_bid_change_at && (
                          <span className="text-muted" style={{ fontSize: '0.7em', marginTop: '2px' }}>
                            First observed: {new Date(row.last_bid_change_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                        <span className="analysis-table__delta analysis-table__delta--neutral" style={{ fontSize: '0.85em' }}>
                          No bid change detected in selected period
                        </span>
                        {row.last_bid_change_at && (
                          <span className="text-muted" style={{ fontSize: '0.7em', marginTop: '2px' }}>
                            Last change first observed: {new Date(row.last_bid_change_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                        )}
                      </div>
                    )}
                  </BidMetricCell>
                  <BidMetricCell showCompare={showCompare}>
                    {bidPercentUnavailable ? (
                      <span className="analysis-table__unavailable">
                        {bidPercentUnavailable}
                      </span>
                    ) : row.bid_changed_in_selected_period ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                        <span className={`analysis-table__delta analysis-table__delta--${bidTone}`}>
                          {formatNumber(row.bid_change_percent, 1)}%
                        </span>
                      </div>
                    ) : (
                      <span className="analysis-table__delta analysis-table__delta--neutral" style={{ fontSize: '0.85em' }}>
                        —
                      </span>
                    )}
                  </BidMetricCell>
                  <td className="notes-col">
                    <button
                      type="button"
                      className="btn btn--ghost notes-trigger"
                      onClick={() =>
                        setNotesTarget({
                          entityKey: row.entity_key,
                          title: row.keyword,
                          subtitle: [
                            row.campaign_name,
                            row.ad_group_name,
                            row.app_name ? `App · ${row.app_name}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · '),
                        })
                      }
                    >
                      Notes
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <NotesPanel
        open={Boolean(notesTarget)}
        onClose={() => setNotesTarget(null)}
        entityType="keyword"
        entityKey={notesTarget?.entityKey}
        title={notesTarget?.title}
        subtitle={notesTarget?.subtitle}
      />

      <KeywordDetailDrawer
        open={Boolean(detailKeyword)}
        keyword={detailKeyword}
        onClose={() => setDetailKeyword(null)}
      />
    </>
  )
}
