# Campaign Previous Installs Diagnosis

## Issue
For filtered apps in comparison mode:
- ✅ Previous Spend returned correctly
- ✅ Previous Taps returned correctly  
- ❌ Previous Installs always 0
- ❌ Previous CPA becomes N/A (due to 0 installs)

---

## Root Cause

**Older database rows have `installs_tap_through = 0` (not populated).**

The query uses `SUM(installs_tap_through)` which returns 0 for old data, even though install counts exist in the legacy `installs` column.

---

## Data Flow Trace

### 1. Raw Database Data (Previous Period: Jun 28 - Jul 4)

```
Jun 28: spend=22.72, taps=14, installs=22, tap_through=0, total=22
Jun 29: spend=7.1,   taps=12, installs=19, tap_through=0, total=19
Jun 30: spend=3.31,  taps=5,  installs=15, tap_through=0, total=15
Jul 01: spend=7.02,  taps=10, installs=16, tap_through=0, total=16
Jul 02: spend=15.79, taps=9,  installs=13, tap_through=0, total=13
Jul 03: spend=8.9,   taps=6,  installs=18, tap_through=0, total=18
Jul 04: spend=12.45, taps=8,  installs=12, tap_through=0, total=12
```

**Totals**: spend=77.29, taps=64, **installs=115**, tap_through=0

### 2. Current Period Data (Jul 5 - Jul 11)

```
Jul 05: spend=16.05, taps=9,  tap_through=7,  view_through=10, total=17
Jul 06: spend=6.62,  taps=12, tap_through=9,  view_through=8,  total=17
Jul 07: spend=1.59,  taps=3,  tap_through=3,  view_through=8,  total=11
Jul 08: spend=8.07,  taps=5,  tap_through=5,  view_through=5,  total=10
Jul 09: spend=8.92,  taps=7,  tap_through=2,  view_through=8,  total=10
Jul 10: spend=0.04,  taps=1,  tap_through=0,  view_through=5,  total=5
Jul 11: spend=0.69,  taps=2,  tap_through=1,  view_through=2,  total=3
```

**Totals**: spend=41.98, taps=39, **installs_tap_through=27**

---

## SQL Query Result (Before Fix)

```sql
SELECT 
  SUM(spend) as spend,
  SUM(taps) as taps,
  SUM(installs_tap_through) as installs_tap_through
FROM daily_campaign_metrics
WHERE campaign_name = 'Standard Delm8 -Brand'
  AND report_date BETWEEN '2026-06-28' AND '2026-07-04'
```

**Result**:
```json
{
  "spend": "77.29",        // ✅ Correct
  "taps": "64",            // ✅ Correct
  "installs_tap_through": "0"  // ❌ Wrong (should be 115)
}
```

---

## Merged Comparison Object (Before Fix)

```javascript
{
  previous: {
    spend: 77.29,      // ✅ Correct
    taps: 64,          // ✅ Correct
    installs: 0,       // ❌ Wrong (from installs_tap_through = 0)
    cpa: null          // ❌ Wrong (null because installs = 0)
  },
  current: {
    spend: 41.98,
    taps: 39,
    installs: 27,      // ✅ Correct
    cpa: 1.55          // ✅ Correct
  }
}
```

---

## Final API Response (Before Fix)

```json
{
  "campaign_name": "Standard Delm8 -Brand",
  "previous_spend": 77.29,
  "current_spend": 41.98,
  "previous_taps": 64,
  "current_taps": 39,
  "previous_installs": 0,     // ❌ WRONG
  "current_installs": 27,
  "previous_cpa": null,       // ❌ WRONG
  "current_cpa": 1.55
}
```

---

## Exact Location Where Previous Installs Become 0

**File**: `backend/analyticsService.js`  
**Function**: `getCampaignSummary()`  
**Line**: 223  

```sql
SUM(installs_tap_through) as installs_tap_through
```

This aggregates `installs_tap_through` which is 0 for all old rows, even though:
- `installs` column has 115 total
- `installs_total` column has 115 total

---

## Solution

Use `COALESCE` to fall back to the legacy `installs` column when `installs_tap_through` is not populated:

```sql
SUM(COALESCE(NULLIF(installs_tap_through, 0), installs)) as installs_tap_through
```

**Logic**:
1. `NULLIF(installs_tap_through, 0)` → Returns NULL if value is 0
2. `COALESCE(..., installs)` → Uses `installs` if first value is NULL
3. Old data: 0 → NULL → uses `installs` (✅ 115)
4. New data: 27 → 27 → uses `installs_tap_through` (✅ 27)

**Why this works**:
- Old rows: `installs_tap_through = 0`, `installs = 22` → Uses 22
- New rows: `installs_tap_through = 7`, `installs = 17` → Uses 7
- Edge case: Legitimate 0 tap-through installs in new data → Uses `installs` as fallback (acceptable)

---

## Files to Change

1. `backend/analyticsService.js` - `getCampaignSummary()` comparison query (line 223)
2. `backend/analyticsService.js` - `getCampaignSummary()` non-comparison query (line 246)
3. `backend/analyticsService.js` - `getKeywordSummary()` comparison query (similar pattern)
4. `backend/analyticsService.js` - `getKeywordSummary()` non-comparison query (similar pattern)
5. `backend/analyticsService.js` - `getDashboardSummary()` queries (similar pattern)
6. `backend/analyticsService.js` - `getDailyTrend()` query (similar pattern)

All queries that aggregate `installs_tap_through` need the COALESCE fallback.
