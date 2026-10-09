import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BrandCards from '../components/BrandCards'
import CollapsibleSection from '../components/CollapsibleSection'
import DashboardAlerts from '../components/DashboardAlerts'
import DashboardHeader from '../components/DashboardHeader'
import DataTable from '../components/DataTable'
import InsightDetailsDrawer from '../components/InsightDetailsDrawer'
import InsightsBar from '../components/InsightsBar'
import KpiCard, { formatKpiValue } from '../components/KpiCard'
import OverallSummary from '../components/OverallSummary'
import TrendChart from '../components/TrendChart'
import WeeklyTrendTable from '../components/WeeklyTrendTable'
import WelcomeUpload from '../components/WelcomeUpload'
import { fetchCampaignWeeklyPerformance, fetchInsights } from '../api'
import { useApp } from '../context/AppContext'
import { ALL_APPS, filterByApp } from '../utils/appFilter'
import {
  computeBrandSplit,
  mapInsightsToCards,
  percentChange,
} from '../utils/dashboardHelpers'

export function hasWeeklyPerformanceRange(dateRange) {
  return Boolean(dateRange?.startDate) && Boolean(dateRange?.endDate)
}

export default function Dashboard() {
  const navigate = useNavigate()
  const {
    periodComparison,
    imports,
    importsStatus,
    apps,
    appFilter,
    comparingPeriod,
    periodCompareEnabled,
    filterPreset,
    customStartDate,
    customEndDate,
  } = useApp()

  const [weeklyData, setWeeklyData] = useState(null)
  const [previousWeeklyData, setPreviousWeeklyData] = useState(null)
  const [weeklyLoading, setWeeklyLoading] = useState(false)
  const [selectedInsight, setSelectedInsight] = useState(null)
  const [overallInsight, setOverallInsight] = useState(null)
  const [insightsData, setInsightsData] = useState([])
  const [insightsLoading, setInsightsLoading] = useState(false)
  const weeklyRequestId = useRef(0)

  const overall = periodComparison?.overall
  const showCompare =
    periodCompareEnabled &&
    filterPreset !== 'ALL' &&
    Boolean(periodComparison)

  const selectedApp = useMemo(
    () => (appFilter === ALL_APPS ? null : apps.find((app) => app.app_key === appFilter) ?? null),
    [apps, appFilter],
  )

  /** Prefer CSV App ID when present; always include app_key for stable matching. */
  const chartAppParams = useMemo(() => {
    if (appFilter === ALL_APPS) return {}
    return {
      appKey: appFilter,
      ...(selectedApp?.app_id ? { appId: selectedApp.app_id } : {}),
    }
  }, [appFilter, selectedApp])

  const campaigns = filterByApp(periodComparison?.campaigns ?? [], appFilter)
  const appBreakdown = filterByApp(periodComparison?.app_breakdown ?? [], appFilter)
  const appsList = periodComparison?.apps ?? []
  const topCampaigns = filterByApp(periodComparison?.top_campaigns ?? [], appFilter).slice(0, 8)
  const topKeywords = filterByApp(periodComparison?.top_keywords ?? [], appFilter).slice(0, 8)

  const brandSplit = useMemo(() => computeBrandSplit(campaigns), [campaigns])
  const insights = useMemo(
    () => mapInsightsToCards(insightsData),
    [insightsData],
  )

  const dateRange = useMemo(() => {
    if (periodComparison?.periods) {
      return {
        startDate: periodComparison.periods.current_period.start_date,
        endDate: periodComparison.periods.current_period.end_date,
        previousStartDate: periodComparison.periods.previous_period.start_date,
        previousEndDate: periodComparison.periods.previous_period.end_date,
      }
    }
    if (filterPreset === 'CUSTOM') {
      return {
        startDate: customStartDate,
        endDate: customEndDate,
        previousStartDate: null,
        previousEndDate: null,
      }
    }
    return {
      startDate: null,
      endDate: null,
      previousStartDate: null,
      previousEndDate: null,
    }
  }, [periodComparison, filterPreset, customStartDate, customEndDate])

  const periodLabel = useMemo(() => {
    if (filterPreset === 'CUSTOM' && customStartDate && customEndDate) {
      return `${customStartDate} to ${customEndDate}`
    }
    const daysMap = {
      '7D': 'Last 7 days',
      '14D': 'Last 14 days',
      '30D': 'Last 30 days',
    }
    return daysMap[filterPreset] || 'Last 7 days'
  }, [filterPreset, customStartDate, customEndDate])

  useEffect(() => {
    let cancelled = false
    const requestId = ++weeklyRequestId.current

    async function loadWeekly() {
      if (
        importsStatus !== 'ready' ||
        imports.length === 0 ||
        filterPreset === 'ALL' ||
        !hasWeeklyPerformanceRange(dateRange)
      ) {
        setWeeklyData(null)
        setPreviousWeeklyData(null)
        setWeeklyLoading(false)
        return
      }

      // Drop stale chart points immediately so the UI doesn't linger on All Apps / prior app.
      setWeeklyLoading(true)
      setWeeklyData(null)
      setPreviousWeeklyData(null)

      try {
        const currentPromise = fetchCampaignWeeklyPerformance({
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          ...chartAppParams,
        })

        const previousPromise =
          showCompare && dateRange.previousStartDate && dateRange.previousEndDate
            ? fetchCampaignWeeklyPerformance({
                startDate: dateRange.previousStartDate,
                endDate: dateRange.previousEndDate,
                ...chartAppParams,
              })
            : Promise.resolve(null)

        const [currentResult, previousResult] = await Promise.all([
          currentPromise,
          previousPromise,
        ])

        if (cancelled || requestId !== weeklyRequestId.current) return

        setWeeklyData(currentResult)
        setPreviousWeeklyData(previousResult)
      } catch {
        if (cancelled || requestId !== weeklyRequestId.current) return
        setWeeklyData(null)
        setPreviousWeeklyData(null)
      } finally {
        if (!cancelled && requestId === weeklyRequestId.current) {
          setWeeklyLoading(false)
        }
      }
    }

    loadWeekly()
    return () => {
      cancelled = true
    }
  }, [
    dateRange.startDate,
    dateRange.endDate,
    dateRange.previousStartDate,
    dateRange.previousEndDate,
    chartAppParams,
    filterPreset,
    showCompare,
    importsStatus,
    imports.length,
  ])

  useEffect(() => {
    let cancelled = false

    async function loadInsights() {
      if (
        importsStatus !== 'ready' ||
        imports.length === 0 ||
        filterPreset === 'ALL' ||
        (filterPreset === 'CUSTOM' && (!customStartDate || !customEndDate))
      ) {
        setInsightsData([])
        setInsightsLoading(false)
        return
      }

      if (!showCompare) {
        setInsightsData([])
        setInsightsLoading(false)
        return
      }

      setInsightsLoading(true)

      try {
        const appId = selectedApp?.app_id || null
        const params = filterPreset === 'CUSTOM'
          ? { startDate: customStartDate, endDate: customEndDate, appId }
          : { days: filterPreset === '7D' ? 7 : filterPreset === '14D' ? 14 : filterPreset === '30D' ? 30 : 7, appId }

        const result = await fetchInsights(params)

        if (!cancelled) {
          setOverallInsight(result.overallInsight || null)
          setInsightsData(result.insights || [])
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load insights:', error)
          setInsightsData([])
        }
      } finally {
        if (!cancelled) {
          setInsightsLoading(false)
        }
      }
    }

    loadInsights()
    return () => {
      cancelled = true
    }
  }, [filterPreset, customStartDate, customEndDate, selectedApp, showCompare, importsStatus, imports.length])

  /** Daily points ascending (backend already sorts by date); never weekly rollups for charts. */
  const daysChronological = useMemo(() => {
    const days = weeklyData?.days ?? []
    return [...days].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  }, [weeklyData])

  const previousDaysChronological = useMemo(() => {
    const days = previousWeeklyData?.days ?? []
    return [...days].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  }, [previousWeeklyData])

  const showAppBreakdown = appsList.length > 1

  const needsDate =
    filterPreset === 'ALL' || (filterPreset === 'CUSTOM' && (!customStartDate || !customEndDate))

  const showWelcome = importsStatus === 'ready' && imports.length === 0

  if (importsStatus === 'loading' && imports.length === 0) {
    return (
      <div className="content-shell dashboard-page">
        <p className="analysis-empty">Loading…</p>
      </div>
    )
  }

  if (showWelcome) {
    return (
      <div className="content-shell dashboard-page">
        <WelcomeUpload />
      </div>
    )
  }

  if (comparingPeriod) {
    return (
      <div className="content-shell dashboard-page">
        <DashboardHeader />
        <p className="analysis-empty">Loading dashboard…</p>
      </div>
    )
  }

  if (needsDate) {
    return (
      <div className="content-shell dashboard-page">
        <DashboardHeader />
        <section className="panel-card">
          <p className="muted">
            Select <strong>7D</strong>, <strong>14D</strong>, <strong>30D</strong>, or apply a{' '}
            <strong>Custom</strong> date range to load the dashboard.
          </p>
        </section>
      </div>
    )
  }

  if (!periodComparison) {
    return (
      <div className="content-shell dashboard-page">
        <DashboardHeader />
        <section className="panel-card">
          <p className="muted">No data for this period. Upload CSV reports on History.</p>
        </section>
      </div>
    )
  }

  return (
    <div className="content-shell dashboard-page">
      <DashboardHeader />

      <div className="kpi-row kpi-row--primary">
        <KpiCard
          label="Total Spend"
          value={formatKpiValue(overall?.current_spend, 'currency')}
          previousValue={overall?.previous_spend}
          changePercent={
            showCompare ? percentChange(overall?.current_spend, overall?.previous_spend) : null
          }
          metricKind="cost"
          formatKind="currency"
          showCompare={showCompare}
          icon="spend"
          sparklineDays={daysChronological}
          sparklineMetricKey="spend"
          sparklineLoading={weeklyLoading}
        />
        <KpiCard
          label="Installs"
          value={formatKpiValue(overall?.current_installs, 'integer')}
          previousValue={overall?.previous_installs}
          changePercent={
            showCompare
              ? percentChange(overall?.current_installs, overall?.previous_installs)
              : null
          }
          metricKind="volume"
          formatKind="integer"
          showCompare={showCompare}
          icon="installs"
          sparklineDays={daysChronological}
          sparklineMetricKey="installs"
          sparklineLoading={weeklyLoading}
        />
        <KpiCard
          label="CPA"
          value={formatKpiValue(overall?.current_cpa, 'currency')}
          previousValue={overall?.previous_cpa}
          changePercent={showCompare ? percentChange(overall?.current_cpa, overall?.previous_cpa) : null}
          metricKind="cost"
          formatKind="currency"
          showCompare={showCompare}
          icon="cpa"
          sparklineDays={daysChronological}
          sparklineMetricKey="cpa"
          sparklineLoading={weeklyLoading}
        />
        <KpiCard
          label="CPT"
          value={formatKpiValue(overall?.current_average_cpt, 'currency')}
          previousValue={overall?.previous_average_cpt}
          changePercent={
            showCompare
              ? percentChange(overall?.current_average_cpt, overall?.previous_average_cpt)
              : null
          }
          metricKind="cost"
          formatKind="currency"
          showCompare={showCompare}
          icon="cpt"
          sparklineDays={daysChronological}
          sparklineMetricKey="cpt"
          sparklineLoading={weeklyLoading}
        />
      </div>

      <CollapsibleSection
        id="overall-summary"
        title="Overall Performance Summary"
        defaultExpanded={true}
      >
        <OverallSummary 
          overallInsight={overallInsight}
          period={periodLabel}
          selectedApp={selectedApp}
        />
      </CollapsibleSection>

      <CollapsibleSection
        id="detailed-insights"
        title="Detailed insights"
        count={insights.length > 0 ? insights.length : null}
        defaultExpanded={true}
      >
        <InsightsBar 
          insights={insights} 
          onViewDetails={(card, index) => {
            // Find the full API insight object matching this card
            const fullInsight = insightsData[index]
            if (fullInsight) {
              setSelectedInsight(fullInsight)
            }
          }} 
        />
      </CollapsibleSection>

      <InsightDetailsDrawer
        open={Boolean(selectedInsight)}
        insight={selectedInsight}
        dateRange={dateRange}
        selectedApp={selectedApp}
        onClose={() => setSelectedInsight(null)}
        onViewCampaigns={() => {
          setSelectedInsight(null)
          navigate('/campaigns')
        }}
        onViewKeywords={() => {
          setSelectedInsight(null)
          navigate('/keywords')
        }}
      />

      <CollapsibleSection
        id="targets-alerts"
        title="Targets & alerts"
        defaultExpanded={true}
      >
        <DashboardAlerts />
      </CollapsibleSection>

      <BrandCards brandSplit={brandSplit} />

      <CollapsibleSection
        id="performance-trend"
        title="Performance trend"
        defaultExpanded={true}
      >
        <div className="chart-row">
          <TrendChart
            title="Spend trend"
            days={daysChronological}
            previousDays={previousDaysChronological}
            metricKey="spend"
            formatKind="currency"
            toneKind="cost"
            showCompare={showCompare}
            loading={weeklyLoading}
            yAxisLabel="Spend"
          />
          <TrendChart
            title="Installs trend"
            days={daysChronological}
            previousDays={previousDaysChronological}
            metricKey="installs"
            formatKind="integer"
            toneKind="volume"
            showCompare={showCompare}
            loading={weeklyLoading}
            yAxisLabel="Installs"
          />
        </div>
      </CollapsibleSection>

      <section className="dashboard-tables">
        <section className="dashboard-panel">
          <div className="dashboard-panel__header">
            <h2 className="dashboard-panel__title">Top Campaigns</h2>
          </div>
          <DataTable
            columns={[
              { key: 'campaign_name', label: 'Campaign' },
              {
                key: 'current_spend',
                label: 'Spend',
                align: 'right',
                sortable: true,
                compareKind: 'cost',
                formatKind: 'currency',
              },
              {
                key: 'current_installs',
                label: 'Installs',
                align: 'right',
                sortable: true,
                compareKind: 'volume',
                formatKind: 'integer',
              },
              {
                key: 'current_cpa',
                label: 'CPA',
                align: 'right',
                sortable: true,
                compareKind: 'cost',
                formatKind: 'currency',
              },
            ]}
            rows={topCampaigns}
            emptyMessage="No campaign data"
            defaultSortKey="current_spend"
            showCompare={showCompare}
          />
        </section>

        <section className="dashboard-panel">
          <div className="dashboard-panel__header">
            <h2 className="dashboard-panel__title">Top Keywords</h2>
          </div>
          <DataTable
            columns={[
              { key: 'keyword', label: 'Keyword' },
              {
                key: 'campaign_name',
                label: 'Campaign',
                render: (r) => r.campaign_name || '—',
              },
              {
                key: 'current_spend',
                label: 'Spend',
                align: 'right',
                sortable: true,
                compareKind: 'cost',
                formatKind: 'currency',
              },
              {
                key: 'current_installs',
                label: 'Installs',
                align: 'right',
                sortable: true,
                compareKind: 'volume',
                formatKind: 'integer',
              },
              {
                key: 'current_cpa',
                label: 'CPA',
                align: 'right',
                sortable: true,
                compareKind: 'cost',
                formatKind: 'currency',
              },
            ]}
            rows={topKeywords}
            emptyMessage="No keyword data"
            defaultSortKey="current_spend"
            showCompare={showCompare}
          />
        </section>
      </section>

      <div className="kpi-row kpi-row--secondary">
        <KpiCard
          label="Impressions"
          value={formatKpiValue(overall?.current_impressions, 'integer')}
          previousValue={overall?.previous_impressions}
          changePercent={
            showCompare
              ? percentChange(overall?.current_impressions, overall?.previous_impressions)
              : null
          }
          metricKind="volume"
          formatKind="integer"
          showCompare={showCompare}
          icon="impressions"
          compact
        />
        <KpiCard
          label="TTR"
          value={formatKpiValue(overall?.current_ttr, 'percent')}
          previousValue={overall?.previous_ttr}
          changePercent={showCompare ? percentChange(overall?.current_ttr, overall?.previous_ttr) : null}
          metricKind="volume"
          formatKind="percent"
          showCompare={showCompare}
          icon="percent"
          compact
        />
        <KpiCard
          label="Conversion Rate"
          value={formatKpiValue(overall?.current_cr, 'percent')}
          previousValue={overall?.previous_cr}
          changePercent={showCompare ? percentChange(overall?.current_cr, overall?.previous_cr) : null}
          metricKind="volume"
          formatKind="percent"
          showCompare={showCompare}
          icon="percent"
          compact
        />
        <KpiCard
          label="Total Taps"
          value={formatKpiValue(overall?.current_taps, 'integer')}
          previousValue={overall?.previous_taps}
          changePercent={
            showCompare ? percentChange(overall?.current_taps, overall?.previous_taps) : null
          }
          metricKind="volume"
          formatKind="integer"
          showCompare={showCompare}
          icon="taps"
          compact
        />
      </div>

      <CollapsibleSection
        id="weekly-performance"
        title="Weekly performance"
        defaultExpanded={true}
      >
        {weeklyLoading ? (
          <p className="analysis-empty">Loading trend…</p>
        ) : (
          <WeeklyTrendTable
            weeks={weeklyData?.weeks ?? []}
            emptyMessage="No weekly data for this period"
          />
        )}
      </CollapsibleSection>

      {showAppBreakdown ? (
        <section className="dashboard-panel">
          <div className="dashboard-panel__header">
            <h2 className="dashboard-panel__title">App Breakdown</h2>
          </div>
          <DataTable
            columns={[
              { key: 'app_name', label: 'App' },
              {
                key: 'current_spend',
                label: 'Spend',
                align: 'right',
                sortable: true,
                compareKind: 'cost',
                formatKind: 'currency',
              },
              {
                key: 'current_installs',
                label: 'Installs',
                align: 'right',
                sortable: true,
                compareKind: 'volume',
                formatKind: 'integer',
              },
              {
                key: 'current_cpa',
                label: 'CPA',
                align: 'right',
                sortable: true,
                compareKind: 'cost',
                formatKind: 'currency',
              },
              {
                key: 'current_average_cpt',
                label: 'CPT',
                align: 'right',
                sortable: true,
                compareKind: 'cost',
                formatKind: 'currency',
                previousKey: 'previous_average_cpt',
              },
              {
                key: 'current_ttr',
                label: 'TTR',
                align: 'right',
                sortable: true,
                compareKind: 'volume',
                formatKind: 'percent',
              },
            ]}
            rows={appBreakdown}
            emptyMessage="No app breakdown"
            defaultSortKey="current_spend"
            showCompare={showCompare}
          />
        </section>
      ) : null}
    </div>
  )
}
