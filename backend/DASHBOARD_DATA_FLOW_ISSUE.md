# Dashboard KPI Cards Data Flow Issue

## Problem
KPI cards display N/A while trend charts display data.

## Root Cause
**Response shape mismatch** between `getDashboardSummary()` and `compareStructured.js` transformation.

---

## 1. Analytics Service Response (getDashboardSummary)

**File**: `backend/analyticsService.js` line 182-191

**Actual Response Shape**:
```javascript
{
  current: {
    spend: 1200.75,
    installs: 60,
    cpa: 20.01,
    cpt: 2.5,
    ttr: 5.0,
    cr: 1.2,
    impressions: 10000,
    taps: 500,
    // ...all metrics nested under 'current'
  },
  previous: {
    spend: 1000.50,
    installs: 50,
    cpa: 20.01,
    cpt: 2.4,
    ttr: 4.8,
    cr: 1.0,
    impressions: 9500,
    taps: 480,
    // ...all metrics nested under 'previous'
  },
  periods: { ... },
  changes: {
    spend_change: 20.0,
    cpa_change: 0.0,
    installs_change: 20.0
  }
}
```

---

## 2. API Transformation (compareStructured.js)

**File**: `backend/compareStructured.js` line 74-94

**Current (BROKEN) Transformation**:
```javascript
const overall = {
  scope: 'overall',
  previous_spend: summary.previous_spend,      // ❌ undefined
  current_spend: summary.current_spend,        // ❌ undefined
  spend_change: summary.spend_change,          // ❌ undefined
  previous_impressions: summary.previous_impressions,  // ❌ undefined
  current_impressions: summary.current_impressions,    // ❌ undefined
  previous_taps: summary.previous_taps,        // ❌ undefined
  current_taps: summary.current_taps,          // ❌ undefined
  previous_installs: summary.previous_installs,        // ❌ undefined
  current_installs: summary.current_installs,          // ❌ undefined
  previous_cpa: summary.previous_cpa,          // ❌ undefined
  current_cpa: summary.current_cpa,            // ❌ undefined
  cpa_change: summary.cpa_change,              // ❌ undefined
  previous_average_cpt: summary.previous_cpt,  // ❌ undefined
  current_average_cpt: summary.current_cpt,    // ❌ undefined
  previous_cr: summary.previous_cr,            // ❌ undefined
  current_cr: summary.current_cr,              // ❌ undefined
  previous_ttr: summary.previous_ttr,          // ❌ undefined
  current_ttr: summary.current_ttr,            // ❌ undefined
}
```

**Issue**: Accessing flat properties on `summary` object, but metrics are nested under `summary.current` and `summary.previous`.

---

## 3. Frontend Expectations (Dashboard.jsx)

**File**: `frontend/src/pages/Dashboard.jsx` line 216-273

**Expected Shape**:
```javascript
overall = {
  scope: 'overall',
  current_spend: 1200.75,
  previous_spend: 1000.50,
  spend_change: 20.0,
  current_installs: 60,
  previous_installs: 50,
  current_cpa: 20.01,
  previous_cpa: 20.01,
  cpa_change: 0.0,
  current_average_cpt: 2.5,
  previous_average_cpt: 2.4,
  current_impressions: 10000,
  previous_impressions: 9500,
  current_taps: 500,
  previous_taps: 480,
  current_ttr: 5.0,
  previous_ttr: 4.8,
  current_cr: 1.2,
  previous_cr: 1.0,
  // ...flat structure with prefixed properties
}
```

**Usage in KPI Cards**:
```javascript
<KpiCard
  label="Total Spend"
  value={formatKpiValue(overall?.current_spend, 'currency')}
  previousValue={overall?.previous_spend}
  changePercent={showCompare ? percentChange(overall?.current_spend, overall?.previous_spend) : null}
/>
```

---

## 4. The Mismatch

| Location | Property Access | Actual Value |
|----------|----------------|--------------|
| compareStructured.js | `summary.previous_spend` | `undefined` ❌ |
| compareStructured.js | `summary.current_spend` | `undefined` ❌ |
| **Should be** | `summary.previous.spend` | `1000.50` ✅ |
| **Should be** | `summary.current.spend` | `1200.75` ✅ |

---

## Fix

**File**: `backend/compareStructured.js` line 74-94

**Corrected Transformation**:
```javascript
const overall = {
  scope: 'overall',
  previous_spend: summary.previous?.spend ?? null,           // ✅
  current_spend: summary.current?.spend ?? null,             // ✅
  spend_change: summary.changes?.spend_change ?? null,       // ✅
  previous_impressions: summary.previous?.impressions ?? null,  // ✅
  current_impressions: summary.current?.impressions ?? null,    // ✅
  previous_taps: summary.previous?.taps ?? null,             // ✅
  current_taps: summary.current?.taps ?? null,               // ✅
  previous_installs: summary.previous?.installs ?? null,     // ✅
  current_installs: summary.current?.installs ?? null,       // ✅
  previous_cpa: summary.previous?.cpa ?? null,               // ✅
  current_cpa: summary.current?.cpa ?? null,                 // ✅
  cpa_change: summary.changes?.cpa_change ?? null,           // ✅
  previous_average_cpt: summary.previous?.cpt ?? null,       // ✅
  current_average_cpt: summary.current?.cpt ?? null,         // ✅
  previous_cr: summary.previous?.cr ?? null,                 // ✅
  current_cr: summary.current?.cr ?? null,                   // ✅
  previous_ttr: summary.previous?.ttr ?? null,               // ✅
  current_ttr: summary.current?.ttr ?? null,                 // ✅
}
```

---

## Summary

**Old (Broken)**:
```javascript
summary.previous_spend     // undefined
summary.current_spend      // undefined
```

**New (Fixed)**:
```javascript
summary.previous.spend     // 1000.50
summary.current.spend      // 1200.75
```

The transformation layer in `compareStructured.js` was accessing flat properties instead of nested objects returned by `getDashboardSummary()`.
