# Phase 4C Keywords Audit

## Endpoints Using Old Logic

### ✅ `/api/compare/period` - PRIMARY KEYWORDS DATA
**Status**: Using Analytics Service  
**Implementation**: `compareStructured.js` → `getKeywordSummary()`  
**Queries**: `daily_keyword_metrics` structured table ✅  
**Used By**: Keywords analysis page when comparison enabled

### `/api/imports/compare` - HISTORY PAGE ONLY
**Status**: Uses old `compare.js` with JSONB queries  
**Purpose**: Compare TWO specific imports on History page  
**Used By**: History page import comparison feature  
**Action**: ⚠️ NOT USED BY KEYWORDS ANALYSIS - No migration needed for this audit

### `/api/imports/:id/keyword-summary` - HISTORY PAGE ONLY
**Status**: Uses old `imports.js` with JSONB queries  
**Purpose**: Show keywords for ONE specific import on History page  
**Used By**: History page import details view  
**Action**: ⚠️ NOT USED BY KEYWORDS ANALYSIS - No migration needed for this audit

---

## Current State

### Keywords Page Data Sources

1. **When Comparison Enabled** (7D/14D/30D):
   - ✅ Uses `periodComparison.keywords` from Analytics Service
   - ✅ Queries `daily_keyword_metrics` structured table
   - ✅ Phase 2 formulas via `calculateDerivedMetrics()`

2. **When Comparison Disabled** (ALL):
   - ❌ Uses `keywordSummary.keywords` from History import
   - ❌ This is for History page, not Keywords analysis
   - ⚠️ Keywords page should guide user to enable comparison

---

## Issues Found

### 1. Missing `app_key` Field ❌
Keywords response lacks `app_key` field needed for frontend filtering.

**Current**: Only has `app_id` and `app_name`  
**Needed**: `app_key: id:${app_id.toLowerCase()}`  
**Impact**: Frontend `filterByApp()` may fail to match

### 2. Keyword Identity Fields
Database has NO separate ID columns for:
- ❌ `campaign_id` - doesn't exist in Apple Search Ads data
- ❌ `ad_group_id` - doesn't exist in Apple Search Ads data  
- ❌ `keyword_id` - doesn't exist in Apple Search Ads data

**Identity uses names**:
- ✅ `app_id` (numeric)
- ✅ `campaign_name` (text)
- ✅ `ad_group_name` (text)
- ✅ `keyword_text` (text)

**This is correct** - Apple Search Ads doesn't provide separate IDs for these entities.

### 3. Notes Entity Key
Frontend uses `buildKeywordEntityKey()` which combines:
- `app_id`
- `campaign_name`
- `ad_group_name`
- `keyword` text

**Status**: ✅ Correct approach for keywords without separate IDs

---

## Required Fixes

### Fix 1: Add `app_key` to Keyword Response
Similar to campaigns, keywords need `app_key` for frontend filtering.

**File**: `backend/analyticsService.js` - `getKeywordSummary()`

**Change**: Add to comparison response:
```javascript
app_key: `id:${item.app_id.toLowerCase()}`,
```

---

## Verification Checklist

- [x] ✅ Keywords use Analytics Service (`getKeywordSummary()`)
- [x] ✅ Queries structured table (`daily_keyword_metrics`)
- [x] ✅ Phase 2 formulas (`calculateDerivedMetrics()`)
- [x] ✅ App filter works (WHERE clause fixed)
- [x] ✅ Bid fields present (current/previous/change/%)
- [x] ✅ Period comparison works
- [x] ✅ Install attribution uses `installs_tap_through` with COALESCE fallback
- [ ] ❌ Missing `app_key` field
- [x] ✅ Keyword identity uses names (correct - no IDs exist)
- [x] ✅ Notes entity key correct

---

## No Migration Needed

These endpoints serve different purposes (History page):
- `/api/imports/compare` - Compare two imports
- `/api/imports/:id/keyword-summary` - Show import details

They are NOT used by Keywords analysis page and don't need migration for this audit.
