const APP_ID_ALIASES = ['app id', 'adam id', 'app adam id']
const APP_NAME_ALIASES = ['app name', 'app']

function normalizeKeyPart(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim().toLowerCase()
}

function findColumnByAliases(headers, aliases) {
  const normalized = headers.map((header) => ({
    original: header,
    norm: header.toLowerCase().trim().replace(/\s+/g, ' '),
  }))

  for (const alias of aliases) {
    const match = normalized.find((header) => header.norm === alias)
    if (match) return match.original
  }

  for (const alias of aliases) {
    const match = normalized.find((header) => header.norm.includes(alias))
    if (match) return match.original
  }

  return null
}

function resolveAppIdentity(record, headers) {
  const appIdColumn = findColumnByAliases(headers, APP_ID_ALIASES)
  const appNameColumn = findColumnByAliases(headers, APP_NAME_ALIASES)

  const rawId = appIdColumn ? record[appIdColumn] : null
  const rawName = appNameColumn ? record[appNameColumn] : null

  const normalizedId = normalizeKeyPart(rawId)
  const normalizedName = normalizeKeyPart(rawName)

  let app_key
  if (normalizedId) {
    app_key = `id:${normalizedId}`
  } else if (normalizedName) {
    app_key = `name:${normalizedName}`
  } else {
    app_key = 'unknown_app'
  }

  const app_name = normalizedName
    ? String(rawName).trim()
    : normalizedId
      ? String(rawId).trim()
      : 'Unknown App'

  return {
    app_key,
    app_id: normalizedId ? String(rawId).trim() : null,
    app_name,
  }
}

function collectAppsFromRows(rows, headers) {
  const apps = new Map()

  for (const row of rows) {
    const app = resolveAppIdentity(row.data, headers)
    if (!apps.has(app.app_key)) {
      apps.set(app.app_key, app)
    }
  }

  return [...apps.values()].sort((a, b) => a.app_name.localeCompare(b.app_name))
}

module.exports = {
  APP_ID_ALIASES,
  APP_NAME_ALIASES,
  normalizeKeyPart,
  findColumnByAliases,
  resolveAppIdentity,
  collectAppsFromRows,
}
