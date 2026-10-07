import { useCallback, useMemo } from 'react'
import MetricCompareCell, { formatIntegerMetric } from './MetricCompareCell'
import SortableTableHeader from './SortableTableHeader'
import { buildWeekCompareHint } from '../utils/periodLabels'
import { formatCurrency, formatPercent } from '../utils/format'
import { percentChange } from '../utils/dashboardHelpers'
import { useTableSort } from '../utils/tableSort'

const SORTABLE_COLUMNS = [
  { key: 'weekStarting', label: 'Week Starting' },
  { key: 'spend', label: 'Spend' },
  { key: 'installs', label: 'Installs' },
  { key: 'cpa', label: 'CPA' },
  { key: 'cpt', label: 'CPT' },
  { key: 'ttr', label: 'TTR' },
]

function weekStartingTimestamp(value) {
  if (value == null || value === '') return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : time
}

function sortWeeksByDateDesc(weeks) {
  return [...(weeks ?? [])].sort((a, b) => {
    const aTime = weekStartingTimestamp(a.weekStarting)
    const bTime = weekStartingTimestamp(b.weekStarting)
    if (aTime == null && bTime == null) return 0
    if (aTime == null) return 1
    if (bTime == null) return -1
    return bTime - aTime
  })
}

function hasServerWeekComparison(week) {
  return Object.prototype.hasOwnProperty.call(week, 'previous_week_starting')
}

function enrichWeekRows(weeks) {
  // Weeks must be newest-first so index+1 is the prior week when the API
  // did not already resolve previous-week metrics.
  const ordered = sortWeeksByDateDesc(weeks)

  return ordered.map((week, index) => {
    const older = ordered[index + 1]
    const fromServer = hasServerWeekComparison(week)
    const previousSpend = fromServer ? (week.previous_spend ?? null) : (older?.spend ?? null)
    const previousInstalls = fromServer ? (week.previous_installs ?? null) : (older?.installs ?? null)
    const previousCpa = fromServer ? (week.previous_cpa ?? null) : (older?.cpa ?? null)
    const previousCpt = fromServer ? (week.previous_cpt ?? null) : (older?.cpt ?? null)
    const previousTtr = fromServer ? (week.previous_ttr ?? null) : (older?.ttr ?? null)
    const previousWeekStarting = fromServer
      ? (week.previous_week_starting ?? null)
      : (older?.weekStarting ?? null)

    return {
      ...week,
      id: week.weekStarting,
      weekStartingTime: weekStartingTimestamp(week.weekStarting),
      previous_spend: previousSpend,
      previous_installs: previousInstalls,
      previous_cpa: previousCpa,
      previous_cpt: previousCpt,
      previous_ttr: previousTtr,
      previous_week_starting: previousWeekStarting,
      compare_hint: buildWeekCompareHint(week.weekStarting, previousWeekStarting),
      spend_delta: percentChange(week.spend, previousSpend),
      installs_delta: percentChange(week.installs, previousInstalls),
      cpa_delta: percentChange(week.cpa, previousCpa),
      cpt_delta: percentChange(week.cpt, previousCpt),
      ttr_delta: percentChange(week.ttr, previousTtr),
    }
  })
}

function getWeekSortValue(row, key) {
  if (key === 'weekStarting') return row.weekStartingTime
  return row[key]
}

export default function WeeklyTrendTable({ weeks, emptyMessage }) {
  const enriched = useMemo(() => enrichWeekRows(weeks), [weeks])
  const getSortValue = useCallback(getWeekSortValue, [])
  const { sortedRows, sort, requestSort } = useTableSort(enriched, {
    defaultKey: 'weekStarting',
    defaultDir: 'desc',
    getSortValue,
  })

  if (!weeks?.length) {
    return <p className="analysis-empty">{emptyMessage}</p>
  }

  return (
    <div className="analysis-table-wrap">
      <table className="analysis-table weekly-trend-table">
        <thead>
          <tr>
            {SORTABLE_COLUMNS.map((col) => (
              <SortableTableHeader
                key={col.key}
                label={col.label}
                sortKey={col.key}
                sort={sort}
                onSort={requestSort}
                className={col.key === 'weekStarting' ? undefined : 'num'}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((week) => {
            const weekHint = week.compare_hint
            return (
              <tr key={week.weekStarting}>
                <td>{week.weekStarting}</td>
                <MetricCompareCell
                  current={week.spend}
                  previous={week.previous_spend}
                  percent={week.spend_delta}
                  kind="cost"
                  showCompare
                  compareHint={weekHint}
                  formatValue={formatCurrency}
                />
                <MetricCompareCell
                  current={week.installs}
                  previous={week.previous_installs}
                  percent={week.installs_delta}
                  kind="volume"
                  showCompare
                  compareHint={weekHint}
                  formatValue={formatIntegerMetric}
                />
                <MetricCompareCell
                  current={week.cpa}
                  previous={week.previous_cpa}
                  percent={week.cpa_delta}
                  kind="cost"
                  showCompare
                  compareHint={weekHint}
                  formatValue={formatCurrency}
                />
                <MetricCompareCell
                  current={week.cpt}
                  previous={week.previous_cpt}
                  percent={week.cpt_delta}
                  kind="cost"
                  showCompare
                  compareHint={weekHint}
                  formatValue={formatCurrency}
                />
                <MetricCompareCell
                  current={week.ttr}
                  previous={week.previous_ttr}
                  percent={week.ttr_delta}
                  kind="volume"
                  showCompare
                  compareHint={weekHint}
                  formatValue={formatPercent}
                />
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
