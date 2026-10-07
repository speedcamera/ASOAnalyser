# Phase 4A: Dashboard Migration to Analytics Service

## Current Dashboard Endpoints

### 1. `/api/compare/period` (Main Dashboard Data)
**File**: `backend/index.js` line 132
**Implementation**: `compareStructured.js` -> `getPeriodCompare()`

**What it does**:
- Resolves period windows (current + previous for comparison)
- Aggregates overall metrics for both periods
- Builds campaign comparison list
- Builds keyword comparison list
- Builds app breakdown
- Returns top 10 campaigns and top 10 keywords

**Current Implementation Issues**:
- Duplicates SQL queries across multiple helper functions
- Duplicates period resolution logic (also in analyticsService)
- Duplicates metric calculations (also in analyticsMetrics)
- Each sub-function (`buildCampaignComparison`, `buildKeywordComparison`, etc.) runs separate queries

### 2. `/api/campaigns/weekly-performance` (Daily Trend Charts)
**File**: `backend/index.js` line 104
**Implementation**: `campaignWeekly.js` -> `getCampaignWeeklyPerformance()`

**What it does**:
- Returns daily metrics grouped by date
- Calculates CPA, CPT, TTR inline
- Rolls up to weekly totals for backward compatibility
- Supports app and campaign filtering

**Current Implementation Issues**:
- Calculates derived metrics inline (CPA, CPT, TTR) instead of using standardized formulas
- Does not use `calculateDerivedMetrics()` from analyticsMetrics
- Duplicates metric calculation logic

---

## Analytics Service Functions Available

From `backend/analyticsService.js`:

| Function | Purpose | App Filter | Date Filter | Compare Mode |
|----------|---------|------------|-------------|--------------|
| `getDashboardSummary` | Overall metrics | ✅ | ✅ | ✅ |
| `getCampaignSummary` | Campaign list with comparison | ✅ | ✅ | ✅ |
| `getKeywordSummary` | Keyword list with comparison | ✅ | ✅ | ✅ |
| `getDailyTrend` | Daily metrics time series | ✅ | ✅ | ❌ |
| `getPeriodComparison` | Period-over-period comparison | ✅ | ✅ | N/A |
| `getAppBreakdown` | App-level breakdown | ❌ | ✅ | ✅ |
| `getTopCampaigns` | Top N campaigns by spend | ✅ | ✅ | ❌ |
| `getTopKeywords` | Top N keywords by spend | ✅ | ✅ | ❌ |

All functions:
- Query structured daily tables only
- Use standardized metric calculations via `calculateDerivedMetrics()`
- Follow consistent parameter patterns
- Return consistent data shapes

---

## Migration Strategy

### Step 1: Migrate `/api/compare/period`

**Before** (compareStructured.js):
```javascript
async function getPeriodCompare({ days, startDate, endDate }) {
  const periods = await resolvePeriodWindows({ days, startDate, endDate })
  
  const [previousOverall, currentOverall, campaigns, keywords, appBreakdown, apps] = 
    await Promise.all([
      aggregatePeriodMetrics(periods.previous_period.start_date, ...),
      aggregatePeriodMetrics(periods.current_period.start_date, ...),
      buildCampaignComparison(...),
      buildKeywordComparison(...),
      buildAppBreakdown(...),
      getAppsList(),
    ])
  
  return { periods, overall, campaigns, keywords, app_breakdown, apps, ... }
}
```

**After** (use Analytics Service):
```javascript
async function getPeriodCompare({ days, startDate, endDate, appId }) {
  // Use Analytics Service functions
  const summary = await getDashboardSummary({ startDate, endDate, days, appId, compare: true })
  const campaigns = await getCampaignSummary({ startDate, endDate, days, appId, compare: true })
  const keywords = await getKeywordSummary({ startDate, endDate, days, appId, compare: true })
  const appBreakdown = await getAppBreakdown({ startDate, endDate, days })
  
  // Transform to match existing API shape
  return {
    periods: summary.periods,
    overall: transformToOverallShape(summary),
    campaigns,
    keywords,
    app_breakdown: appBreakdown,
    apps: appBreakdown.map(app => ({ ...app })),
    top_campaigns: campaigns.slice(0, 10),
    top_keywords: keywords.slice(0, 10),
  }
}
```

**Benefits**:
- Single source of truth for calculations
- Consistent formulas across all endpoints
- Reduced code duplication
- App filtering works consistently

### Step 2: Migrate `/api/campaigns/weekly-performance`

**Before** (campaignWeekly.js):
```javascript
// Raw SQL with inline calculations
const rows = await pool.query(`SELECT report_date, SUM(spend), ...`)
const days = rows.map(row => ({
  cpa: installs > 0 ? spend / installs : null,  // ❌ Inline calculation
  cpt: taps > 0 ? spend / taps : null,          // ❌ Inline calculation
  ...
}))
```

**After** (use Analytics Service):
```javascript
// Use Analytics Service
const dailyData = await getDailyTrend({ startDate, endDate, appId, campaignName })

// Transform to match existing API shape (with weekly rollups)
return {
  days: dailyData,
  weeks: rollupToWeeks(dailyData),  // For backward compatibility
}
```

**Benefits**:
- Uses standardized metric formulas
- Consistent with other endpoints
- Easier to maintain

---

## API Response Shape Preservation

### `/api/compare/period` Response Shape (MUST PRESERVE)

```json
{
  "periods": {
    "current_period": { "start_date": "2024-01-15", "end_date": "2024-01-21" },
    "previous_period": { "start_date": "2024-01-08", "end_date": "2024-01-14" }
  },
  "overall": {
    "scope": "overall",
    "previous_spend": 1000.50,
    "current_spend": 1200.75,
    "spend_change": 20.0,
    "previous_installs": 50,
    "current_installs": 60,
    "previous_cpa": 20.01,
    "current_cpa": 20.01,
    "cpa_change": 0.0,
    ...
  },
  "campaigns": [
    {
      "campaign_name": "Campaign A",
      "app_id": "com.example.app",
      "app_name": "Example App",
      "previous_spend": 500.00,
      "current_spend": 600.00,
      "spend_change": 20.0,
      ...
    }
  ],
  "keywords": [...],
  "apps": [...],
  "app_breakdown": [...],
  "top_campaigns": [...],
  "top_keywords": [...]
}
```

### `/api/campaigns/weekly-performance` Response Shape (MUST PRESERVE)

```json
{
  "days": [
    {
      "date": "2024-01-15",
      "spend": 100.50,
      "installs": 10,
      "taps": 50,
      "impressions": 1000,
      "cpa": 10.05,
      "cpt": 2.01,
      "ttr": 5.0,
      "installs_tap_through": 10,
      "installs_view_through": 2,
      "installs_total": 12
    }
  ],
  "weeks": [
    {
      "week_start": "2024-01-15",
      "spend": 700.50,
      "installs": 70,
      ...
    }
  ]
}
```

---

## Implementation Checklist

### Pre-Migration
- [x] Identify Dashboard endpoints
- [x] Identify SQL queries and calculations
- [x] List endpoints to migrate
- [x] Verify Analytics Service has all needed functions
- [x] Document API response shapes

### Migration
- [ ] Update `/api/compare/period` endpoint
  - [ ] Replace `getPeriodCompare` implementation
  - [ ] Use Analytics Service functions
  - [ ] Transform response to match existing shape
  - [ ] Add app filter support (`appId` query param)
- [ ] Update `/api/campaigns/weekly-performance` endpoint
  - [ ] Replace `getCampaignWeeklyPerformance` implementation
  - [ ] Use Analytics Service `getDailyTrend`
  - [ ] Preserve weekly rollup for backward compatibility
- [ ] Update Analytics Service if needed
  - [ ] Ensure `resolvePeriods` handles async latest date lookup
  - [ ] Add any missing helper functions

### Testing
- [ ] Test Dashboard with All Apps filter
- [ ] Test Dashboard with specific App filter
- [ ] Test Dashboard with 7D date range
- [ ] Test Dashboard with 30D date range
- [ ] Test Dashboard with Custom date range
- [ ] Test Dashboard with Compare mode ON
- [ ] Test Dashboard with Compare mode OFF
- [ ] Verify KPI cards update with filters
- [ ] Verify Brand vs Non-Brand summary updates
- [ ] Verify Daily trend charts update
- [ ] Verify AI Insights update
- [ ] Verify Weekly table updates

---

## Files to Change

1. **backend/compareStructured.js** - Rewrite to use Analytics Service
2. **backend/campaignWeekly.js** - Rewrite to use Analytics Service
3. **backend/analyticsService.js** - Minor updates if needed (async date lookup)
4. **backend/index.js** - Update query param handling to support `appId`

---

## Files NOT to Change

- frontend/* (no layout changes)
- backend/db.js (no schema changes)
- backend/imports.js (no import logic changes)
- backend/dailyMetrics.js (no UPSERT changes)
- Any Campaign/Keyword page endpoints

---

## Expected Outcome

After migration:
1. All Dashboard data comes from Analytics Service
2. App filter works for all Dashboard widgets
3. Date filter works for all Dashboard widgets
4. Compare mode works for all Dashboard widgets
5. All calculations use Phase 2 standardized formulas
6. No JSONB queries (only structured daily tables)
7. Frontend requires no changes (API shape preserved)
