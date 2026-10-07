# Dashboard Installs App Filter Fix - Summary

## Root Cause
**The period comparison API call was not including the app filter parameter.**

The Dashboard KPI cards (Spend, Installs, CPA, CPT, etc.) all come from the `periodComparison` data in AppContext. This data was being fetched WITHOUT the `appId` parameter, so it always returned aggregated data for all apps regardless of the selected filter.

Charts worked correctly because they used a separate API call (`fetchCampaignWeeklyPerformance`) that DID include the `appId` parameter.

---

## Files Changed

### 1. frontend/src/api.js (Line 75)

**OLD**:
```javascript
export async function fetchPeriodCompare({ days, startDate, endDate } = {}) {
  const params = new URLSearchParams()
  if (days) params.set('days', String(days))
  if (startDate) params.set('startDate', startDate)
  if (endDate) params.set('endDate', endDate)
  // ❌ No appId support

  const res = await fetch(`/api/compare/period?${params}`)
  return res.json()
}
```

**NEW**:
```javascript
export async function fetchPeriodCompare({ days, startDate, endDate, appId } = {}) {
  const params = new URLSearchParams()
  if (days) params.set('days', String(days))
  if (startDate) params.set('startDate', startDate)
  if (endDate) params.set('endDate', endDate)
  if (appId) params.set('appId', String(appId))  // ✅ Added appId

  const res = await fetch(`/api/compare/period?${params}`)
  return res.json()
}
```

### 2. frontend/src/context/AppContext.jsx (Line 68-95)

**OLD**:
```javascript
const loadPeriodComparison = useCallback(async () => {
  // ...
  const comparison = days
    ? await fetchPeriodCompare({ days })              // ❌ No appId
    : await fetchPeriodCompare({
        startDate: customStartDate,
        endDate: customEndDate,                       // ❌ No appId
      })
  setPeriodComparison(comparison)
}, [periodCompareEnabled, filterPreset, customStartDate, customEndDate])
//  ❌ Missing appFilter in dependencies
```

**NEW**:
```javascript
const loadPeriodComparison = useCallback(async () => {
  // ...
  
  // Get selected app's ID for filtering
  const selectedApp = appFilter === ALL_APPS 
    ? null 
    : apps.find(app => app.app_key === appFilter)
  const appId = selectedApp?.app_id || null        // ✅ Resolve app ID

  const comparison = days
    ? await fetchPeriodCompare({ days, appId })              // ✅ Pass appId
    : await fetchPeriodCompare({
        startDate: customStartDate,
        endDate: customEndDate,
        appId,                                               // ✅ Pass appId
      })
  setPeriodComparison(comparison)
}, [periodCompareEnabled, filterPreset, customStartDate, customEndDate, appFilter, apps])
//  ✅ Added appFilter and apps to dependencies
```

---

## Query Parameter Used

### Before Fix
```
GET /api/compare/period?days=7
(Always returns ALL apps data)
```

### After Fix - All Apps
```
GET /api/compare/period?days=7
(No appId parameter → returns ALL apps data)
```

### After Fix - Specific App
```
GET /api/compare/period?days=7&appId=com.example.app
(Includes appId → returns ONLY that app's data)
```

---

## SQL Filter Logic Applied

The `appId` parameter flows through:

1. **API Endpoint** (`backend/index.js` line 136):
   ```javascript
   const appId = req.query.appId || null
   const comparison = await getPeriodCompare({ days, startDate, endDate, appId })
   ```

2. **compareStructured.js** (line 44):
   ```javascript
   getDashboardSummary({ startDate, endDate, days, appId, compare: true })
   ```

3. **analyticsService.js** `getDashboardSummary()` (line 122):
   ```javascript
   const { where, params } = buildFilters({ startDate, endDate, appId })
   ```

4. **SQL WHERE Clause** (line 133):
   ```sql
   SELECT 
     SUM(spend) as spend,
     SUM(impressions) as impressions,
     SUM(taps) as taps,
     SUM(installs_tap_through) as installs_tap_through,
     SUM(installs_view_through) as installs_view_through,
     SUM(installs_total) as installs_total
   FROM daily_campaign_metrics
   WHERE 1=1 AND app_id = $1  -- ✅ Filters by app_id when appId provided
   ```

**When appId is null**: No app_id filter → aggregates ALL apps  
**When appId is provided**: Filters `WHERE app_id = $1` → aggregates ONLY that app

---

## Testing Steps

### 1. Test All Apps
1. Open Dashboard
2. Select **"All Apps"** from filter dropdown
3. Record the Installs value (e.g., 1,234)

### 2. Test App A
1. Select **App A** from filter dropdown
2. Verify Installs **changes** (e.g., 567)
3. Verify it's different from "All Apps" value
4. Verify other KPIs also change (Spend, CPA, CPT, etc.)

### 3. Test App B
1. Select **App B** from filter dropdown
2. Verify Installs **changes again** (e.g., 667)
3. Verify it's different from App A value
4. Verify other KPIs also change

### 4. Return to All Apps
1. Select **"All Apps"** again
2. Verify Installs returns to original combined value (1,234)
3. Verify all KPIs return to combined values

### 5. Verify API Calls (Browser DevTools)
1. Open Network tab
2. Change app filter
3. See request: `GET /api/compare/period?days=7&appId=com.example.app`
4. Verify `appId` parameter is present when specific app selected
5. Verify `appId` parameter is absent when "All Apps" selected

---

## What Now Works

✅ **All KPI Cards respond to App filter**:
- Total Spend
- Installs
- CPA (Cost Per Install)
- CPT (Cost Per Tap)
- Impressions
- TTR (Tap-Through Rate)
- CR (Conversion Rate)
- Taps

✅ **Brand vs Non-Brand summary** responds to App filter

✅ **Top Campaigns/Keywords tables** respond to App filter

✅ **Charts already worked** (they were using separate API call with appId)

✅ **useEffect dependency** includes appFilter, so data reloads when filter changes

---

## Metrics Calculation

All metrics use **installs_tap_through** as the default install attribution:

```sql
SELECT 
  SUM(installs_tap_through) as installs_tap_through
FROM daily_campaign_metrics
WHERE 1=1 AND app_id = $1  -- When app selected
```

**CPA Calculation**: `spend / installs_tap_through`  
**CR Calculation**: `(installs_tap_through / taps) * 100`

When **All Apps** selected: No app_id filter → sums across all apps  
When **Specific App** selected: Filters by app_id → sums only that app

---

## Summary

**Root Cause**: Period comparison API call missing `appId` parameter  
**Files Changed**: 2 frontend files  
**Backend Changes**: None (already supported appId)  
**Query Parameter**: `appId` now passed when app selected  
**SQL Filter**: `WHERE app_id = $1` applied when appId provided  
**Metrics**: Use `installs_tap_through` for default attribution  

Dashboard KPIs now correctly respond to App filter! 🎉
