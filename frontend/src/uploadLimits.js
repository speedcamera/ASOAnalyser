/** Documented beta maximum. The backend limit is authoritative. */
export const MAX_CSV_FILE_SIZE_MB = 16
export const MAX_CSV_FILE_SIZE_BYTES = MAX_CSV_FILE_SIZE_MB * 1024 * 1024
export const MAX_CSV_ROWS = 100000

export function clientUploadRejection(file) {
  if (!file) return 'No file uploaded'
  const name = typeof file.name === 'string' ? file.name : ''
  if (!name.toLowerCase().endsWith('.csv')) return 'Only CSV files are allowed'
  if (typeof file.size === 'number' && file.size > MAX_CSV_FILE_SIZE_BYTES) {
    return 'CSV file exceeds the maximum allowed size'
  }
  return ''
}
