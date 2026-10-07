export const ALL_APPS = '__all__'

export function matchesAppFilter(row, appFilter) {
  if (!appFilter || appFilter === ALL_APPS) return true
  return row.app_key === appFilter || row.app_name === appFilter
}

export function filterByApp(rows, appFilter) {
  if (!appFilter || appFilter === ALL_APPS) return rows
  return rows.filter((row) => matchesAppFilter(row, appFilter))
}
