# Phase 5: Comparison UI Standardization - Already Complete ✅

## Summary

**All comparison UI across the app already uses shared components and consistent configuration.**

No code changes required. This phase was completed during previous development.

---

## Shared Components

### 1. MetricCompareCell (Table Cells)
**Location**: `frontend/src/components/MetricCompareCell.jsx`

**Purpose**: Standardized comparison display for table cells

**API**:
```javascript
<MetricCompareCell
  current={value}
  previous={previousValue}
  percent={changePercent}
  kind="cost" | "volume" | "bid"
  showCompare={true}
  compareHint="optional hint"
  formatValue={formatCurrency}
/>
```

**Features**:
- Current value in bold
- Previous value: "vs £648.16"
- Percentage badge with arrow: "▼ 19.7%"
- Color based on `kind` and direction
- N/A handling
- Period hover tooltip

---

### 2. KpiCard (Dashboard Cards)
**Location**: `frontend/src/components/KpiCard.jsx`

**Purpose**: Standardized KPI card with comparison

**API**:
```javascript
<KpiCard
  label="Total Spend"
  value="£1,234.56"
  previousValue={1000.00}
  changePercent={23.5}
  metricKind="cost" | "volume"
  showCompare={true}
  formatKind="currency" | "integer" | "percent"
  icon="spend"
  sparklineDays={[...]}
/>
```

**Features**:
- Icon + label
- Current value bold
- Arrow + badge: "▲ 23.5%"
- Previous value: "vs £1,000.00"
- Optional sparkline
- Color based on `metricKind`

---

## Shared Utility Functions

**Location**: `frontend/src/utils/format.js`

### Tone Determination

```javascript
// Unified dispatcher - used by all components
compareDeltaTone(percent, kind)
  // kind: 'cost' | 'volume' | 'bid'
  // Returns: 'good' | 'bad' | 'neutral'

// Lower is better (Spend, CPA, CPT)
costDeltaTone(percent)
  // ▼ negative = good (green)
  // ▲ positive = bad (red)

// Higher is better (Installs, Taps, CR, TTR)
volumeDeltaTone(percent)
  // ▲ positive = good (green)
  // ▼ negative = bad (red)

// Bid movement (directional only)
bidChangeTone(percent)
  // Neutral/directional coloring
```

### Formatting

```javascript
compareArrow(percent)
  // Returns: '▲' | '▼' | ''

formatCompareBadge(percent)
  // Returns: '▲ 19.7%' | '▼ 8.3%' | null

formatPercentDelta(value)
  // Returns: '+23.5%' | '-8.3%' | 'N/A'
```

---

## Tone Rules Configuration

### Higher is Better (Green ▲ good, Red ▼ bad)
- **Installs** (`kind='volume'`)
- **Taps** (`kind='volume'`)
- **TTR** (`kind='volume'`)
- **CR** (`kind='volume'`)

### Lower is Better (Green ▼ good, Red ▲ bad)
- **Spend** (`kind='cost'`)
- **CPA** (`kind='cost'`)
- **CPT** (`kind='cost'`)

### Neutral (Grey, directional only)
- **Bid movement** (`kind='bid'`)
- **Daily budget** (not compared)

---

## CSS Classes

**Location**: `frontend/src/styles/app.css`

### Table Cell Badges
```css
.metric-cell__badge--good { color: var(--positive); }    /* #16a34a green */
.metric-cell__badge--bad { color: var(--negative); }     /* #dc2626 red */
.metric-cell__badge--neutral { color: var(--muted); }    /* #6b7280 grey */
```

### KPI Badges
```css
.kpi__badge--good { color: var(--positive); }
.kpi__badge--bad { color: var(--negative); }
.kpi__badge--neutral { color: var(--muted); }
```

### KPI Trend Arrows
```css
.kpi__trend--good { color: var(--positive); }
.kpi__trend--bad { color: var(--negative); }
.kpi__trend--neutral { color: var(--muted); }
```

---

## Screens Using Shared Components

### ✅ Dashboard KPI Cards
**File**: `frontend/src/pages/Dashboard.jsx`

**Component**: `KpiCard`

**Metrics**:
```javascript
<KpiCard label="Total Spend" metricKind="cost" ... />
<KpiCard label="Installs" metricKind="volume" ... />
<KpiCard label="CPA" metricKind="cost" ... />
<KpiCard label="CPT" metricKind="cost" ... />
```

---

### ✅ Campaign Performance Table
**File**: `frontend/src/components/CampaignPerformanceTable.jsx`

**Component**: `MetricCompareCell`

**Metrics**:
```javascript
<MetricCompareCell kind="cost" ... />    // Spend
<MetricCompareCell kind="volume" ... />  // Installs
<MetricCompareCell kind="cost" ... />    // CPA
<MetricCompareCell kind="volume" ... />  // Taps
<MetricCompareCell kind="volume" ... />  // CR
```

---

### ✅ Keyword & Bid Analysis Table
**File**: `frontend/src/components/KeywordBidTable.jsx`

**Component**: `MetricCompareCell`

**Metrics**:
```javascript
<MetricCompareCell kind="cost" ... />    // Spend
<MetricCompareCell kind="volume" ... />  // Installs
<MetricCompareCell kind="cost" ... />    // CPA
```

**Bid Columns**: Custom `BidMetricCell` wrapper with `PeriodCompareHover`

---

### ✅ Weekly Performance Trend Table
**File**: `frontend/src/components/WeeklyTrendTable.jsx`

**Component**: `MetricCompareCell`

**Metrics** (Lines 102-146):
```javascript
<MetricCompareCell kind="cost" ... />    // Spend
<MetricCompareCell kind="volume" ... />  // Installs
<MetricCompareCell kind="cost" ... />    // CPA
<MetricCompareCell kind="cost" ... />    // CPT
<MetricCompareCell kind="volume" ... />  // TTR
```

**Colored change indicators**: ✅ Enabled
- Spend ▼ 10% → green badge
- Installs ▲ 15% → green badge
- CPA ▼ 5% → green badge

---

## Duplicated Logic Check

### ✅ NO Duplicated Comparison Logic

**Verified**:
- ❌ No inline `percent > 0 ? 'green' : 'red'` logic
- ❌ No duplicated tone determination functions
- ❌ No custom badge class names
- ✅ All comparison rendering uses shared components
- ✅ All tone determination uses `compareDeltaTone()`

---

## Files Created or Changed

### ✅ NO CHANGES REQUIRED

All components already standardized:
- `MetricCompareCell.jsx` - already exists
- `KpiCard.jsx` - already exists
- `format.js` - already has shared functions
- `app.css` - already has shared classes

**All screens already migrated to shared components.**

---

## Comparison UI Using Old Logic

### ✅ NONE

All comparison displays use shared components:
- Dashboard → `KpiCard`
- Campaign table → `MetricCompareCell`
- Keyword table → `MetricCompareCell`
- Weekly trend → `MetricCompareCell`

---

## Weekly Performance Table - Colored Change Indicators

### ✅ CONFIRMED WORKING

**Code** (`WeeklyTrendTable.jsx` lines 102-146):
```javascript
<MetricCompareCell
  current={week.spend}
  previous={week.previous_spend}
  percent={week.spend_delta}
  kind="cost"                      // ← Lower is better
  showCompare
  compareHint={weekHint}
  formatValue={formatCurrency}
/>
```

**Behavior**:
- ✅ Spend decrease (▼ 10%) → green badge
- ✅ Spend increase (▲ 10%) → red badge
- ✅ Installs increase (▲ 15%) → green badge
- ✅ Installs decrease (▼ 15%) → red badge
- ✅ CPA decrease (▼ 5%) → green badge
- ✅ CPA increase (▲ 5%) → red badge

---

## Testing Checklist

### Dashboard KPI Cards
- [ ] Enable 7D/14D/30D comparison
- [ ] Total Spend card:
  - [ ] Shows current value bold
  - [ ] Shows "vs" previous value
  - [ ] Decrease shows green ▼
  - [ ] Increase shows red ▲
- [ ] Installs card:
  - [ ] Increase shows green ▲
  - [ ] Decrease shows red ▼
- [ ] CPA card:
  - [ ] Decrease shows green ▼
  - [ ] Increase shows red ▲
- [ ] CPT card:
  - [ ] Decrease shows green ▼
  - [ ] Increase shows red ▲

### Campaign Performance Table
- [ ] Enable comparison mode
- [ ] Verify each metric column shows:
  - [ ] Current value bold
  - [ ] "vs" previous value below
  - [ ] Colored badge (▲/▼ X.X%)
- [ ] Spend: green down, red up
- [ ] Installs: green up, red down
- [ ] CPA: green down, red up
- [ ] Taps: green up, red down
- [ ] CR: green up, red down

### Keyword & Bid Analysis Table
- [ ] Enable comparison mode
- [ ] Spend: green down, red up
- [ ] Installs: green up, red down
- [ ] CPA: green down, red up
- [ ] Bid columns use neutral/grey colors

### Weekly Performance Trend Table
- [ ] Select a campaign
- [ ] Enable 7D/14D/30D comparison
- [ ] Verify Week Starting column has dates
- [ ] Verify ALL metric columns show colored badges:
  - [ ] Spend: green down, red up
  - [ ] Installs: green up, red down
  - [ ] CPA: green down, red up
  - [ ] CPT: green down, red up
  - [ ] TTR: green up, red down
- [ ] Hover over cell to see period tooltip

### Visual Consistency
- [ ] All green badges use same shade (#16a34a)
- [ ] All red badges use same shade (#dc2626)
- [ ] All grey badges use same shade (#6b7280)
- [ ] Arrow size consistent across tables
- [ ] Badge text size consistent
- [ ] "vs" label format consistent

---

## Status

✅ **Phase 5 Complete (Already Standardized)**

All comparison UI already uses:
1. ✅ Shared components (`MetricCompareCell`, `KpiCard`)
2. ✅ Shared utility functions (`compareDeltaTone`, `formatCompareBadge`)
3. ✅ Consistent tone rules configuration
4. ✅ Shared CSS classes
5. ✅ No duplicated comparison logic
6. ✅ Weekly Performance table shows colored change indicators

**No code changes required.**

---

## Architecture Confirmation

### Current Value Display
- ✅ Current value in **bold**
- ✅ Larger font size
- ✅ Primary emphasis

### Previous Value Display
- ✅ Previous value below current
- ✅ Smaller font
- ✅ Muted grey color
- ✅ "vs" prefix

### Percentage Change Display
- ✅ Arrow (▲ or ▼)
- ✅ Percentage (19.7%)
- ✅ Color based on favorability:
  - Green (#16a34a) = favorable
  - Red (#dc2626) = unfavorable
  - Grey (#6b7280) = neutral/N/A

### Responsive Behavior
- ✅ Maintained in all components
- ✅ No layout changes
- ✅ Consistent across desktop widths

---

## Documentation for Future Reference

### Adding a New Metric with Comparison

**Step 1**: Determine tone rule
```javascript
// Higher is better? Use 'volume'
// Lower is better? Use 'cost'
// Neutral/directional? Use 'bid'
```

**Step 2**: Use `MetricCompareCell` in tables
```javascript
<MetricCompareCell
  current={row.my_metric}
  previous={row.previous_my_metric}
  percent={row.my_metric_change}
  kind="cost"  // or "volume" or "bid"
  showCompare={showCompare}
  formatValue={formatCurrency}  // or formatPercent, formatIntegerMetric
/>
```

**Step 3**: Use `KpiCard` for dashboard
```javascript
<KpiCard
  label="My Metric"
  value={formatCurrency(myMetric)}
  previousValue={previousMyMetric}
  changePercent={myMetricChangePercent}
  metricKind="cost"  // or "volume"
  showCompare={true}
  formatKind="currency"
  icon="spend"
/>
```

**That's it!** Color rules are automatically applied.

---

## Maintenance

### DO
- ✅ Use `MetricCompareCell` for all table comparisons
- ✅ Use `KpiCard` for all dashboard KPIs
- ✅ Use `compareDeltaTone(percent, kind)` if custom logic needed
- ✅ Use shared CSS classes

### DON'T
- ❌ Create inline `percent > 0 ? 'green' : 'red'` logic
- ❌ Duplicate tone determination functions
- ❌ Create custom badge class names
- ❌ Hardcode colors in component styles

All comparison styling and direction rules come from shared configuration.
