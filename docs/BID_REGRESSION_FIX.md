# Bid Regression Diagnostic and Fix Report

## Executive Summary

**Original Issue:** 7D showed N/A for Current Bid, 14D worked correctly.

**My First Attempt:** Added `bid_strategy` to GROUP BY and point-in-time bid lookups.

**Regression:** Broke 14D (which previously worked) while 7D remained broken.

**Root Cause:** Apple Search Ads data contains multiple `bid_strategy` values per keyword. Only some strategies have non-null bids. Grouping by `bid_strategy` created multiple API rows per keyword, confusing the frontend.

**Final Fix:** Remove `bid_strategy` from GROUP BY. Use point-in-time lookups that query across ALL `bid_strategy` values and pick the latest non-null bid from any strategy.

**Status:** ✅ Fixed and verified

---

## Diagnostic Process

### Step 1: Database Inspection

Examined keyword "circuit plus" in `daily_keyword_metrics`:

```
Date       | Bid Strategy  | Max CPT Bid
-----------|---------------|-------------
2026-08-16 | Manual CPT    | NULL
2026-08-15 | Manual CPT    | NULL
2026-08-14 | Manual CPT    | NULL
2026-08-10 | Manual CPT    | NULL
2026-08-09 | Manual CPT    | NULL
2026-08-09 | Manage Bids   | £1.30       ← ONLY THIS HAS BID
2026-08-06 | Manual CPT    | NULL
2026-08-06 | Manage Bids   | £1.30
...
```

**CRITICAL FINDING:** The same keyword has multiple rows per date with different `bid_strategy` values. Only "Manage Bids" rows have non-null bids.

### Step 2: API Response Analysis

**Before My Fix:**

7D: 1 row returned
- Current Bid: N/A
- Previous Bid: £2.50 (populated)

14D: 1 row returned
- Current Bid: £1.30
- Previous Bid: £1.30

**After My Broken Fix:**

7D: **2 rows** returned
- Row 1: bid_strategy='Manual CPT', bids = NULL
- Row 2: bid_strategy='Manage Bids', bids = £1.30

14D: **2 rows** returned
- Row 1: bid_strategy='Manage Bids', bids = £1.30
- Row 2: bid_strategy='Manual CPT', bids = NULL

**Problem:** Frontend expected 1 row per keyword, got 2. Displayed the wrong row or got confused.

### Step 3: SQL Comparison

**ORIGINAL CODE (Before my fix):**

```sql
SELECT 
  k.keyword_text, k.campaign_name, k.ad_group_name, k.app_id,
  MAX(k.keyword_max_cpt_bid) as keyword_max_cpt_bid,
  CASE WHEN k.report_date >= $3 AND k.report_date <= $4 
    THEN 'current' ELSE 'previous' END as period,
  ...
FROM daily_keyword_metrics k
WHERE ((k.report_date >= $1 AND k.report_date <= $2)
    OR (k.report_date >= $3 AND k.report_date <= $4))
GROUP BY k.keyword_text, k.campaign_name, k.ad_group_name, 
         k.app_id, k.app_name, period
         -- NO bid_strategy in GROUP BY
```

**Why 14D Worked:** Wider period window (Aug 3-16) included "Manage Bids" rows with £1.30. `MAX()` picked £1.30.

**Why 7D Failed:** Narrow period window (Aug 10-16) only had "Manual CPT" rows with NULL bids. `MAX()` returned NULL.

**MY BROKEN FIX:**

Added `COALESCE(k.bid_strategy, '') as bid_strategy` to SELECT and `k.bid_strategy` to GROUP BY.

**Why It Broke Everything:** Created separate rows per `bid_strategy`, violating frontend's expectation of one row per keyword.

### Step 4: Root Cause

1. **Data Reality:** Apple Search Ads reports multiple `bid_strategy` values for the same keyword
2. **Only Some Have Bids:** "Manage Bids" has £1.30, "Manual CPT" has NULL
3. **UI Expectation:** Show ONE row per keyword (identified without bid_strategy)
4. **Wrong Approach:** Treating `bid_strategy` as part of keyword identity for period comparison

---

## Solution

### Correct Approach

1. **GROUP BY keyword only** (no `bid_strategy`) → One API row per keyword
2. **Point-in-time bid lookups** query across ALL `bid_strategy` values
3. **Pick latest non-null bid** from ANY strategy for that keyword

### Implementation

**Updated `resolveKeywordBids()` function:**

```javascript
async function resolveKeywordBids(keywordIdentities, currentEndDate, previousEndDate) {
  for (const identity of keywordIdentities) {
    const key = `${identity.app_id}|${identity.campaign_name}|${identity.ad_group_name}|${identity.keyword_text}`
    
    // Find current bid across ALL bid_strategy values
    const currentBidResult = await pool.query(
      `SELECT keyword_max_cpt_bid
       FROM daily_keyword_metrics
       WHERE app_id = $1
         AND campaign_name = $2
         AND ad_group_name = $3
         AND keyword_text = $4
         AND report_date <= $5
         AND keyword_max_cpt_bid IS NOT NULL
       ORDER BY report_date DESC, id DESC
       LIMIT 1`,
      [identity.app_id, identity.campaign_name, identity.ad_group_name, 
       identity.keyword_text, currentEndDate]
    )
    
    // Same for previous bid...
  }
}
```

**Key Changes:**
- Removed `bid_strategy` filter from WHERE clause
- Removed `bid_strategy` from function parameters
- Removed `bid_strategy` from GROUP BY in main query
- Removed `bid_strategy` from Map keys

---

## Test Results

### Keyword: "circuit plus"

**7D (Aug 10-16):**
- ✅ Current Bid: £1.30 (was N/A)
- ✅ Previous Bid: £1.30
- ✅ Bid Change: £0.00
- ✅ Bid %: 0%
- ✅ **1 row returned** (was 2)

**14D (Aug 3-16):**
- ✅ Current Bid: £1.30 (was £1.30, still working)
- ✅ Previous Bid: £1.30
- ✅ Bid Change: £0.00
- ✅ Bid %: 0%
- ✅ **1 row returned** (was 2)

**30D (Jul 18 - Aug 16):**
- ✅ Current Bid: £1.30
- ✅ Previous Bid: £1.30
- ✅ Bid Change: £0.00
- ✅ Bid %: 0%
- ✅ **1 row returned**

### Keyword: "courier" (Different Campaign)

**7D:**
- ✅ Current Bid: £2.01
- ✅ Previous Bid: £2.01
- ✅ **1 row returned**

**14D:**
- ✅ Current Bid: £2.01
- ✅ Previous Bid: £2.01
- ✅ **1 row returned**

### Analytics Tests
- ✅ 22/22 tests passed (no regressions)

---

## Files Changed

### 1. `backend/analyticsService.js`

**Lines 367-420:** Updated `resolveKeywordBids()` function
- Removed `bid_strategy` parameter
- Removed `bid_strategy` filter from WHERE clause
- Query now searches across ALL bid_strategy values

**Lines 431-448:** Updated comparison mode SQL
- Removed `COALESCE(k.bid_strategy, '') as bid_strategy` from SELECT
- Removed `k.bid_strategy` from GROUP BY

**Lines 462-485:** Updated non-comparison mode SQL
- Removed `COALESCE(k.bid_strategy, '') as bid_strategy` from SELECT
- Removed `k.bid_strategy` from GROUP BY

**Lines 495-530:** Updated grouping logic
- Changed Map key from including `bid_strategy` to excluding it
- Removed `bid_strategy` field from grouped item
- Updated `keywordIdentities` array to not include `bid_strategy`

---

## Why My Previous Fix Broke 14D

**Original behavior:**
- SQL returned 1 row per keyword (aggregated across bid_strategy)
- 14D: MAX(keyword_max_cpt_bid) = £1.30 from "Manage Bids" rows

**My broken fix:**
- SQL returned 2 rows per keyword (one per bid_strategy)
- Row 1: bid_strategy='Manage Bids', bid = £1.30
- Row 2: bid_strategy='Manual CPT', bid = NULL
- Frontend displayed first row OR got confused by duplicates

**Why it broke:**
- Frontend expects ONE row per keyword
- UI doesn't show or filter by bid_strategy
- Multiple rows violated this contract

---

## Final Lookup Rule

### Current Bid
```
SELECT keyword_max_cpt_bid
FROM daily_keyword_metrics
WHERE app_id = ?
  AND campaign_name = ?
  AND ad_group_name = ?
  AND keyword_text = ?
  AND report_date <= currentEndDate
  AND keyword_max_cpt_bid IS NOT NULL
ORDER BY report_date DESC, id DESC
LIMIT 1
```

**No bid_strategy filter** → queries across ALL strategies

### Previous Bid
Same query with `report_date <= previousEndDate`

### Keyword Identity for Period Comparison
```
app_id | campaign_name | ad_group_name | keyword_text
```

**Explicitly NOT including:** `bid_strategy`

---

## Important Distinction: Two Different Identities

### 1. Period Comparison Identity (Keywords Page)
```
app_id | campaign_name | ad_group_name | keyword_text
```

**Used for:** Normal keyword reporting, period comparisons, UI display

**Rationale:** Users see keywords, not bid strategies. UI doesn't display or filter by `bid_strategy`.

### 2. Bid Experiment Identity (Bid History)
```
app_id | campaign_name | ad_group_name | keyword_text | bid_strategy
```

**Used for:** Tracking specific bid changes for experiment observation

**Rationale:** When analyzing a bid change experiment, the specific `bid_strategy` matters because the user changed the bid under a specific strategy.

**These are NOT interchangeable.** The Bid History feature uses the full identity. The Keywords period comparison uses the shorter identity.

---

## Verification Checklist

- [x] 7D shows valid bid values (not N/A)
- [x] 14D still works (not broken)
- [x] 30D shows consistent bid values
- [x] Only 1 row returned per keyword
- [x] Bid change calculation correct (£0.00 for unchanged)
- [x] Bid % calculation correct (0% for unchanged)
- [x] Second keyword from different campaign verified
- [x] Existing analytics tests pass (no regressions)

---

## Lessons Learned

1. **Don't assume data structure:** Always inspect actual database rows first
2. **Multiple strategies per keyword:** Apple Search Ads can report the same keyword under different bid strategies
3. **UI contract matters:** API must return what the frontend expects (1 row per keyword)
4. **Identity varies by use case:** Period comparison uses 4-field identity, Bid Experiments use 5-field identity
5. **Diagnose before fixing:** The first fix failed because I didn't understand the data structure

---

## Conclusion

The bid regression has been fully resolved. The implementation now:

1. ✅ Returns one API row per keyword (as frontend expects)
2. ✅ Uses point-in-time bid lookups (not period aggregation)
3. ✅ Queries across all bid_strategy values (picks latest non-null)
4. ✅ Works consistently for 7D, 14D, and 30D periods
5. ✅ Introduces no regressions to existing functionality

Both 7D and 14D now display accurate bid comparison data.
