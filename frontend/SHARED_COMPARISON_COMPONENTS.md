# Shared Comparison Components - Reference Guide

## Overview

All comparison UI across the app uses standardized shared components with consistent color rules.

---

## Component: MetricCompareCell

**Use for**: Table cells with comparison display

**Location**: `frontend/src/components/MetricCompareCell.jsx`

### API

```javascript
import MetricCompareCell from './MetricCompareCell'
import { formatCurrency, formatPercent } from '../utils/format'

<MetricCompareCell
  current={123.45}
  previous={100.00}
  percent={23.5}
  kind="cost"
  showCompare={true}
  compareHint="vs previous period"
  formatValue={formatCurrency}
/>
```

### Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `current` | `number \| null` | Yes | - | Current period value |
| `previous` | `number \| null` | No | - | Previous period value |
| `percent` | `number \| null` | No | - | Percentage change |
| `kind` | `'cost' \| 'volume' \| 'bid'` | No | `'volume'` | Tone rule |
| `showCompare` | `boolean` | No | `false` | Show comparison UI |
| `compareHint` | `string \| null` | No | `null` | Tooltip hint text |
| `formatValue` | `(v: number) => string` | No | `String` | Value formatter |

### Kind Parameter

**`kind='cost'`** - Lower is better
- Spend, CPA, CPT
- Green ▼ = favorable (decrease)
- Red ▲ = unfavorable (increase)

**`kind='volume'`** - Higher is better
- Installs, Taps, TTR, CR
- Green ▲ = favorable (increase)
- Red ▼ = unfavorable (decrease)

**`kind='bid'`** - Neutral/directional
- Bid changes
- Grey color (no good/bad judgment)

### Visual Output

```
┌─────────────────┐
│   £123.45       │  ← Current value (bold)
│   vs £100.00    │  ← Previous value (muted)
│   ▲ 23.5%       │  ← Badge (colored by kind)
└─────────────────┘
```

### Example Usage

```javascript
// Spend (lower is better)
<MetricCompareCell
  current={row.current_spend}
  previous={row.previous_spend}
  percent={row.spend_change}
  kind="cost"
  showCompare={showCompare}
  formatValue={formatCurrency}
/>

// Installs (higher is better)
<MetricCompareCell
  current={row.current_installs}
  previous={row.previous_installs}
  percent={row.installs_change}
  kind="volume"
  showCompare={showCompare}
  formatValue={formatIntegerMetric}
/>
```

---

## Component: KpiCard

**Use for**: Dashboard KPI cards with comparison

**Location**: `frontend/src/components/KpiCard.jsx`

### API

```javascript
import KpiCard from './KpiCard'

<KpiCard
  label="Total Spend"
  value="£1,234.56"
  previousValue={1000.00}
  changePercent={23.5}
  metricKind="cost"
  showCompare={true}
  formatKind="currency"
  icon="spend"
  sparklineDays={daysArray}
  sparklineMetricKey="spend"
  sparklineLoading={false}
  compact={false}
/>
```

### Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `label` | `string` | Yes | - | KPI label text |
| `value` | `string` | Yes | - | Formatted current value |
| `previousValue` | `number \| null` | No | `null` | Previous period raw value |
| `changePercent` | `number \| null` | No | `null` | Percentage change |
| `metricKind` | `'cost' \| 'volume'` | No | `'volume'` | Tone rule |
| `showCompare` | `boolean` | No | `true` | Show comparison UI |
| `formatKind` | `'currency' \| 'integer' \| 'percent'` | No | `'currency'` | Format type |
| `icon` | `string` | No | `'percent'` | Icon name |
| `sparklineDays` | `array \| null` | No | `null` | Sparkline data |
| `sparklineMetricKey` | `string \| null` | No | `null` | Sparkline metric |
| `sparklineLoading` | `boolean` | No | `false` | Sparkline loading |
| `compact` | `boolean` | No | `false` | Compact layout |

### MetricKind Parameter

**`metricKind='cost'`** - Lower is better
- Spend, CPA, CPT
- Green ▼ = favorable
- Red ▲ = unfavorable

**`metricKind='volume'`** - Higher is better
- Installs, Taps, TTR, CR, Impressions
- Green ▲ = favorable
- Red ▼ = unfavorable

### Visual Output

```
┌─────────────────────────────┐
│ [Icon] Total Spend          │
│                             │
│ £1,234.56                   │  ← Current (bold, large)
│                             │
│ ▲ ▲ 23.5%  vs £1,000.00     │  ← Comparison (colored)
│ ────────────────────────    │  ← Optional sparkline
└─────────────────────────────┘
```

### Icon Options

- `spend` - Currency symbol
- `installs` - Download/shield icon
- `cpa` - Chart/trend icon
- `cpt` - Info icon
- `impressions` - Eye icon
- `taps` - Hand/tap icon
- `percent` - Percentage icon

### Example Usage

```javascript
// Spend (lower is better)
<KpiCard
  label="Total Spend"
  value={formatCurrency(totalSpend)}
  previousValue={previousSpend}
  changePercent={spendChangePercent}
  metricKind="cost"
  showCompare={true}
  formatKind="currency"
  icon="spend"
  sparklineDays={daysChronological}
  sparklineMetricKey="spend"
  sparklineLoading={weeklyLoading}
/>

// Installs (higher is better)
<KpiCard
  label="Installs"
  value={formatNumber(installs, 0)}
  previousValue={previousInstalls}
  changePercent={installsChangePercent}
  metricKind="volume"
  showCompare={true}
  formatKind="integer"
  icon="installs"
  sparklineDays={daysChronological}
  sparklineMetricKey="installs"
/>
```

---

## Utility Functions

**Location**: `frontend/src/utils/format.js`

### compareDeltaTone(percent, kind)

**Purpose**: Determine badge color based on direction and metric type

**Parameters**:
- `percent` (number | null): Percentage change
- `kind` ('cost' | 'volume' | 'bid'): Metric type

**Returns**: `'good' | 'bad' | 'neutral'`

**Logic**:
```javascript
// kind = 'cost' (lower is better)
//   percent < 0 → 'good' (green)
//   percent > 0 → 'bad' (red)
//   percent === 0 or null → 'neutral' (grey)

// kind = 'volume' (higher is better)
//   percent > 0 → 'good' (green)
//   percent < 0 → 'bad' (red)
//   percent === 0 or null → 'neutral' (grey)

// kind = 'bid' (neutral)
//   Always 'neutral' or directional (grey)
```

**Example**:
```javascript
import { compareDeltaTone } from '../utils/format'

// Spend decreased 10%
compareDeltaTone(-10, 'cost')  // → 'good' (green)

// Installs decreased 10%
compareDeltaTone(-10, 'volume')  // → 'bad' (red)

// Bid changed 5%
compareDeltaTone(5, 'bid')  // → 'neutral' (grey)
```

---

### formatCompareBadge(percent)

**Purpose**: Format percentage change with arrow

**Parameters**:
- `percent` (number | null): Percentage change

**Returns**: `string | null`

**Examples**:
```javascript
import { formatCompareBadge } from '../utils/format'

formatCompareBadge(23.5)   // → '▲ 23.5%'
formatCompareBadge(-8.3)   // → '▼ 8.3%'
formatCompareBadge(0)      // → ''
formatCompareBadge(null)   // → null
```

---

### compareArrow(percent)

**Purpose**: Get arrow symbol based on direction

**Parameters**:
- `percent` (number | null): Percentage change

**Returns**: `'▲' | '▼' | ''`

**Examples**:
```javascript
import { compareArrow } from '../utils/format'

compareArrow(10)    // → '▲'
compareArrow(-5)    // → '▼'
compareArrow(0)     // → ''
compareArrow(null)  // → ''
```

---

## CSS Classes

**Location**: `frontend/src/styles/app.css`

### Table Cell Badges

```css
.metric-cell__badge--good {
  color: var(--positive);  /* #16a34a green */
}

.metric-cell__badge--bad {
  color: var(--negative);  /* #dc2626 red */
}

.metric-cell__badge--neutral {
  color: var(--muted);  /* #6b7280 grey */
}
```

### KPI Badges

```css
.kpi__badge--good {
  color: var(--positive);
}

.kpi__badge--bad {
  color: var(--negative);
}

.kpi__badge--neutral {
  color: var(--muted);
}
```

### KPI Trend Arrows

```css
.kpi__trend--good {
  color: var(--positive);
}

.kpi__trend--bad {
  color: var(--negative);
}

.kpi__trend--neutral {
  color: var(--muted);
}
```

---

## Color Reference

```css
:root {
  --positive: #16a34a;  /* Green - favorable */
  --negative: #dc2626;  /* Red - unfavorable */
  --muted: #6b7280;     /* Grey - neutral */
}
```

---

## Decision Tree: Which Component to Use?

```
Is it a table cell?
├─ YES → Use MetricCompareCell
│         - Campaign Performance table
│         - Keyword & Bid Analysis table
│         - Weekly Performance Trend table
│
└─ NO → Is it a dashboard card?
         ├─ YES → Use KpiCard
         │         - Dashboard KPI cards
         │
         └─ NO → Custom component?
                  - Use compareDeltaTone() utility
                  - Use shared CSS classes
```

---

## Metric Type Reference

### Cost Metrics (Lower is Better)

Use `kind='cost'` or `metricKind='cost'`:
- **Spend** - Total advertising spend
- **CPA** - Cost Per Acquisition (install)
- **CPT** - Cost Per Tap

**Color Rule**:
- ▼ Decrease = Green (favorable)
- ▲ Increase = Red (unfavorable)

---

### Volume Metrics (Higher is Better)

Use `kind='volume'` or `metricKind='volume'`:
- **Installs** - App installations
- **Taps** - Ad taps/clicks
- **Impressions** - Ad views
- **TTR** - Tap-Through Rate (%)
- **CR** - Conversion Rate (%)

**Color Rule**:
- ▲ Increase = Green (favorable)
- ▼ Decrease = Red (unfavorable)

---

### Neutral Metrics

Use `kind='bid'`:
- **Bid Changes** - Keyword bid adjustments
- **Daily Budget** - Campaign budget settings

**Color Rule**:
- Grey (no good/bad judgment)

---

## Common Formatters

```javascript
import {
  formatCurrency,
  formatPercent,
  formatNumber,
} from '../utils/format'

// Currency (£1,234.56)
formatValue={formatCurrency}

// Percentage (23.45%)
formatValue={formatPercent}

// Integer (1,234)
formatValue={(v) => formatNumber(v, 0)}

// Decimal (12.34)
formatValue={(v) => formatNumber(v, 2)}
```

---

## Complete Example

### Campaign Performance Table

```javascript
import MetricCompareCell, { formatIntegerMetric } from './MetricCompareCell'
import { formatCurrency, formatPercent } from '../utils/format'

<table className="analysis-table campaign-table">
  <thead>
    <tr>
      <th>Campaign</th>
      <th className="num">Spend</th>
      <th className="num">Installs</th>
      <th className="num">CPA</th>
      <th className="num">CR</th>
    </tr>
  </thead>
  <tbody>
    {campaigns.map(row => (
      <tr key={row.id}>
        <td>{row.campaign_name}</td>
        
        <MetricCompareCell
          current={row.current_spend}
          previous={row.previous_spend}
          percent={row.spend_change}
          kind="cost"
          showCompare={showCompare}
          formatValue={formatCurrency}
        />
        
        <MetricCompareCell
          current={row.current_installs}
          previous={row.previous_installs}
          percent={row.installs_change}
          kind="volume"
          showCompare={showCompare}
          formatValue={formatIntegerMetric}
        />
        
        <MetricCompareCell
          current={row.current_cpa}
          previous={row.previous_cpa}
          percent={row.cpa_change}
          kind="cost"
          showCompare={showCompare}
          formatValue={formatCurrency}
        />
        
        <MetricCompareCell
          current={row.cr}
          previous={row.previous_cr}
          percent={row.cr_change}
          kind="volume"
          showCompare={showCompare}
          formatValue={formatPercent}
        />
      </tr>
    ))}
  </tbody>
</table>
```

### Dashboard KPI Cards

```javascript
import KpiCard from './KpiCard'
import { formatCurrency, formatNumber } from '../utils/format'

<div className="dashboard-kpis">
  <KpiCard
    label="Total Spend"
    value={formatCurrency(spend)}
    previousValue={previousSpend}
    changePercent={spendChangePercent}
    metricKind="cost"
    showCompare={true}
    formatKind="currency"
    icon="spend"
    sparklineDays={days}
    sparklineMetricKey="spend"
  />
  
  <KpiCard
    label="Installs"
    value={formatNumber(installs, 0)}
    previousValue={previousInstalls}
    changePercent={installsChangePercent}
    metricKind="volume"
    showCompare={true}
    formatKind="integer"
    icon="installs"
    sparklineDays={days}
    sparklineMetricKey="installs"
  />
  
  <KpiCard
    label="CPA"
    value={formatCurrency(cpa)}
    previousValue={previousCpa}
    changePercent={cpaChangePercent}
    metricKind="cost"
    showCompare={true}
    formatKind="currency"
    icon="cpa"
  />
</div>
```

---

## Best Practices

### DO
✅ Use `MetricCompareCell` for all table comparisons  
✅ Use `KpiCard` for all dashboard cards  
✅ Use `compareDeltaTone(percent, kind)` for custom logic  
✅ Use correct `kind` parameter for each metric  
✅ Use shared CSS classes  
✅ Handle `null` values gracefully  

### DON'T
❌ Create inline comparison color logic  
❌ Duplicate tone determination functions  
❌ Hardcode colors in styles  
❌ Create custom badge class names  
❌ Mix metric kinds (e.g., don't use 'volume' for CPA)  

---

## Troubleshooting

### Badge not showing correct color

**Check**:
1. Is `kind` or `metricKind` parameter correct?
   - Spend, CPA, CPT → `'cost'`
   - Installs, Taps, CR, TTR → `'volume'`
2. Is `percent` a valid number?
3. Is CSS loaded correctly?

### Previous value not showing

**Check**:
1. Is `showCompare={true}`?
2. Is `previous` prop provided?
3. Is `previous` not null/undefined?

### Arrow not appearing

**Check**:
1. Is `percent` not zero?
2. Is `percent` a valid number (not null)?
3. Is `formatCompareBadge()` being called?

---

## Migration Checklist

When adding a new comparison display:

- [ ] Identify metric type (cost/volume/neutral)
- [ ] Choose component (MetricCompareCell for tables, KpiCard for dashboard)
- [ ] Set correct `kind` or `metricKind` parameter
- [ ] Provide `current`, `previous`, `percent` props
- [ ] Choose appropriate `formatValue` function
- [ ] Test color display (green for favorable, red for unfavorable)
- [ ] Test N/A handling (null values)
- [ ] Verify responsive behavior

---

## Support

For questions or issues with comparison components:
1. Check this reference guide
2. Review existing usage in codebase
3. Inspect `MetricCompareCell.jsx` and `KpiCard.jsx` source
4. Review `format.js` utility functions

Remember: **All comparison logic uses shared components** - no custom implementations needed.
