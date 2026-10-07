# New Keyword Handling - Implementation Summary

## Overview

Implemented proper handling for new keywords that have current performance data but no historical comparison data yet.

**Status:** ✅ Complete

---

## Definition of "New Keyword"

A keyword is classified as "new" when:
- It has valid data in the **current period** (spend > 0 OR impressions > 0 OR taps > 0 OR installs > 0)
- AND it has **no valid data** in the **previous period**

Uses the stable keyword identity from `ANALYTICS.md`:
```
app_id | campaign_name | ad_group_name | keyword_text
```

**Note:** Does NOT use `bid_strategy` in this determination, as period comparison aggregates across all bid strategies.

---

## Backend Implementation

### File: `backend/analyticsService.js`

**Added `comparison_status` field** to keyword summary response:

```javascript
comparisonStatus: 'new' | 'comparable' | 'unavailable'
```

**Classification logic:**

```javascript
const hasPreviousData = item.previous !== null && (
  item.previous.spend > 0 || 
  item.previous.impressions > 0 || 
  item.previous.taps > 0 || 
  item.previous.installs > 0
)

const hasCurrentData = item.current !== null && (
  item.current.spend > 0 || 
  item.current.impressions > 0 || 
  item.current.taps > 0 || 
  item.current.installs > 0
)

if (hasCurrentData && !hasPreviousData) {
  comparisonStatus = 'new'
} else if (hasCurrentData && hasPreviousData) {
  comparisonStatus = 'comparable'
} else {
  comparisonStatus = 'unavailable'
}
```

---

## Frontend Implementation

### 1. Keywords Table (`KeywordBidTable.jsx`)

**Previous Bid Column:**
- For new keywords: displays **"New"** badge (blue, uppercase)
- For comparable keywords: displays bid value or N/A

**Bid Change / Bid % Columns:**
- For new keywords: displays **"N/A"**
- For comparable keywords: displays calculated change

```jsx
<BidValueCell 
  value={row.previous_bid} 
  isNew={isNew && showCompare} 
/>
```

### 2. Keyword Overview Panel (`KeywordOverviewPanel.jsx`)

**New Keyword Notice (top of panel):**

Displays prominently when `comparison_status === 'new'`:

```
┌─────────────────────────────────────────────────┐
│ [New] This keyword is new. There is not enough │
│ historical data yet to compare its performance  │
│ with an earlier period. Comparisons will appear │
│ automatically as more data is collected.        │
└─────────────────────────────────────────────────┘
```

**Period Comparison Table:**
- Previous values: show "—" (dash)
- Change column: show "—"
- Movement column: show **"New"**

**Performance Insights:**
- **Skipped entirely** for new keywords (no insights generated)
- Avoids misleading "new activity" messages

### 3. Data Mapping (`keywordAnalysis.js`)

**Added `comparison_status` to mapped keyword row:**

```javascript
comparison_status: row.comparison_status ?? 'comparable'
```

**Updated insights generation:**

```javascript
export function buildKeywordPerformanceInsights(keyword) {
  if (!keyword?.period_compare) return []
  
  // Skip insights for new keywords
  if (keyword.comparison_status === 'new') return []
  
  // ... rest of insights logic
}
```

---

## CSS Styling (`app.css`)

### New Keyword Indicators

**Table "New" badge:**
```css
.keyword-new-indicator {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  color: #0284c7;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
}
```

**Overview notice box:**
```css
.keyword-overview__new-notice {
  background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
  border: 1px solid #bae6fd;
  border-radius: 8px;
  padding: 1rem;
}
```

---

## Display Behavior

### New Keyword Example

**Backend Response:**
```json
{
  "keyword": "deliver app",
  "comparison_status": "new",
  "current_bid": 1.00,
  "previous_bid": 1.00,
  "bid_change": 0,
  "bid_change_percent": 0,
  "current_spend": 0.92,
  "current_impressions": 12,
  "current_taps": 1,
  "current_installs": 0,
  "previous_spend": null,
  "previous_impressions": null,
  "previous_taps": null,
  "previous_installs": null
}
```

**Keywords Table Display:**
| Keyword | Current Bid | Prev Bid | Bid Change | Bid % |
|---------|-------------|----------|------------|-------|
| deliver app | £1.00 | **New** | N/A | N/A |

**Overview Panel:**
- ✅ New keyword notice shown
- ✅ Current metrics displayed: Spend £0.92, Impressions 12, Taps 1, Installs 0
- ✅ Period comparison table shows "—" for previous values, "New" in Movement column
- ✅ No insights generated (section hidden)

### Established Keyword (Comparison)

**Backend Response:**
```json
{
  "keyword": "parcel delivery app",
  "comparison_status": "comparable",
  "current_bid": 2.50,
  "previous_bid": 2.50,
  "bid_change": 0,
  "bid_change_percent": 0,
  "current_spend": 150.24,
  "previous_spend": 178.00
}
```

**Keywords Table Display:**
| Keyword | Current Bid | Prev Bid | Bid Change | Bid % |
|---------|-------------|----------|------------|-------|
| parcel delivery app | £2.50 | £2.50 | £0.00 | 0% |

**Overview Panel:**
- ❌ No new keyword notice
- ✅ Current metrics displayed
- ✅ Period comparison table shows previous values and calculated changes
- ✅ Insights generated normally

---

## Automatic Transition

Once a keyword accumulates data in a previous period:

1. **Backend automatically updates** `comparison_status` from `"new"` to `"comparable"`
2. **Frontend automatically switches** to normal comparison display:
   - Previous Bid shows actual value (not "New")
   - Bid Change and Bid % show calculated values
   - Period comparison table populates previous values
   - Insights are generated

**No manual action required.**

---

## What Was NOT Changed

✅ Bid Experiment detection  
✅ Bid History feature  
✅ Observation windows  
✅ Analytics formulas (CPT, CPA, TTR, CR)  
✅ CSV imports  
✅ Database schema  
✅ Dashboard page  
✅ Campaign analytics  
✅ Point-in-time bid resolution logic

---

## Test Results

### Backend Classification

Sample from 7D period (Aug 10-16, 2026):
- **129 comparable keywords** (have both current and previous data)
- **43 new keywords** (have current data but no previous data)
- **70 unavailable keywords** (insufficient data for comparison)

### Analytics Tests

```
22/22 tests passed ✅
```

No regressions introduced.

---

## Files Changed

### Backend
1. **`backend/analyticsService.js`**
   - Added `comparison_status` field logic
   - Classification based on presence of previous-period data

### Frontend
2. **`frontend/src/utils/keywordAnalysis.js`**
   - Pass through `comparison_status` in `mapPeriodKeywordRow`
   - Skip insights generation for new keywords in `buildKeywordPerformanceInsights`

3. **`frontend/src/components/KeywordBidTable.jsx`**
   - Updated `BidValueCell` to accept `isNew` prop
   - Display "New" badge for previous bid when `isNew && showCompare`
   - Show N/A for bid change/percent when `isNew`

4. **`frontend/src/components/KeywordOverviewPanel.jsx`**
   - Added new keyword notice section at top of panel
   - Updated period comparison table to show "—" for previous values when new
   - Show "New" in Movement column when new

5. **`frontend/src/styles/app.css`**
   - Added styles for `.keyword-new-indicator`
   - Added styles for `.keyword-overview__new-notice` and child elements
   - Added style for `.keyword-overview-new-indicator`

### Documentation
6. **`docs/ANALYTICS.md`**
   - Added "New keyword handling" section
   - Documented `comparison_status` field values
   - Described frontend display behavior

7. **`docs/NEW_KEYWORD_HANDLING.md`** (new)
   - Complete implementation summary

---

## Acceptance Criteria

### New Keyword

| Criterion | Status |
|-----------|--------|
| Current Bid displays | ✅ Shows latest valid Max CPT |
| Previous Bid not fabricated | ✅ Shows "New" badge, not copied current value |
| No misleading change percentage | ✅ Shows N/A |
| Current metrics visible | ✅ All current metrics display normally |
| UI explains data collection | ✅ Clear notice with explanation |

### Established Keyword

| Criterion | Status |
|-----------|--------|
| Normal comparisons unchanged | ✅ All comparisons work as before |

---

## User Experience

### Before (All Keywords Treated as Comparable)

New keywords showed:
- Previous Bid: N/A or £0.00
- Bid Change: misleading % or Infinity
- Period comparison: "vs N/A" repeated under every metric
- Insights: "New activity" for every metric

**Problem:** Confusing, looked like data errors

### After (New Keywords Properly Identified)

New keywords show:
- Previous Bid: **"New"** badge (clear indicator)
- Bid Change / Bid %: N/A (honest)
- Period comparison: One clear "New" state for the entire row
- Insights: None (avoids noise)
- Explanatory text: "This keyword is new. There is not enough historical data yet..."

**Result:** Clear, honest, informative

---

## Future Considerations

### Potential Enhancements (Not Implemented)

1. **Badge variations:**
   - "New" → first 7 days
   - "Collecting data" → after 7 days but before comparison window complete

2. **Confidence indicators:**
   - "Low confidence" for keywords with minimal previous data
   - "High confidence" for keywords with substantial history

3. **Onboarding tooltips:**
   - Explain what "New" means on hover
   - Link to help documentation

These are intentionally deferred to keep the initial implementation simple and focused.

---

## Conclusion

New keywords are now properly handled with clear, honest presentation that:

1. ✅ Shows valid current performance
2. ✅ Doesn't fabricate previous values
3. ✅ Explains why comparison isn't available
4. ✅ Automatically transitions to normal comparison when data accumulates
5. ✅ Maintains all existing functionality for established keywords

The implementation is complete, tested, and ready for production.
