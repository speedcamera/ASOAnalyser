import MetricCompareCell, { formatIntegerMetric } from './MetricCompareCell'
import SortableTableHeader from './SortableTableHeader'
import { formatCurrency, formatPercent } from '../utils/format'
import { percentChange } from '../utils/dashboardHelpers'
import { useTableSort } from '../utils/tableSort'

export default function DataTable({
  columns,
  rows,
  emptyMessage = 'No data',
  defaultSortKey,
  defaultSortDir = 'desc',
  showCompare = false,
}) {
  const resolvedDefaultKey =
    defaultSortKey ??
    columns.find((col) => col.sortable)?.sortKey ??
    columns.find((col) => col.sortable)?.key ??
    'spend'

  const { sortedRows, sort, requestSort } = useTableSort(rows, {
    defaultKey: resolvedDefaultKey,
    defaultDir: defaultSortDir,
    getSortValue: (row, key) => row[key],
  })

  if (!rows?.length) {
    return <p className="table-empty">{emptyMessage}</p>
  }

  return (
    <div className="table-wrap">
      <table className="table analysis-table">
        <thead>
          <tr>
            {columns.map((col) => {
              const sortKey = col.sortKey ?? col.key
              if (col.sortable) {
                return (
                  <SortableTableHeader
                    key={col.key}
                    label={col.label}
                    sortKey={sortKey}
                    sort={sort}
                    onSort={requestSort}
                    className={col.align === 'right' ? 'num' : undefined}
                  />
                )
              }
              return (
                <th
                  key={col.key}
                  className={col.align === 'right' ? 'num' : undefined}
                >
                  {col.label}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, index) => (
            <tr key={row.id ?? row.group_key ?? row.app_key ?? index}>
              {columns.map((col) => {
                if (col.compareKind) {
                  const current = row[col.key]
                  const previousKey = col.previousKey ?? `previous_${col.key.replace(/^current_/, '')}`
                  const previous = row[previousKey]
                  const percent = showCompare
                    ? percentChange(current, previous)
                    : null
                  const formatValue =
                    col.formatKind === 'percent'
                      ? formatPercent
                      : col.formatKind === 'integer'
                        ? formatIntegerMetric
                        : formatCurrency

                  return (
                    <MetricCompareCell
                      key={col.key}
                      current={current}
                      previous={previous}
                      percent={percent}
                      kind={col.compareKind}
                      showCompare={showCompare}
                      formatValue={formatValue}
                    />
                  )
                }

                return (
                  <td
                    key={col.key}
                    className={col.align === 'right' ? 'num' : undefined}
                  >
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
