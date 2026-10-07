# Phase 6B: Before Coding - Current State and Proposed Changes

## 1. Inspection Results

### Existing Campaign and Keyword Chart Components

**Finding**: ❌ **No dedicated campaign or keyword detail trend charts found**

#### Current Detail Views

**CampaignDetailDrawer.jsx**:
- Shows summary stats only (Spend, Installs, CPA, Taps, CR, Budget)
- Has Notes button
- ❌ No trend chart

**Keyword Detail View**:
- ❌ Does not exist
- Keywords page shows table only (KeywordBidTable)

**Dashboard TrendChart**:
- ✅ Exists but shows aggregated data across all campaigns
- User specified: "Do not modify Dashboard insights, page layouts, unrelated charts"
- This is an "unrelated chart"

---

## 2. Entity Key Generation

### Campaign Entity Key ✅

**Source**: `frontend/src/utils/entityKeys.js`

```javascript
buildCampaignEntityKey({ 
  appId: campaign.app_id, 
  campaignName: campaign.campaign_name 
})
```

**Example**: `"12345|Brand Campaign"`

**Format**: `appId|campaignName`

### Keyword Entity Key ✅

**Source**: `frontend/src/utils/entityKeys.js`

```javascript
buildKeywordEntityKey({ 
  appId: keyword.app_id, 
  campaignName: keyword.campaign_name,
  adGroupName: keyword.ad_group_name,
  keyword: keyword.keyword_text
})
```

**Example**: `"12345|Brand Campaign|Ad Group 1|shoes"`

**Format**: `appId|campaignName|adGroupName|keyword`

---

## 3. Chart Library Confirmation ✅

**Type**: Custom SVG-based chart (not third-party library)

**Location**: `frontend/src/components/TrendChart.jsx`

**Capabilities**:
- ✅ Custom SVG elements can be added
- ✅ Coordinate mapping functions exist:
  - `valueToY(value, minY, maxY, plotTop, plotHeight)` - Maps metric value to Y coordinate
  - `indexToX(index, count, plotLeft, plotWidth)` - Maps data point index to X coordinate
- ✅ Hover interactions implemented
- ✅ Tooltips implemented
- ✅ Null value handling (gaps in data)

**Marker Support**: Can add `<circle>`, `<path>`, `<rect>` SVG markers

---

## 4. Backend Daily Trend API

### Analytics Service Function ✅

**Function**: `getDailyTrend({ startDate, endDate, appId, campaignName })`

**Location**: `backend/analyticsService.js` (line 532)

**Returns**: Array of daily data points
```javascript
[
  {
    date: "2026-07-14",
    spend: 123.45,
    impressions: 5000,
    taps: 250,
    installs: 15,
    installs_tap_through: 15,
    installs_view_through: 2,
    installs_total: 17,
    cpa: 8.23,
    cpt: 0.49,
    ttr: 5.0,
    cr: 6.0
  },
  // ...
]
```

**Filter Support**:
- ✅ `appId` - filter by app
- ✅ `campaignName` - filter by specific campaign
- ✅ `startDate` / `endDate` - date range
- ❌ No `keyword` filter (uses `daily_campaign_metrics` table)

### Keyword Daily Trend

**Status**: ❌ No dedicated keyword daily trend function

**Required**: New function `getKeywordDailyTrend({ startDate, endDate, appId, campaignName, adGroupName, keyword })`

**Data Source**: `daily_keyword_metrics` table

### API Endpoints

**Status**: ❌ No REST endpoints exist for daily trends

**Required**:
```
GET /api/campaigns/daily-trend?campaignName=...&appId=...&startDate=...&endDate=...
GET /api/keywords/daily-trend?keyword=...&campaignName=...&appId=...&startDate=...&endDate=...
```

---

## 5. Files to Change

### Backend (5 files)

#### New API Endpoints
**`backend/index.js`**
- Add `GET /api/campaigns/daily-trend`
- Add `GET /api/keywords/daily-trend`

#### New Analytics Function
**`backend/analyticsService.js`**
- Add `getKeywordDailyTrend()` function (query `daily_keyword_metrics`)
- Export new function

### Frontend (8+ files)

#### New Components
1. **`frontend/src/components/KeywordDetailDrawer.jsx`** (NEW)
   - Show keyword summary stats
   - Embed TrendChart
   - Embed ChartAnnotations

2. **`frontend/src/components/ChartAnnotations.jsx`** (NEW)
   - Fetch annotations by entityType + entityKey
   - Map annotation dates to chart coordinates
   - Render SVG markers
   - Show tooltip on hover
   - Group same-day annotations
   - Different marker styles by note type

#### Modified Components
3. **`frontend/src/components/CampaignDetailDrawer.jsx`**
   - Fetch campaign daily trend data
   - Add TrendChart component
   - Add ChartAnnotations component
   - Pass date range from app filters

4. **`frontend/src/components/TrendChart.jsx`**
   - Add `annotations` prop (optional)
   - Add `renderAnnotations` child prop or slot
   - Expose coordinate mapping for external use
   - Ensure annotations render on top layer

5. **`frontend/src/components/KeywordBidTable.jsx`**
   - Add "View Details" button column
   - Wire up KeywordDetailDrawer
   - Pass entity_key to drawer

6. **`frontend/src/components/CampaignPerformanceTable.jsx`**
   - Ensure "View Details" passes entity_key
   - May already be correct

#### API Layer
7. **`frontend/src/api.js`**
   - Add `fetchCampaignDailyTrend()`
   - Add `fetchKeywordDailyTrend()`

#### Styles
8. **`frontend/src/styles/app.css`**
   - Add `.chart-annotation-marker` styles
   - Add note type color variants
   - Add annotation tooltip styles
   - Ensure detail drawer can fit charts

---

## 6. Implementation Approach

### Phase 1: Add Trend Charts to Detail Views

**Step 1**: Create backend endpoints
- Add `/api/campaigns/daily-trend` route
- Add `getKeywordDailyTrend()` to analyticsService
- Add `/api/keywords/daily-trend` route

**Step 2**: Enhance CampaignDetailDrawer
- Fetch daily trend on open
- Render TrendChart
- Use global date filters from AppContext
- Support comparison mode

**Step 3**: Create KeywordDetailDrawer
- Mirror CampaignDetailDrawer structure
- Fetch keyword daily trend
- Render TrendChart

**Step 4**: Wire up detail views
- Add "View Details" to KeywordBidTable
- Test charts work correctly

### Phase 2: Add Annotation Markers

**Step 1**: Create ChartAnnotations component
- Fetch annotations
- Filter by date range
- Map to chart coordinates
- Render SVG markers

**Step 2**: Design marker styles
- Different shapes/colors by note type
- Grouped marker indicator
- Hover tooltip

**Step 3**: Integrate into charts
- Add to CampaignDetailDrawer chart
- Add to KeywordDetailDrawer chart
- Test hover interactions

---

## 7. Annotation Marker Design

### Marker Styles by Note Type

```
note         → Blue filled circle    ●
optimisation → Green filled star     ★
observation  → Yellow filled diamond ◆
issue        → Red filled triangle   ▲
experiment   → Purple filled square  ■
```

### Grouped Annotations (Multiple on Same Day)

**Marker**: Larger circle with count badge

```svg
<g class="chart-annotation-marker chart-annotation-marker--grouped">
  <circle cx="..." cy="..." r="8" fill="#5B4FD6" />
  <text x="..." y="..." fill="white" font-size="10" text-anchor="middle">3</text>
</g>
```

### Tooltip on Hover

**Single Annotation**:
```
────────────────────────
📝 Note
Created: 14 Jul 2026, 15:30
Pinned

Campaign performing well
after budget increase.
────────────────────────
```

**Multiple Annotations**:
```
────────────────────────────
📍 3 Notes on 14 Jul 2026
────────────────────────────
✅ Optimisation (Pinned)
Increased daily budget to £50

📝 Note
Good CTR this week

⚠️ Issue
CPA spiking, investigate
────────────────────────────
```

### Date Mapping

**Annotation created_at**: `"2026-07-14T15:30:00.000Z"`  
**Extract date**: `"2026-07-14"`  
**Match to chart**: Find data point with `date === "2026-07-14"`  
**Calculate x**: Use `indexToX(pointIndex, totalPoints, plotLeft, plotWidth)`  
**Calculate y**: Fixed position at top of chart (e.g., `plotTop + 10`)

---

## 8. Open Questions Resolved

### Q1: Do backend endpoints exist?
**A**: `getDailyTrend()` exists but no REST endpoints. Need to create them.

### Q2: Should detail drawers use global filters?
**A**: Yes. Use AppContext date range and comparison mode for consistency.

### Q3: How to identify campaign/keyword?
**A**: Use `entity_key` from table row (already in backend responses).

### Q4: Multiple annotations on same date?
**A**: Group visually (show count), list all in tooltip.

### Q5: Marker positioning?
**A**: Fixed Y at top of chart, X based on date match. Avoids obscuring data lines.

---

## Summary for User Confirmation

**Current State**:
- ❌ No campaign detail trend charts
- ❌ No keyword detail trend charts
- ✅ Dashboard has trend charts (unrelated, will not modify)

**Proposed Implementation**:
1. ✅ Add daily trend API endpoints (backend)
2. ✅ Add TrendChart to CampaignDetailDrawer
3. ✅ Create KeywordDetailDrawer with TrendChart
4. ✅ Create reusable ChartAnnotations component
5. ✅ Overlay annotation markers on detail charts
6. ✅ Style by note type, group same-day, show tooltips

**Files to Change**: 13 files (5 backend, 8 frontend)

**Ready to proceed**: Yes ✅
