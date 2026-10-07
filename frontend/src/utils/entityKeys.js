function part(value) {
  if (value === null || value === undefined || value === '') return '-'
  return String(value).trim()
}

/** Prefer adam/app id; fall back to app_key so notes stay stable without an ID. */
export function resolveAppId(row) {
  if (row?.app_id) return String(row.app_id).trim()
  if (row?.app_key) return String(row.app_key).trim()
  return 'unknown_app'
}

/**
 * Campaign entity_key: appId|campaignName
 * Stable across date ranges / period filters.
 */
export function buildCampaignEntityKey({ appId, campaignName }) {
  return `${part(appId)}|${part(campaignName)}`
}

/**
 * Keyword entity_key: appId|campaignName|adGroupName|keyword
 */
export function buildKeywordEntityKey({ appId, campaignName, adGroupName, keyword }) {
  return `${part(appId)}|${part(campaignName)}|${part(adGroupName)}|${part(keyword)}`
}

export const NOTE_TYPES = [
  { value: 'note', label: 'Note' },
  { value: 'optimisation', label: 'Optimisation' },
  { value: 'observation', label: 'Observation' },
  { value: 'issue', label: 'Issue' },
  { value: 'experiment', label: 'Experiment' },
]

export function noteTypeLabel(value) {
  return NOTE_TYPES.find((t) => t.value === value)?.label ?? value
}

export function formatNoteTimestamp(value) {
  if (!value) return 'N/A'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
