import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  fetchApps,
  fetchImport,
  fetchImportCampaignSummary,
  fetchImportKeywordSummary,
  fetchImportMetricsSummary,
  fetchImportProfile,
  fetchImportRows,
  fetchImports,
  fetchPeriodCompare,
  uploadCsv,
} from '../api'
import { ALL_APPS } from '../utils/appFilter'
import { clientUploadRejection } from '../uploadLimits'
import { customRangeError } from '../analyticsLimits'

const AppContext = createContext(null)

const PRESET_DAYS = { '7D': 7, '14D': 14, '30D': 30 }

export function AppProvider({ children }) {
  const [imports, setImports] = useState([])
  const [apps, setApps] = useState([])
  const [appFilter, setAppFilter] = useState(ALL_APPS)
  const [selectedImportId, setSelectedImportId] = useState(null)
  const [selectedImport, setSelectedImport] = useState(null)
  const [metricsSummary, setMetricsSummary] = useState(null)
  const [campaignSummary, setCampaignSummary] = useState(null)
  const [keywordSummary, setKeywordSummary] = useState(null)
  const [columnProfile, setColumnProfile] = useState(null)
  const [rows, setRows] = useState([])
  const [rowsTotal, setRowsTotal] = useState(0)
  const [periodComparison, setPeriodComparison] = useState(null)
  const [filterPreset, setFilterPreset] = useState('7D')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [periodCompareEnabled, setPeriodCompareEnabled] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [importsStatus, setImportsStatus] = useState('loading')
  const [uploading, setUploading] = useState(false)
  const [comparingPeriod, setComparingPeriod] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('')

  const loadApps = useCallback(async () => {
    try {
      const data = await fetchApps()
      setApps(data)
    } catch {
      setApps([])
    }
  }, [])

  const loadImports = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchImports()
      setImports(data)
      setImportsStatus('ready')
      if (data.length > 0) {
        setSelectedImportId((current) => current ?? data[0].id)
      }
    } catch (err) {
      setError(err.message)
      setImportsStatus('error')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadPeriodComparison = useCallback(async () => {
    if (filterPreset === 'ALL') {
      setPeriodComparison(null)
      return
    }

    if (filterPreset === 'CUSTOM' && (!customStartDate || !customEndDate)) {
      setPeriodComparison(null)
      return
    }

    setComparingPeriod(true)
    try {
      // Get selected app's ID for filtering
      const selectedApp = appFilter === ALL_APPS 
        ? null 
        : apps.find(app => app.app_key === appFilter)
      const appId = selectedApp?.app_id || null

      const days = PRESET_DAYS[filterPreset]
      const comparison = days
        ? await fetchPeriodCompare({ days, appId })
        : await fetchPeriodCompare({
            startDate: customStartDate,
            endDate: customEndDate,
            appId,
          })
      setPeriodComparison(comparison)
    } catch (err) {
      setPeriodComparison(null)
      setError(err.message)
    } finally {
      setComparingPeriod(false)
    }
  }, [periodCompareEnabled, filterPreset, customStartDate, customEndDate, appFilter, apps])

  const loadImportDetails = useCallback(async (importId) => {
    if (!importId) return

    setLoading(true)
    setError('')
    try {
      const [importRecord, metrics, campaigns, keywords, profile, rowsData] =
        await Promise.all([
          fetchImport(importId),
          fetchImportMetricsSummary(importId),
          fetchImportCampaignSummary(importId),
          fetchImportKeywordSummary(importId),
          fetchImportProfile(importId),
          fetchImportRows(importId, { limit: 100, offset: 0 }),
        ])

      setSelectedImport(importRecord)
      setMetricsSummary(metrics)
      setCampaignSummary(campaigns)
      setKeywordSummary(keywords)
      setColumnProfile(profile)
      setRows(rowsData?.rows ?? [])
      setRowsTotal(rowsData?.total ?? 0)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const selectImport = useCallback((importId) => {
    setSelectedImportId(importId)
  }, [])

  const handleUpload = useCallback(
    async (file) => {
      if (!file) return

      const rejection = clientUploadRejection(file)
      if (rejection) {
        setUploadMessage('')
        setError(rejection)
        return
      }

      setUploading(true)
      setError('')
      setUploadMessage('')
      try {
        const result = await uploadCsv(file)
        setUploadMessage(
          `Uploaded ${result.uploadedRows} rows: ${result.insertedRows} new, ${result.updatedRows} updated (${result.totalStoredRows} stored).`,
        )
        await loadImports()
        await loadApps()
        setSelectedImportId(result.id)
      } catch (err) {
        setError(err.message)
      } finally {
        setUploading(false)
      }
    },
    [loadImports, loadApps],
  )

  const setFilterPresetAndRefresh = useCallback((preset) => {
    setFilterPreset(preset)
  }, [])

  const applyCustomDateRange = useCallback((start, end) => {
    const problem = customRangeError(start, end)
    if (problem) {
      setError(problem)
      return
    }
    setError('')
    setCustomStartDate(start)
    setCustomEndDate(end)
    setFilterPreset('CUSTOM')
  }, [])

  const refreshGlobalFilters = useCallback(() => {
    loadPeriodComparison()
  }, [loadPeriodComparison])

  useEffect(() => {
    loadImports()
    loadApps()
  }, [loadImports, loadApps])

  useEffect(() => {
    if (selectedImportId) {
      loadImportDetails(selectedImportId)
    }
  }, [selectedImportId, loadImportDetails])

  useEffect(() => {
    if (importsStatus !== 'ready') return
    if (imports.length === 0) {
      setPeriodComparison(null)
      return
    }
    loadPeriodComparison()
  }, [importsStatus, imports.length, loadPeriodComparison])

  const appFilterOptions = useMemo(() => {
    const fromPeriod = periodComparison?.apps ?? []
    const fromImport = [
      ...(metricsSummary?.apps ?? []),
      ...(campaignSummary?.apps ?? []),
      ...(keywordSummary?.apps ?? []),
    ]
    const merged = new Map()
    for (const app of [...apps, ...fromPeriod, ...fromImport]) {
      merged.set(app.app_key, app)
    }
    return [...merged.values()].sort((a, b) => a.app_name.localeCompare(b.app_name))
  }, [apps, periodComparison, metricsSummary, campaignSummary, keywordSummary])

  const value = useMemo(
    () => ({
      imports,
      importsStatus,
      apps: appFilterOptions,
      appFilter,
      setAppFilter,
      selectedImportId,
      selectedImport,
      metricsSummary,
      campaignSummary,
      keywordSummary,
      columnProfile,
      rows,
      rowsTotal,
      periodComparison,
      filterPreset,
      customStartDate,
      customEndDate,
      periodCompareEnabled,
      error,
      loading,
      uploading,
      comparingPeriod,
      uploadMessage,
      setCustomStartDate,
      setCustomEndDate,
      setPeriodCompareEnabled,
      setFilterPresetAndRefresh,
      applyCustomDateRange,
      selectImport,
      handleUpload,
      refreshGlobalFilters,
      loadApps,
      setError,
    }),
    [
      imports,
      importsStatus,
      appFilterOptions,
      appFilter,
      selectedImportId,
      selectedImport,
      metricsSummary,
      campaignSummary,
      keywordSummary,
      columnProfile,
      rows,
      rowsTotal,
      periodComparison,
      filterPreset,
      customStartDate,
      customEndDate,
      periodCompareEnabled,
      error,
      loading,
      uploading,
      comparingPeriod,
      uploadMessage,
      setFilterPresetAndRefresh,
      applyCustomDateRange,
      selectImport,
      handleUpload,
      refreshGlobalFilters,
      loadApps,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
