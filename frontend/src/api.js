import { apiFetch, readApiJson } from './auth/apiClient'

export async function fetchAuthContext() {
  const res = await apiFetch('/api/auth/context')
  return readApiJson(res, 'Organisation could not be loaded')
}

export async function updateOrganisationName(name) {
  const res = await apiFetch('/api/auth/organisation', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return readApiJson(res, 'Organisation name could not be saved')
}

function request(path, options, fallback) {
  return apiFetch(path, options).then((res) => readApiJson(res, fallback))
}

export async function fetchImports() {
  return request('/api/imports', {}, 'Imports could not be loaded')
}

export async function fetchApps() {
  return request('/api/apps', {}, 'Apps could not be loaded')
}

export async function fetchImport(importId) {
  return request(`/api/imports/${importId}`, {}, 'This import could not be loaded')
}

export async function fetchImportProfile(importId) {
  return request(`/api/imports/${importId}/profile`, {}, 'This import profile could not be loaded')
}

export async function fetchImportMetricsSummary(importId) {
  return request(`/api/imports/${importId}/metrics-summary`, {}, 'This import summary could not be loaded')
}

export async function fetchImportCampaignSummary(importId) {
  return request(`/api/imports/${importId}/campaign-summary`, {}, 'This import summary could not be loaded')
}

export async function fetchImportKeywordSummary(importId) {
  return request(`/api/imports/${importId}/keyword-summary`, {}, 'This import summary could not be loaded')
}

export async function fetchImportRows(importId, { limit = 100, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  return request(`/api/imports/${importId}/rows?${params}`, {}, 'This import could not be loaded')
}

export async function fetchCampaignBudgetHistory({ appId, campaignName } = {}) {
  const params = new URLSearchParams()
  if (appId) params.set('appId', String(appId))
  if (campaignName) params.set('campaignName', campaignName)
  const res = await apiFetch(`/api/campaigns/budget-history?${params}`)
  return readApiJson(res, 'Budget history could not be loaded')
}

export async function fetchCampaignWeeklyPerformance({
  campaignName,
  startDate,
  endDate,
  appKey,
  appId,
} = {}) {
  const params = new URLSearchParams()
  if (campaignName) params.set('campaignName', campaignName)
  if (startDate) params.set('startDate', startDate)
  if (endDate) params.set('endDate', endDate)
  if (appId) params.set('appId', String(appId))
  if (appKey) params.set('appKey', appKey)

  const res = await apiFetch(`/api/campaigns/weekly-performance?${params}`)
  return readApiJson(res, 'Failed to load weekly performance')
}

export async function fetchPeriodCompare({ days, startDate, endDate, appId } = {}) {
  const params = new URLSearchParams()
  if (days) params.set('days', String(days))
  if (startDate) params.set('startDate', startDate)
  if (endDate) params.set('endDate', endDate)
  if (appId) params.set('appId', String(appId))

  const res = await apiFetch(`/api/compare/period?${params}`)
  return readApiJson(res, 'Failed to load period comparison')
}

export async function uploadCsv(file) {
  const formData = new FormData()
  formData.append('file', file)

  return request('/api/imports', { method: 'POST', body: formData }, 'Upload failed')
}

export async function fetchAnnotations({ entityType, entityKey }) {
  const params = new URLSearchParams({ entityType, entityKey })
  const res = await apiFetch(`/api/annotations?${params}`)
  return readApiJson(res, 'Failed to load notes')
}

export async function createAnnotation(body) {
  const res = await apiFetch('/api/annotations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readApiJson(res, 'Failed to create note')
}

export async function updateAnnotation(id, body) {
  const res = await apiFetch(`/api/annotations/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readApiJson(res, 'Failed to update note')
}

export async function deleteAnnotation(id) {
  const res = await apiFetch(`/api/annotations/${id}`, { method: 'DELETE' })
  return readApiJson(res, 'Failed to delete note')
}

export async function fetchGoals({ entityType, entityKey } = {}) {
  const params = new URLSearchParams()
  if (entityType) params.set('entityType', entityType)
  if (entityKey) params.set('entityKey', entityKey)
  
  const res = await apiFetch(`/api/goals?${params}`)
  return readApiJson(res, 'Failed to load goals')
}

export async function createGoal(body) {
  const res = await apiFetch('/api/goals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readApiJson(res, 'Failed to create goal')
}

export async function updateGoal(id, body) {
  const res = await apiFetch(`/api/goals/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readApiJson(res, 'Failed to update goal')
}

export async function deleteGoal(id) {
  const res = await apiFetch(`/api/goals/${id}`, { method: 'DELETE' })
  return readApiJson(res, 'Failed to delete goal')
}

export async function updateCampaignSegment(campaignId, segment) {
  const res = await apiFetch(`/api/campaigns/${campaignId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segment }),
  })
  return readApiJson(res, 'Failed to update campaign segment')
}

export async function fetchAlerts({ entityType, entityKey } = {}) {
  const params = new URLSearchParams()
  if (entityType) params.set('entityType', entityType)
  if (entityKey) params.set('entityKey', entityKey)
  
  const res = await apiFetch(`/api/alerts?${params}`)
  return readApiJson(res, 'Failed to load alerts')
}

export async function fetchInsights({ days, startDate, endDate, appId } = {}) {
  const params = new URLSearchParams()
  if (days) params.set('days', String(days))
  if (startDate) params.set('startDate', startDate)
  if (endDate) params.set('endDate', endDate)
  if (appId) params.set('appId', String(appId))
  
  const res = await apiFetch(`/api/insights?${params}`)
  return readApiJson(res, 'Failed to load insights')
}

export async function fetchBidExperiments(filters = {}) {
  const params = new URLSearchParams()
  if (filters.appId) params.set('appId', String(filters.appId))
  if (filters.campaignName) params.set('campaignName', filters.campaignName)
  if (filters.adGroupName != null) params.set('adGroupName', filters.adGroupName)
  if (filters.keywordText) params.set('keywordText', filters.keywordText)
  if (filters.keywordIdentityKey) params.set('keywordIdentityKey', filters.keywordIdentityKey)
  if (filters.status) params.set('status', filters.status)
  if (filters.limit) params.set('limit', String(filters.limit))
  if (filters.offset) params.set('offset', String(filters.offset))

  const res = await apiFetch(`/api/bid-experiments?${params}`)
  return readApiJson(res, 'Failed to load bid experiments')
}

export async function fetchBidExperiment(id) {
  const res = await apiFetch(`/api/bid-experiments/${id}`)
  return readApiJson(res, 'Failed to load bid experiment')
}

export async function fetchBidExperimentSettings() {
  const res = await apiFetch('/api/bid-experiment-settings')
  return readApiJson(res, 'Failed to load bid experiment settings')
}

export async function updateBidExperimentSettings({ defaultObservationDays }) {
  const res = await apiFetch('/api/bid-experiment-settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultObservationDays }),
  })
  return readApiJson(res, 'Failed to update bid experiment settings')
}
