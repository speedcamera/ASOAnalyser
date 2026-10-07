export function na(value, formatter) {
  if (value === null || value === undefined) return 'N/A'
  return formatter ? formatter(value) : String(value)
}
