# Campaign App Filter Diagnosis

## Issue
**Selecting All Apps returns campaign data.**  
**Selecting any individual app returns NO data.**

---

## Root Cause

The Campaign frontend applies a **DOUBLE FILTER**:
1. ✅ Backend filters campaigns by `appId` (SQL `WHERE app_id = $N`)
2. ❌ Frontend filters campaigns AGAIN using `filterByApp()` helper

The frontend filter fails because campaign objects are **missing the `app_key` field**.

---

## Data Flow Trace

### 1. App Dropdown Values
```javascript
// GET /api/apps returns:
[
  {
    "app_key": "id:1429831779",     // ← Used as dropdown value
    "app_id": "1429831779",          
    "app_name": "DelM8 UK Address Finder"
  },
  {
    "app_key": "id:1563254124",
    "app_id": "1563254124",
    "app_name": "Delm8 Route Planner UK & Maps"
  }
]
```

### 2. Frontend Request URL
```
GET /api/compare/period?days=7&appId=1429831779
```

**Sent by**: `AppContext.jsx` → `loadPeriodComparison()`

### 3. Backend Filter Value Received
```javascript
// index.js line 137
const appId = req.query.appId || null
// appId = "1429831779"
```

### 4. SQL Query with Filter
```sql
SELECT 
  campaign_name,
  app_id,
  app_name,
  ...
FROM daily_campaign_metrics
WHERE (report_date >= $1 AND report_date <= $2)
   OR (report_date >= $3 AND report_date <= $4)
  AND app_id = $5  -- ✅ Correctly filters for "1429831779"
GROUP BY campaign_name, app_id, app_name, period
```

**Result**: Backend correctly returns 29 campaigns for app "1429831779"

### 5. Campaign Response Fields (from backend)
```javascript
[
  {
    "campaign_name": "Standard Delm8 -Brand",
    "app_id": "1429831779",           // ✅ Present
    "app_name": "DelM8 UK Address Finder", // ✅ Present
    // "app_key": MISSING ❌
    "daily_budget": 15,
    "previous_spend": 77.29,
    "current_spend": 41.98,
    // ... other metrics
  }
]
```

### 6. Frontend Double-Filter (THE PROBLEM)
```javascript
// Campaigns.jsx line 30
const tableRows = useMemo(() => {
  const campaigns = filterByApp(periodComparison?.campaigns ?? [], appFilter)
  // appFilter = "id:1429831779"
  // campaigns have NO app_key field!
  return campaigns.map((row) => mapCampaignPerformanceRow(row, showCompare))
}, [periodComparison, appFilter, showCompare])
```

**`filterByApp` function** (`frontend/src/utils/appFilter.js` line 8-11):
```javascript
export function filterByApp(rows, appFilter) {
  if (!appFilter || appFilter === ALL_APPS) return rows
  return rows.filter((row) => matchesAppFilter(row, appFilter))
}

function matchesAppFilter(row, appFilter) {
  if (!appFilter || appFilter === ALL_APPS) return true
  return row.app_key === appFilter || row.app_name === appFilter
  // ❌ row.app_key is undefined!
  // ❌ row.app_name is "DelM8 UK Address Finder"
  // ❌ appFilter is "id:1429831779"
  // NO MATCH → All campaigns filtered out!
}
```

---

## Why "All Apps" Works

When `appFilter === ALL_APPS`:
1. Backend receives `appId = null` → NO SQL filter → Returns ALL campaigns
2. Frontend `filterByApp()` sees `ALL_APPS` → Returns ALL campaigns (line 9 early return)

Result: ✅ Campaigns display

---

## Why Specific App FAILS

When `appFilter === "id:1429831779"`:
1. Backend receives `appId = "1429831779"` → SQL filters correctly → Returns 29 campaigns ✅
2. Frontend `filterByApp()` checks:
   - `row.app_key === "id:1429831779"` → `undefined === "id:1429831779"` ❌
   - `row.app_name === "id:1429831779"` → `"DelM8 UK Address Finder" === "id:1429831779"` ❌
3. NO matches → ALL campaigns filtered out ❌

Result: ❌ Empty table

---

## Verification - Database has correct app_id

```javascript
// Query: SELECT DISTINCT app_id FROM daily_campaign_metrics
[
  { "app_id": "1563254124" },
  { "app_id": "1429831779" },
  { "app_id": "test-app-123" }
]
```

## Verification - Backend SQL works

```javascript
// Test: getCampaignSummary({ days: 7, appId: "1429831779", compare: true })
// Returns: 29 campaigns ✅
```

## Verification - Frontend filter breaks it

```javascript
// Input: 29 campaigns from backend (no app_key field)
// Filter: appFilter = "id:1429831779"
// Output: 0 campaigns (all filtered out) ❌
```

---

## Solution

Add `app_key` field to campaign objects in `getCampaignSummary()` response.

**File**: `backend/analyticsService.js`

**Changes**:
1. Line 263-276: Add `app_key` to non-comparison response
2. Line 306-326: Add `app_key` to comparison response

**Format**: `app_key: id:${app_id.toLowerCase()}`

**Why this works**:
- Backend continues to filter by SQL (correct)
- Frontend filter now has `app_key` field to match against
- `row.app_key === appFilter` will be TRUE
- Campaigns pass through both filters ✅

---

## Alternative Solution (NOT Recommended)

Remove the frontend `filterByApp()` call in `Campaigns.jsx`.

**Why NOT recommended**:
- Frontend double-filter provides safety for edge cases
- Other pages might rely on this pattern
- Backend filter alone should work, but frontend validation is good UX practice
- Adding `app_key` is a 2-line fix with zero risk
