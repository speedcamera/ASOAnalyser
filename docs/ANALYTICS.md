# Analytics — Delm8 Ads Analyser

Source of truth for metric definitions used by Dashboard, Campaigns, Keywords Overview, and Bid History.

This document is the reference for future Historical Baselines, Behaviour Profiles, and Recommendations.

---

## Canonical data source

Primary structured store:

- `daily_campaign_metrics` — campaign-day totals (Dashboard / Campaigns overall)
- `daily_keyword_metrics` — keyword-day totals (Keywords / Bid Experiments)

Period analytics for live screens read these tables through **`analyticsService.js`** (via `compareStructured.js` → `GET /api/compare/period`).

---

## Canonical formulas

Implemented once in **`backend/analyticsMetrics.js`** → `calculateDerivedMetrics`.

| Metric | Formula | Zero denominator |
|--------|---------|------------------|
| CPT | `spend / taps` | `null` |
| CPA | `spend / installs_tap_through` | `null` |
| TTR | `(taps / impressions) * 100` | `null` |
| Conversion Rate | `(installs_tap_through / taps) * 100` | `null` |

**Install attribution (canonical):** tap-through installs.

SQL aggregations use:

```sql
SUM(COALESCE(NULLIF(installs_tap_through, 0), installs)) AS installs_tap_through
```

as a legacy fallback when tap-through is stored as 0 but older `installs` is populated.

### Totals vs derived

- **Totals** (spend, impressions, taps, installs): genuine zero activity may be `0`.
- **Derived** (CPT, CPA, TTR, CR): mathematically unavailable → `null` (never `Infinity`, `NaN`, or `0` meaning “missing”).
- Frontend displays `null` as **N/A**.

---

## Percentage change

Shared implementation: `percentChange` / `changeDirection` / `describeMetricChange` in `analyticsMetrics.js`.

Consumed by:

- `analyticsService` (as `calcChange`)
- `bidExperiments` (before/after deltas)
- Frontend `dashboardHelpers.percentChange` (must mirror these rules for display-only recompute)

| Case | Percent | Direction |
|------|---------|-----------|
| Both available, previous ≠ 0 | `((current − previous) / previous) * 100` | `increase` / `decrease` / `unchanged` |
| previous = 0, current = 0 | `0` | `unchanged` |
| previous = 0, current > 0 | `null` | `unavailable` (+ `is_new_activity`) |
| Either missing | `null` | `unavailable` |

Direction describes **numerical movement only**. It does not mean improved, declined, good, or bad.

---

## Date-range semantics

`resolvePeriods` in `analyticsService.js`:

- Inclusive calendar dates.
- For a current window of N days: previous is the immediately preceding N days, non-overlapping.
- Example (7 days ending 2026-07-20): current `2026-07-14→20`, previous `2026-07-07→13`.

Missing calendar days are omitted from aggregates (not filled with zeros) for analytical totals.

### “All Time”

Frontend sets `periodComparison = null` when the preset is `ALL`.  
Comparison is **unavailable** — no manufactured previous-all-time period.

---

## Campaign daily budget

Daily Budget history is read from `daily_campaign_metrics`, scoped by `organisation_id`, `app_id`, and `campaign_name`.

| Term | Meaning |
|------|---------|
| Observation | A report date with a non-null Daily Budget |
| Change | A later observation with a different budget |
| First observation | One recorded date. Current budget is that value. Previous budget and the change stay unrecorded |
| Unchanged history | The same budget on more than one report date. Current budget is shown. There is no change |
| Missing budget | Null. The current budget is "Not recorded" only when no valid budget exists. A recorded zero stays zero |
| Chronology | Latest budget is the latest non-null value by `report_date`, not upload time |

`budget_comparison_status` is `new` for a single recorded budget, `comparable` when an earlier different budget exists, and `unavailable` when no budget has been recorded. `budget_changed_in_selected_period` is true only when the current budget was first observed inside the selected analytics window.

## Keyword identity

### Stable keyword identity (canonical)

```
app_id | campaign_name | ad_group_name | keyword_text | bid_strategy
```

Null/blank `ad_group_name` and `bid_strategy` normalize to `''`.

**Database uniqueness (P3):** `daily_keyword_metrics` UNIQUE constraint is `(organisation_id, app_id, report_date, campaign_name, ad_group_name, keyword_text, bid_strategy)`. The keyword identity key above excludes `organisation_id` and `report_date` for cross-period comparison.

**Used by:**
- Bid Experiments (buildKeywordIdentityKey in bidExperiments.js)
- Analytics Service bid resolution (getKeywordSummary comparison mode)
- Daily metrics upsert conflict detection

### Annotations / period entity keys

`analyticsService` entity keys for annotations use `-` for blank parts and **omit** `bid_strategy` for backward compatibility.  
Do not treat these as interchangeable with the stable keyword identity keys used for bid tracking.

---

## Shared performance flow

```
daily_*_metrics
      ↓
calculateDerivedMetrics + percentChange   (analyticsMetrics.js)
      ↓
analyticsService.js  (period aggregation + resolvePeriods)
      ↓
compareStructured.js → GET /api/compare/period
      ↓
Dashboard · Campaigns · Keywords Overview

bidExperiments.js → same calculateDerivedMetrics + percentChange
      ↓
Bid History (custom before/after windows)
```

No separate Performance Engine module is required; the Analytics Service + `analyticsMetrics` fulfil that role.

---

## New keyword handling

When a keyword has current-period data but no valid data before the current comparison period (using the stable keyword identity), it is classified as "new".

### Backend response

`analyticsService.getKeywordSummary()` includes a `comparison_status` field:

- `"new"`: has current data but no previous data (new keyword)
- `"comparable"`: has both current and previous data (normal comparison)
- `"unavailable"`: insufficient data for comparison

### Frontend display

For new keywords:

- **Current Bid:** display latest valid Max CPT
- **Previous Bid:** show "New" indicator (not N/A, not copied current value)
- **Bid Change / Bid %:** N/A
- **Current metrics:** display normally
- **Period comparison table:** show "New" in Movement column, "—" for previous values
- **Overview panel:** explanatory notice explaining data is still being collected

Once sufficient historical data exists, `comparison_status` automatically becomes `"comparable"` and normal comparisons appear.

## Screens and consumers

| Screen | Data path |
|--------|-----------|
| Dashboard | `/api/compare/period` overall + campaigns |
| Campaigns | `/api/compare/period` campaigns |
| Keywords Overview | `/api/compare/period` keywords (row already compared) |
| Bid History | `/api/bid-experiments/:id` (same formulas, custom windows) |
| History | Import summaries + legacy `/api/compare` |

---

## Frontend responsibilities

Allowed:

- Currency / percent / integer formatting
- Arrows reflecting **numerical** direction (e.g. CPT ↓ when CPT falls)
- N/A for null
- Neutral movement labels: Increase / Decrease / Unchanged / Unavailable / New activity

Not allowed for descriptive analytics UI:

- Improved / Declined judgements
- Recalculating CPA/CPT/TTR/CR with different formulas than the backend

Keyword Overview uses neutral movement presentation. Dashboard KPI cards may still use semantic cost/volume colouring for alerts-style UX; that is presentation, not a second metric engine.

---

## Remaining legacy / known debt

1. **Import-based metrics** (`imports.computeGroupMetrics`, History, Keywords when `ALL`) — parallel formulas; not daily-table Analytics Service.
2. **Brand / Non-brand** — still aggregated in the browser (`computeBrandSplit`).
3. **Insights engine** — may use severity language (warning/positive); separate from Overview movement labels.
4. **Legacy `/api/compare`** — import pairwise compare; not used by live period Dashboard.
5. Historical Baselines remain Bid History–scoped; not part of the shared period object yet.

---

## Explicitly out of scope (this document’s phase)

- Historical Baselines productisation beyond existing Bid History fields
- Behaviour Profiles, Recommendations, AI
- New charts, ROAS, placement analytics
- New keyword dimension tables
