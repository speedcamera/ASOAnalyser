# Dashboard Installs Not Responding to App Filter - Root Cause

## Issue
Dashboard Installs (and all KPI metrics) remain unchanged when the app filter changes.

## Root Cause
**The period comparison API call does NOT include the app filter parameter.**

---

## Data Flow

### 1. Dashboard.jsx (Frontend)
- Has `appFilter` state from AppContext
- Computes `selectedApp` and `chartAppParams` for charts
- Charts work because they include `appId` in their API calls
- BUT the main Dashboard summary comes from `periodComparison` in AppContext

### 2. AppContext.jsx - loadPeriodComparison()
**Line 68-95**

**Current (BROKEN)**:
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

**Issues**:
1. Does NOT pass `appFilter` or `appId` to API
2. Does NOT depend on `appFilter`, so doesn't reload when app changes
3. API call always fetches data for ALL apps

### 3. api.js - fetchPeriodCompare()
**Line 75-87**

**Current (INCOMPLETE)**:
```javascript
export async function fetchPeriodCompare({ days, startDate, endDate } = {}) {
  const params = new URLSearchParams()
  if (days) params.set('days', String(days))
  if (startDate) params.set('startDate', startDate)
  if (endDate) params.set('endDate', endDate)
  // ❌ Does not accept or pass appId

  const res = await fetch(`/api/compare/period?${params}`)
  return res.json()
}
```

**Issue**: Function doesn't accept or pass `appId` parameter

### 4. Backend (Already Fixed)
**backend/index.js** - Already supports `appId` query parameter ✅  
**backend/analyticsService.js** - Already filters by `appId` ✅

---

## Why Charts Work But KPIs Don't

**Charts**: Use `chartAppParams` which includes `appId` → `/api/campaigns/weekly-performance?appId=...` ✅

**KPIs**: Use `periodComparison` from AppContext which doesn't pass `appId` → `/api/compare/period?days=7` (no appId) ❌

---

## Fix Required

### 1. frontend/src/api.js
Add `appId` parameter support:
```javascript
export async function fetchPeriodCompare({ days, startDate, endDate, appId } = {}) {
  const params = new URLSearchParams()
  if (days) params.set('days', String(days))
  if (startDate) params.set('startDate', startDate)
  if (endDate) params.set('endDate', endDate)
  if (appId) params.set('appId', String(appId))  // ✅ Add this

  const res = await fetch(`/api/compare/period?${params}`)
  return res.json()
}
```

### 2. frontend/src/context/AppContext.jsx
Pass `appId` and depend on `appFilter`:
```javascript
const loadPeriodComparison = useCallback(async () => {
  // ...
  
  // Get selected app's ID
  const selectedApp = appFilter === ALL_APPS 
    ? null 
    : apps.find(app => app.app_key === appFilter)
  const appId = selectedApp?.app_id || null
  
  const comparison = days
    ? await fetchPeriodCompare({ days, appId })              // ✅ Pass appId
    : await fetchPeriodCompare({
        startDate: customStartDate,
        endDate: customEndDate,
        appId,                                               // ✅ Pass appId
      })
  setPeriodComparison(comparison)
}, [periodCompareEnabled, filterPreset, customStartDate, customEndDate, appFilter, apps])
//  ✅ Add appFilter and apps to dependencies
```

---

## Expected Result After Fix

### All Apps Selected
```
GET /api/compare/period?days=7
(no appId parameter)
→ Returns aggregated data for ALL apps
```

### App A Selected
```
GET /api/compare/period?days=7&appId=com.example.appA
→ Returns data ONLY for App A
```

### App B Selected
```
GET /api/compare/period?days=7&appId=com.example.appB
→ Returns data ONLY for App B
```

KPI cards will update immediately when app filter changes.
