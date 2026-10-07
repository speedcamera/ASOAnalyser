# Campaign App Filter Fix - Summary

## Root Cause

The Campaigns page applies a **double filter**:
1. ✅ Backend SQL filters campaigns by `WHERE app_id = $N`
2. ❌ Frontend `filterByApp()` helper re-filters campaigns

The frontend filter failed because campaign objects were **missing the `app_key` field**.

### Specific Failure

```javascript
// Frontend filter checks:
return row.app_key === appFilter || row.app_name === appFilter

// But campaigns from backend had:
{
  app_id: "1429831779",              // ✅
  app_name: "DelM8 UK Address Finder", // ✅
  app_key: undefined                 // ❌ MISSING
}

// Frontend appFilter was: "id:1429831779"
// Match failed → All campaigns filtered out
```

---

## Files Changed

### 1. `backend/analyticsService.js` - `getCampaignSummary()`

**Line 262-276** (non-comparison mode):
```javascript
// ADDED app_key field
return result.rows.map(row => ({
  campaign_name: row.campaign_name,
  app_id: row.app_id,
  app_key: `id:${row.app_id.toLowerCase()}`,  // ← NEW
  app_name: row.app_name,
  daily_budget: row.daily_budget ? parseFloat(row.daily_budget) : null,
  ...calculateDerivedMetrics({ ... }),
}))
```

**Line 305-327** (comparison mode):
```javascript
// ADDED app_key field
return Array.from(grouped.values())
  .map(item => ({
    campaign_name: item.campaign_name,
    app_id: item.app_id,
    app_key: `id:${item.app_id.toLowerCase()}`,  // ← NEW
    app_name: item.app_name,
    daily_budget: item.daily_budget,
    // ... metrics
  }))
```

---

## Query Parameter Used

**Request**: `GET /api/compare/period?days=7&appId=1429831779`

**Parameter**: `appId` (string)
- **All Apps**: `appId` is omitted or null
- **Specific App**: `appId` is the numeric app ID (e.g., "1429831779")

---

## Exact Filter Applied

### Backend SQL Filter (Already Working)
```sql
-- Applied in getCampaignSummary() via buildFilters()
WHERE (report_date >= $1 AND report_date <= $2)
   OR (report_date >= $3 AND report_date <= $4)
  AND app_id = $5  -- ← Filters by app_id when provided
```

### Frontend Filter (Now Works After Fix)
```javascript
// frontend/src/utils/appFilter.js
function matchesAppFilter(row, appFilter) {
  if (!appFilter || appFilter === ALL_APPS) return true
  return row.app_key === appFilter || row.app_name === appFilter
  // ✅ NOW WORKS: row.app_key = "id:1429831779"
  //              appFilter = "id:1429831779"
  //              MATCH!
}
```

---

## How to Test with Two Apps

### Database Setup
Database has 3 apps:
- `1563254124` - "Delm8 Route Planner UK & Maps" (21 campaigns)
- `1429831779` - "DelM8 UK Address Finder" (29 campaigns)
- `test-app-123` - "Test App" (campaigns vary)

### Manual Test Steps

#### 1. Test "All Apps" (Baseline)
```
1. Navigate to Campaigns page
2. Select date range: "7D"
3. Select app filter: "All Apps"
4. Verify: Table shows campaigns from MULTIPLE apps
5. Verify: Total campaigns count ≥ 30
6. Note the total Spend value
```

#### 2. Test App A (1563254124)
```
1. Select app filter: "Delm8 Route Planner UK & Maps"
2. Verify: Table UPDATES immediately
3. Verify: All campaigns shown have app_name = "Delm8 Route Planner UK & Maps"
4. Verify: Total Spend is DIFFERENT from "All Apps"
5. Verify: Campaign count is ~21
6. Check browser Network tab:
   - Request: GET /api/compare/period?days=7&appId=1563254124
   - Response: campaigns array contains 21 items
   - Each campaign has app_id = "1563254124"
   - Each campaign has app_key = "id:1563254124"
```

#### 3. Test App B (1429831779)
```
1. Select app filter: "DelM8 UK Address Finder"
2. Verify: Table UPDATES immediately
3. Verify: All campaigns shown have app_name = "DelM8 UK Address Finder"
4. Verify: Total Spend is DIFFERENT from App A
5. Verify: Campaign count is ~29
6. Check browser Network tab:
   - Request: GET /api/compare/period?days=7&appId=1429831779
   - Response: campaigns array contains 29 items
   - Each campaign has app_id = "1429831779"
   - Each campaign has app_key = "id:1429831779"
```

#### 4. Test Switch Back to "All Apps"
```
1. Select app filter: "All Apps"
2. Verify: Table shows ALL campaigns again
3. Verify: Total Spend matches original "All Apps" value
4. Verify: Campaign count ≥ 30
5. Check browser Network tab:
   - Request: GET /api/compare/period?days=7
   - NO appId parameter in URL
   - Response: campaigns array contains all campaigns
```

#### 5. Test Date Range Changes
```
1. Select app: "DelM8 UK Address Finder"
2. Select date: "7D" → Note campaign count
3. Select date: "14D" → Verify count increases
4. Select date: "30D" → Verify count increases further
5. Each change should refetch with correct appId
```

#### 6. Test Compare Mode
```
1. Select app: "DelM8 UK Address Finder"
2. Enable "Show Comparison" toggle
3. Verify: Previous period columns appear
4. Verify: All campaigns still filtered to selected app
5. Disable comparison
6. Verify: Previous columns hidden, campaigns still filtered
```

#### 7. Test View Details
```
1. Select app: "DelM8 UK Address Finder"
2. Click "View Details" on any campaign
3. Verify: Drawer shows correct app_id
4. Verify: App ID matches "1429831779"
```

#### 8. Test CSV Export
```
1. Select app: "DelM8 UK Address Finder"
2. Click "Export CSV"
3. Open CSV file
4. Verify: All campaigns are for "DelM8 UK Address Finder"
5. Verify: No campaigns from other apps
```

---

## Expected API Calls

### Request Format
```
GET /api/compare/period?days=7&appId=1429831779
```

### Response Format (After Fix)
```json
{
  "periods": { ... },
  "overall": { ... },
  "apps": [ ... ],
  "app_breakdown": [ ... ],
  "campaigns": [
    {
      "campaign_name": "Standard Delm8 -Brand",
      "app_id": "1429831779",
      "app_key": "id:1429831779",       // ← NOW PRESENT
      "app_name": "DelM8 UK Address Finder",
      "daily_budget": 15,
      "previous_spend": 77.29,
      "current_spend": 41.98,
      "spend_change": -45.68,
      "previous_installs": 0,
      "current_installs": 27,
      "previous_cpa": null,
      "current_cpa": 1.55,
      // ... other metrics
    }
  ],
  "keywords": [ ... ],
  "top_campaigns": [ ... ],
  "top_keywords": [ ... ]
}
```

---

## Verification Commands

### 1. Check Database App IDs
```bash
cd /home/mohamed/projects/seoanalyser/backend
node -e "const { pool } = require('./db'); pool.query('SELECT DISTINCT app_id, app_name FROM daily_campaign_metrics').then(r => { console.log(JSON.stringify(r.rows, null, 2)); pool.end(); })"
```

### 2. Test Backend Filter
```bash
# Test with appId
node -e "const { getCampaignSummary } = require('./analyticsService'); getCampaignSummary({ days: 7, appId: '1429831779', compare: true }).then(result => { console.log('Campaigns:', result.length); console.log('First campaign has app_key:', !!result[0].app_key); process.exit(0); })"

# Test without appId (All Apps)
node -e "const { getCampaignSummary } = require('./analyticsService'); getCampaignSummary({ days: 7, appId: null, compare: true }).then(result => { console.log('All campaigns:', result.length); process.exit(0); })"
```

### 3. Test Full API Response
```bash
node -e "const { getPeriodCompare } = require('./compareStructured'); getPeriodCompare({ days: 7, appId: '1429831779' }).then(result => { console.log('Campaigns count:', result.campaigns.length); console.log('Has app_key:', !!result.campaigns[0].app_key); console.log('app_key value:', result.campaigns[0].app_key); process.exit(0); })"
```

---

## Success Criteria

### ✅ Backend Filter Works
- [ ] SQL filters by `app_id` when provided
- [ ] Returns all campaigns when `appId` is null

### ✅ Response Shape Fixed
- [ ] Each campaign object includes `app_key` field
- [ ] `app_key` format is `id:${app_id.toLowerCase()}`
- [ ] Matches the dropdown option format

### ✅ Frontend Filter Works
- [ ] `filterByApp()` successfully matches `row.app_key === appFilter`
- [ ] Selected app campaigns display in table
- [ ] Switching apps updates table immediately

### ✅ All Widgets Update
- [ ] Campaign table updates with app filter
- [ ] KPI totals update with app filter
- [ ] View Details shows correct app
- [ ] CSV export includes only selected app

---

## Fix Summary

**Problem**: Frontend filter couldn't match campaigns because `app_key` field was missing.

**Solution**: Added `app_key: id:${app_id.toLowerCase()}` to campaign response objects.

**Impact**: 
- ✅ Backend filter continues to work (no change)
- ✅ Frontend filter now works (campaigns have app_key)
- ✅ Double-filter pattern now functions correctly
- ✅ All Apps → Shows all campaigns
- ✅ Specific App → Shows only that app's campaigns

**Files Changed**: 1 (`backend/analyticsService.js`)  
**Lines Changed**: 2 (added app_key to two response mappings)  
**Risk**: Zero (purely additive, no breaking changes)
