/**
 * Beta CSV upload limits.
 *
 * Defaults come from the stored Apple Ads imports: the largest is 60,005
 * rows and about 12.7 MB of CSV. 10 MB would reject that file. 16 MB is the
 * smallest power-of-two megabyte cap above it. 100,000 rows stays above the
 * largest stored report. Operators can raise either value inside the ranges
 * checked here. Production does not fall back to the previous 50 MB cap.
 *
 * memoryStorage stays for this beta. A 16 MB file is the most one request
 * holds, and the upload rate limit bounds how often one user can start
 * another. A disk or streaming rewrite is not required for that bound.
 */

const DEFAULT_MAX_CSV_FILE_SIZE_MB = 16
const DEFAULT_MAX_CSV_ROWS = 100000
const DEFAULT_MAX_CSV_UPLOADS_PER_WINDOW = 10
const DEFAULT_MAX_CSV_UPLOAD_WINDOW_MINUTES = 15

const FILE_SIZE_RANGE = { min: 1, max: 32 }
const ROW_RANGE = { min: 1, max: 200000 }
const UPLOAD_RANGE = { min: 1, max: 60 }
const WINDOW_RANGE = { min: 1, max: 1440 }

function readWholeNumber(value, name, range, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback
  }
  const text = String(value).trim()
  if (!/^\d+$/.test(text)) {
    throw new Error(`${name} must be a whole number from ${range.min} to ${range.max}.`)
  }
  const parsed = Number(text)
  if (parsed < range.min || parsed > range.max) {
    throw new Error(`${name} must be a whole number from ${range.min} to ${range.max}.`)
  }
  return parsed
}

function csvUploadLimits(env = process.env) {
  const maxFileSizeMb = readWholeNumber(
    env.MAX_CSV_FILE_SIZE_MB,
    'MAX_CSV_FILE_SIZE_MB',
    FILE_SIZE_RANGE,
    DEFAULT_MAX_CSV_FILE_SIZE_MB,
  )
  const maxRows = readWholeNumber(
    env.MAX_CSV_ROWS,
    'MAX_CSV_ROWS',
    ROW_RANGE,
    DEFAULT_MAX_CSV_ROWS,
  )
  const uploadsPerWindow = readWholeNumber(
    env.MAX_CSV_UPLOADS_PER_WINDOW,
    'MAX_CSV_UPLOADS_PER_WINDOW',
    UPLOAD_RANGE,
    DEFAULT_MAX_CSV_UPLOADS_PER_WINDOW,
  )
  const windowMinutes = readWholeNumber(
    env.MAX_CSV_UPLOAD_WINDOW_MINUTES,
    'MAX_CSV_UPLOAD_WINDOW_MINUTES',
    WINDOW_RANGE,
    DEFAULT_MAX_CSV_UPLOAD_WINDOW_MINUTES,
  )

  return {
    maxFileSizeMb,
    maxBytes: maxFileSizeMb * 1024 * 1024,
    maxRows,
    uploadsPerWindow,
    windowMinutes,
  }
}

function assertCsvUploadConfigured(env = process.env) {
  csvUploadLimits(env)
}

module.exports = {
  DEFAULT_MAX_CSV_FILE_SIZE_MB,
  DEFAULT_MAX_CSV_ROWS,
  DEFAULT_MAX_CSV_UPLOADS_PER_WINDOW,
  DEFAULT_MAX_CSV_UPLOAD_WINDOW_MINUTES,
  assertCsvUploadConfigured,
  csvUploadLimits,
}
