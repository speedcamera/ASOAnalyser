# Weekly Performance Trend - Spend Coloring Fix

## Root Cause

**Missing percentage calculation in frontend.**

The backend API does NOT return `spendChangePercent`, `installsChangePercent`, or `cpaChangePercent` fields in the weekly data.

### Backend Response
```json
{
  "weekStarting": "2026-06-15",
  "spend": 67.91,
  "installs": 87,
  "cpa": 0.78,
  "cpt": 0.68,
  "ttr": 3.31,
  "cr": 87
  // ❌ NO spendChangePercent
  // ❌ NO installsChangePercent
  // ❌ NO cpaChangePercent
}
```

### Frontend Code (Before Fix)
`WeeklyTrendTable.jsx` line 52-56:
```javascript
spend_delta: week.spendChangePercent,        // ❌ undefined (field doesn't exist)
installs_delta: week.installsChangePercent,  // ❌ undefined (field doesn't exist)
cpa_delta: week.cpaChangePercent,            // ❌ undefined (field doesn't exist)
cpt_delta: percentChange(week.cpt, older?.cpt ?? null),  // ✅ calculated
ttr_delta: percentChange(week.ttr, older?.ttr ?? null),  // ✅ calculated
```

### Result
`MetricCompareCell` receives `percent={undefined}`, so:
- Current value displays ✅
- Previous value displays ✅
- Badge does NOT display ❌ (because `percent` is undefined)

---

## Fix

Calculate percentage changes in the frontend using `percentChange()` helper, just like CPT and TTR.

### File Changed
`frontend/src/components/WeeklyTrendTable.jsx`

### Change
Lines 52-54 in `enrichWeekRows()` function:

```javascript
// Before
spend_delta: week.spendChangePercent,
installs_delta: week.installsChangePercent,
cpa_delta: week.cpaChangePercent,

// After
spend_delta: percentChange(week.spend, older?.spend ?? null),
installs_delta: percentChange(week.installs, older?.installs ?? null),
cpa_delta: percentChange(week.cpa, older?.cpa ?? null),
```

---

## Component Props Used for Spend

```javascript
<MetricCompareCell
  current={week.spend}
  previous={week.previous_spend}
  percent={week.spend_delta}      // Now calculated: percentChange(current, previous)
  kind="cost"                      // Lower is better
  showCompare
  compareHint={weekHint}
  formatValue={formatCurrency}
/>
```

**Tone Rules** (`kind="cost"`):
- Spend decrease (▼) → green (favorable)
- Spend increase (▲) → red (unfavorable)
- No change or null → grey (neutral)

---

## Confirmation

### Spend Increase = Red ✅
```
Week 1: £147.59
Week 2: £67.91
Change: +117.3%
Result: ▲ 117.3% (RED badge)
```

### Spend Decrease = Green ✅
```
Week 1: £67.91
Week 2: £147.59
Change: -54.0%
Result: ▼ 54.0% (GREEN badge)
```

---

## Testing

### Before Fix
```
Week Starting | Spend      | Installs | CPA
------------- | ---------- | -------- | -----
2026-07-06    | £25.74     | 34       | £0.76
              | vs £98.39  | vs 126   | vs £0.78
              |            | ▼ 73.0%  | ▼ 3.4%
                ↑ NO BADGE
```

### After Fix
```
Week Starting | Spend      | Installs | CPA
------------- | ---------- | -------- | -----
2026-07-06    | £25.74     | 34       | £0.76
              | vs £98.39  | vs 126   | vs £0.78
              | ▼ 73.8%    | ▼ 73.0%  | ▼ 3.4%
                ↑ GREEN (favorable spend decrease)
```

---

## Impact

**Scope**: Weekly Performance Trend frontend only

**Files Changed**: 1 (`frontend/src/components/WeeklyTrendTable.jsx`)

**Components Used**: `MetricCompareCell` (already shared component from Phase 5)

**Backend**: No changes

**Calculations**: No changes (using existing `percentChange()` helper)

**Other Pages**: No changes
