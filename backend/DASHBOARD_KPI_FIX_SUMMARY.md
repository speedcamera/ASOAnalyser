# Dashboard KPI Cards Fix Summary

## Issue
Dashboard KPI cards displayed "N/A" while trend charts showed data correctly.

## Root Cause
**Response shape mismatch** in the transformation layer (`compareStructured.js`).

The transformation was accessing flat properties on the `summary` object, but `getDashboardSummary()` returns metrics nested under `current` and `previous` objects.

---

## Files Changed

### backend/compareStructured.js (Line 73-95)

**OLD (Broken) - Accessing flat properties**:
```javascript
const overall = {
  scope: 'overall',
  previous_spend: summary.previous_spend,           // ❌ undefined
  current_spend: summary.current_spend,             // ❌ undefined
  spend_change: summary.spend_change,               // ❌ undefined
  previous_impressions: summary.previous_impressions,  // ❌ undefined
  current_impressions: summary.current_impressions,    // ❌ undefined
  previous_taps: summary.previous_taps,             // ❌ undefined
  current_taps: summary.current_taps,               // ❌ undefined
  previous_installs: summary.previous_installs,     // ❌ undefined
  current_installs: summary.current_installs,       // ❌ undefined
  previous_cpa: summary.previous_cpa,               // ❌ undefined
  current_cpa: summary.current_cpa,                 // ❌ undefined
  cpa_change: summary.cpa_change,                   // ❌ undefined
  previous_average_cpt: summary.previous_cpt,       // ❌ undefined
  current_average_cpt: summary.current_cpt,         // ❌ undefined
  previous_cr: summary.previous_cr,                 // ❌ undefined
  current_cr: summary.current_cr,                   // ❌ undefined
  previous_ttr: summary.previous_ttr,               // ❌ undefined
  current_ttr: summary.current_ttr,                 // ❌ undefined
}
```

**NEW (Fixed) - Accessing nested properties**:
```javascript
const overall = {
  scope: 'overall',
  previous_spend: summary.previous?.spend ?? null,           // ✅ correct
  current_spend: summary.current?.spend ?? null,             // ✅ correct
  spend_change: summary.changes?.spend_change ?? null,       // ✅ correct
  previous_impressions: summary.previous?.impressions ?? null,  // ✅ correct
  current_impressions: summary.current?.impressions ?? null,    // ✅ correct
  previous_taps: summary.previous?.taps ?? null,             // ✅ correct
  current_taps: summary.current?.taps ?? null,               // ✅ correct
  previous_installs: summary.previous?.installs ?? null,     // ✅ correct
  current_installs: summary.current?.installs ?? null,       // ✅ correct
  previous_cpa: summary.previous?.cpa ?? null,               // ✅ correct
  current_cpa: summary.current?.cpa ?? null,                 // ✅ correct
  cpa_change: summary.changes?.cpa_change ?? null,           // ✅ correct
  previous_average_cpt: summary.previous?.cpt ?? null,       // ✅ correct
  current_average_cpt: summary.current?.cpt ?? null,         // ✅ correct
  previous_cr: summary.previous?.cr ?? null,                 // ✅ correct
  current_cr: summary.current?.cr ?? null,                   // ✅ correct
  previous_ttr: summary.previous?.ttr ?? null,               // ✅ correct
  current_ttr: summary.current?.ttr ?? null,                 // ✅ correct
}
```

---

## Data Flow

### 1. Analytics Service Response (`getDashboardSummary`)

**Returns**:
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
    taps: 500
  },
  previous: {
    spend: 1000.50,
    installs: 50,
    cpa: 20.01,
    cpt: 2.4,
    ttr: 4.8,
    cr: 1.0,
    impressions: 9500,
    taps: 480
  },
  periods: { ... },
  changes: {
    spend_change: 20.0,
    cpa_change: 0.0,
    installs_change: 20.0
  }
}
```

### 2. API Response (after transformation)

**Returns**:
```javascript
{
  periods: { ... },
  overall: {
    scope: 'overall',
    current_spend: 1200.75,      // ✅ now populated
    previous_spend: 1000.50,     // ✅ now populated
    current_installs: 60,        // ✅ now populated
    previous_installs: 50,       // ✅ now populated
    current_cpa: 20.01,          // ✅ now populated
    previous_cpa: 20.01,         // ✅ now populated
    current_average_cpt: 2.5,    // ✅ now populated
    previous_average_cpt: 2.4,   // ✅ now populated
    current_impressions: 10000,  // ✅ now populated
    previous_impressions: 9500,  // ✅ now populated
    current_taps: 500,           // ✅ now populated
    previous_taps: 480,          // ✅ now populated
    current_ttr: 5.0,            // ✅ now populated
    previous_ttr: 4.8,           // ✅ now populated
    current_cr: 1.2,             // ✅ now populated
    previous_cr: 1.0,            // ✅ now populated
    // ...change percentages calculated by frontend
  },
  campaigns: [...],
  keywords: [...],
  apps: [...],
  app_breakdown: [...],
  top_campaigns: [...],
  top_keywords: [...]
}
```

### 3. Frontend (Dashboard.jsx)

**Expects and receives**:
```javascript
<KpiCard
  label="Total Spend"
  value={formatKpiValue(overall?.current_spend, 'currency')}  // ✅ 1200.75
  previousValue={overall?.previous_spend}                      // ✅ 1000.50
  changePercent={percentChange(overall?.current_spend, overall?.previous_spend)}
/>
```

---

## The Fix

**Changed**: Property access pattern in transformation layer

**Old Pattern**:
```javascript
summary.previous_spend    // undefined (property doesn't exist)
```

**New Pattern**:
```javascript
summary.previous?.spend   // 1000.50 (nested object access)
```

---

## Verification

After fix, Dashboard KPI cards should display:
- ✅ Total Spend with current and previous values
- ✅ Installs with current and previous values
- ✅ CPA with current and previous values
- ✅ CPT with current and previous values
- ✅ Impressions with current and previous values
- ✅ TTR with current and previous values
- ✅ CR with current and previous values
- ✅ Taps with current and previous values
- ✅ All change percentages calculated correctly

Trend charts should continue working (unchanged).

---

## Why Charts Still Worked

Charts use a different endpoint (`/api/campaigns/weekly-performance`) that calls `getDailyTrend()` directly, which returns data in the expected format. Only the Dashboard summary KPIs were affected by this transformation mismatch.
