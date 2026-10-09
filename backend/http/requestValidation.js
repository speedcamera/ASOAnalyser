/**
 * Small parsers for user-controlled API input.
 *
 * Invalid values throw httpError(400) before a route starts database work.
 * A well-formed resource id that belongs to another organisation is still
 * a 404 from the tenant query, not a 400.
 */

const { httpError } = require('./clientError')

const MAX_ANALYTICS_DAYS = 90
const MAX_ORGANISATION_NAME = 200
const MAX_NOTE_TEXT = 2000
const MAX_ENTITY_KEY = 500
const MAX_FILTER_TEXT = 300
const MAX_GOAL_THRESHOLD = 1_000_000_000_000
const MAX_PAGE_OFFSET = 100000
const MAX_SERIAL_ID = 2147483647

function invalid(message) {
  throw httpError(400, message)
}

function inclusiveCalendarDays(startDate, endDate) {
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  return Math.round((end - start) / 86400000) + 1
}

function parseCalendarDate(value, name) {
  if (value === undefined || value === null || value === '') return null
  const text = String(value).trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) invalid(`${name} must be a calendar date in YYYY-MM-DD format`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    invalid(`${name} must be a valid calendar date`)
  }
  return text
}

function parseAnalyticsDays(value) {
  if (value === undefined || value === null || value === '') return null
  const text = String(value).trim()
  if (!/^[1-9]\d*$/.test(text)) {
    invalid(`days must be a whole number from 1 to ${MAX_ANALYTICS_DAYS}`)
  }
  const days = Number(text)
  if (days > MAX_ANALYTICS_DAYS) {
    invalid(`days must be a whole number from 1 to ${MAX_ANALYTICS_DAYS}`)
  }
  return days
}

function readAnalyticsQuery(query = {}, { requireChoice = false, requireDates = false } = {}) {
  const days = parseAnalyticsDays(query.days)
  const startDate = parseCalendarDate(query.startDate, 'startDate')
  const endDate = parseCalendarDate(query.endDate, 'endDate')

  if ((startDate && !endDate) || (!startDate && endDate)) {
    invalid('Provide both startDate and endDate')
  }
  if (startDate && endDate && startDate > endDate) {
    invalid('startDate must be on or before endDate')
  }
  if (startDate && endDate && inclusiveCalendarDays(startDate, endDate) > MAX_ANALYTICS_DAYS) {
    invalid(`Date range must be ${MAX_ANALYTICS_DAYS} days or fewer`)
  }
  if (requireDates && (!startDate || !endDate)) {
    invalid('startDate and endDate are required')
  }
  if (requireChoice && days == null && (!startDate || !endDate)) {
    invalid('Provide days or both startDate and endDate')
  }

  return { days, startDate, endDate }
}

function parseResourceId(value, label) {
  const text = String(value ?? '').trim()
  if (!/^[1-9]\d*$/.test(text)) invalid(`Invalid ${label}`)
  const id = Number(text)
  if (!Number.isSafeInteger(id) || id > MAX_SERIAL_ID) invalid(`Invalid ${label}`)
  return id
}

function parseBoundedInteger(value, { name, min, max, fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    if (fallback === undefined) invalid(`${name} is required`)
    return fallback
  }

  let parsed
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      invalid(`${name} must be a whole number from ${min} to ${max}`)
    }
    parsed = value
  } else {
    const text = String(value).trim()
    if (!/^-?\d+$/.test(text)) {
      invalid(`${name} must be a whole number from ${min} to ${max}`)
    }
    parsed = Number(text)
  }

  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    invalid(`${name} must be a whole number from ${min} to ${max}`)
  }
  return parsed
}

function readFilterText(value, name, max = MAX_FILTER_TEXT, { blank = 'omit' } = {}) {
  if (value === undefined || value === null) return null
  const text = String(value)
  if (text.length > max) invalid(`${name} is too long`)
  if (text === '' && blank === 'omit') return null
  return text
}

function parseOrganisationName(value) {
  // organisations.organisation_name is TEXT NOT NULL and has no length constraint.
  if (typeof value !== 'string') invalid('Organisation name must be text')
  const name = value.trim()
  if (!name) invalid('Organisation name is required')
  if (name.length > MAX_ORGANISATION_NAME) invalid('Organisation name is too long')
  return name
}

function parseGoalThreshold(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_GOAL_THRESHOLD) {
    invalid('Threshold must be a non-negative number')
  }
  return value
}

module.exports = {
  MAX_ANALYTICS_DAYS,
  MAX_ORGANISATION_NAME,
  MAX_ENTITY_KEY,
  MAX_FILTER_TEXT,
  MAX_GOAL_THRESHOLD,
  MAX_NOTE_TEXT,
  MAX_PAGE_OFFSET,
  inclusiveCalendarDays,
  parseAnalyticsDays,
  parseBoundedInteger,
  parseCalendarDate,
  parseGoalThreshold,
  parseOrganisationName,
  parseResourceId,
  readAnalyticsQuery,
  readFilterText,
}
