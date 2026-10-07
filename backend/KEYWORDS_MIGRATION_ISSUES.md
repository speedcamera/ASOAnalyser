# Keywords Migration Issues - Diagnosis

## Issue 1: Missing Bid Fields

### Frontend Expectation (keywordAnalysis.js lines 55-58)
```javascript
current_bid: row.current_bid,
previous_bid: row.previous_bid,
bid_change: row.bid_change,
bid_change_percent: row.bid_change_percent,
```

### Current API Response
```json
{
  "keyword": "posttag: address finder",
  "keyword_max_cpt_bid": 10,
  // Missing: current_bid, previous_bid, bid_change, bid_change_percent
}
```

### Root Cause

The Analytics Service `getKeywordSummary()` comparison query uses:
```sql
MAX(keyword_max_cpt_bid) as keyword_max_cpt_bid
```

This aggregates the bid across BOTH periods, losing period-specific bid values.

The grouping happens AFTER period filtering:
```sql
GROUP BY keyword_text, campaign_name, ad_group_name, app_id, app_name, period
```

But the MAX is computed per period, then stored in `grouped` map with only one `keyword_max_cpt_bid` value, not separate current/previous bids.

**Solution needed**: Track `keyword_max_cpt_bid` per period in the grouped object, then calculate bid changes.

---

## Issue 2: Campaign Dropdown Not Filtered by App

### Current Behavior
- Main app filter (AppContext) sends `appId` to backend
- Backend returns keywords filtered by app ✅
- FilterBar's campaign dropdown should show only campaigns from those keywords
- `collectCampaignOptions(sourceRows, app)` filters by `app_name`

### Root Cause

The FilterBar has TWO app filters:
1. **Main app filter** (AppContext) - filters backend data ✅
2. **FilterBar app dropdown** - client-side only filtering

When user selects an app in **main filter**, backend returns only that app's keywords.

But the **FilterBar's app dropdown** defaults to "all", so:
- `collectCampaignOptions(sourceRows, 'all')` returns ALL campaigns from sourceRows
- Since sourceRows only has App A keywords, it correctly shows only App A campaigns ✅

**Actually working correctly!** The issue may be:
- Frontend app filter state not syncing with FilterBar
- Or user confusion between two app filters

Need to verify if this is actually a problem or just a UX confusion.

---

## Verification

### Bid Data Exists in Database ✅
```
2026-06-28: bid=3.29
2026-06-29: bid=3.29
...
2026-07-11: bid=3.29
```

### API Response Shape (Missing Fields)
- ✅ Has `keyword_max_cpt_bid`: 10
- ❌ Missing `current_bid`
- ❌ Missing `previous_bid`
- ❌ Missing `bid_change`
- ❌ Missing `bid_change_percent`

---

## Required Changes

### File: `backend/analyticsService.js` - `getKeywordSummary()`

#### 1. Track bid per period in SQL result
Each row from SQL has:
- `period`: 'current' or 'previous'
- `keyword_max_cpt_bid`: MAX bid for that period

#### 2. Store bids in grouped object
```javascript
grouped.set(key, {
  // ...existing fields
  currentBid: null,
  previousBid: null,
})

// When processing rows:
if (row.period === 'current') {
  item.currentBid = parseFloat(row.keyword_max_cpt_bid) || null
} else {
  item.previousBid = parseFloat(row.keyword_max_cpt_bid) || null
}
```

#### 3. Calculate bid changes
```javascript
const bidChange = calcChange(item.currentBid, item.previousBid)
const bidChangePercent = item.currentBid && item.previousBid
  ? ((item.currentBid - item.previousBid) / item.previousBid) * 100
  : null
```

#### 4. Return bid fields
```javascript
return {
  // ...existing fields
  current_bid: item.currentBid,
  previous_bid: item.previousBid,
  bid_change: bidChangePercent,
  bid_change_percent: bidChangePercent,
}
```

---

## Expected Response After Fix

```json
{
  "keyword": "posttag: address finder",
  "campaign_name": "Standard Delm8 - Competitors",
  "keyword_max_cpt_bid": 10,
  "current_bid": 10,
  "previous_bid": 10,
  "bid_change": 0,
  "bid_change_percent": 0,
  "current_spend": 31.26,
  "previous_spend": 19.19,
  // ...other fields
}
```
