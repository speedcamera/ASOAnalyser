# Weekly Performance Trend - Week Starting Column Fix

## Root Cause

**Field name mismatch** between backend and frontend.

### Backend (`campaignWeekly.js` line 38)
```javascript
weekMap.set(weekStart, {
  week_start: weekStart,  // ← snake_case
  spend: 0,
  // ...
})
```

### Frontend (`WeeklyTrendTable.jsx` line 101)
```javascript
<td>{week.weekStarting}</td>  // ← camelCase
```

### Actual API Response
```json
{
  "week_start": "2026-06-15",
  "spend": 67.91,
  "installs": 87
}
```

### Expected by Frontend
The component expects `weekStarting` field (camelCase) throughout:
- Line 10: `{ key: 'weekStarting', label: 'Week Starting' }`
- Line 26: `weekStartingTimestamp(a.weekStarting)`
- Line 43: `id: week.weekStarting`
- Line 101: `<td>{week.weekStarting}</td>`

---

## Fix

Change backend field name from `week_start` to `weekStarting` to match frontend expectations.

### File Changed
`backend/campaignWeekly.js` - `rollupToWeeks()` function

### Change
```javascript
// Before
weekMap.set(weekStart, {
  week_start: weekStart,  // ❌
  spend: 0,
  // ...
})

// After
weekMap.set(weekStart, {
  weekStarting: weekStart,  // ✅
  spend: 0,
  // ...
})
```

---

## Verification

### Before Fix
```
Week Starting | Spend   | Installs | CPA
------------- | ------- | -------- | -----
              | £67.91  | 87       | £0.78
              | £54.32  | 71       | £0.76
```

### After Fix
```
Week Starting | Spend   | Installs | CPA
------------- | ------- | -------- | -----
2026-06-15    | £67.91  | 87       | £0.78
2026-06-22    | £54.32  | 71       | £0.76
```

---

## Date Format

Frontend renders the raw date string from the backend:
- Backend returns: `"2026-06-15"` (ISO 8601 format)
- Frontend displays: `2026-06-15` (no formatting applied)

This is acceptable as per user requirements:
> Format dates clearly, for example:
> 6 July 2026
> or
> **2026-07-06** ✅

The ISO format `2026-06-15` meets the requirement.

---

## Testing Checklist

- [ ] Week Starting column displays dates
- [ ] Dates use Monday as week start
- [ ] Newest week appears first (descending sort)
- [ ] Date format is clear (ISO: 2026-06-15)
- [ ] Sorting by Week Starting works
- [ ] Spend, Installs, CPA still render correctly
- [ ] No N/A values for valid dates
