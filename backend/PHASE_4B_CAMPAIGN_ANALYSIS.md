# Phase 4B: Campaign Screen Migration Analysis

## Summary
**The Campaign screen is ALREADY using the Analytics Service!** ✅

All Campaign endpoints were migrated during Phase 4A as part of the Dashboard migration.

---

## Current Campaign Endpoints

### 1. `/api/compare/period` (Campaign Data Source)
**Purpose**: Provides campaign list with period comparison  
**Status**: ✅ **MIGRATED in Phase 4A**  
**Implementation**: `compareStructured.js` → `getCampaignSummary()` from Analytics Service  
**Used By**: Campaign table, filters, comparisons

**Analytics Service Function**:
- `getCampaignSummary()` - Returns campaign list with current/previous metrics
- Queries `daily_campaign_metrics` table
- Uses Phase 2 standardized formulas
- Supports `appId` filtering
- Supports date range filtering
- Supports comparison mode

### 2. `/api/campaigns/weekly-performance` (Trend Data - NOT Campaign Screen)
**Purpose**: Provides daily/weekly trend data  
**Status**: ✅ **MIGRATED in Phase 4A**  
**Implementation**: `campaignWeekly.js` → `getDailyTrend()` from Analytics Service  
**Used By**: Dashboard trend charts (not Campaign page)

---

## Campaign Page Data Flow

### Frontend (Campaigns.jsx)
```javascript
const {
  periodComparison,      // ← From AppContext
  appFilter,
  periodCompareEnabled,
} = useApp()

const tableRows = useMemo(() => {
  const campaigns = filterByApp(periodComparison?.campaigns ?? [], appFilter)
  return campaigns.map((row) => mapCampaignPerformanceRow(row, showCompare))
}, [periodComparison, appFilter, showCompare])
```

**Data Source**: `periodComparison.campaigns` from AppContext

### AppContext Data Source
```javascript
// AppContext.jsx - loadPeriodComparison()
const comparison = await fetchPeriodCompare({ days, appId })
setPeriodComparison(comparison)
```

**API Call**: `GET /api/compare/period?days=7&appId=...`

### Backend Endpoint
```javascript
// backend/index.js
app.get('/api/compare/period', async (req, res) => {
  const comparison = await getPeriodCompare({ days, startDate, endDate, appId })
  res.json(comparison)
})
```

**Implementation**: `compareStructured.js`

### Analytics Service
```javascript
// compareStructured.js
const campaigns = await getCampaignSummary({ 
  startDate, 
  endDate, 
  days,
  appId, 
  compare: true 
})
```

**Function**: `analyticsService.js` → `getCampaignSummary()`

### SQL Queries
```sql
-- analyticsService.js - getCampaignSummary()
SELECT 
  campaign_name,
  app_id,
  app_name,
  SUM(spend) as spend,
  SUM(impressions) as impressions,
  SUM(taps) as taps,
  SUM(installs_tap_through) as installs_tap_through,
  MAX(daily_budget) as daily_budget
FROM daily_campaign_metrics
WHERE 1=1 
  AND report_date >= $1 
  AND report_date <= $2
  AND app_id = $3  -- ✅ When appId provided
GROUP BY campaign_name, app_id, app_name
ORDER BY spend DESC
```

**Metrics Calculated Using Phase 2 Formulas**:
```javascript
calculateDerivedMetrics({
  spend,
  impressions,
  taps,
  installs_tap_through,  // ← Default install metric
  installs_view_through,
  installs_total
})
// Returns: { spend, installs, cpa, cpt, ttr, cr, ... }
```

---

## Campaign Page Widgets

| Widget | Data Source | Analytics Service | App Filter | Date Filter | Compare Mode |
|--------|-------------|-------------------|------------|-------------|--------------|
| Campaign Table | `periodComparison.campaigns` | `getCampaignSummary()` | ✅ | ✅ | ✅ |
| View Details | Row data (no fetch) | N/A | ✅ | ✅ | ✅ |
| Export CSV | Row data (frontend) | N/A | ✅ | ✅ | ✅ |

---

## Response Shape

### Campaign List Response (from Analytics Service)
```javascript
[
  {
    campaign_name: "Campaign A",
    app_id: "com.example.app",
    app_name: "Example App",
    app_key: "id:com.example.app",
    entity_key: "campaign:com.example.app:Campaign A",
    
    // Current period
    current_spend: 1200.75,
    current_installs: 60,
    current_cpa: 20.01,
    current_taps: 500,
    current_cpt: 2.4,
    current_cr: 12.0,
    current_ttr: 5.0,
    current_impressions: 10000,
    
    // Previous period (if compare=true)
    previous_spend: 1000.50,
    previous_installs: 50,
    previous_cpa: 20.01,
    previous_taps: 480,
    previous_cpt: 2.08,
    previous_cr: 10.4,
    previous_ttr: 4.8,
    previous_impressions: 9500,
    
    // Other fields
    daily_budget: 100.00,
  },
  // ...more campaigns
]
```

---

## Phase 2 Formulas Applied

All campaign metrics use standardized formulas from `analyticsMetrics.js`:

```javascript
// Default install attribution: installs_tap_through
const installsTapThrough = totals.installs_tap_through ?? 0

// CPA = spend / tap-through installs
const cpa = installsTapThrough > 0 ? spend / installsTapThrough : null

// CPT = spend / taps
const cpt = taps > 0 ? spend / taps : null

// TTR = (taps / impressions) * 100
const ttr = impressions > 0 ? (taps / impressions) * 100 : null

// CR = (tap-through installs / taps) * 100
const cr = taps > 0 ? (installsTapThrough / taps) * 100 : null
```

---

## Filters Applied

### App Filter
- **All Apps**: No `appId` parameter → aggregates all apps
- **Specific App**: `appId` parameter → filters `WHERE app_id = $1`
- **Frontend**: Applies additional `filterByApp()` for safety

### Date Filter
- **7D/14D/30D**: `days` parameter → resolves to date range
- **Custom**: `startDate`/`endDate` parameters → direct range
- **SQL**: `WHERE report_date >= $1 AND report_date <= $2`

### Compare Mode
- **ON**: `compare: true` → fetches both current and previous periods
- **OFF**: `compare: false` → fetches current period only
- **Frontend**: Shows/hides previous columns based on `periodCompareEnabled`

---

## Verification

### Campaign Screen Uses Analytics Service ✅

1. ✅ **All campaign data** comes from `getCampaignSummary()`
2. ✅ **Queries structured tables** (`daily_campaign_metrics`)
3. ✅ **Uses Phase 2 formulas** (via `calculateDerivedMetrics()`)
4. ✅ **Uses installs_tap_through** as default install metric
5. ✅ **App filter works** (passes `appId` to Analytics Service)
6. ✅ **Date filter works** (passes date range to Analytics Service)
7. ✅ **Compare mode works** (passes `compare: true` to Analytics Service)

### No JSONB Queries ✅

Campaign page does NOT query `import_rows` JSONB column. All data comes from structured daily tables.

---

## Migration Status

| Component | Status | Notes |
|-----------|--------|-------|
| Campaign Table | ✅ Migrated | Phase 4A |
| View Details | ✅ No API | Just displays row data |
| Export CSV | ✅ Frontend Only | No backend changes needed |
| KPI Values | ✅ Migrated | From `periodComparison.campaigns` |
| Period Comparison | ✅ Migrated | Phase 4A |
| App Filter | ✅ Working | Added in Phase 4A |
| Date Filter | ✅ Working | Already supported |
| Compare Mode | ✅ Working | Already supported |

---

## Remaining Work

**NONE** ✅

All Campaign endpoints and widgets are already using the Analytics Service with:
- ✅ Structured daily tables only
- ✅ Phase 2 standardized formulas
- ✅ installs_tap_through as default metric
- ✅ App filter support
- ✅ Date filter support
- ✅ Compare mode support

---

## Recommendation

**Phase 4B for Campaign screen is already complete.** No additional migration needed.

**Next**: Proceed to Phase 4C for Keywords screen migration (if needed).
