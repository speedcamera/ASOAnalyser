# Phase 6B: Chart Annotations Analysis

## Current State Audit

### Existing Components

#### 1. TrendChart.jsx
- **Location**: `frontend/src/components/TrendChart.jsx`
- **Type**: Custom SVG-based chart (not a third-party library)
- **Current Usage**: Dashboard only (Spend Trend, Installs Trend)
- **Features**:
  - Daily data points
  - Current vs Previous period comparison
  - Hover tooltips with metrics
  - Responsive sizing
  - Custom path rendering with null handling

#### 2. CampaignDetailDrawer.jsx
- **Location**: `frontend/src/components/CampaignDetailDrawer.jsx`
- **Current Content**: Summary stats only
  - Spend, Installs, CPA, Taps, CR, Daily Budget
  - Segment pill
  - App ID
  - Notes button
- **Missing**: ❌ No trend chart

#### 3. Keyword Detail View
- **Status**: ❌ No dedicated keyword detail drawer found
- **Current**: Keywords page shows table only (KeywordBidTable)

---

## User Request Interpretation

### Option A: Add Charts + Annotations (Most Likely)
The user wants to:
1. **Add** trend charts to campaign/keyword detail views
2. **Then** overlay annotation markers on those charts

**Evidence**:
- "Campaign and Keyword detail trend charts only" suggests these are specific charts
- "Do not modify Dashboard insights, page layouts, unrelated charts" excludes Dashboard
- No existing detail charts were found

### Option B: Charts Already Exist (Less Likely)
The user expects detail charts already exist but I haven't found them.

**Unlikely because**:
- Thorough search found no campaign/keyword detail charts
- CampaignDetailDrawer has no chart component

---

## Required Implementation (Option A)

### 1. Enhance CampaignDetailDrawer

**Add**:
- Fetch daily campaign metrics for selected campaign
- Render TrendChart component
- Show Spend, Installs, CPA trends over time
- Support current vs previous period comparison
- Overlay annotation markers

**API Endpoint Needed**:
```
GET /api/campaigns/:campaignId/daily-trend
  ?startDate=...
  &endDate=...
  &appId=...
```

### 2. Create KeywordDetailDrawer

**New Component**:
- Similar to CampaignDetailDrawer
- Show keyword summary stats
- Fetch daily keyword metrics
- Render TrendChart component
- Overlay annotation markers

**API Endpoint Needed**:
```
GET /api/keywords/:keywordId/daily-trend
  ?startDate=...
  &endDate=...
  &appId=...
  &campaignId=...
```

### 3. Create ChartAnnotations Component

**Purpose**: Reusable annotation markers for TrendChart

**Features**:
- Fetch annotations by entityType + entityKey
- Map annotation created_at to chart x-axis
- Render SVG markers at correct positions
- Different marker styles by note type
- Group same-day annotations
- Tooltip on hover showing note details
- Filter by chart date range

---

## Entity Key Generation

### Campaign
```javascript
buildCampaignEntityKey({ 
  appId: campaign.app_id, 
  campaignName: campaign.campaign_name 
})
// Result: "12345|Brand Campaign"
```

### Keyword
```javascript
buildKeywordEntityKey({ 
  appId: keyword.app_id, 
  campaignName: keyword.campaign_name,
  adGroupName: keyword.ad_group_name,
  keyword: keyword.keyword_text
})
// Result: "12345|Brand Campaign|Ad Group 1|shoes"
```

---

## Chart Library

**Current**: Custom SVG implementation in TrendChart.jsx

**Supports**:
- ✅ Custom SVG elements (can add markers)
- ✅ Coordinate mapping (valueToY, indexToX functions)
- ✅ Hover interactions (already implemented)
- ✅ Tooltips (already implemented)

**Approach**: Add SVG `<circle>` or `<path>` markers on top of existing chart

---

## Annotation Marker Design

### Visual Styles by Note Type

```
note         → Blue circle
optimisation → Green star
observation  → Yellow diamond
issue        → Red warning triangle
experiment   → Purple square
```

### Grouped Annotations (Same Day)

**Visual**: Stacked marker or number badge
```
[3]  ← Shows count
```

**Tooltip**: List all annotations
```
📌 3 Notes on 14 July 2026
─────────────────────────
✅ Optimisation
Increased daily budget to £50

📝 Note  
Campaign performing well

⚠️ Issue
CPA spiking, investigate
```

---

## Date Mapping Strategy

### annotations.created_at → Chart Date

**Problem**: Annotations store `created_at` (timestamp), chart uses `report_date` (date)

**Solution**: Extract date from created_at
```javascript
const markerDate = annotation.created_at.split('T')[0] // "2026-07-14"
```

**Positioning**:
1. Find matching chart data point by date
2. Use existing `indexToX()` function to get x coordinate
3. Use fixed y position (top of chart) or metric value y position

---

## Files to Change

### New Files
1. `frontend/src/components/KeywordDetailDrawer.jsx` (NEW)
2. `frontend/src/components/ChartAnnotations.jsx` (NEW)

### Modified Files
1. `frontend/src/components/CampaignDetailDrawer.jsx`
   - Add daily trend chart
   - Integrate ChartAnnotations
2. `frontend/src/components/TrendChart.jsx`
   - Add support for rendering child annotations
   - Expose coordinate mapping functions via props
3. `frontend/src/components/CampaignPerformanceTable.jsx`
   - Update "View Details" to pass date range
4. `frontend/src/components/KeywordBidTable.jsx`
   - Add "View Details" button
   - Wire up KeywordDetailDrawer
5. `frontend/src/api.js`
   - Add `fetchCampaignDailyTrend()`
   - Add `fetchKeywordDailyTrend()`
6. `frontend/src/styles/app.css`
   - Add annotation marker styles

### Backend Files (If Endpoints Missing)
1. `backend/index.js` - Add routes
2. `backend/analyticsService.js` - Add daily trend functions (may already exist)

---

## Open Questions

### 1. Do backend endpoints for daily trends exist?

Need to check:
- `GET /api/campaigns/:id/daily-trend` or similar
- `GET /api/keywords/:id/daily-trend` or similar

Or use:
- Existing `getDailyTrend()` from analyticsService.js with filters?

### 2. Should detail drawers match current date/comparison filters?

**Option A**: Use global filters from AppContext
- Pro: Consistent with rest of app
- Pro: No extra UI needed
- Con: Adds complexity to drawer

**Option B**: Show last 30 days always
- Pro: Simpler implementation
- Pro: Self-contained drawer
- Con: Inconsistent with app filters

**Recommendation**: Option A (use global filters)

### 3. How to identify campaign/keyword for detail view?

**Campaign**: Use `entity_key` from backend response
**Keyword**: Use `entity_key` from backend response

Already available in table rows.

---

## Implementation Plan

### Phase 1: Add Charts to Detail Views
1. Add daily trend API calls
2. Integrate TrendChart into CampaignDetailDrawer
3. Create KeywordDetailDrawer with TrendChart
4. Test charts without annotations

### Phase 2: Add Annotation Markers
1. Create ChartAnnotations component
2. Fetch annotations by entity key
3. Map annotations to chart coordinates
4. Render SVG markers
5. Add hover tooltips
6. Handle grouped annotations

---

## Recommendation

**Proceed with Option A**: Add charts first, then annotations.

This matches the user's request for "Campaign and Keyword detail trend charts" and provides a logical place to display annotation markers.

The task breakdown:
1. ✅ Inspect existing components (DONE)
2. ✅ Confirm entity keys (DONE - entityKeys.js)
3. ✅ Confirm chart library (DONE - custom SVG)
4. ⏳ Show files to change (see above)
5. ⏳ Implement charts
6. ⏳ Implement annotations
