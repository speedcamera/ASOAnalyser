# Dashboard Redesign Analysis: Stripe-Style Layout

## Current Dashboard Problems

### 1. Incoherent Layout
**Problem**: Dashboard has evolved incrementally with features stacked vertically in order of implementation.

**Current flow**:
```
1. Large Hero Header (DashboardHeader)
2. KPI Row #1 (4 cards: Spend, Installs, CPA, CPT)
3. Overall Summary (two-column)
4. Detailed Insights (horizontal bar)
5. Performance Alerts
6. Brand Cards (Brand vs Non-Brand split)
7. Trends Section (two charts side-by-side)
8. Top Campaigns Table
9. Top Keywords Table
10. KPI Row #2 (4 cards: Impressions, TTR, CR, Taps)
11. Weekly Performance Trend Table
12. App Breakdown Table (conditional)
```

**Issues**:
- No clear visual hierarchy
- Most important KPIs split between top and bottom
- Overall Summary and Detailed Insights disconnected
- Charts and tables mixed together
- No relationship between chart and overall insight
- Brand Cards unclear value vs space consumed
- Weekly table buried at bottom despite being valuable

---

### 2. Hero Header Too Large
**File**: `DashboardHeader.jsx`

**Current**:
```
┌────────────────────────────────────────────────────────┐
│ Performance Dashboard                                  │
│ 2026-01-01 → 2026-01-07                               │
│ Summary across all selected apps                       │
│                                                         │
│                         [App] [Date] [Custom] [Compare]│
└────────────────────────────────────────────────────────┘
```

**Problems**:
- "Performance Dashboard" title too large
- "Summary across all selected apps" redundant subtitle
- Period displayed separately (duplicates filter state)
- Takes up ~150px vertical space
- Not Stripe-like (Stripe uses compact page headers)

---

### 3. Split KPI Cards
**Current**:
- Primary row (lines 282-345): Spend, Installs, CPA, CPT
- Secondary row (lines 499-550): Impressions, TTR, CR, Taps

**Problems**:
- Users must scroll to bottom to see TTR and CR
- Most important metrics (Installs, CPA, CR) are split
- Secondary KPIs less important but take same space
- No visual indication which are primary vs secondary

**Desired**: Single row with 5 most important KPIs above the fold.

---

### 4. Overall Summary Isolated
**Current**: OverallSummary appears after first KPI row, before detailed insights.

**Problems**:
- No visual connection to charts/trends
- Sits in middle of page disconnected
- User sees summary before seeing the data it summarizes
- Should be paired with primary chart for context

---

### 5. Detailed Insights Poor Layout
**Component**: `InsightsBar.jsx`

**Current**: Horizontal list with 4 cards in a row (`.insights-card__list`).

**Problems**:
- Long horizontal stretch
- Cards forced to squeeze into one row
- Not responsive on narrow screens
- Unclear hierarchy vs Overall Summary
- Should be secondary to Overall Summary

**Desired**: 2-3 column grid below main content.

---

### 6. Charts and Tables Mixed
**Current**:
- Trends section (2 charts)
- Top Campaigns table
- Top Keywords table
- Weekly Performance Trend table

**Problems**:
- No clear "primary chart" - two equal charts
- Tables interrupt visual flow
- Weekly table buried despite high value
- Top Campaigns/Keywords unclear purpose on Dashboard

---

### 7. Brand Cards Unclear Value
**Component**: `BrandCards.jsx`

**Current**: Shows Brand vs Non-Brand spend split with progress bars.

**Problems**:
- Unclear value on Dashboard (more useful in Campaigns)
- Takes significant vertical space
- Appears randomly between Alerts and Trends
- Could be moved to Campaigns page or omitted

---

## Proposed Dashboard Structure

### 1. Compact Page Header
```
┌─────────────────────────────────────────────────────────┐
│ Overview                                        [App ▾] │
│ Monitor Apple Ads performance     [7D][14D][30D][Custom]│
│                                          [Compare: On ▾]│
└─────────────────────────────────────────────────────────┘
```

**Changes**:
- Title: "Performance Dashboard" → "Overview"
- Subtitle: Concise one-liner
- Filters aligned on right
- Period not duplicated
- Height reduced from ~150px to ~80px

---

### 2. KPI Summary Row (5 Cards)
```
┌──────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
│ Total Spend  │   Installs   │     CPA      │     TTR      │      CR      │
│  £12,450     │    1,234     │   £10.09     │    5.4%      │    2.8%      │
│  ↑ 15.2%     │  ↓ 8.3%      │  ↑ 25.1%     │  ↑ 3.2%      │  ↓ 5.4%      │
│  vs £10,800  │  vs 1,347    │  vs £8.06    │  vs 5.2%     │  vs 3.0%     │
└──────────────┴──────────────┴──────────────┴──────────────┴──────────────┘
```

**Selected KPIs** (priority order):
1. **Spend** - Most important business input
2. **Installs** - Primary outcome metric
3. **CPA** - Primary efficiency metric
4. **TTR** - Engagement indicator
5. **CR** - Conversion efficiency

**Removed from primary**:
- CPT (less important than CPA)
- Impressions (low-level funnel metric)
- Taps (implied by TTR)

**Responsive**:
- Desktop: 5 columns
- Tablet: 3 + 2 wrap
- Mobile: 2 columns or 1 column

---

### 3. Primary Performance Section (Two-Column Grid)
```
┌────────────────────────────────────────┬──────────────────────────┐
│ Performance Trend                      │ Overall Performance      │
│                                        │                          │
│ [Chart with current + previous]       │ Performance declined     │
│                                        │ significantly  [Critical]│
│                                        │                          │
│                                        │ Acquisition efficiency   │
│                                        │ weakened...              │
│   (SVG chart area)                    │                          │
│                                        │ Tap-through installs...  │
│                                        │                          │
│                                        │ KEY DRIVERS              │
│                                        │ ↓ Installs -34.5%        │
│                                        │ ↑ CPA +52.7%             │
│                                        │ ↑ TTR +8.3%              │
│                                        │                          │
│ Last 14 days vs previous 14 days      │ Last 14 days • All Apps  │
└────────────────────────────────────────┴──────────────────────────┘
```

**Left (65-70%): Performance Trend Panel**
- Single primary chart (Spend or Installs - user choice if supported)
- Current + previous period lines
- Clear legend
- Subdued grid
- Minimal chrome

**Right (30-35%): Overall Performance Summary**
- Title + severity badge
- Summary sentence
- 2-3 sentence explanation
- Up to 3 key drivers
- Period context
- Semantic colors applied correctly

---

### 4. Secondary Analytics Section (Two-Column Grid)
```
┌────────────────────────────────────────┬──────────────────────────┐
│ Weekly Performance Trend               │ Performance Alerts       │
│                                        │                          │
│ Week Starting │ Spend │ Installs │ CPA│ [5 alerts active]        │
│ 2026-07-14    │ £800  │   95     │£8.4│                          │
│ 2026-07-07    │ £750  │  110     │£6.8│ CPA │ Campaign A         │
│ 2026-06-30    │ £820  │  120     │£6.8│ Current: £15.20          │
│                                        │ Threshold: £10.00        │
│                                        │                          │
│                                        │ Installs │ Campaign B    │
│                                        │ Current: 45              │
│                                        │ Threshold: 100           │
│                                        │                          │
│                                        │ [View all goals →]       │
└────────────────────────────────────────┴──────────────────────────┘
```

**Left**: Weekly Performance Trend Table
- Compact Stripe-style table
- Right-aligned numbers
- Tabular nums
- Sorted newest first
- Week labels populated

**Right**: Alerts and Goals Summary
- Show top 3-5 active breaches
- Metric, entity, threshold, current
- Clear empty state if none
- Link to Campaigns/Keywords

---

### 5. Detailed Insights Section (Grid)
```
Detailed insights

┌──────────────────────┬──────────────────────┬──────────────────────┐
│ Alert                │ Trend                │ Growth               │
│ CPA increased 52.7%  │ Spend increased 12%  │ TTR improved 8.3%    │
│                      │                      │                      │
│ CPA increased from   │ Daily budget...      │ Tap-through rate...  │
│ £4.85 to £7.40      │                      │                      │
│ [View details →]     │ [View details →]     │ [View details →]     │
└──────────────────────┴──────────────────────┴──────────────────────┘
```

**Layout**:
- 2-3 columns on desktop
- Compact cards
- Title + summary only (not full explanation)
- Severity badge
- "View details" action
- Full explanation in drawer

---

### 6. Optional: Recent Activity or Top Entities
If space allows, add one final section:
- Recent notes/annotations (if available)
- Top campaigns (condensed)
- Or omit entirely

---

## Proposed Component Hierarchy

```
DashboardPage
├── DashboardPageHeader (NEW - compact)
│   ├── PageTitle
│   └── DashboardFilters (refactored from Header)
│
├── KPISummaryRow (NEW - 5 cards in grid)
│   └── MetricCard (existing, reused)
│
├── PrimaryAnalyticsGrid (NEW - two-column)
│   ├── PerformanceTrendPanel (NEW - wraps TrendChart)
│   └── OverallInsightCard (existing OverallSummary)
│
├── SecondaryAnalyticsGrid (NEW - two-column)
│   ├── WeeklyPerformancePanel (NEW - wraps WeeklyTrendTable)
│   └── AlertsSummaryPanel (refactored DashboardAlerts)
│
├── DetailedInsightsSection (NEW - grid layout)
│   └── InsightCard (NEW - compact card, not InsightsBar)
│
└── InsightDetailsDrawer (existing, unchanged)
```

---

## Shared Components to Create or Reuse

### Create New:
1. **DashboardPageHeader** - Compact header with title + filters
2. **KPISummaryRow** - 5-card grid wrapper
3. **PrimaryAnalyticsGrid** - Two-column grid container
4. **PerformanceTrendPanel** - Panel wrapping TrendChart
5. **SecondaryAnalyticsGrid** - Two-column grid container
6. **WeeklyPerformancePanel** - Panel wrapping WeeklyTrendTable
7. **AlertsSummaryPanel** - Compact version of DashboardAlerts
8. **DetailedInsightsSection** - Grid container for insights
9. **InsightCard** - Compact card for detailed insights

### Reuse Existing:
1. **MetricCard** / **KpiCard** - For KPI summary row
2. **OverallSummary** - Already refactored to two-column
3. **TrendChart** - For performance trend
4. **WeeklyTrendTable** - For weekly performance
5. **InsightDetailsDrawer** - For insight details

### Refactor:
1. **DashboardHeader** → Extract filters to **DashboardFilters**
2. **InsightsBar** → Replace with **InsightCard** in grid
3. **DashboardAlerts** → Simplify to **AlertsSummaryPanel**

### Remove or Relocate:
1. **BrandCards** - Omit or move to bottom
2. **DataTable (Top Campaigns)** - Omit or move to bottom
3. **DataTable (Top Keywords)** - Omit or move to bottom
4. **App Breakdown** - Keep conditional at bottom

---

## Files That Will Change

### New Files:
1. `frontend/src/components/DashboardPageHeader.jsx`
2. `frontend/src/components/KPISummaryRow.jsx`
3. `frontend/src/components/PrimaryAnalyticsGrid.jsx`
4. `frontend/src/components/PerformanceTrendPanel.jsx`
5. `frontend/src/components/SecondaryAnalyticsGrid.jsx`
6. `frontend/src/components/WeeklyPerformancePanel.jsx`
7. `frontend/src/components/AlertsSummaryPanel.jsx`
8. `frontend/src/components/DetailedInsightsSection.jsx`
9. `frontend/src/components/InsightCard.jsx`

### Modified Files:
1. `frontend/src/pages/Dashboard.jsx` - Complete restructure
2. `frontend/src/styles/app.css` - New layout classes
3. `frontend/src/components/DashboardHeader.jsx` - Extract filters (or deprecate)

### Unchanged Files:
1. `frontend/src/components/KpiCard.jsx` - Reused as-is
2. `frontend/src/components/OverallSummary.jsx` - Already refactored
3. `frontend/src/components/TrendChart.jsx` - Reused as-is
4. `frontend/src/components/WeeklyTrendTable.jsx` - Reused as-is
5. `frontend/src/components/InsightDetailsDrawer.jsx` - Reused as-is
6. `frontend/src/context/AppContext.jsx` - No changes
7. `frontend/src/api.js` - No changes
8. All backend files - No changes

---

## Responsive Behavior

### Desktop (>1024px)
- 5 KPI cards in one row
- Primary grid: 65% chart / 35% insight
- Secondary grid: 60% weekly / 40% alerts
- Detailed insights: 3 columns

### Tablet (768-1024px)
- 3 + 2 KPI cards (wraps)
- Primary grid: 60% chart / 40% insight
- Secondary grid: 50% / 50%
- Detailed insights: 2 columns

### Mobile (<768px)
- 2 or 1 KPI card per row
- Primary grid: stacked (chart above, insight below)
- Secondary grid: stacked (weekly above, alerts below)
- Detailed insights: 1 column

---

## Data Flow and State Preservation

### Unchanged:
- `useApp()` context
- `appFilter` state
- `filterPreset` state
- `periodCompareEnabled` state
- `periodComparison` data
- `weeklyData` / `previousWeeklyData` state
- `insightsData` / `overallInsight` state
- All API calls and parameters
- Stale request protection

### Filter Propagation:
All filters must update:
- [x] KPI cards
- [x] Performance trend chart
- [x] Overall insight
- [x] Detailed insights
- [x] Weekly performance table
- [x] Alerts (where applicable)

---

## Semantic Color Rules

### Correct Rules (Apply to KPI cards and insights):
| Metric | Increase | Decrease |
|--------|----------|----------|
| Installs | Positive (green) | Negative (red) |
| CPA | Negative (red) | Positive (green) |
| CPT | Negative (red) | Positive (green) |
| TTR | Positive (green) | Negative (red) |
| CR | Positive (green) | Negative (red) |
| Spend | Neutral (grey) | Neutral (grey) |

**Already implemented in**:
- `OverallSummary.jsx` - `getDriverSentiment()` function
- `KpiCard.jsx` - `metricKind` prop

**Verify in**:
- New `InsightCard` component
- Preserved in all KPI cards

---

## Acceptance Criteria

1. ✅ Dashboard looks like one coherent product
2. ✅ Top 5 KPIs visible above the fold
3. ✅ Main chart and overall summary have clear visual priority
4. ✅ Overall insight text no longer stretches across screen
5. ✅ Detailed insights visually secondary
6. ✅ All filters continue to work
7. ✅ Metrics reconcile with current API
8. ✅ Semantic colors correct
9. ✅ No fake or placeholder data
10. ✅ No analytics or backend changes
11. ✅ Works on desktop, tablet, mobile
12. ✅ No console errors or horizontal overflow

---

## Implementation Plan

### Phase 1: Component Creation
1. Create new layout components (header, grids, panels)
2. Create compact `InsightCard` component
3. Test components in isolation

### Phase 2: Dashboard Restructure
1. Backup current `Dashboard.jsx`
2. Rebuild Dashboard using new structure
3. Preserve all state and API calls
4. Remove obsolete sections (BrandCards, Top Campaigns/Keywords from middle)

### Phase 3: Styling
1. Add new CSS layout classes
2. Ensure responsive breakpoints
3. Match Stripe design principles
4. Test on multiple screen sizes

### Phase 4: Testing
1. Verify all filters work
2. Verify data matches API
3. Verify semantic colors
4. Verify responsive behavior
5. Verify no console errors

---

## Notes

- BrandCards moved to bottom or omitted (low priority)
- Top Campaigns/Keywords moved to bottom or omitted (already in separate pages)
- Weekly table promoted to secondary analytics section (high value)
- CPT removed from primary KPIs (less important than CPA)
- Single primary chart instead of two equal charts (Spend/Installs toggle if supported)
- Overall Summary paired with chart for context
- Detailed insights grid replaces horizontal bar
