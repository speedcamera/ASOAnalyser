# Architecture — SEO Analyser

Reference for the **current** implementation (not the aspirational design).
Updated after the Bid Experiments phase.

---

## 1. Overview

Delm8 Apple Ads / SEO Analyser is a Node/Express + Postgres backend and Vite/React frontend.

CSV uploads land in `imports` / `import_rows`, then roll into:

- `daily_campaign_metrics`
- `daily_keyword_metrics`

Period analytics for Dashboard, Campaigns, and Keywords primarily read those daily tables through `analyticsService.js` (via `compareStructured.js`).

Campaign segments live in `campaigns` and are inherited by keywords at query time via `(app_id, campaign_name)`.

---

## 2. Important tables

| Table | Role |
|-------|------|
| `imports` / `import_rows` | Raw CSV storage |
| `daily_campaign_metrics` | Per-day campaign rollups |
| `daily_keyword_metrics` | Per-day keyword rollups (unique on app/date/campaign/ad group/keyword/`bid_strategy`) |
| `campaigns` | Campaign dimension + editable `segment` |
| `annotations` | Notes on campaign/keyword entity keys |
| `performance_goals` | Target thresholds (alerts evaluated live) |
| `application_settings` | Narrow key/value settings (e.g. bid experiment default window) |
| `bid_experiments` | Detected Max CPT bid-change experiments |

There is **no** `daily_app_metrics` table and no standalone `keywords` dimension table.

`campaign_id` / `keyword_id` on daily keyword metrics are typically null. Relationships use composite keys, not those IDs.

**Multi-tenant ownership (P2) and query scoping (P4):** All customer data tables include `organisation_id INTEGER NOT NULL` referencing `organisations(id)`. Customer-data and analytics queries filter on `organisation_id`. Apple Ads routes take that id from `req.organisationId`.

**Multi-tenant uniqueness (P3):** All unique constraints now include `organisation_id` prefix:
- `import_rows`: `(organisation_id, record_key)`
- `campaigns`: `(organisation_id, app_id, campaign_name)`
- `daily_campaign_metrics`: `(organisation_id, app_id, report_date, campaign_name)`
- `daily_keyword_metrics`: `(organisation_id, app_id, report_date, campaign_name, ad_group_name, keyword_text, bid_strategy)`
- `bid_experiments`: `(organisation_id, keyword_identity_key, change_date, previous_max_cpt_bid, new_max_cpt_bid)`

Two organisations can now store identical Apple Ads data independently.

**Authentication (P5A), organisation context (P5B), and protected-route chain (P5C.1):** `@clerk/express` verifies the session (`clerkMiddleware()` then `getAuth()`). A verified Clerk user id is mapped to `users.auth_provider = 'clerk'` and `users.auth_provider_user_id`, then attached as `req.user`. `req.user.id` is the local user id. `GET /api/auth/me` requires that session and does not resolve an organisation. `requireAuthenticatedTenant` runs that authentication step and then P5B organisation resolution, setting `req.organisationId` from `organisation_users`. `GET /api/auth/context` uses that chain. `GET /api/auth/tenant-test` was removed in P6A.1. The current product phase allows one active membership per user. A user with none, other than the configured Development Organisation bootstrap identity, receives a new empty organisation as owner.

**Imports (P5C.2):** `backend/importRoutes.js` registers the import routes on `requireAuthenticatedTenant`. Upload, list, detail, rows, summaries, and import comparison take `req.organisationId` only. `createImport` writes that id through `imports`, `import_rows`, campaigns, daily metrics, bid history, and bid-experiment detection. `getTransitionalOrganisationId()` is not used in that pipeline. P6A.2 caps CSV file size, row count, and upload attempts before that write.

**Dashboard, campaigns, and keywords (P5C.3):** `backend/analyticsRoutes.js` registers apps, alerts, insights, campaign segment updates, weekly performance, and period comparison on `requireAuthenticatedTenant`. Those handlers read `req.organisationId` only. The frontend calls them through the P5D.1 authenticated API client.

**Goals, annotations, and bid experiments (P5C.4):** `backend/featureRoutes.js` registers those routes on `requireAuthenticatedTenant`. Creates, lists, updates, deletes, experiment detection, and experiment analysis use `req.organisationId`. The latest report date and the default observation window are organisation-scoped. The transitional Development Organisation resolver is no longer used by production routes. The P5B bootstrap identity can still join the existing Development Organisation. P5C application tenant migration is complete.

---

## 3. Analytics Service

**File:** `backend/analyticsService.js`  
**Formulas + % change:** `backend/analyticsMetrics.js` → `calculateDerivedMetrics`, `percentChange`, `describeMetricChange`

Canonical installs for CPA/CR: tap-through (with legacy `installs` fallback in SQL).

See **`docs/ANALYTICS.md`** for formulas, date-range rules, missing-vs-zero, and consumer map.

Consumed by:

- `compareStructured` → Dashboard / Campaigns / Keywords period payload
- `campaignWeekly` → charts / weekly table
- `insightsEngine`
- `alerts`
- `bidExperiments` (same derived formulas; custom before/after windows)

Still outside the service: import-level summaries, Brand/Non-brand client aggregation.

**No separate Performance Engine** — extend this service + `analyticsMetrics` instead.

---

## 4. Bid Experiments

### Purpose

Descriptive detection of meaningful Max CPT bid changes. Compare keyword performance before and after each change.

This phase does **not** provide:

- causal proof or statistical significance
- success/failure verdicts
- behaviour profiles or elasticity scores
- bid recommendations or AI advice
- ROAS / revenue analysis

### Identity

```
keyword_identity_key =
  app_id | campaign_name | ad_group_name | keyword_text | bid_strategy
```

Empty/null `ad_group_name` and `bid_strategy` normalize to `''` (matches `daily_keyword_metrics` uniqueness).

### Bid-change tolerance

- Bids are currency values rounded to **2 decimal places** (cents).
- Equal after rounding ⇒ no experiment (`1.2` vs `1.20` ignored).
- A one-penny difference is a genuine experiment.

Ignored as experiments:

- first recorded bid for a keyword
- null ↔ value transitions
- same-day duplicates (already collapsed in daily metrics)

### Detection

**Module:** `backend/bidExperiments.js`

- Scans `daily_keyword_metrics` ordered by `report_date`
- Creates one row per genuine previous→new bid pair
- Idempotent unique constraint:
  `(keyword_identity_key, change_date, previous_max_cpt_bid, new_max_cpt_bid)`
- Runs:
  - after import commit (scoped to affected identities)
  - startup backfill after daily-metrics backfill (`setImmediate`)

### Observation window setting

- Key: `bid_experiment_default_observation_days`
- Allowed: **3, 7, 14, 30**
- Default: **7**
- Applies only when **new** experiments are created
- Existing experiments keep `requested_observation_days`

### Before / after windows

For `change_date` and requested `N` days:

| Window | Range |
|--------|-------|
| Before | `[change_date − N, change_date)` — excludes change date |
| After | starts **on** `change_date` (daily row reflects the bid in effect that day), for up to `N` calendar days |

Missing calendar days are omitted from aggregates (not treated as zeros).

Metrics (via `calculateDerivedMetrics`): spend, impressions, taps, installs, CPT, CPA, TTR, CR + % deltas. Zero denominators ⇒ `null` (never Infinity/NaN).

### Historical baselines (Typical Range)

`GET /api/bid-experiments/:id` includes a `baselines` object calculated on read from daily CPA before `change_date` (default 90-day lookback; days with installs > 0 only).

| Field | Meaning |
|-------|---------|
| `typical_low` / `typical_high` | Q1–Q3 (“Typical Range”) — primary UI presentation |
| `current` | After-window CPA |
| `status` | Above / Within / Below historical range (or insufficient) |
| `confidence` | `High` (≥30 samples), `Medium` (≥14), `Low` (≥5), `Insufficient` (<5) |
| `statistics` | Full summary: median, q1, q3, iqr, min, max, sample_size — secondary/advanced only |

Frontend Bid History shows **Typical CPA**, **Current CPA**, and **Status** — not median/IQR labels.

### Status

Resolved against **latest available `report_date`** for the app (not merely “today”):

| Status | Meaning |
|--------|---------|
| `observing` | Dataset has not reached the full requested after window |
| `completed` | Full window elapsed with adequate data |
| `interrupted` | Later bid change for the same identity shortened the after window |
| `insufficient_data` | Fewer than 2 data days in before/after when evaluation is due |

Interrupted after windows **exclude** the subsequent change date.

Performance totals are **not** stored on experiments; they are calculated on read.

### API

| Method | Path | Role |
|--------|------|------|
| GET | `/api/bid-experiments` | List summaries (filterable) |
| GET | `/api/bid-experiments/:id` | Full before/after analysis |
| GET | `/api/bid-experiment-settings` | Default + allowed windows |
| PATCH | `/api/bid-experiment-settings` | Update default (3/7/14/30 only) |

### Frontend

Keywords page → click keyword → `KeywordDetailDrawer` → **Bid History** tab:

- default observation window control
- chronological experiment list
- detail panel with before/after metrics

UI does not label experiments as success/failure.

---

## 4a. Campaign daily budget history

Daily Budget is recorded on each Apple Ads report row and stored on `daily_campaign_metrics.daily_budget` for that report date. That table is the canonical history. There is no second budget-history table.

Campaign identity is `organisation_id` + `app_id` + `campaign_name`, the same composite used by campaign analytics. Apple campaign IDs are not the key. The same campaign name in another organisation or another app has its own budget series.

A budget **observation** is the first report date of a rounded (2 decimal) budget. A budget **change** is a later observation whose budget differs from the previous recorded budget. The first observation is not a change, and a missing budget is never treated as zero.

Chronology uses `report_date`. Uploading an older CSV later cannot reverse a newer report date, because each campaign-day is one row. Re-importing the same day replaces that day's budget and does not append a duplicate change.

`GET /api/campaigns/budget-history` returns the derived changes for one campaign. Campaign period responses also include `current_daily_budget`, `previous_daily_budget`, `budget_change`, `budget_change_percent`, `budget_first_observed_date`, `budget_observation_count`, `budget_comparison_status` (`new` for one recorded date, `unchanged` when that same budget repeats, `comparable` when an earlier different budget exists, `unavailable` only when no budget exists), `budget_changed_in_selected_period`, and `last_budget_change_at`. `daily_budget` and `current_daily_budget` are the latest non-null budget by report date. A missing previous budget does not clear the current budget. A recorded zero stays zero.

This phase does not create budget experiments or before/after performance scores.

---

## 5. Import pipeline

```
CSV → parseCsv → createImport (import_rows)
    → upsert daily campaign/keyword metrics
      (daily_budget on each report date is the budget history write)
    → COMMIT
    → detectBidExperimentsForKeywordRecords (scoped)
```

Startup: migrate → backfill daily metrics → backfill bid experiments.

---

## 6. Frontend pages

| Page | Data |
|------|------|
| Dashboard | Period compare + insights + alerts + client Brand/Non-brand |
| Campaigns | Period campaigns + daily budget history + editable segments |
| Keywords | Period keywords (or import fallback) + Bid History drawer |
| History | Per-import summaries |

---

## 7. Known limitations

- Keyword↔campaign joins use name+app (Apple campaign IDs unused).
- Dual analytics paths remain (period daily tables vs import summaries).
- Brand/Non-brand still aggregated in the browser.
- Bid experiments are descriptive only.
- Per-experiment observation window is immutable in the UI by design.

---

## 8. Important backend files

```
backend/analyticsService.js
backend/analyticsMetrics.js
backend/bidExperiments.js
backend/campaignBudgetHistory.js
backend/campaignWeekly.js
backend/compareStructured.js
backend/dailyMetrics.js
backend/db.js
backend/auth/clerkConfig.js
backend/auth/localUser.js
backend/auth/middleware.js
backend/auth/organisationContext.js
backend/auth/tenantMiddleware.js
backend/auth/routes.js
backend/imports.js
backend/importRoutes.js
backend/insightsEngine.js
backend/campaigns.js
backend/goals.js
backend/alerts.js
```
