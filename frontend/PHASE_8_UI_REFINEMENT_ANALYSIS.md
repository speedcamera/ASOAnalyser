# Phase 8 UI Refinement: Overall Performance Summary - Analysis

## Root Cause

### Issue 1: Full-Width Expansion
**Current behavior**: `.overall-summary` is a single full-width container with no column layout or width constraints.

**CSS**:
```css
.overall-summary {
  background: linear-gradient(...);
  padding: 1.75rem 2rem;
  /* No max-width, no grid, no columns */
}
```

**Result**: Explanation text can span 150+ characters per line on wide screens, making it hard to read.

---

### Issue 2: Incorrect Semantic Colors

**Current logic** (`OverallSummary.jsx` line 38):
```jsx
className={`key-driver-chip key-driver-chip--${driver.direction} ...`}
```

**CSS** (lines 2377-2385):
```css
.key-driver-chip--up .key-driver-chip__icon {
  color: var(--negative);  /* red */
}

.key-driver-chip--down .key-driver-chip__icon {
  color: var(--positive);  /* green */
}
```

**Problem**: Colors based purely on numeric direction (up/down), not metric semantics.

**Incorrect results**:
- Installs ↓ -34% → green (WRONG - declining installs is bad)
- CPA ↑ +52% → red (correct)
- CR ↓ -12% → green (WRONG - declining CR is bad)

**Correct semantic rules**:
| Metric | Increase | Decrease |
|--------|----------|----------|
| Installs | Good (green) | Bad (red) |
| CPA | Bad (red) | Good (green) |
| CPT | Bad (red) | Good (green) |
| Spend | Neutral (depends) | Neutral (depends) |
| CR | Good (green) | Bad (red) |
| TTR | Good (green) | Bad (red) |
| Taps | Good (green) | Bad (red) |

---

### Issue 3: No Two-Column Layout

**Current structure**:
```
┌─────────────────────────────────────────────────────────┐
│ [Title + Badge]                    [Period + App]       │
│                                                          │
│ Summary text                                            │
│                                                          │
│ ┌────────────────────────────────────────────────────┐ │
│ │ Long explanation spanning full width...            │ │
│ └────────────────────────────────────────────────────┘ │
│                                                          │
│ KEY DRIVERS                                             │
│ [Chip] [Chip] [Chip]                                   │
└─────────────────────────────────────────────────────────┘
```

**Required structure**:
```
┌───────────────────────────────────┬────────────────────┐
│ Main Summary Tile (60-65%)        │ Key Drivers (35-40%)│
│                                   │                    │
│ [Title]              [Badge]      │ KEY DRIVERS        │
│                                   │                    │
│ Summary text                      │ ↓ Installs  -34.5% │
│                                   │                    │
│ Explanation paragraph             │ ↑ CPA       +52.7% │
│ (max ~70 chars/line)              │                    │
│                                   │ ↑ TTR       +8.3%  │
│                                   │                    │
│ Last 7 days • All Apps            │                    │
└───────────────────────────────────┴────────────────────┘
```

---

## Existing Dashboard Card Primitives

Inspecting `KpiCard.jsx`:
```jsx
<article className="kpi-card">
  <header className="kpi-card__header">
    <h3 className="kpi-card__title">...</h3>
    <span className="kpi-card__badge">...</span>
  </header>
  <div className="kpi-card__body">...</div>
</article>
```

**Card styles available**:
- `.kpi-card` - standard dashboard card
- `.insights-card` - insights section card
- Standard padding, border, border-radius, background

**Reuse approach**:
- Use similar `.card` structure for both tiles
- Apply consistent padding, borders, shadows
- Match existing visual style

---

## Files That Will Change

### 1. `frontend/src/components/OverallSummary.jsx`
**Changes**:
- Restructure JSX to use two-column grid
- Split into "main tile" and "key drivers tile"
- Add `getDriverSentiment()` function for semantic colors
- Change driver chip styling to use sentiment classes
- Render drivers as stacked rows (not horizontal chips)

### 2. `frontend/src/styles/app.css`
**Changes**:
- Replace `.overall-summary` with grid layout
- Add `.overall-summary-grid` (two-column container)
- Add `.overall-summary__main-tile` (left column)
- Add `.overall-summary__drivers-tile` (right column)
- Add `.driver-row` (stacked driver layout)
- Add sentiment-based color classes:
  - `.driver-row--favorable` (green)
  - `.driver-row--unfavorable` (red)
  - `.driver-row--neutral` (grey)
- Update responsive behavior (stack on mobile)
- Reduce title font size
- Constrain explanation text width

---

## Semantic Color Logic

### Implementation

```javascript
function getDriverSentiment(metric, direction) {
  // Higher is better metrics
  const higherIsBetter = ['installs', 'cr', 'ttr', 'taps', 'impressions']
  
  // Lower is better metrics
  const lowerIsBetter = ['cpa', 'cpt']
  
  // Neutral metrics (context-dependent)
  const neutral = ['spend']
  
  if (higherIsBetter.includes(metric)) {
    return direction === 'up' ? 'favorable' : 'unfavorable'
  }
  
  if (lowerIsBetter.includes(metric)) {
    return direction === 'down' ? 'favorable' : 'unfavorable'
  }
  
  return 'neutral'
}
```

### Test Cases

| Metric | Change | Direction | Sentiment | Color | Icon |
|--------|--------|-----------|-----------|-------|------|
| installs | +25% | up | favorable | green | ↑ |
| installs | -34% | down | unfavorable | red | ↓ |
| cpa | +52% | up | unfavorable | red | ↑ |
| cpa | -20% | down | favorable | green | ↓ |
| cr | +15% | up | favorable | green | ↑ |
| cr | -12% | down | unfavorable | red | ↓ |
| ttr | +8% | up | favorable | green | ↑ |
| ttr | -5% | down | unfavorable | red | ↓ |
| spend | +20% | up | neutral | grey | ↑ |
| spend | -15% | down | neutral | grey | ↓ |

---

## Responsive Layout Behavior

### Desktop (>1024px)
```
┌─────────────────────────────────┬──────────────────┐
│ Main Tile (65%)                 │ Drivers (35%)    │
│                                 │                  │
│ Content...                      │ Drivers...       │
└─────────────────────────────────┴──────────────────┘
```
CSS:
```css
.overall-summary-grid {
  display: grid;
  grid-template-columns: 65fr 35fr;
  gap: 1rem;
}
```

### Tablet (768px - 1024px)
```
┌─────────────────────────────────┬──────────────────┐
│ Main Tile (60%)                 │ Drivers (40%)    │
└─────────────────────────────────┴──────────────────┘
```
CSS:
```css
@media (max-width: 1024px) {
  .overall-summary-grid {
    grid-template-columns: 60fr 40fr;
  }
}
```

### Mobile (<768px)
```
┌──────────────────────────────────────────┐
│ Main Tile (100%)                         │
│                                          │
│ Content...                               │
└──────────────────────────────────────────┘
┌──────────────────────────────────────────┐
│ Drivers Tile (100%)                      │
│                                          │
│ Drivers...                               │
└──────────────────────────────────────────┘
```
CSS:
```css
@media (max-width: 768px) {
  .overall-summary-grid {
    grid-template-columns: 1fr;
  }
}
```

---

## Typography Hierarchy

### Before
```
Title: 1.375rem (22px) - too large
Summary: 1.0625rem (17px)
Explanation: 0.9375rem (15px)
```

### After
```
Title: 1.125rem (18px) - reduced
Badge: 0.75rem (12px) - compact pill
Summary: 0.9375rem (15px) - normal
Explanation: 0.9375rem (15px) - readable
Meta: 0.8125rem (13px) - subtle
Drivers: 0.875rem (14px) - clear
```

---

## Solution Summary

**Two-column grid layout**:
- Left: Main summary tile (title, badge, summary, explanation, metadata)
- Right: Key drivers tile (3 stacked rows)

**Semantic colors**:
- Installs/CR/TTR up → green
- Installs/CR/TTR down → red
- CPA/CPT up → red
- CPA/CPT down → green
- Spend → neutral grey

**Responsive**:
- Desktop: side-by-side (65/35 split)
- Tablet: side-by-side (60/40 split)
- Mobile: stacked

**Visual style**:
- Reuse existing card styles
- Compact badge
- Readable text width
- Equal-height driver rows
- Clean spacing
