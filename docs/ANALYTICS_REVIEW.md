# Analytics Layer Review — Outcome

**Date:** 22 July 2026  
**Project:** Delm8 Ads Analyser  
**Phase:** Context-efficiency / technical-debt (pre–Historical Baselines)

---

## Purpose

Confirm that Dashboard, Campaigns, Keywords Overview, and Bid History use consistent analytics definitions, and remove duplicated calculation logic before later analytical layers (Historical Baselines, Behaviour Profiles, Recommendations) are added.

**Explicitly out of scope for this phase:** Historical Baselines product work, recommendations, behaviour profiles, AI, new charts, new product features, database migrations, broad UI redesign.

---

## Verdict

**A new Performance Engine is not required.**

The application already has a reliable canonical path:

```
daily_campaign_metrics / daily_keyword_metrics
        ↓
analyticsMetrics.js  (calculateDerivedMetrics + percentChange)
        ↓
analyticsService.js  (aggregation, resolvePeriods)
        ↓
compareStructured.js → GET /api/compare/period
        ↓
Dashboard · Campaigns · Keywords Overview

bidExperiments.js → same formulas, custom before/after windows
        ↓
Bid History
```

**Action taken:** extend and document the existing Analytics Service / `analyticsMetrics` module; do not invent a parallel abstraction.

---

## Audit answers (summary)

| # | Question | Answer |
|---|----------|--------|
| 1 | Where are core metrics calculated? | Totals in SQL; derived metrics in `calculateDerivedMetrics`. Import/History uses a parallel path. |
| 2 | CPT/CPA/TTR/CR in one module? | Yes for live period analytics and Bid History. |
| 3 | Install attribution consistent? | Yes on daily path: tap-through (`installs_tap_through` with legacy `installs` fallback). Imports may differ. |
| 4 | Period comparison where? | Backend (`resolvePeriods` + Analytics Service). Frontend may recompute % for display from current/previous. |
| 5 | % change duplicated? | Yes — was triplicated (service, bid experiments, frontend). Consolidated. |
| 6 | Zero denominators consistent? | Yes in canonical module → `null` (never Infinity/NaN). |
| 7 | Missing vs zero? | Totals may be `0`; derived unavailable → `null`; UI shows N/A. |
| 8 | Keywords Overview uses Analytics Service? | Yes, via `/api/compare/period` keywords payload. |
| 9 | Bid History same formulas? | Yes (`calculateDerivedMetrics`). Windows differ by design. |
| 10 | Date ranges consistent? | Period presets: equal-length, non-overlapping inclusive ranges. Bid experiment windows are separate. |
| 11 | Legacy routes still live? | `/api/compare` (import-based) for History. Period screens use `/api/compare/period`. |
| 12 | Could two screens disagree? | Yes if one uses period data and one uses import/ALL fallback; Overview vs Bid History can differ because windows differ. |
| 13 | Brand/Non-brand in browser? | **Yes — still.** Documented as remaining debt. |
| 14 | Improved/Declined in frontend? | Removed from Keywords Overview. Dashboard insights/KPI colouring may still use semantic tones. |
| 15 | Smallest safe consolidation? | Shared % change + docs + Overview neutralization + tests. No new engine/API/migration. |

---

## Metric calculation map (pre-consolidation)

| Metric | Canonical location | Other locations (debt / legacy) |
|--------|--------------------|----------------------------------|
| Spend, Impressions, Taps, Installs | SQL `SUM` in Analytics Service / Bid Experiments | Import `computeGroupMetrics` |
| CPT, CPA, TTR, CR | `analyticsMetrics.calculateDerivedMetrics` | Frontend keyword mapper fallbacks; import averages |
| % change | Was: `analyticsService.calcChange`, `bidExperiments.percentChange`, `dashboardHelpers.percentChange` | Weekly trend helpers |
| Period windows | `analyticsService.resolvePeriods` | Bid Experiments custom observation windows |
| Brand / Non-brand | — | Frontend `computeBrandSplit` |

---

## Confirmed duplicate / conflicting logic (addressed or deferred)

### Addressed in this phase

1. **Triplicated percentage-change helpers** — consolidated into `analyticsMetrics.percentChange` / `describeMetricChange`; service and Bid Experiments consume it; frontend mirrors the rules.
2. **0 → 0 treated as unavailable** — corrected to percent `0`, direction `unchanged`.
3. **0 → positive risking Infinity/100%** — remains `null` percent with **New activity** UI (not Infinity).
4. **Keywords Overview “Improved” / “Declined”** — removed; factual movement labels only.

### Deferred (documented debt)

1. Brand / Non-brand still aggregated in the browser.
2. Import/History metrics still use `imports.computeGroupMetrics` (parallel formulas).
3. Annotation entity keys vs Bid Experiment identity (`bid_strategy`, blank normalization) are not identical — do not conflate them.
4. Dashboard KPI semantic good/bad colouring retained (presentation); Overview is neutral.

---

## Stable keyword identity

**Bid Experiments (authoritative for keyword performance experiments):**

```
app_id | campaign_name | ad_group_name | keyword_text | bid_strategy
```

- Null/blank `ad_group_name` and `bid_strategy` → `''`
- Matches `daily_keyword_metrics` uniqueness
- Do not join by keyword text alone

**Period annotation entity keys** use `-` for blanks and omit `bid_strategy`. Treat as a separate key space.

---

## Canonical install attribution

**Tap-through installs** for CPA and Conversion Rate.

SQL pattern:

```sql
SUM(COALESCE(NULLIF(installs_tap_through, 0), installs))
```

Semantics were **not** silently changed.

---

## Canonical formulas

| Metric | Formula | If denominator is 0 |
|--------|---------|---------------------|
| CPT | `spend / taps` | `null` |
| CPA | `spend / installs_tap_through` | `null` |
| TTR | `(taps / impressions) × 100` | `null` |
| Conversion Rate | `(installs_tap_through / taps) × 100` | `null` |

### Totals vs derived

- **Totals:** genuine zero activity may be `0`.
- **Derived:** unavailable → `null` (never Infinity, NaN, or zero-as-missing).
- **Frontend:** display `null` as N/A.

---

## Percentage-change rules (canonical)

| Case | Percent | Direction |
|------|---------|-----------|
| Both available, previous ≠ 0 | `((current − previous) / previous) × 100` | `increase` / `decrease` / `unchanged` |
| previous = 0, current = 0 | `0` | `unchanged` |
| previous = 0, current ≠ 0 | `null` | `unavailable` (+ new-activity flag) |
| Either value missing | `null` | `unavailable` |

Direction describes **numerical movement only** — not improved, declined, good, or bad.

---

## Date-range semantics

`resolvePeriods` (Analytics Service):

- Inclusive calendar dates
- Current N days → previous = immediately preceding N days, non-overlapping
- Example (7 days ending 2026-07-20): current `2026-07-14 → 2026-07-20`, previous `2026-07-07 → 2026-07-13`

**All Time:** frontend disables period comparison (`periodComparison = null`). No manufactured previous-all-time window.

Missing calendar days are omitted from analytical aggregates (not filled with synthetic zeros).

---

## What was implemented

### Backend

- Extended `backend/analyticsMetrics.js` with `percentChange`, `changeDirection`, `describeMetricChange`, `CHANGE_DIRECTION`
- `analyticsService` and `bidExperiments` now use the shared percent-change implementation
- Added `backend/test-analytics-metrics.js` (`npm run test:analytics`)

### Frontend

- Aligned `dashboardHelpers.percentChange` / `describeMetricChange` with backend rules
- Keywords Overview: neutral movement (Increase / Decrease / Unchanged / Unavailable / New activity)
- Removed Improved / Declined from Overview
- Arrows follow numerical direction (e.g. CPT falling → ▼)
- `KpiCard` supports `neutralMovement` and `changeLabel` (e.g. New activity)

### Documentation

- Created **`docs/ANALYTICS.md`** (ongoing source of truth for analytics)
- Updated **`docs/ARCHITECTURE.md`** Analytics Service section

### Not implemented (by design)

- No new `/api/keyword-performance` endpoint
- No new Performance Engine module
- No database migration
- No Historical Baselines / recommendations / behaviour profiles / AI
- No Brand/Non-brand backend migration
- Bid experiment detection, windows, and statuses unchanged

---

## Behavioural correction worth noting

| Before | After |
|--------|--------|
| previous = 0 and current = 0 → change unavailable (`null`) | percent `0`, direction **unchanged** |
| previous = 0 and current > 0 → risk of misleading % | percent `null`, UI **New activity** |
| Overview status “Improved” / “Declined” | Factual movement labels only |

Dashboard totals and period windows were not redesigned; formula source for derived metrics was already shared.

---

## Example corrected outputs

**New activity (previous installs 0 → current 1)**  
Installs: `1` · Change: **New activity** (not ∞ / 100%)

**CPT decrease (£7.50 → £5.54)**  
CPT: `£5.54` · **▼ 26%** · Movement: **Decrease**

**Both periods zero**  
Change: **0%** · Movement: **Unchanged**

**Zero taps**  
CPT: **N/A** (`null`), not `0` or Infinity

---

## Screens → data path (after review)

| Screen | Path | Same derived formulas? |
|--------|------|------------------------|
| Dashboard | `/api/compare/period` | Yes |
| Campaigns | `/api/compare/period` | Yes |
| Keywords Overview | `/api/compare/period` keywords | Yes |
| Bid History | `/api/bid-experiments/:id` | Yes (custom windows) |
| History | Import summaries / legacy `/api/compare` | Parallel legacy path |

---

## Remaining known limitations

1. Dual analytics paths: daily period tables vs import summaries  
2. Brand / Non-brand still client-side  
3. Match type / keyword status often unavailable in Overview summary  
4. Bid Experiment identity includes `bid_strategy`; period entity keys do not  
5. Insights engine may still use severity language on Dashboard (separate from Overview movement labels)

---

## Verification performed

| Check | Result |
|-------|--------|
| `npm run test:analytics` | Pass (22 cases) |
| `npm run test:bid-experiments` | Pass |
| Frontend production build | Pass |
| `Improved` / `Declined` in `frontend/src` | None remaining |
| Migrations / new tables | None added |
| Historical Baselines / recommendations | Not added |

---

## Recommended next phases (not done here)

1. Optional: move Brand/Non-brand aggregation into Analytics Service (small, scoped)  
2. Historical Baselines on top of shared formulas (already partially present on Bid History detail)  
3. Behaviour Profiles / Recommendations consuming the same canonical metrics  
4. Gradually retire or clearly quarantine import-based metric formulas for live screens

---

## Related documents

- [`docs/ANALYTICS.md`](./ANALYTICS.md) — living analytics source of truth  
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — system architecture including Bid Experiments  

---

## One-line summary

**The live analytics stack already had one metric engine; this review consolidated percentage-change rules, removed Overview value judgements, documented the contract in `ANALYTICS.md`, and added tests — without adding a redundant Performance Engine or new product features.**
