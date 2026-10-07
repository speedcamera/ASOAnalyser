# Phase 5: Comparison UI Standardization Audit

## Current State Analysis

### ✅ Shared Components Already Exist

#### 1. `MetricCompareCell` Component
**Location**: `frontend/src/components/MetricCompareCell.jsx`

**API**:
```javascript
<MetricCompareCell
  current={value}
  previous={previousValue}
  percent={changePercent}
  kind="cost" | "volume" | "bid"
  showCompare={true}
  compareHint="optional hint text"
  formatValue={(v) => formatCurrency(v)}
/>
```

**Features**:
- ✅ Renders `<td>` with current value
- ✅ Shows previous value: "vs £648.16"
- ✅ Shows percentage badge: "▼ 19.7%"
- ✅ Uses `compareDeltaTone(percent, kind)` for color
- ✅ Supports N/A handling
- ✅ Wraps in `PeriodCompareHover` for tooltips

**Used By**:
- ✅ Campaign Performance table
- ✅ Keyword & Bid Analysis table
- ✅ Weekly Performance Trend table

---

#### 2. `KpiCard` Component
**Location**: `frontend/src/components/KpiCard.jsx`

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
  sparklineMetricKey="spend"
  sparklineLoading={false}
/>
```

**Features**:
- ✅ Renders KPI card with icon
- ✅ Shows current value bold
- ✅ Shows arrow + badge: "▲ 23.5%"
- ✅ Shows previous value: "vs £1,000.00"
- ✅ Uses `compareDeltaTone(percent, toneKind)` for color
- ✅ Optional sparkline chart
- ✅ Wraps in `PeriodCompareHover`

**Used By**:
- ✅ Dashboard KPI cards

---

### ✅ Shared Utility Functions

**Location**: `frontend/src/utils/format.js`

#### Tone Determination
```javascript
// Higher is better (Installs, Taps, CR, TTR)
volumeDeltaTone(percent) → 'good' | 'bad' | 'neutral'

// Lower is better (Spend, CPA, CPT)
costDeltaTone(percent) → 'good' | 'bad' | 'neutral'

// Bid movement (directional only)
bidChangeTone(percent) → 'good' | 'bad' | 'neutral'

// Unified dispatcher
compareDeltaTone(percent, kind) → 'good' | 'bad' | 'neutral'
  // kind: 'cost' | 'volume' | 'bid'
```

#### Formatting
```javascript
compareArrow(percent) → '▲' | '▼' | ''
formatCompareBadge(percent) → '▲ 19.7%' | '▼ 8.3%' | null
formatPercentDelta(value) → '+23.5%' | '-8.3%' | 'N/A'
```

---

### ✅ Shared CSS Classes

**Location**: `frontend/src/styles/app.css`

#### Table Cell Badges
```css
.metric-cell__badge--good { color: var(--positive); }  /* green */
.metric-cell__badge--bad { color: var(--negative); }   /* red */
.metric-cell__badge--neutral { color: var(--muted); }  /* grey */
```

#### KPI Badges
```css
.kpi__badge--good { color: var(--positive); }
.kpi__badge--bad { color: var(--negative); }
.kpi__badge--neutral { color: var(--muted); }
```

#### KPI Trend Arrows
```css
.kpi__trend--good { color: var(--positive); }
.kpi__trend--bad { color: var(--negative); }
.kpi__trend--neutral { color: var(--muted); }
```

---

## Current Component Usage

### ✅ Dashboard KPI Cards
**File**: `frontend/src/pages/Dashboard.jsx`

**Component**: `KpiCard`

**Metrics**:
- Total Spend (cost: lower is better)
- Installs (volume: higher is better)
- CPA (cost: lower is better)
- CPT (cost: lower is better)

**Status**: ✅ Already standardized

---

### ✅ Campaign Performance Table
**File**: `frontend/src/components/CampaignPerformanceTable.jsx`

**Component**: `MetricCompareCell`

**Metrics**:
- Spend (kind='cost')
- Installs (kind='volume')
- CPA (kind='cost')
- Taps (kind='volume')
- CR (kind='volume')

**Code Example** (Line 60-72):
```javascript
<MetricCompareCell
  current={row.current_spend}
  previous={row.previous_spend}
  percent={row.spend_change}
  kind="cost"
  showCompare={showCompare}
  formatValue={formatCurrency}
/>
```

**Status**: ✅ Already standardized

---

### ✅ Keyword & Bid Analysis Table
**File**: `frontend/src/components/KeywordBidTable.jsx`

**Component**: `MetricCompareCell`

**Metrics**:
- Spend (kind='cost')
- Installs (kind='volume')
- CPA (kind='cost')

**Custom Bid Cells**: Uses `BidMetricCell` wrapper with `PeriodCompareHover`

**Status**: ✅ Already standardized

---

### ✅ Weekly Performance Trend Table
**File**: `frontend/src/components/WeeklyTrendTable.jsx`

**Component**: `MetricCompareCell`

**Metrics**:
- Spend (kind='cost')
- Installs (kind='volume')
- CPA (kind='cost')
- CPT (kind='cost')
- TTR (kind='volume')

**Code Example** (Line 102-110):
```javascript
<MetricCompareCell
  current={week.spend}
  previous={week.previous_spend}
  percent={week.spend_delta}
  kind="cost"
  showCompare
  compareHint={weekHint}
  formatValue={formatCurrency}
/>
```

**Status**: ✅ Already standardized

---

## Duplicated Logic Check

### ❌ NO Duplicated Comparison Logic Found

All comparison rendering uses:
1. ✅ `MetricCompareCell` for tables
2. ✅ `KpiCard` for dashboard cards
3. ✅ `compareDeltaTone(percent, kind)` for color determination
4. ✅ Shared CSS classes

---

## Tone Rules Configuration

### Current Implementation (Already Correct)

**Higher is better** (green ▲ good, red ▼ bad):
- Installs ✅
- Taps ✅
- TTR ✅
- CR ✅

**Lower is better** (green ▼ good, red ▲ bad):
- Spend ✅
- CPA ✅
- CPT ✅

**Neutral** (grey, directional only):
- Bid movement ✅
- Daily budget (not shown with comparison) ✅

---

## Weekly Performance Trend - Color Verification

**Current State**:
The Weekly Performance Trend table **already uses** `MetricCompareCell` with proper `kind` parameter.

**Verification**:
```javascript
// Line 102-109
<MetricCompareCell
  current={week.spend}
  previous={week.previous_spend}
  percent={week.spend_delta}
  kind="cost"                    // ← Lower is better
  showCompare
  compareHint={weekHint}
  formatValue={formatCurrency}
/>

// Line 111-118
<MetricCompareCell
  current={week.installs}
  previous={week.previous_installs}
  percent={week.installs_delta}
  kind="volume"                   // ← Higher is better
  showCompare
  compareHint={weekHint}
  formatValue={formatIntegerMetric}
/>
```

**Expected Behavior**:
- ✅ Spend ▼ 10% → green (favorable cost reduction)
- ✅ Spend ▲ 10% → red (unfavorable cost increase)
- ✅ Installs ▲ 15% → green (favorable volume increase)
- ✅ Installs ▼ 15% → red (unfavorable volume decrease)

---

## Conclusion

### ✅ Phase 5 Already Complete

The app already has:
1. ✅ Shared `MetricCompareCell` component
2. ✅ Shared `KpiCard` component
3. ✅ Shared `compareDeltaTone()` function
4. ✅ Consistent tone rules (higher/lower is better)
5. ✅ Shared CSS classes for colors
6. ✅ All screens migrated to shared components
7. ✅ No duplicated comparison logic

**All comparison UI is already standardized.**

---

## Testing Checklist

### Dashboard KPI Cards
- [ ] Enable 7D/14D/30D comparison
- [ ] Verify Spend shows green ▼ when decreasing
- [ ] Verify Spend shows red ▲ when increasing
- [ ] Verify Installs shows green ▲ when increasing
- [ ] Verify Installs shows red ▼ when decreasing
- [ ] Verify CPA shows green ▼ when decreasing
- [ ] Verify "vs" previous value displays

### Campaign Performance Table
- [ ] Enable comparison
- [ ] Verify Spend column colors (green down, red up)
- [ ] Verify Installs column colors (green up, red down)
- [ ] Verify CPA column colors (green down, red up)
- [ ] Verify Taps column colors (green up, red down)
- [ ] Verify CR column colors (green up, red down)

### Keyword & Bid Analysis Table
- [ ] Enable comparison
- [ ] Verify Spend column colors
- [ ] Verify Installs column colors
- [ ] Verify CPA column colors
- [ ] Verify bid columns use neutral/directional colors

### Weekly Performance Trend Table
- [ ] Navigate to Campaigns → select campaign
- [ ] Enable 7D/14D/30D comparison
- [ ] Verify Week Starting column has dates
- [ ] Verify Spend shows colored ▲▼ badges
- [ ] Verify Installs shows colored ▲▼ badges
- [ ] Verify CPA shows colored ▲▼ badges
- [ ] Verify CPT shows colored ▲▼ badges
- [ ] Verify TTR shows colored ▲▼ badges
- [ ] Green for favorable, red for unfavorable

---

## No Changes Required

All requirements are already met:
- ✅ Shared components exist and are used
- ✅ Consistent tone rules configuration
- ✅ All screens use shared components
- ✅ No duplicated comparison logic
- ✅ Weekly Performance table shows colored change indicators
