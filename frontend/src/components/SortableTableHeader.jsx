export default function SortableTableHeader({
  label,
  sortKey,
  sort,
  onSort,
  className = 'num',
  headerClassName = '',
}) {
  const active = sort.key === sortKey

  return (
    <th
      className={`${className} ${headerClassName} analysis-table__sortable${active ? ' analysis-table__sortable--active' : ''}`.trim()}
      onClick={() => onSort(sortKey)}
      scope="col"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span className="analysis-table__sort-label">{label}</span>
      <span className="analysis-table__sort-icon" aria-hidden="true">
        {active ? (sort.dir === 'desc' ? '↓' : '↑') : '↕'}
      </span>
    </th>
  )
}
