import { useCallback, useMemo, useState } from 'react'

export function compareSortValues(a, b, direction = 'desc') {
  const aNull = a === null || a === undefined || a === ''
  const bNull = b === null || b === undefined || b === ''
  if (aNull && bNull) return 0
  if (aNull) return 1
  if (bNull) return -1

  let cmp
  if (typeof a === 'string' && typeof b === 'string') {
    cmp = a.localeCompare(b, undefined, { sensitivity: 'base' })
  } else {
    const aNum = Number(a)
    const bNum = Number(b)
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
      cmp = aNum - bNum
    } else {
      cmp = String(a).localeCompare(String(b), undefined, { sensitivity: 'base' })
    }
  }

  return direction === 'asc' ? cmp : -cmp
}

export function sortRows(rows, sortKey, direction, getValue) {
  const accessor = getValue ?? ((row) => row[sortKey])
  return [...rows].sort((a, b) =>
    compareSortValues(accessor(a), accessor(b), direction),
  )
}

export function useTableSort(rows, { defaultKey = 'spend', defaultDir = 'desc', getSortValue } = {}) {
  const [sort, setSort] = useState({ key: defaultKey, dir: defaultDir })

  const sortedRows = useMemo(() => {
    const accessor = getSortValue
      ? (row) => getSortValue(row, sort.key)
      : (row) => row[sort.key]
    return sortRows(rows, sort.key, sort.dir, accessor)
  }, [rows, sort, getSortValue])

  const requestSort = useCallback((key) => {
    setSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
      }
      return { key, dir: 'desc' }
    })
  }, [])

  return { sortedRows, sort, requestSort }
}
