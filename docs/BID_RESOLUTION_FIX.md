# Bid Resolution Fix - Implementation Report

## Executive Summary

**Issue:** Keywords page showed "N/A" for Current Bid, Previous Bid, Bid Change, and Bid % with 7-day periods, but displayed correctly with 14-day periods.

**Root Cause:** Bid resolution used `MAX(keyword_max_cpt_bid)` aggregated over rows constrained to period date ranges, treating bid as an additive period metric instead of a point-in-time state value.

**Status:** ✅ Fixed and tested

---

## Root Cause Analysis

### The Problem

`backend/analyticsService.js` `getKeywordSummary()` function (lines 384-553) implemented incorrect bid resolution logic:

```sql
SELECT 
  MAX(k.keyword_max_cpt_bid) as keyword_max_cpt_bid,
  ...
FROM daily_keyword_metrics k
WHERE ((k.report_date >= $1 AND k.report_date <= $2)
    OR (k.report_date >= $3 AND k.report_date <= $4))
GROUP BY k.keyword_text, k.campaign_name, k.ad_group_name, k.app_id, period
```

**Problems:**

1. **Wrong aggregation scope**: `MAX()` only considered rows within each period's date range
2. **Missing bid_strategy**: Didn't include `bid_strategy` in GROUP BY, violating stable keyword identity
3. **Semantic error**: Treated bid as a period metric instead of a state value

### Why 7D Failed

**Scenario:**
- Bid changed to £2.50 on August 1
- Current period: August 10-16 (7 days)
- Previous period: August 3-9 (7 days)
- No further bid changes

**What happened:**

The WHERE clause filtered to only rows between Aug 10-16 OR Aug 3-9. If there were no rows with non-null `keyword_max_cpt_bid` inside the Aug 10-16 window (perhaps they're null or the keyword had no activity), then:

- `MAX(keyword_max_cpt_bid)` for current period = `NULL`
- `item.currentBid = null`
- UI displayed: **"N/A"**

The £2.50 bid from August 1 was **completely ignored** because it fell outside both period windows.

### Why 14D Worked (By Accident)

With 14-day periods:
- Current period: August 3-16 (14 days)
- Previous period: July 20 - August 2 (14 days)

The wider window included days closer to the August 1 bid change. If at least one daily row existed with `keyword_max_cpt_bid = £2.50` in that window, then `MAX()` returned £2.50.

**This worked by accident**, not by design. If the bid was set on July 25, even 14D would fail.

---

## Implementation

### 1. Added Point-in-Time Bid Resolution Function

Created `resolveKeywordBids()` function in `analyticsService.js`:

```javascript
async function resolveKeywordBids(keywordIdentities, currentEndDate, previousEndDate, appIdFilter, campaignFilter) {
  // For each keyword identity:
  // - Find latest non-null keyword_max_cpt_bid where report_date <= currentEndDate
  // - Find latest non-null keyword_max_cpt_bid where report_date <= previousEndDate
  // - Use deterministic ordering: report_date DESC, id DESC
}
```

**SQL per keyword:**

```sql
SELECT keyword_max_cpt_bid
FROM daily_keyword_metrics
WHERE app_id = $1
  AND campaign_name = $2
  AND ad_group_name = $3
  AND keyword_text = $4
  AND COALESCE(bid_strategy, '') = $5
  AND report_date <= $6  -- currentEndDate or previousEndDate
  AND keyword_max_cpt_bid IS NOT NULL
ORDER BY report_date DESC, id DESC
LIMIT 1
```

### 2. Updated Keyword Identity to Include bid_strategy

**Before:**
```javascript
const key = `${row.app_id}|${row.campaign_name}|${row.ad_group_name}|${row.keyword_text}`
```

**After:**
```javascript
const key = `${row.app_id}|${row.campaign_name}|${row.ad_group_name}|${row.keyword_text}|${row.bid_strategy}`
```

Added `COALESCE(k.bid_strategy, '') as bid_strategy` to SELECT clause and `k.bid_strategy` to GROUP BY clause.

### 3. Updated Bid Comparison Calculation

Applied canonical percentage change rules from `analyticsMetrics.js`:

```javascript
if (currentBid !== null && previousBid !== null) {
  bidChangeAmount = currentBid - previousBid
  if (previousBid === 0) {
    bidChangePercent = currentBid === 0 ? 0 : null  // 0/0=0, pos/0=null
  } else {
    bidChangePercent = ((currentBid - previousBid) / previousBid) * 100
  }
}
```

**Rules:**
- Both bids available, previous ≠ 0 → normal percentage
- Both zero → 0% (unchanged)
- Previous zero, current non-zero → null (no finite percentage; new activity)
- Either missing → null

### 4. Updated Documentation

Updated `docs/ANALYTICS.md` to reflect that `analyticsService` now uses the full stable keyword identity including `bid_strategy` for bid resolution.

---

## Files Changed

### 1. `backend/analyticsService.js`
- **Lines 367-424**: Added `resolveKeywordBids()` function for point-in-time bid lookup
- **Lines 426-553**: Updated `getKeywordSummary()` to:
  - Include `bid_strategy` in SELECT and GROUP BY
  - Use full stable keyword identity for grouping
  - Call `resolveKeywordBids()` to get current and previous bids
  - Apply canonical bid change calculation rules

### 2. `docs/ANALYTICS.md`
- **Lines 87-101**: Updated keyword identity documentation to clarify that stable identity includes `bid_strategy` and is used by Analytics Service bid resolution

### 3. `backend/test-bid-resolution.js` (NEW)
- Comprehensive test suite with 12 test cases covering all scenarios
- Tests point-in-time bid resolution, period comparison, and keyword identity isolation

### 4. `backend/package.json`
- Added `test:bid-resolution` script

---

## Final Bid Rules

### Current Bid
Find the **latest non-null** `keyword_max_cpt_bid` where:
- `app_id`, `campaign_name`, `ad_group_name`, `keyword_text`, `bid_strategy` match the keyword identity
- `report_date <= currentEndDate`
- `keyword_max_cpt_bid IS NOT NULL`
- Order by `report_date DESC, id DESC`
- Take first row (LIMIT 1)

If no matching row exists: `current_bid = null`

### Previous Bid
Find the **latest non-null** `keyword_max_cpt_bid` where:
- Same keyword identity matching
- `report_date <= previousEndDate`
- `keyword_max_cpt_bid IS NOT NULL`
- Same ordering and limit

If no matching row exists: `previous_bid = null`

### Bid Change
- If both available: `bidChange = currentBid - previousBid`
- If either missing: `bidChange = null`

### Bid Change Percent
- Both available, previous ≠ 0: `((currentBid - previousBid) / previousBid) * 100`
- Both available, both zero: `0%` (unchanged)
- Both available, previous = 0, current ≠ 0: `null` (cannot express as finite percentage)
- Either missing: `null`

**No Infinity or NaN values.**

---

## Example: 7D Output Before and After

### Before (Broken)

**Scenario:** Bid set to £2.50 on August 1, no changes. Period: Aug 10-16 (7D)

```json
{
  "keyword": "test keyword",
  "current_bid": null,        // ❌ WRONG - bid existed on Aug 1
  "previous_bid": null,       // ❌ WRONG
  "bid_change": null,         // ❌ WRONG
  "bid_change_percent": null  // ❌ WRONG
}
```

**UI Display:** Current Bid: N/A, Previous Bid: N/A, Bid Change: N/A, Bid %: N/A

### After (Fixed)

**Same scenario:**

```json
{
  "keyword": "test keyword",
  "current_bid": 2.50,        // ✅ Correct - latest bid on or before Aug 16
  "previous_bid": 2.50,       // ✅ Correct - latest bid on or before Aug 9
  "bid_change": 0.00,         // ✅ Correct - no change
  "bid_change_percent": 0     // ✅ Correct - 0% change
}
```

**UI Display:** Current Bid: £2.50, Previous Bid: £2.50, Bid Change: £0.00, Bid %: 0%

---

## Tests Performed

### Comprehensive Test Suite: 12 Test Cases

All 12 tests **PASSED** ✅

1. ✅ **Bid exists inside 7D period**  
   Bid set on Aug 5, both periods see £2.50

2. ✅ **Bid was set before 7D period and carried forward**  
   Bid set on Aug 1, null rows inside period, both see £2.50

3. ✅ **Same bid spans both current and previous periods**  
   Bid set on Aug 1, no changes, both see £2.50, 0% change

4. ✅ **Bid changed during current period**  
   Previous: £2.00, Current: £2.50 (changed Aug 12), 25% increase

5. ✅ **Bid changed during previous period**  
   Changed Aug 5 (£1.50 → £2.00), both periods see £2.00

6. ✅ **Multiple historical bid changes exist**  
   July 20: £1.00, Aug 1: £1.50, Aug 5: £2.00, Aug 12: £2.50  
   Previous sees £2.00, Current sees £2.50

7. ✅ **Current period contains null bid rows after a valid historical bid**  
   Bid set Aug 1 (£3.00), null rows Aug 11-13, both periods see £3.00

8. ✅ **No historical bid exists**  
   Only null bids, both return null, UI shows N/A (correct)

9. ✅ **7D, 14D and 30D resolve the same current bid when no bid change occurred**  
   Bid set July 1, all period lengths see £2.75

10. ✅ **Same keyword text in different campaigns remains isolated**  
    "shared keyword" in Campaign A: £1.50, Campaign B: £2.50

11. ✅ **Same keyword in different ad groups remains isolated**  
    "keyword in groups" in Ad Group A: £1.75, Ad Group B: £2.25

12. ✅ **Same keyword across apps remains isolated**  
    "cross app keyword" in TEST_APP: £3.00, TEST_APP_B: £4.00

### Regression Tests

Ran existing analytics test suite (`npm run test:analytics`):  
**22 tests PASSED** ✅

No regressions introduced.

---

## Verification

### Local Testing

```bash
cd backend
npm run test:bid-resolution
# Result: 12 passed, 0 failed ✅

npm run test:analytics
# Result: 22 tests passed ✅
```

### Manual Testing Checklist

- [ ] Open Keywords page with 7D period
- [ ] Verify bid values display correctly (no N/A where bid exists)
- [ ] Change to 14D period, verify same bid values
- [ ] Test keyword with bid change during current period
- [ ] Test keyword with no historical bid (should show N/A)
- [ ] Test keyword with bid set before both periods (should carry forward)
- [ ] Verify bid change calculation (amount and percentage)

---

## What Was NOT Changed

✅ Analytics metric formulas (CPT, CPA, TTR, CR)  
✅ Period date range calculation (`resolvePeriods`)  
✅ Bid Experiment logic (`bidExperiments.js`)  
✅ CSV import  
✅ Database schema (no migrations needed)  
✅ Dashboard page  
✅ Campaign page  
✅ Frontend display logic (uses API response as-is)

---

## Success Criteria

| Criterion | Status |
|-----------|--------|
| Current Bid resolves correctly for 7D period | ✅ |
| Previous Bid resolves correctly for 7D period | ✅ |
| Bid Change calculates correctly | ✅ |
| Bid % calculates correctly (no Infinity/NaN) | ✅ |
| bid_strategy included in keyword identity | ✅ |
| All 12 test cases pass | ✅ |
| No regressions in existing analytics tests | ✅ |
| Documentation updated | ✅ |

---

## Deployment Notes

1. **Database:** No schema changes required
2. **Migration:** No data migration needed
3. **Rollback:** Safe to rollback if needed (pure logic change)
4. **Performance:** Added separate queries for bid resolution per keyword in comparison mode
   - For 100 keywords: ~200 queries (100 current + 100 previous)
   - Indexed lookups, should be fast (<1ms per query)
   - Consider optimization if performance issues arise (batch query with LATERAL joins)

---

## Future Optimizations (Optional)

If performance becomes an issue with large keyword counts, consider:

1. **Batch bid resolution with single query using LATERAL joins:**
```sql
SELECT 
  k.app_id, k.campaign_name, k.ad_group_name, k.keyword_text, k.bid_strategy,
  current_bid.keyword_max_cpt_bid as current_bid,
  previous_bid.keyword_max_cpt_bid as previous_bid
FROM (SELECT DISTINCT ...) k
LEFT JOIN LATERAL (
  SELECT keyword_max_cpt_bid
  FROM daily_keyword_metrics
  WHERE ... AND report_date <= $currentEnd
  ORDER BY report_date DESC, id DESC
  LIMIT 1
) current_bid ON true
LEFT JOIN LATERAL (
  SELECT keyword_max_cpt_bid
  FROM daily_keyword_metrics
  WHERE ... AND report_date <= $previousEnd
  ORDER BY report_date DESC, id DESC
  LIMIT 1
) previous_bid ON true
```

2. **Add materialized bid state table** (if bid lookups become frequent enough to justify)

---

## Conclusion

The bid resolution issue has been fully resolved. The implementation:

1. ✅ Uses correct semantic rule for point-in-time bid state
2. ✅ Includes `bid_strategy` in stable keyword identity
3. ✅ Applies canonical bid change calculation rules
4. ✅ Passes all 12 comprehensive test cases
5. ✅ Introduces no regressions
6. ✅ Is fully documented

Keywords page now displays accurate bid comparison data regardless of period length.
