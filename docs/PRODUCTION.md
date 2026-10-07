# Multi-Tenant Productionisation Plan

**Delm8 Ads Analyser — External SaaS Migration**

---

## 1. Executive Summary

### Current State

Delm8 Ads Analyser is a **single-tenant application** with **no authentication system** and **no ownership isolation**. All data is globally accessible. Every table, API endpoint, and query operates in a shared namespace.

### Target Outcome

Enable multiple unrelated organisations to use the product safely with **complete data isolation**. Organisation A must never read, modify, import, query, or affect Organisation B's data, even if a user manipulates API parameters or IDs directly.

### Critical Finding

**ZERO tenant safety exists today.** This is a ground-up architectural change, not an incremental feature. Every customer-data table, API route, query, import flow, unique constraint, and entity key must be modified.

### Risk Level

**CRITICAL**. Launching multi-tenant without implementing the full isolation plan would result in immediate data leakage, cross-tenant contamination, and complete security failure.

### Recommended Approach

Phased migration with **authentication-first**, then **schema updates**, then **route protection**, then **frontend context**. Do not skip authentication. Do not assume frontend filtering provides safety.

---

## 2. Current Ownership Model

### Reality Check

| Entity | Current Ownership | Tenant Isolation | Production Ready |
|--------|-------------------|------------------|------------------|
| `imports` | **NONE** | No | ❌ |
| `import_rows` | **NONE** (FK to import) | No | ❌ |
| `campaigns` | `app_id` only | No | ❌ |
| `daily_campaign_metrics` | `app_id` only | No | ❌ |
| `daily_keyword_metrics` | `app_id` only | No | ❌ |
| `annotations` | `entity_key` string | No | ❌ |
| `performance_goals` | `entity_key` string | No | ❌ |
| `bid_experiments` | `app_id` only | No | ❌ |
| `application_settings` | **GLOBAL** | No | ❌ |

### App Identity (Current Implementation)

**`app_id` is NOT a tenant identifier.** It is an **Apple App Store product ID** derived from CSV imports.

- **Source:** CSV column `App ID`, `Adam ID`, or `App Adam ID`
- **Alternative:** CSV column `App Name` → `name:<lowercased>`
- **Storage:** `app_id` TEXT field (nullable in most tables)
- **Unique identifier:** Computed `app_key` (e.g., `id:123456789` or `name:myapp`)

**Critical issue:** Two unrelated organisations can import data for **the same Apple App Store app_id**. The current schema would **merge their data** because there is no tenant boundary.

**Example collision:**

- **Organisation A** imports campaign data for app `id:123456789`
- **Organisation B** also manages app `id:123456789` (same Apple app)
- Current schema: both organisations' campaigns collide in `campaigns` table
- Deduplication: `record_key` in `import_rows` would treat identical rows as duplicates
- Query leakage: both organisations see each other's performance data

### Primary Keys

All tables use surrogate integer primary keys (`id SERIAL` or `id BIGSERIAL`).

**Exploitable:** A user who discovers another organisation's campaign `id=42` can:

- Read: `GET /api/campaigns/42` (no such route exists yet, but pattern is exploitable)
- Update: `PATCH /api/campaigns/42`
- Delete: not implemented, but trivial to add without checks

**Pre-P4 note:** customer-data queries did not yet filter by tenant. P4 made `organisation_id` mandatory on those queries. This section records the risk that P4 closed.

---

## 3. Authentication Status

### Current State

Historical snapshot from before the multi-tenant work. It is not the current status. Phase P5A below is the authentication foundation. Phase P5B resolves an organisation for routes that opt in. Customer routes still use the Development Organisation until P5C.

| Component | Exists |
|-----------|--------|
| `users` table | ❌ No |
| Login system | ❌ No |
| Sessions | ❌ No |
| JWTs | ❌ No |
| Cookies | ❌ No |
| Password hashing | ❌ No |
| Password reset | ❌ No |
| Email verification | ❌ No |
| User registration | ❌ No |
| User roles | ❌ No |

### Backend

- **No middleware** checks authentication.
- **No `req.user`** context.
- **All routes are public.**

### Frontend

- **No login screen.**
- **No user identity.**
- **AppContext** manages app filters and period presets but contains zero authentication.

### Environment

- `.env` contains only:
  ```
  DATABASE_URL=postgresql://...
  PORT=3001
  ```
- No `JWT_SECRET`, `SESSION_SECRET`, or authentication provider config.

### Deployment

**UNKNOWN.** No production deployment configuration file found.

If deployed today as-is, the application is **completely public**. Anyone with the URL can:

- Upload CSVs
- View all campaigns
- Modify all goals
- Read all annotations
- Access all historical data

---

## 4. Proposed Tenant Model

### Minimum Viable Entities

```
users
  id                    SERIAL PRIMARY KEY
  email                 TEXT UNIQUE NOT NULL
  password_hash         TEXT NOT NULL
  full_name             TEXT
  created_at            TIMESTAMPTZ DEFAULT NOW()
  updated_at            TIMESTAMPTZ DEFAULT NOW()

organisations
  id                    SERIAL PRIMARY KEY
  organisation_name     TEXT NOT NULL
  created_at            TIMESTAMPTZ DEFAULT NOW()
  updated_at            TIMESTAMPTZ DEFAULT NOW()

organisation_users
  id                    SERIAL PRIMARY KEY
  organisation_id       INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
  role                  TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'analyst'))
  created_at            TIMESTAMPTZ DEFAULT NOW()
  UNIQUE (organisation_id, user_id)

apps
  id                    SERIAL PRIMARY KEY
  organisation_id       INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE
  external_app_id       TEXT   -- Apple App Store ID (may be null)
  app_name              TEXT NOT NULL
  created_at            TIMESTAMPTZ DEFAULT NOW()
  updated_at            TIMESTAMPTZ DEFAULT NOW()
  UNIQUE (organisation_id, external_app_id)  -- same external ID allowed across orgs
  UNIQUE (organisation_id, app_name)         -- same name allowed across orgs
```

### Roles (Initial)

| Role | Capabilities |
|------|--------------|
| **owner** | Full organisation control: invite/remove users, change settings, delete data |
| **admin** | Manage campaigns, goals, annotations, uploads. Cannot manage users or billing. |
| **analyst** | Read-only: view dashboards, campaigns, keywords, history. Cannot edit or upload. |

**Do not add more roles until these three are proven.**

### Organisation Scope Rule

Every protected request must resolve:

```
authenticatedUser (from session/JWT)
  ↓
activeOrganisation (from user selection or single membership)
  ↓
authorisedMembership (check organisation_users)
  ↓
tenant-scoped query (WHERE organisation_id = ...)
```

**The frontend must never be the source of truth for organisation_id.**

Query parameters like `?organisationId=123` are **advisory only**. The backend must derive `organisation_id` from the authenticated session.

### Apps Table

**Purpose:** Internal registry of apps managed by each organisation.

- **`external_app_id`:** Apple App Store product ID (nullable, not unique globally)
- **`app_name`:** Display name (not unique globally)
- **Organisation boundary:** `(organisation_id, external_app_id)` unique
- **Foreign key target:** `daily_*_metrics` should eventually reference `apps.id`

**Migration complexity:**

Current `app_id` in daily tables is the **raw external identifier**. Post-migration:

- Option A: Keep `app_id TEXT` as external ID, add `internal_app_id INTEGER REFERENCES apps(id)`
- Option B: Replace `app_id` with `app_id INTEGER REFERENCES apps(id)`, store external ID in `apps.external_app_id`

**Recommended:** Option A (preserve existing daily table `app_id` as external, add separate FK). Less disruptive.

---

## 5. Database Ownership Map

### Tables Requiring Direct `organisation_id`

These tables are **customer data** and must have direct organisation ownership:

| Table | Add Column | Reason |
|-------|------------|--------|
| **imports** | `organisation_id INTEGER NOT NULL REFERENCES organisations(id)` | Root ownership — every CSV upload belongs to one org |
| **campaigns** | `organisation_id INTEGER NOT NULL REFERENCES organisations(id)` | Campaign dimension is tenant-specific |
| **annotations** | `organisation_id INTEGER NOT NULL REFERENCES organisations(id)` | Notes are private to tenant |
| **performance_goals** | `organisation_id INTEGER NOT NULL REFERENCES organisations(id)` | Goals are private to tenant |
| **bid_experiments** | `organisation_id INTEGER NOT NULL REFERENCES organisations(id)` | Detected experiments are tenant-specific |
| **apps** | `organisation_id INTEGER NOT NULL REFERENCES organisations(id)` | Internal app registry per tenant |

### Tables Inheriting Ownership

These tables can **inherit** organisation ownership through a parent FK:

| Table | Inherits From | Safe Chain |
|-------|---------------|------------|
| **import_rows** | `imports.id → imports.organisation_id` | ✅ Safe (1 hop) |
| **daily_campaign_metrics** | Future: `apps.id → apps.organisation_id` | ⚠️ Requires apps table first |
| **daily_keyword_metrics** | Future: `apps.id → apps.organisation_id` | ⚠️ Requires apps table first |

**Critical decision:**

Should `daily_*_metrics` have **direct** `organisation_id` or **inherited** through `apps`?

**Recommended:** Add **direct `organisation_id`** to daily tables during migration for safety and query performance. Avoid requiring joins through `apps` on every analytics query.

**Final recommendation:**

```sql
ALTER TABLE daily_campaign_metrics ADD COLUMN organisation_id INTEGER REFERENCES organisations(id);
ALTER TABLE daily_keyword_metrics ADD COLUMN organisation_id INTEGER REFERENCES organisations(id);
```

Backfill from the `imports.organisation_id` that created them. Add `NOT NULL` constraint after backfill verification.

### Global Tables (No Tenant Scope)

| Table | Scope | Multi-tenant Handling |
|-------|-------|----------------------|
| **application_settings** | System-wide | Move tenant-specific settings (e.g., default bid experiment window) to new `organisation_settings` table |

**Recommended:**

```sql
CREATE TABLE organisation_settings (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  setting_key TEXT NOT NULL,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id, setting_key)
);
```

System-wide defaults remain in `application_settings`. Tenant overrides go in `organisation_settings`.

---

## 6. Backend Route Audit

### Current Routes (All Unprotected)

| Method | Endpoint | Purpose | Tables Touched | Current Scoping | Required Tenant Scope |
|--------|----------|---------|----------------|-----------------|----------------------|
| GET | `/api/health` | Health check | — | None | ✅ Public (no change) |
| GET | `/api/apps` | List apps | `import_rows` (inferred) | **None** | **organisation_id** from session |
| GET | `/api/annotations` | List annotations | `annotations` | `entity_type`, `entity_key` | **organisation_id** + entity filters |
| POST | `/api/annotations` | Create annotation | `annotations` | None | **organisation_id** from session |
| PUT | `/api/annotations/:id` | Update annotation | `annotations` | `id` only | **organisation_id** ownership check |
| DELETE | `/api/annotations/:id` | Delete annotation | `annotations` | `id` only | **organisation_id** ownership check |
| GET | `/api/goals` | List goals | `performance_goals` | Optional `entity_type`, `entity_key` | **organisation_id** + entity filters |
| POST | `/api/goals` | Create goal | `performance_goals` | None | **organisation_id** from session |
| PUT | `/api/goals/:id` | Update goal | `performance_goals` | `id` only | **organisation_id** ownership check |
| DELETE | `/api/goals/:id` | Delete goal | `performance_goals` | `id` only | **organisation_id** ownership check |
| GET | `/api/alerts` | Evaluate alerts | `performance_goals`, `daily_*_metrics` | Optional `entity_type`, `entity_key` | **organisation_id** |
| PATCH | `/api/campaigns/:id` | Update campaign segment | `campaigns` | `id` only | **organisation_id** ownership check |
| GET | `/api/bid-experiments` | List experiments | `bid_experiments` | Optional `appId`, `campaignName`, etc. | **organisation_id** |
| GET | `/api/bid-experiments/:id` | Get experiment detail | `bid_experiments`, `daily_keyword_metrics` | `id` only | **organisation_id** ownership check |
| GET | `/api/bid-experiment-settings` | Get default observation window | `application_settings` | **Global** | **Move to org settings** |
| PATCH | `/api/bid-experiment-settings` | Update default observation window | `application_settings` | **Global** | **Move to org settings** |
| GET | `/api/insights` | Generate insights | `daily_*_metrics` | Optional `appId` | **organisation_id** |
| GET | `/api/campaigns/weekly-performance` | Campaign weekly chart | `daily_campaign_metrics` | Optional `appId`, `campaignName` | **organisation_id** |
| GET | `/api/compare/period` | Period comparison | `daily_*_metrics`, `campaigns` | Optional `appId` | **organisation_id** |
| GET | `/api/compare` | Legacy import comparison | `imports`, `import_rows` | `baseImportId`, `compareImportId` | **organisation_id** ownership check |
| POST | `/api/imports` | CSV upload | `imports`, `import_rows`, `daily_*_metrics` | **None** | **organisation_id** from session |
| GET | `/api/imports` | List imports | `imports` | **None** | **organisation_id** |
| GET | `/api/imports/:id` | Get import | `imports` | `id` only | **organisation_id** ownership check |
| GET | `/api/imports/:id/keyword-summary` | Import keyword summary | `import_rows` | `id` only | **organisation_id** ownership check |
| GET | `/api/imports/:id/campaign-summary` | Import campaign summary | `import_rows` | `id` only | **organisation_id** ownership check |
| GET | `/api/imports/:id/metrics-summary` | Import metrics summary | `import_rows` | `id` only | **organisation_id** ownership check |
| GET | `/api/imports/:id/profile` | Import column profile | `imports` | `id` only | **organisation_id** ownership check |
| GET | `/api/imports/:id/rows` | Import raw rows | `import_rows` | `id` only | **organisation_id** ownership check |

### High-Risk ID-Based Routes

**Critical vulnerability:** Any route accepting `:id` in the path currently has **zero ownership validation**.

**Attack scenario:**

1. User in Organisation A discovers they are viewing campaign `id=15`
2. User changes URL to `PATCH /api/campaigns/16`
3. Current code: updates campaign 16 (owned by Organisation B)
4. **Complete cross-tenant modification.**

**Required fix:**

Every ID-based route must:

```javascript
// Example: PATCH /api/campaigns/:id
const campaignId = parseInt(req.params.id, 10)
const organisationId = req.session.organisationId  // from auth middleware

const campaign = await pool.query(
  `SELECT id FROM campaigns WHERE id = $1 AND organisation_id = $2`,
  [campaignId, organisationId]
)

if (campaign.rows.length === 0) {
  return res.status(404).json({ error: 'Campaign not found' })
}

// Proceed with update
```

**Same pattern required for:**

- `/api/annotations/:id`
- `/api/goals/:id`
- `/api/campaigns/:id`
- `/api/bid-experiments/:id`
- `/api/imports/:id` (all child routes)

### Analytics Queries (Highest Risk)

**Current behaviour:** All analytics queries accept optional `appId` filter but **no tenant boundary**.

**Example exploit:**

```
GET /api/compare/period?days=7&appId=<competitor_app_id>
```

Current code: returns **all data** for that `app_id` across **all organisations**.

**Required change:**

```javascript
// analyticsService.js → buildFilters()
function buildFilters({ startDate, endDate, appId, campaignName, organisationId }, baseParams = []) {
  const conditions = []
  const params = [...baseParams]
  let paramIndex = baseParams.length + 1

  // MANDATORY: tenant scope first
  if (!organisationId) {
    throw new Error('organisationId is required for all analytics queries')
  }
  conditions.push(`organisation_id = $${paramIndex++}`)
  params.push(organisationId)

  // Existing filters follow
  if (startDate) { ... }
  if (appId) { ... }

  return { where: conditions.length ? `AND ${conditions.join(' AND ')}` : '', params, paramIndex }
}
```

**Every Analytics Service function must accept `organisationId` parameter** and pass it to `buildFilters`.

**Every route calling Analytics Service must derive `organisationId` from session**, never from query parameter.

---

## 7. Analytics Service Impact

### Functions Requiring Modification

All functions in `analyticsService.js` must accept an **authenticated `organisationId`** parameter:

| Function | Current Signature | Required Change |
|----------|-------------------|-----------------|
| `getOverallSummary()` | `{ startDate, endDate, days, appId, compare }` | Add **`organisationId`** (required) |
| `getCampaignSummary()` | `{ startDate, endDate, days, appId, compare }` | Add **`organisationId`** (required) |
| `getKeywordSummary()` | `{ startDate, endDate, days, appId, campaignName, compare }` | Add **`organisationId`** (required) |
| `resolveKeywordBids()` | `(keywordIdentities, currentEndDate, previousEndDate, appIdFilter, campaignFilter)` | Add **`organisationId`** (required) |
| `getAppBreakdown()` | `{ startDate, endDate, days, compare }` | Add **`organisationId`** (required) |
| `getTopCampaigns()` | `{ startDate, endDate, days, appId, limit }` | Add **`organisationId`** (required) |
| `getTopKeywords()` | `{ startDate, endDate, days, appId, limit }` | Add **`organisationId`** (required) |

### Query Pattern (Before)

```sql
SELECT
  app_id,
  campaign_name,
  SUM(spend) AS spend,
  ...
FROM daily_campaign_metrics
WHERE 1=1
  AND report_date >= $1
  AND report_date <= $2
  AND app_id = $3  -- optional filter
GROUP BY app_id, campaign_name
```

### Query Pattern (After)

```sql
SELECT
  app_id,
  campaign_name,
  SUM(spend) AS spend,
  ...
FROM daily_campaign_metrics
WHERE 1=1
  AND organisation_id = $1        -- MANDATORY
  AND report_date >= $2
  AND report_date <= $3
  AND app_id = $4                 -- optional filter
GROUP BY app_id, campaign_name
```

**Critical:** `organisation_id` filter must be **first** and **required**. Do not allow null.

### Bid Experiments

**Current:** `bidExperiments.js` queries `daily_keyword_metrics` and `bid_experiments` without tenant scope.

**Required:**

- `detectBidExperimentsForKeywordRecords()` → add `organisationId` parameter
- `listBidExperiments()` → add `organisationId` filter from session
- `getBidExperimentById()` → ownership check on `bid_experiments.organisation_id`

### Alerts

**Current:** `alerts.js` → `fetchEntityMetrics()` calls `analyticsService` without tenant scope.

**Required:** Pass `organisationId` from goal's ownership to analytics queries.

---

## 8. Import Pipeline Impact

### Current Flow

```
CSV upload
  ↓
parseCsv() → headers, records
  ↓
createImport() → insert imports, import_rows
  ↓
backfillDailyMetrics() → upsert daily_campaign_metrics, daily_keyword_metrics
  ↓
detectBidExperiments() → insert bid_experiments
```

**Missing:** **Who owns this import?**

### Required Flow

```
Authenticated user request
  ↓
Derive organisation_id from req.session
  ↓
CSV upload
  ↓
parseCsv() → headers, records
  ↓
createImport(organisationId, fileName, headers, records)
  ↓
  INSERT INTO imports (organisation_id, ...)
  ↓
  INSERT INTO import_rows (import_id, organisation_id, ...)  -- explicit org FK
  ↓
backfillDailyMetrics(importId)
  ↓
  Read import.organisation_id
  ↓
  Upsert daily_campaign_metrics with organisation_id
  ↓
  Upsert daily_keyword_metrics with organisation_id
  ↓
detectBidExperiments(organisationId, affectedKeywordIdentities)
  ↓
  INSERT INTO bid_experiments (organisation_id, ...)
```

### Deduplication (Critical Issue)

**Current:** `import_rows` has a **unique index** on `record_key`:

```sql
CREATE UNIQUE INDEX idx_import_rows_record_key ON import_rows (record_key);
```

**`record_key` format:**

```
app_key | date | campaign_name | ad_group_name | keyword_text | bid_strategy
```

**Problem:** If two organisations import **identical CSV rows** (same app, date, campaign, keyword), the second import **fails** due to unique constraint violation.

**Required fix:**

```sql
DROP INDEX idx_import_rows_record_key;

CREATE UNIQUE INDEX idx_import_rows_record_key_org
  ON import_rows (organisation_id, record_key);
```

This allows identical records across tenants but prevents duplicates within a tenant.

### Daily Metrics Deduplication

**Current uniqueness:**

**`daily_campaign_metrics`:**

```sql
UNIQUE (app_id, report_date, campaign_name)
```

**`daily_keyword_metrics`:**

```sql
UNIQUE (app_id, report_date, campaign_name, ad_group_name, keyword_text, bid_strategy)
```

**Problem:** Two organisations importing data for the same `app_id` would **collide**.

**Required fix:**

```sql
-- Drop old constraints
ALTER TABLE daily_campaign_metrics DROP CONSTRAINT uq_daily_campaign;
ALTER TABLE daily_keyword_metrics DROP CONSTRAINT uq_daily_keyword;

-- Add tenant-scoped constraints
ALTER TABLE daily_campaign_metrics
  ADD CONSTRAINT uq_daily_campaign_org UNIQUE (
    organisation_id, app_id, report_date, campaign_name
  );

ALTER TABLE daily_keyword_metrics
  ADD CONSTRAINT uq_daily_keyword_org UNIQUE (
    organisation_id, app_id, report_date, campaign_name, ad_group_name, keyword_text, bid_strategy
  );
```

### Campaign Registry

**Current:** `campaigns` table has:

```sql
UNIQUE (app_id, campaign_name)
```

**Problem:** Two organisations with the same Apple app cannot have campaigns with the same name.

**Required fix:**

```sql
ALTER TABLE campaigns DROP CONSTRAINT uq_campaign;

ALTER TABLE campaigns
  ADD CONSTRAINT uq_campaign_org UNIQUE (organisation_id, app_id, campaign_name);
```

---

## 9. Campaign and Keyword Identity

### Current Identities

**Campaign:**

```
(app_id, campaign_name)
```

**Keyword (stable identity for bid tracking):**

```
app_id | campaign_name | ad_group_name | keyword_text | bid_strategy
```

**Keyword (entity key for annotations):**

```
app_id | campaign_name | ad_group_name | keyword_text
```

_(Note: `bid_strategy` intentionally omitted for backward compatibility with annotations.)_

### Multi-Tenant Identities

**Campaign:**

```
(organisation_id, app_id, campaign_name)
```

**Keyword (stable):**

```
organisation_id | app_id | campaign_name | ad_group_name | keyword_text | bid_strategy
```

**Keyword (entity key):**

```
organisation_id | app_id | campaign_name | ad_group_name | keyword_text
```

### Bid Experiments Identity

**Current unique constraint:**

```sql
UNIQUE (keyword_identity_key, change_date, previous_max_cpt_bid, new_max_cpt_bid)
```

**`keyword_identity_key` format:**

```
app_id | campaign_name | ad_group_name | keyword_text | bid_strategy
```

**Problem:** Experiments for the same keyword across two organisations would collide.

**Required fix:**

```sql
-- Add organisation_id to bid_experiments (already proposed in section 5)

-- Drop old unique index
DROP INDEX uq_bid_experiment;

-- Add tenant-scoped unique index
CREATE UNIQUE INDEX uq_bid_experiment_org
  ON bid_experiments (
    organisation_id,
    keyword_identity_key,
    change_date,
    previous_max_cpt_bid,
    new_max_cpt_bid
  );
```

---

## 10. Notes / Goals / Bid Experiments

### Annotations

**Current storage:**

- `entity_type`: `'campaign'` or `'keyword'`
- `entity_key`: string (e.g., `id:123|MyCampaign`)

**Problem:** `entity_key` is a **tenant-unsafe string**.

**Two organisations could have identical entity keys:**

- Organisation A: campaign `id:123|BrandCampaign`
- Organisation B: campaign `id:123|BrandCampaign`

Current schema: both organisations see **all annotations** for that `entity_key`.

**Required fix:**

```sql
ALTER TABLE annotations ADD COLUMN organisation_id INTEGER REFERENCES organisations(id);

-- Queries must always filter by both:
WHERE entity_type = $1
  AND entity_key = $2
  AND organisation_id = $3
```

**Do not modify `entity_key` format.** Keep backward compatibility. Add `organisation_id` as an **additional required filter**.

### Performance Goals

**Identical issue:**

- `entity_type`: `'campaign'` or `'keyword'`
- `entity_key`: string

**Required fix:**

```sql
ALTER TABLE performance_goals ADD COLUMN organisation_id INTEGER REFERENCES organisations(id);

-- All queries must include:
WHERE organisation_id = $1
  AND entity_type = $2
  AND entity_key = $3
```

### Alerts Evaluation

**Current:** `alerts.js` → `parseEntityKey()` extracts `appId`, `campaignName`, etc. from the string.

**Required:** Pass the goal's `organisation_id` to all `analyticsService` calls. Do not allow alerts to read cross-tenant data.

### Bid Experiments

**Current:** No ownership field.

**Required:** (Already covered in section 5):

```sql
ALTER TABLE bid_experiments ADD COLUMN organisation_id INTEGER NOT NULL REFERENCES organisations(id);
```

All bid experiment queries must filter by `organisation_id`.

---

## 11. Settings

### Current: `application_settings`

**Purpose:** Key-value store for system-wide settings.

**Current keys:**

- `bid_experiment_default_observation_days` (values: 3, 7, 14, 30)

**Scope:** **Global** — affects all users.

### Multi-Tenant Requirement

Tenant-specific settings must not collide. Each organisation may want a different default bid experiment window.

**Recommended:**

1. **Keep `application_settings`** for **system-wide defaults** (e.g., allowed observation days: `[3,7,14,30]`)
2. **Create `organisation_settings`** for **tenant-specific overrides**

```sql
CREATE TABLE organisation_settings (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  setting_key TEXT NOT NULL,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id, setting_key)
);
```

**Query pattern:**

```javascript
async function getSetting(organisationId, key, systemDefault) {
  // 1. Try org-specific setting
  const orgSetting = await pool.query(
    `SELECT setting_value FROM organisation_settings
     WHERE organisation_id = $1 AND setting_key = $2`,
    [organisationId, key]
  )
  if (orgSetting.rows.length > 0) return orgSetting.rows[0].setting_value

  // 2. Fall back to system default
  const systemSetting = await pool.query(
    `SELECT setting_value FROM application_settings WHERE setting_key = $1`,
    [key]
  )
  if (systemSetting.rows.length > 0) return systemSetting.rows[0].setting_value

  // 3. Hardcoded default
  return systemDefault
}
```

### Routes Requiring Update

**Current:**

- `GET /api/bid-experiment-settings` → returns **global** default
- `PATCH /api/bid-experiment-settings` → updates **global** default

**Required:**

- `GET /api/bid-experiment-settings` → return **organisation-specific** default
- `PATCH /api/bid-experiment-settings` → update **organisation-specific** override

---

## 12. Frontend Impact

### Current Frontend State

**Authentication:** None.

**Global State:** `AppContext.jsx` manages:

- `imports` (list)
- `apps` (list)
- `appFilter` (selected app)
- `periodComparison` (analytics data)
- `filterPreset` (`'7D'`, `'14D'`, `'30D'`, `'CUSTOM'`, `'ALL'`)
- `customStartDate`, `customEndDate`

**Missing:**

- `user` (authenticated user)
- `organisation` (active organisation)
- `organisations` (list of orgs user belongs to)

### Required Frontend Changes

#### AppContext Additions

```javascript
const [user, setUser] = useState(null)
const [organisation, setOrganisation] = useState(null)
const [organisations, setOrganisations] = useState([])
const [authenticated, setAuthenticated] = useState(false)
```

#### Authentication Flow

1. **Login page** → user enters email/password
2. **POST /api/auth/login** → returns JWT or session cookie
3. **Frontend stores authentication state** (JWT in memory or httpOnly cookie)
4. **Fetch user profile** → `GET /api/auth/me` → returns `user`, `organisations`, `activeOrganisationId`
5. **Load `AppContext`** with authenticated user and organisation

#### Organisation Switcher

If a user belongs to multiple organisations:

- **Header dropdown** to select active organisation
- **POST /api/auth/switch-organisation** or store in session
- **Reload all data** when organisation changes (campaigns, keywords, imports, goals, etc.)

#### Protected Routes

All existing routes (`/`, `/campaigns`, `/keywords`, `/history`) must:

1. Check if `authenticated === true`
2. Redirect to `/login` if not authenticated
3. Render normally if authenticated

#### Upload Flow

**Current:**

```javascript
const handleUpload = async (file) => {
  const result = await uploadCsv(file)
  // ...
}
```

**Required:**

No frontend change needed **if the backend derives `organisation_id` from session**. The frontend should **not** send `organisationId` as a form field — it must come from authenticated context.

#### Filters

**Current:** `appFilter` is a dropdown allowing "All Apps" or a specific app.

**Required:** After authentication, `apps` list must be **scoped to the active organisation**. The backend must return only apps belonging to `req.session.organisationId`.

**Frontend does not change the filter logic — it just receives a tenant-scoped list.**

---

## 13. Migration Plan

### Phased Approach

Migration must be **sequential** to avoid data corruption or constraint violations.

---

### **Phase 1: Authentication Foundation**

**Goal:** Create users, organisations, and membership without touching existing data.

#### Step 1.1: Create Core Tables

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE organisations (
  id SERIAL PRIMARY KEY,
  organisation_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE organisation_users (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'analyst')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id, user_id)
);

CREATE INDEX idx_organisation_users_user ON organisation_users(user_id);
CREATE INDEX idx_organisation_users_org ON organisation_users(organisation_id);
```

**Verification:** Tables exist. No existing data affected.

#### Step 1.2: Create Development Organisation

```sql
INSERT INTO organisations (organisation_name, created_at)
VALUES ('Development Org', NOW())
RETURNING id;
-- Assume returned id = 1
```

**Purpose:** All existing data will be associated with this organisation during backfill.

#### Step 1.3: Create Development User (Optional)

```sql
INSERT INTO users (email, password_hash, full_name, created_at)
VALUES ('dev@delm8.com', '<bcrypt_hash>', 'Development User', NOW())
RETURNING id;
-- Assume returned id = 1

INSERT INTO organisation_users (organisation_id, user_id, role, created_at)
VALUES (1, 1, 'owner', NOW());
```

**Verification:** Login with `dev@delm8.com` works after authentication routes are implemented.

---

### **Phase 2: Add Ownership Columns (Nullable)**

**Goal:** Add `organisation_id` to all customer data tables **without breaking existing queries**.

#### Step 2.1: Add Columns

```sql
ALTER TABLE imports ADD COLUMN organisation_id INTEGER REFERENCES organisations(id);
ALTER TABLE campaigns ADD COLUMN organisation_id INTEGER REFERENCES organisations(id);
ALTER TABLE daily_campaign_metrics ADD COLUMN organisation_id INTEGER REFERENCES organisations(id);
ALTER TABLE daily_keyword_metrics ADD COLUMN organisation_id INTEGER REFERENCES organisations(id);
ALTER TABLE annotations ADD COLUMN organisation_id INTEGER REFERENCES organisations(id);
ALTER TABLE performance_goals ADD COLUMN organisation_id INTEGER REFERENCES organisations(id);
ALTER TABLE bid_experiments ADD COLUMN organisation_id INTEGER REFERENCES organisations(id);
```

**Verification:** Existing queries still work. New column is `NULL` for all rows.

#### Step 2.2: Backfill Safely

**Critical:** Backfill must be idempotent and verify counts before proceeding.

```sql
-- Count existing rows
SELECT 'imports', COUNT(*) FROM imports WHERE organisation_id IS NULL
UNION ALL
SELECT 'campaigns', COUNT(*) FROM campaigns WHERE organisation_id IS NULL
UNION ALL
SELECT 'daily_campaign_metrics', COUNT(*) FROM daily_campaign_metrics WHERE organisation_id IS NULL;
-- ... etc.

-- Backfill (organisation_id = 1 for development)
UPDATE imports SET organisation_id = 1 WHERE organisation_id IS NULL;
UPDATE campaigns SET organisation_id = 1 WHERE organisation_id IS NULL;
UPDATE daily_campaign_metrics SET organisation_id = 1 WHERE organisation_id IS NULL;
UPDATE daily_keyword_metrics SET organisation_id = 1 WHERE organisation_id IS NULL;
UPDATE annotations SET organisation_id = 1 WHERE organisation_id IS NULL;
UPDATE performance_goals SET organisation_id = 1 WHERE organisation_id IS NULL;
UPDATE bid_experiments SET organisation_id = 1 WHERE organisation_id IS NULL;

-- Verify backfill
SELECT 'imports', COUNT(*) FROM imports WHERE organisation_id IS NULL;
-- Result should be 0 for all tables
```

**Verification:** All rows have `organisation_id = 1`. Existing data preserved.

---

### **Phase 3: Update Unique Constraints**

**Goal:** Add `organisation_id` to all uniqueness rules.

#### Step 3.1: Drop Old Constraints

```sql
-- import_rows
DROP INDEX IF EXISTS idx_import_rows_record_key;

-- daily_campaign_metrics
ALTER TABLE daily_campaign_metrics DROP CONSTRAINT IF EXISTS uq_daily_campaign;

-- daily_keyword_metrics
ALTER TABLE daily_keyword_metrics DROP CONSTRAINT IF EXISTS uq_daily_keyword;

-- campaigns
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS uq_campaign;

-- bid_experiments
DROP INDEX IF EXISTS uq_bid_experiment;
```

#### Step 3.2: Create Tenant-Scoped Constraints

```sql
CREATE UNIQUE INDEX idx_import_rows_record_key_org
  ON import_rows (organisation_id, import_id, record_key);

ALTER TABLE daily_campaign_metrics
  ADD CONSTRAINT uq_daily_campaign_org UNIQUE (
    organisation_id, app_id, report_date, campaign_name
  );

ALTER TABLE daily_keyword_metrics
  ADD CONSTRAINT uq_daily_keyword_org UNIQUE (
    organisation_id, app_id, report_date, campaign_name, ad_group_name, keyword_text, bid_strategy
  );

ALTER TABLE campaigns
  ADD CONSTRAINT uq_campaign_org UNIQUE (organisation_id, app_id, campaign_name);

CREATE UNIQUE INDEX uq_bid_experiment_org
  ON bid_experiments (
    organisation_id,
    keyword_identity_key,
    change_date,
    previous_max_cpt_bid,
    new_max_cpt_bid
  );
```

**Verification:** Constraints created. No duplicate violations (because only one organisation exists so far).

---

### **Phase 4: Add NOT NULL Constraints**

**Goal:** Enforce required ownership after backfill.

```sql
ALTER TABLE imports ALTER COLUMN organisation_id SET NOT NULL;
ALTER TABLE campaigns ALTER COLUMN organisation_id SET NOT NULL;
ALTER TABLE daily_campaign_metrics ALTER COLUMN organisation_id SET NOT NULL;
ALTER TABLE daily_keyword_metrics ALTER COLUMN organisation_id SET NOT NULL;
ALTER TABLE annotations ALTER COLUMN organisation_id SET NOT NULL;
ALTER TABLE performance_goals ALTER COLUMN organisation_id SET NOT NULL;
ALTER TABLE bid_experiments ALTER COLUMN organisation_id SET NOT NULL;
```

**Verification:** All constraints applied. Cannot insert rows without `organisation_id`.

---

### **Phase 5: Create Apps Table**

**Goal:** Internal app registry per organisation.

#### Step 5.1: Create Table

```sql
CREATE TABLE apps (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  external_app_id TEXT,   -- Apple App Store ID (nullable)
  app_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id, external_app_id),
  UNIQUE (organisation_id, app_name)
);

CREATE INDEX idx_apps_org ON apps(organisation_id);
CREATE INDEX idx_apps_external_id ON apps(external_app_id);
```

#### Step 5.2: Populate from Existing Data

```sql
INSERT INTO apps (organisation_id, external_app_id, app_name, created_at)
SELECT DISTINCT
  organisation_id,
  NULLIF(app_id, ''),  -- external_app_id
  COALESCE(app_name, app_id, 'Unknown App'),
  NOW()
FROM daily_campaign_metrics
WHERE app_id IS NOT NULL
ON CONFLICT (organisation_id, external_app_id) DO NOTHING;
```

**Verification:** `apps` table populated. One row per (organisation, external_app_id).

---

### **Phase 6: Create Organisation Settings**

```sql
CREATE TABLE organisation_settings (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  setting_key TEXT NOT NULL,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id, setting_key)
);

CREATE INDEX idx_organisation_settings_org ON organisation_settings(organisation_id);
```

**Verification:** Table exists. No initial data required.

---

### **Phase 7: Backend Route Protection**

**Goal:** Add authentication middleware and tenant scoping to all routes.

#### Step 7.1: Authentication Middleware

```javascript
// backend/middleware/authenticate.js
async function authenticate(req, res, next) {
  const sessionId = req.cookies.session_id || req.headers.authorization?.replace('Bearer ', '')
  
  if (!sessionId) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  // Validate session (from database or JWT)
  const session = await validateSession(sessionId)
  
  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired session' })
  }

  req.userId = session.user_id
  req.organisationId = session.organisation_id
  next()
}

module.exports = { authenticate }
```

#### Step 7.2: Apply to All Protected Routes

```javascript
const { authenticate } = require('./middleware/authenticate')

// Apply globally (except login/register)
app.use('/api', authenticate)

// Exempt auth routes
app.post('/api/auth/login', loginHandler)
app.post('/api/auth/register', registerHandler)
```

#### Step 7.3: Update Route Handlers

**Example: Annotations**

```javascript
// Before
app.get('/api/annotations', async (req, res) => {
  const annotations = await listAnnotations({
    entityType: req.query.entityType,
    entityKey: req.query.entityKey,
  })
  res.json(annotations)
})

// After
app.get('/api/annotations', authenticate, async (req, res) => {
  const annotations = await listAnnotations({
    organisationId: req.organisationId,  // from auth middleware
    entityType: req.query.entityType,
    entityKey: req.query.entityKey,
  })
  res.json(annotations)
})
```

**Repeat for every route** in the audit (section 6).

---

### **Phase 8: Analytics Service Protection**

**Goal:** Add `organisationId` parameter to all analytics functions.

#### Step 8.1: Update `buildFilters()`

```javascript
function buildFilters({ startDate, endDate, appId, campaignName, organisationId }, baseParams = []) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const conditions = []
  const params = [...baseParams]
  let paramIndex = baseParams.length + 1

  // Tenant scope FIRST
  conditions.push(`organisation_id = $${paramIndex++}`)
  params.push(organisationId)

  // Existing filters
  if (startDate) { ... }
  if (endDate) { ... }
  if (appId) { ... }

  return { where: conditions.length ? `AND ${conditions.join(' AND ')}` : '', params, paramIndex }
}
```

#### Step 8.2: Update All Analytics Functions

Add `organisationId` parameter to:

- `getOverallSummary()`
- `getCampaignSummary()`
- `getKeywordSummary()`
- `resolveKeywordBids()`
- `getAppBreakdown()`
- `getTopCampaigns()`
- `getTopKeywords()`

**Example:**

```javascript
// Before
async function getCampaignSummary({ startDate, endDate, days, appId, compare = false }) {
  // ...
}

// After
async function getCampaignSummary({ organisationId, startDate, endDate, days, appId, compare = false }) {
  if (!organisationId) throw new Error('organisationId required')
  
  const filters = buildFilters({ startDate, endDate, appId, organisationId })
  // ... rest of function
}
```

---

### **Phase 9: Import Pipeline Protection**

**Goal:** Associate uploads with authenticated user's organisation.

#### Step 9.1: Update `createImport()`

```javascript
// Before
async function createImport(fileName, headers, records) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const importResult = await client.query(
      `INSERT INTO imports (original_name, row_count, column_headers, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id`,
      [fileName, records.length, JSON.stringify(headers)]
    )
    // ...
  }
}

// After
async function createImport(organisationId, fileName, headers, records) {
  if (!organisationId) throw new Error('organisationId required')
  
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const importResult = await client.query(
      `INSERT INTO imports (organisation_id, original_name, row_count, column_headers, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id`,
      [organisationId, fileName, records.length, JSON.stringify(headers)]
    )
    // ...
  }
}
```

#### Step 9.2: Update Upload Route

```javascript
// Before
app.post('/api/imports', upload.single('file'), async (req, res) => {
  const { records, headers } = parseCsv(req.file.buffer)
  const result = await createImport(req.file.originalname, headers, records)
  res.status(201).json(result)
})

// After
app.post('/api/imports', authenticate, upload.single('file'), async (req, res) => {
  const { records, headers } = parseCsv(req.file.buffer)
  const result = await createImport(
    req.organisationId,  // from auth middleware
    req.file.originalname,
    headers,
    records
  )
  res.status(201).json(result)
})
```

---

### **Phase 10: Frontend Authentication**

**Goal:** Add login screen and authenticated AppContext.

#### Step 10.1: Create Login Page

```jsx
// frontend/src/pages/Login.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '../api'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    try {
      await login(email, password)
      navigate('/')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
      <button type="submit">Login</button>
      {error && <p>{error}</p>}
    </form>
  )
}
```

#### Step 10.2: Update AppContext

```javascript
// Add authentication state
const [user, setUser] = useState(null)
const [organisation, setOrganisation] = useState(null)
const [organisations, setOrganisations] = useState([])
const [authenticated, setAuthenticated] = useState(false)

// Load user profile on mount
useEffect(() => {
  async function loadUser() {
    try {
      const profile = await fetchUserProfile()
      setUser(profile.user)
      setOrganisations(profile.organisations)
      setOrganisation(profile.activeOrganisation)
      setAuthenticated(true)
    } catch {
      setAuthenticated(false)
    }
  }
  loadUser()
}, [])
```

#### Step 10.3: Protected Route Wrapper

```jsx
// frontend/src/components/ProtectedRoute.jsx
import { Navigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'

export default function ProtectedRoute({ children }) {
  const { authenticated } = useApp()
  
  if (!authenticated) {
    return <Navigate to="/login" replace />
  }
  
  return children
}
```

---

### **Phase 11: Testing and Verification**

#### Test 11.1: Create Second Organisation

```sql
INSERT INTO organisations (organisation_name) VALUES ('Test Org 2') RETURNING id;
-- Assume id = 2

INSERT INTO users (email, password_hash, full_name)
VALUES ('test@example.com', '<hash>', 'Test User') RETURNING id;
-- Assume id = 2

INSERT INTO organisation_users (organisation_id, user_id, role)
VALUES (2, 2, 'owner');
```

#### Test 11.2: Upload CSV as Organisation 2

1. Login as `test@example.com`
2. Upload a CSV file
3. Verify:
   - Import has `organisation_id = 2`
   - Daily metrics have `organisation_id = 2`
   - Organisation 1 cannot see the import

#### Test 11.3: Cross-Tenant Isolation

1. Login as Organisation 1
2. Note a campaign `id` (e.g., `id=42`)
3. Logout, login as Organisation 2
4. Attempt `GET /api/campaigns/42`
5. Expected: **404 Not Found** (ownership check prevents access)

#### Test 11.4: Analytics Queries

1. Login as Organisation 1
2. `GET /api/compare/period?days=7`
3. Verify response contains only Organisation 1's data
4. Logout, login as Organisation 2
5. Same query
6. Verify response contains only Organisation 2's data

---

### Migration Checklist

- [ ] Phase 1: Authentication tables created
- [ ] Phase 1: Development organisation created
- [ ] Phase 2: Ownership columns added (nullable)
- [ ] Phase 2: Existing data backfilled
- [ ] Phase 3: Unique constraints updated
- [ ] Phase 4: NOT NULL constraints applied
- [ ] Phase 5: Apps table created and populated
- [ ] Phase 6: Organisation settings table created
- [ ] Phase 7: Authentication middleware implemented
- [ ] Phase 7: All routes protected
- [ ] Phase 8: Analytics service tenant-scoped
- [ ] Phase 9: Import pipeline tenant-scoped
- [ ] Phase 10: Frontend login implemented
- [ ] Phase 10: Frontend authenticated state
- [ ] Phase 11: Second organisation tested
- [ ] Phase 11: Cross-tenant isolation verified

---

## 14. Security Model

### Server-Side Enforcement

**Non-negotiable rule:**

```
Every protected request MUST resolve:

  authenticatedUser (from session/JWT)
    ↓
  activeOrganisation (from user selection or single membership)
    ↓
  authorisedMembership (verified in organisation_users)
    ↓
  tenant-scoped database query (WHERE organisation_id = $1)
```

**The frontend must never be the source of truth for `organisation_id`.**

Frontend-supplied parameters (e.g., `?organisationId=123`) are **advisory only** for UI convenience (e.g., organisation switcher). The backend **must always derive `organisation_id`** from the authenticated session.

### Row-Level Security (RLS) vs. Application-Level

**Comparison:**

| Approach | Pros | Cons | Recommendation |
|----------|------|------|----------------|
| **Application-Level** | Simple, explicit, debuggable | Must enforce in every query | ✅ **Recommended** for this project |
| **PostgreSQL RLS** | Automatic enforcement, defense-in-depth | Harder to debug, session variable overhead | ⚠️ Optional (future hardening) |

**Reasoning:**

This project has **no existing RLS policies**. Adding RLS on top of application-level scoping is **defense-in-depth** but not essential for initial multi-tenancy.

**Recommended:** Use **application-level tenant scoping** (explicit `WHERE organisation_id = $1` in every query). Add RLS later if additional hardening is needed.

### Authentication Implementation

**Do not implement custom authentication** unless there is a strong technical reason.

**Recommended:** Use an established library:

- **Node.js:** [Passport.js](http://www.passportjs.org/) (local strategy with bcrypt)
- **Alternative:** [Auth0](https://auth0.com/), [Clerk](https://clerk.dev/), or [Supabase Auth](https://supabase.com/auth)

**Minimum viable custom auth (if required):**

- Store password hashes using **bcrypt** (cost factor ≥ 12)
- Generate session tokens using **crypto.randomBytes(32)**
- Store sessions in a `sessions` table with expiry
- Use **httpOnly cookies** (not localStorage)
- Implement **CSRF protection** for state-changing requests

---

## 15. Risk Register

### CRITICAL Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Launching without authentication** | Complete data exposure | High (if rushed) | **Block launch until Phase 7 complete** |
| **Missing organisation_id in queries** | Cross-tenant data leakage | High (during migration) | **Audit every query** — use linter/grep for `SELECT`/`UPDATE`/`DELETE` without `organisation_id` |
| **ID-based routes without ownership checks** | Cross-tenant modification | High | **Verify ownership on every `:id` route** |
| **Import deduplication collisions** | Failed uploads for legitimate data | Medium | **Update unique constraints** (Phase 3) |
| **Settings remain global** | Tenant config collisions | Medium | **Create organisation_settings table** (Phase 6) |
| **Frontend supplies organisation_id** | Trivial auth bypass | High | **Derive from session only** |

### HIGH Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Backfill fails midway** | Partial organisation ownership | Medium | **Idempotent migrations**, verify counts |
| **Unique constraint violations during migration** | Migration blocked | Medium | **Test on copy of production data first** |
| **Apps table not populated** | Missing app context | Low | **Populate from existing daily_campaign_metrics** (Phase 5) |
| **Legacy `/api/compare` route** | Unprotected import comparison | Low | **Add ownership check** or **deprecate** |

### MEDIUM Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Brand/Non-brand split in browser** | Performance issue for large datasets | Low | Out of scope (no change planned) |
| **Campaign_id / keyword_id still null** | Relationship integrity unclear | Low | Out of scope (composite keys work) |
| **Historical baselines span across tenants** | Baseline calculation error | Low | Baselines already scoped to keyword identity (includes app_id) |

### LOW Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Annotation entity_key format change** | Backward compatibility break | Low | **Do not change entity_key format** — add `organisation_id` filter |
| **Import rows missing source_import_id** | Audit trail incomplete | Low | Already tracked; no change needed |

---

## 16. Recommended Implementation Phases

### Priority Order

1. **Authentication** (Phases 1, 7, 10) — **Must complete before any external launch**
2. **Schema migration** (Phases 2, 3, 4) — **Establishes tenant boundaries**
3. **Backend protection** (Phases 7, 8, 9) — **Enforces tenant isolation**
4. **Apps table** (Phase 5) — **Supports multi-org app management**
5. **Settings** (Phase 6) — **Tenant-specific configuration**
6. **Testing** (Phase 11) — **Verification and QA**

### Timeline Estimation

**Do not estimate delivery dates** (per instructions). The phases above represent **technical sequencing only**.

### MVP Definition

**Minimum for external multi-tenant launch:**

- ✅ Authentication system (login, sessions, password hashing)
- ✅ Users, organisations, organisation_users tables
- ✅ All customer-data tables have `organisation_id`
- ✅ All API routes enforce tenant scoping
- ✅ Unique constraints include `organisation_id`
- ✅ Import pipeline associates uploads with authenticated org
- ✅ Analytics Service filters by `organisation_id`
- ✅ Frontend login screen and authenticated AppContext
- ✅ At least 2 test organisations verified with isolated data

---

## 17. Important Files

### Backend

| File | Role | Changes Required |
|------|------|------------------|
| `backend/db.js` | Schema + migrations | Add tenant tables, ownership columns, constraints |
| `backend/index.js` | Route definitions | Add auth middleware to all protected routes |
| `backend/middleware/authenticate.js` | **NEW** | Session/JWT validation, derive `req.organisationId` |
| `backend/analyticsService.js` | Analytics queries | Add `organisationId` parameter to all functions |
| `backend/imports.js` | CSV upload + deduplication | Accept `organisationId`, update record_key uniqueness |
| `backend/bidExperiments.js` | Bid experiment detection | Add `organisationId` parameter |
| `backend/annotations.js` | Annotations CRUD | Add `organisationId` filter |
| `backend/goals.js` | Goals CRUD | Add `organisationId` filter |
| `backend/alerts.js` | Alerts evaluation | Pass `organisationId` to analytics queries |
| `backend/campaigns.js` | Campaign management | Add `organisationId` filter |
| `backend/compareStructured.js` | Period comparison | Pass `organisationId` to analytics |

### Frontend

| File | Role | Changes Required |
|------|------|------------------|
| `frontend/src/context/AppContext.jsx` | Global state | Add `user`, `organisation`, `organisations`, `authenticated` |
| `frontend/src/pages/Login.jsx` | **NEW** | Login form |
| `frontend/src/components/ProtectedRoute.jsx` | **NEW** | Auth guard for routes |
| `frontend/src/App.jsx` | Route definitions | Wrap routes in `<ProtectedRoute>` |
| `frontend/src/api.js` | API client | **Assumed to exist** — add `/api/auth/login`, `/api/auth/me` |

### Documentation

| File | Role |
|------|------|
| `docs/PRODUCTION.md` | **This document** |
| `docs/ARCHITECTURE.md` | Update after tenant model implemented |
| `docs/ANALYTICS.md` | Update entity key definitions to include `organisation_id` |

---

## 18. Out of Scope (Explicitly Not Addressed Yet)

The following are **deferred** until after basic multi-tenancy is functional:

- ❌ Billing and subscriptions
- ❌ Apple Ads API integration (automated data fetching)
- ❌ AI Copilot / recommendations
- ❌ Historical baselines productisation (already scoped to keyword identity)
- ❌ Agency hierarchy (sub-organisations or white-label)
- ❌ SSO (SAML, OAuth providers)
- ❌ White-labelling (custom domains, branding)
- ❌ Enterprise permissions (custom roles beyond owner/admin/analyst)
- ❌ Public API / webhooks
- ❌ Email notifications (alerts, digests)
- ❌ Production deployment changes (infrastructure, CI/CD)
- ❌ Custom authentication implementation (recommend library)

---

## 19. Implementation Status

### Phase P1: Multi-Tenant Foundation ✅ IMPLEMENTED

**Completed:** Phase 1 schema foundation

**Date:** 2026-08-20

#### Created Tables

**1. users**

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  auth_provider TEXT,
  auth_provider_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Constraints/Indexes:**
- `idx_users_email` — UNIQUE on `email` (WHERE email IS NOT NULL)
- `idx_users_provider_identity` — UNIQUE on `(auth_provider, auth_provider_user_id)` (WHERE both NOT NULL)

**Design notes:**
- Email is nullable to support future non-email authentication providers
- `auth_provider` + `auth_provider_user_id` support external OAuth/SAML providers
- No `password_hash` field — authentication implementation deferred to later phase
- Table represents application identity, not authentication mechanism

**2. organisations**

```sql
CREATE TABLE organisations (
  id SERIAL PRIMARY KEY,
  organisation_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Design notes:**
- Minimal schema — no billing, plans, branding, or hierarchy yet
- `organisation_name` is not unique — duplicate names allowed across system

**3. organisation_users**

```sql
CREATE TABLE organisation_users (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'analyst')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_organisation_user UNIQUE (organisation_id, user_id)
);
```

**Constraints/Indexes:**
- `uq_organisation_user` — UNIQUE on `(organisation_id, user_id)`
- `idx_organisation_users_user` — index on `user_id` (lookup user memberships)
- `idx_organisation_users_org` — index on `organisation_id` (lookup org members)
- FK `organisation_id` → `organisations(id)` ON DELETE CASCADE
- FK `user_id` → `users(id)` ON DELETE CASCADE
- CHECK constraint: `role IN ('owner', 'admin', 'analyst')`

**Role values:**
- `owner` — full organisation control
- `admin` — manage campaigns, goals, annotations, uploads
- `analyst` — read-only access

#### Development Organisation

**Created:** 'Development Organisation'

**Strategy:** Idempotent seed operation
- Checks for existing organisation by name before insert
- Logs ID on creation or when already exists
- Does not hardcode organisation ID in code
- Existing single-tenant data will be associated with this org in Phase P2

**Current state:** Organisation exists, no users or memberships created yet.

#### Migration Implementation

**File:** `backend/db.js`

**Function:** `migrateMultiTenantFoundation()`

**Pattern:** Follows existing idempotent migration style:
- `CREATE TABLE IF NOT EXISTS`
- `CREATE INDEX IF NOT EXISTS`
- Constraint creation wrapped in `DO $$ BEGIN ... EXCEPTION` block
- Development org check-before-insert pattern

**Order:** Runs after existing migrations (`migrateBidExperiments()`), before async backfills.

**Idempotency verified:** Multiple backend restarts do not create duplicate tables, indexes, or organisations.

#### What Has NOT Changed

✅ **No existing table modified:**
- imports
- import_rows
- campaigns
- daily_campaign_metrics
- daily_keyword_metrics
- annotations
- performance_goals
- bid_experiments
- application_settings

✅ **No authentication implemented:**
- No login routes
- No password handling
- No sessions or JWTs
- No protected routes
- All API endpoints remain public

✅ **No tenant scoping applied:**
- No `organisation_id` added to customer data tables (deferred to P2)
- No query filters by organisation
- No route ownership checks
- No import pipeline changes

✅ **No application behavior changed:**
- Dashboard works unchanged
- Campaigns works unchanged
- Keywords works unchanged
- History works unchanged
- CSV upload works unchanged
- Period filters work unchanged

#### Next Phase

**Phase P2:** Add `organisation_id` columns to customer data tables, backfill with development organisation (✅ **COMPLETED** - see below)

---

### Phase P2: Organisation Ownership ✅ IMPLEMENTED

**Completed:** Phase 2 - Organisation ownership columns and backfill

**Date:** 2026-08-20

#### Columns Added

All customer data tables now have `organisation_id INTEGER NOT NULL REFERENCES organisations(id)`:

| Table | organisation_id Added | NOT NULL Applied | Index Added |
|-------|----------------------|------------------|-------------|
| **imports** | ✅ | ✅ | ✅ `idx_imports_org` |
| **import_rows** | ✅ | ✅ | ✅ `idx_import_rows_org` |
| **campaigns** | ✅ | ✅ | ✅ `idx_campaigns_org` |
| **daily_campaign_metrics** | ✅ | ✅ | ✅ `idx_daily_campaign_metrics_org` |
| **daily_keyword_metrics** | ✅ | ✅ | ✅ `idx_daily_keyword_metrics_org` |
| **annotations** | ✅ | ✅ | ✅ `idx_annotations_org` |
| **performance_goals** | ✅ | ✅ | ✅ `idx_performance_goals_org` |
| **bid_experiments** | ✅ | ✅ | ✅ `idx_bid_experiments_org` |

#### Backfill Results

All existing data successfully associated with Development Organisation (ID: 1):

| Table | Rows Backfilled | Final NULL Count |
|-------|----------------|------------------|
| imports | 40 | 0 |
| import_rows | 60,468 | 0 |
| campaigns | 31 | 0 |
| daily_campaign_metrics | 12,936 | 0 |
| daily_keyword_metrics | 60,481 | 0 |
| annotations | 19 | 0 |
| performance_goals | 2 | 0 |
| bid_experiments | 108 | 0 |
| **Total** | **146,085 rows** | **0 NULL values** |

#### Ownership Model

**Direct organisation ownership:** All customer data tables have direct `organisation_id` foreign key (not inherited through joins).

**Development Organisation:** All existing data assigned to "Development Organisation" (ID: 1) during backfill.

**Verification:** Zero NULL `organisation_id` values after backfill completion.

#### Transitional New Data Mechanism

**Purpose:** During the transition period (P2 through authentication implementation), new rows must also receive organisation ownership.

**Implementation:** Added `getTransitionalOrganisationId()` helper in `db.js`:
- Resolves Development Organisation ID at runtime
- No hardcoded numeric ID
- Throws clear error if organisation not found
- **Marked as TRANSITIONAL** - will be replaced when authentication is implemented

**Files modified for new data ownership:**

1. **`backend/imports.js`**
   - `createImport()` - adds organisation_id to new imports and import_rows
   - Uses Development Organisation for transitional ownership

2. **`backend/campaigns.js`**
   - `ensureCampaign()` - adds organisation_id to new campaigns
   - Auto-created campaigns during import get Development Organisation ownership

3. **`backend/dailyMetrics.js`**
   - `upsertDailyCampaignMetrics()` - adds organisation_id to new daily campaign rows
   - `upsertDailyKeywordMetrics()` - adds organisation_id to new daily keyword rows
   - Both preserve existing organisation_id via `COALESCE` in ON CONFLICT clause

4. **`backend/annotations.js`**
   - `createAnnotation()` - adds organisation_id to new annotations

5. **`backend/goals.js`**
   - `createGoal()` - adds organisation_id to new performance goals

6. **`backend/bidExperiments.js`**
   - `detectBidExperiments()` - adds organisation_id to newly detected experiments

#### Migration Implementation

**File:** `backend/db.js`

**Function:** `migrateOrganisationOwnership()`

**Process:**
1. Resolve Development Organisation (fail clearly if not found)
2. Add nullable `organisation_id` columns to all tables
3. Add indexes on `organisation_id` for all tables
4. Backfill existing rows (idempotent: `WHERE organisation_id IS NULL`)
5. Verify zero NULL ownership
6. Apply NOT NULL constraints

**Idempotency verified:**
- Multiple runs: 0 rows updated after initial backfill
- No errors on repeated migration
- Safe to restart backend multiple times

#### Row Counts Verification

**Before P2:** 146,085 total rows across all tables

**After P2:** 146,085 total rows (✅ no data loss)

**Ownership distribution:** 100% owned by Development Organisation

#### What Changed

✅ **Storage ownership:**
- Every customer data row now has `organisation_id`
- All rows belong to Development Organisation
- Direct ownership (not inherited through joins)

✅ **New data creation:**
- All creation paths updated to include organisation_id
- Transitional helper prevents NULL violations
- Development Organisation assigned automatically

✅ **Indexes added:**
- Simple organisation_id indexes on all customer tables
- Supports future tenant-scoped queries

#### What Has NOT Changed

❌ **Query behavior:**
- No queries filter by `organisation_id` yet
- Analytics queries unchanged
- No tenant scoping enforced

❌ **Unique constraints:**
- NOT modified in P2 (deferred to P3)
- Current constraints:
  - `import_rows`: record_key (no organisation scope)
  - `campaigns`: (app_id, campaign_name) (no organisation scope)
  - `daily_campaign_metrics`: (app_id, report_date, campaign_name) (no organisation scope)
  - `daily_keyword_metrics`: (app_id, report_date, campaign_name, ad_group_name, keyword_text, bid_strategy) (no organisation scope)
  - `bid_experiments`: (keyword_identity_key, change_date, previous_max_cpt_bid, new_max_cpt_bid) (no organisation scope)

❌ **Authentication:**
- Still not implemented
- No login routes
- No protected endpoints
- All data remains globally accessible

❌ **Application behavior:**
- Frontend unchanged
- All routes still work the same
- No organisation filtering
- No organisation switcher

#### Verified Working

Tested after P2 implementation:
- ✅ Backend restarts successfully (idempotent)
- ✅ No NULL organisation_id values
- ✅ All row counts match pre-migration
- ✅ Migration logs show 0 rows updated on subsequent runs

#### Next Phase

**Phase P3:** Update unique constraints to include `organisation_id`, preventing cross-tenant data collisions. This includes:
- `import_rows.record_key` → `(organisation_id, record_key)`
- `campaigns` → `(organisation_id, app_id, campaign_name)`
- `daily_campaign_metrics` → `(organisation_id, app_id, report_date, campaign_name)`
- `daily_keyword_metrics` → `(organisation_id, app_id, report_date, campaign_name, ad_group_name, keyword_text, bid_strategy)`
- `bid_experiments` → `(organisation_id, keyword_identity_key, change_date, previous_max_cpt_bid, new_max_cpt_bid)`

(**✅ COMPLETED** - see below)

---

### Phase P3: Tenant-Scoped Unique Constraints ✅ IMPLEMENTED

**Completed:** Phase 3 - Multi-tenant unique constraint migration

**Date:** 2026-08-20

#### Objective

Make all uniqueness rules tenant-aware. Two organisations must be able to store identical Apple Ads data independently, while duplicate records within one organisation remain prevented.

#### Constraint Changes

All unique constraints updated from global scope to organisation scope:

**1. import_rows**
- **OLD:** `UNIQUE (record_key)`
- **NEW:** `UNIQUE (organisation_id, record_key)`
- **Purpose:** Allow different organisations to import identical Apple Ads records
- **Within-org deduplication:** Preserved - overlapping imports still deduplicate correctly

**2. campaigns**
- **OLD:** `UNIQUE (app_id, campaign_name)`
- **NEW:** `UNIQUE (organisation_id, app_id, campaign_name)`
- **Purpose:** Each organisation can have campaigns with same app_id + name

**3. daily_campaign_metrics**
- **OLD:** `UNIQUE (app_id, report_date, campaign_name)`
- **NEW:** `UNIQUE (organisation_id, app_id, report_date, campaign_name)`
- **Purpose:** Independent daily campaign data per organisation

**4. daily_keyword_metrics**
- **OLD:** `UNIQUE (app_id, report_date, campaign_name, ad_group_name, keyword_text, bid_strategy)`
- **NEW:** `UNIQUE (organisation_id, app_id, report_date, campaign_name, ad_group_name, keyword_text, bid_strategy)`
- **Purpose:** Independent daily keyword data per organisation

**5. bid_experiments**
- **OLD:** `UNIQUE (keyword_identity_key, change_date, previous_max_cpt_bid, new_max_cpt_bid)`
- **NEW:** `UNIQUE (organisation_id, keyword_identity_key, change_date, previous_max_cpt_bid, new_max_cpt_bid)`
- **Purpose:** Each organisation can track independent bid experiments

#### Migration Implementation

**File:** `backend/db.js`

**Function:** `migrateMultiTenantUniqueConstraints()`

**Process:**
1. Drop old constraint/index (using `DROP CONSTRAINT IF EXISTS` + `DROP INDEX IF EXISTS CASCADE`)
2. Create new tenant-scoped unique index
3. Repeat for all 5 tables

**Idempotency:** Safe to run multiple times - uses `IF EXISTS` and `IF NOT EXISTS` patterns

#### ON CONFLICT Updates

All `INSERT ... ON CONFLICT` clauses updated to match new constraints:

**1. backend/imports.js**
- **OLD:** `ON CONFLICT (record_key)`
- **NEW:** `ON CONFLICT (organisation_id, record_key)`
- **Location:** `createImport()` function, import_rows upsert

**2. backend/campaigns.js**
- **OLD:** `ON CONFLICT (app_id, campaign_name)`
- **NEW:** `ON CONFLICT (organisation_id, app_id, campaign_name)`
- **Location:** `ensureCampaign()` function

**3. backend/dailyMetrics.js** (2 clauses updated)
- Campaign metrics:
  - **OLD:** `ON CONFLICT (app_id, report_date, campaign_name)`
  - **NEW:** `ON CONFLICT (organisation_id, app_id, report_date, campaign_name)`
  - **Location:** `upsertDailyCampaignMetrics()`
  
- Keyword metrics:
  - **OLD:** `ON CONFLICT (app_id, report_date, campaign_name, ad_group_name, keyword_text, bid_strategy)`
  - **NEW:** `ON CONFLICT (organisation_id, app_id, report_date, campaign_name, ad_group_name, keyword_text, bid_strategy)`
  - **Location:** `upsertDailyKeywordMetrics()`

**4. backend/bidExperiments.js**
- **OLD:** `ON CONFLICT (keyword_identity_key, change_date, previous_max_cpt_bid, new_max_cpt_bid)`
- **NEW:** `ON CONFLICT (organisation_id, keyword_identity_key, change_date, previous_max_cpt_bid, new_max_cpt_bid)`
- **Location:** `detectBidExperimentsForKeywordRecords()`

#### Duplicate Preflight Results

**Before migration:** Checked for potential duplicates under new tenant-scoped identities.

**Result:** ✅ Zero duplicate groups found across all tables
- import_rows: 0 duplicates under (organisation_id, record_key)
- campaigns: 0 duplicates under (organisation_id, app_id, campaign_name)
- daily_campaign_metrics: 0 duplicates under (organisation_id, app_id, report_date, campaign_name)
- daily_keyword_metrics: 0 duplicates under (organisation_id, app_id, report_date, campaign_name, ad_group_name, keyword_text, bid_strategy)
- bid_experiments: 0 duplicates under (organisation_id, keyword_identity_key, change_date, previous_max_cpt_bid, new_max_cpt_bid)

**Conclusion:** Safe to apply new constraints - no existing data conflicts

#### Cross-Tenant Test Results

**Test Setup:** Created "Test Organisation A" (ID: 2) alongside Development Organisation (ID: 1)

**Test 1 - Cross-tenant uniqueness (should allow duplicates across organisations):**
- ✅ Same record_key in both organisations: PASS (2 rows created)
- ✅ Same campaign in both organisations: PASS (2 rows created)
- ✅ Same daily campaign metric in both organisations: PASS (2 rows created)
- ✅ Same daily keyword metric in both organisations: PASS (2 rows created)
- ✅ Same bid experiment in both organisations: PASS (2 rows created)

**Test 2 - Same-tenant deduplication (should prevent duplicates within organisation):**
- ✅ Duplicate record_key within Development Org: PASS (deduplicated, updated existing row)
- ✅ Import row count remained 1 per organisation

**Test 3 - Existing data verification:**
- ✅ All 146,085 original rows unchanged
- ✅ All data still owned by Development Organisation (ID: 1)
- ✅ Analytics totals preserved:
  - Spend: $54,235.12
  - Impressions: 1,030,608
  - Taps: 33,800
  - Installs: 23,282

#### record_key Semantics

**Format:** Unchanged - `app_key|date|campaign|ad_group|keyword|bid_strategy`

**Generation:** No changes to `generateRecordKey()` function in imports.js

**Stability:** record_key still identifies the same Apple Ads analytical record across imports

**Uniqueness:** Now scoped by organisation_id in database constraint, not embedded in record_key string

#### Existing Data Impact

**Row counts before P3:** 146,085 rows
**Row counts after P3:** 146,085 rows (✅ no data changed)

**NULL organisation_id check:** 0 NULL values (✅ all ownership intact)

**Development Organisation verification:** All 134,024 real data rows still belong to org ID 1

#### What Changed

✅ **Storage safety:**
- Cross-tenant data collisions now prevented
- Two organisations can store identical Apple Ads data independently
- Unique constraints now enforce organisation boundaries

✅ **Application logic:**
- All ON CONFLICT clauses updated to include organisation_id
- Deduplication behavior unchanged within single organisation
- No application code broken

✅ **Migration safety:**
- Idempotent (safe to run multiple times)
- No data loss or modification
- Constraint changes only affect future inserts

#### What Has NOT Changed

❌ **Query behavior:**
- No queries filter by organisation_id yet
- Analytics still return all data globally
- No tenant scoping enforced in SELECT statements

❌ **Authentication:**
- Still not implemented
- No login routes
- No protected endpoints

❌ **Application behavior:**
- Frontend unchanged
- All routes work the same
- No organisation filtering visible to users

❌ **record_key generation:**
- Algorithm unchanged
- Still stable across imports
- organisation_id not embedded in record_key string

#### Idempotency Verification

**Test:** Ran migration twice consecutively

**Result:** ✅ No errors, constraints recreated successfully
- 1st run: Dropped old constraints, created new ones
- 2nd run: Attempted to drop (already gone), created (already exist - no error)
- Final state: Correct constraints in place

#### Files Changed

| File | Changes |
|------|---------|
| **backend/db.js** | Added `migrateMultiTenantUniqueConstraints()` function |
| **backend/imports.js** | Updated ON CONFLICT in import_rows upsert |
| **backend/campaigns.js** | Updated ON CONFLICT in campaign upsert |
| **backend/dailyMetrics.js** | Updated 2 ON CONFLICT clauses (campaign + keyword) |
| **backend/bidExperiments.js** | Updated ON CONFLICT in bid experiment detection |
| **docs/PRODUCTION.md** | Added P3 implementation status (this section) |

---

## Phase P4: Tenant-Scoped Query Execution ✅ IMPLEMENTED

**Objective:** Make every backend customer-data operation require organisation context. Backend is now tenant-safe before authentication.

**Status:** ✅ **COMPLETE** 

See detailed implementation summary in `P4-IMPLEMENTATION-COMPLETE.md` at project root.

### Overview

P4 adds mandatory organisation scoping to all backend services and queries. Organisation context comes from a **transitional server-side helper** that resolves the Development Organisation. This makes the backend tenant-safe before authentication is implemented in P5.

### Key Changes

**1. Transitional Organisation Context (`backend/db.js`):**
- `resolveOrganisationContext()` - shared helper for all routes
- Enhanced `getTransitionalOrganisationId()` with caching
- Marked as transitional - will be replaced with `req.organisationId` in P5

**2. Analytics Service (`backend/analyticsService.js`):**
- `buildFilters()` requires `organisationId`, adds `organisation_id = ?` filter
- All 10+ analytics functions require `organisationId` parameter
- All JOINs include `organisation_id` matching
- Fail closed: throws if `organisationId` missing

**3. Facade Services:**
- `compareStructured.js`, `campaignWeekly.js`, `insightsEngine.js`, `alerts.js`
- All require and pass `organisationId` to analytics service

**4. CRUD Services - IDOR Protection:**
- `goals.js`, `annotations.js`, `campaigns.js`
- List: `WHERE organisation_id = ?`
- Update/Delete: `WHERE id = ? AND organisation_id = ?`

**5. Bid Experiments (`backend/bidExperiments.js`):**
- `listBidExperiments()` - filters by `organisation_id`
- `getBidExperimentById()` - IDOR protected

**6. Imports (`backend/imports.js`):**
- All 8 functions require `organisationId`
- IDOR protection on all ID-based operations

**7. Route Handlers (`backend/index.js`):**
- ALL customer-data routes updated
- Pattern: `const organisationId = await resolveOrganisationContext()`
- 20+ routes updated

### What Changed

- Every analytics query requires `organisationId`
- Every CRUD operation requires `organisationId`
- All SQL includes `organisation_id` filter
- IDOR protection: `WHERE id = ? AND organisation_id = ?`
- Fail closed: missing `organisationId` throws error

### What DID NOT Change

**NO Authentication:**
- No login/registration routes
- No JWT/sessions
- No authentication middleware

**NO Frontend Changes:**
- No organisation selector
- No login UI
- Existing behavior unchanged

**Existing Data:**
- All belongs to Development Organisation
- Analytics totals unchanged
- CSV uploads work unchanged

### Files Changed

**9 Service Files:**
- `db.js`, `analyticsService.js`, `compareStructured.js`, `campaignWeekly.js`
- `insightsEngine.js`, `alerts.js`, `goals.js`, `annotations.js`, `campaigns.js`
- `bidExperiments.js`, `imports.js`

**Route Handler:**
- `index.js` - 20+ routes updated

### Security Guarantees

- **IDOR Protection:** Update/delete require `id + organisation_id`
- **Tenant Isolation:** All queries scoped by `organisation_id`
- **Fail Closed:** Missing context throws error
- **404 on Cross-Tenant:** ID manipulation returns 404 (not 403)

### Verification Tests

**Recommended:**
1. Two-organisation isolation test (verify Org A can't see Org B data)
2. IDOR protection test (verify cross-tenant ID manipulation returns 404)
3. Development Org analytics reconciliation (verify totals unchanged)

### P4.1: Tenant-Isolation Verification and Hardening ✅ COMPLETE

**Objective:** Verify tenant isolation, find and fix any remaining tenant leaks, harden fail-closed behavior.

**Status:** ✅ **COMPLETE**

#### Critical Issue Found and Fixed

**Issue:** Bid experiment analysis (`analyzeExperiment()`) queried `daily_keyword_metrics` WITHOUT `organisation_id` filtering.

**Risk:** Two organisations with identical keyword identities (same app_id, campaign_name, ad_group_name, keyword_text, bid_strategy, dates) would have their metrics MIXED in experiment analysis.

**Fix Applied:**
- Updated 6 functions in `bidExperiments.js`
- All queries now filter by `organisation_id = $1`
- `queryKeywordDailyRows()` - added required `organisationId` parameter
- `aggregateKeywordWindow()` - added required `organisationId` parameter  
- `fetchHistoricalCpaSamples()` - added required `organisationId` parameter
- `analyzeExperiment()` - requires `experiment.organisation_id`, passes to all helpers
- `detectBidExperiments()` - filters by `organisation_id`
- `detectBidExperimentsForKeywordRecords()` - requires `organisationId`
- Updated call site in `imports.js` to pass import's `organisation_id`

**Lines Changed:** ~200 lines

#### Verification Results

**CREATE Routes Audit:** ✅ PASS
- All create operations assign `organisation_id` server-side
- None accept `organisation_id` from request body/query
- Verified: annotations, goals, imports, campaigns, metrics, experiments

**Full SQL Audit:** ✅ PASS
- 50+ queries audited across 8 customer-data tables
- ALL properly scoped by `organisation_id`
- 0 unsafe queries found (after fixes)
- Intentionally unscoped: only system tables (organisations, users, settings)

**IDOR Protection:** ✅ VERIFIED
- All ID-based operations use: `WHERE id = ? AND organisation_id = ?`
- Returns 404 if not found in organisation scope
- 14/14 ID-based endpoints protected

**Fail-Closed Behavior:** ✅ VERIFIED
- All functions check: `if (!organisationId) throw new Error(...)`
- `buildFilters()` enforces at query level
- No function silently returns unscoped data

**Route Coverage:** ✅ COMPLETE
- 23/23 customer-data routes verified
- All require organisation context
- All properly scoped

**Test Scripts Created:**
- `test-p4.1-isolation.js` - Two-organisation isolation test
- `test-p4.1-idor.js` - IDOR protection test
- Tests identical advertising identities remain isolated

#### Test Execution Results ✅ EXECUTED AND PASSED

**Test Command:** `node test-p4.1-isolation.js` (from backend/ directory)

**Date Executed:** Thursday Aug 20, 2026

**Organisations/Fixtures Created:**
- Organisation A (ID: 5)
- Organisation B (ID: 6)
- Identical advertising structure: same app_id, campaign_name, ad_group_name, keyword_text, bid_strategy, report_date
- Different metrics: Org A = £100 spend, Org B = £900 spend

**Analytics Isolation Result:** ✅ PASS
- Dashboard: Org A shows £100 only, Org B shows £900 only
- Campaigns: Org A shows 1 campaign (£100), Org B shows 1 campaign (£900)
- Keywords: Org A shows 1 keyword (£50), Org B shows 1 keyword (£450)
- NO cross-contamination: Each org sees ONLY its own data
- Combined total (£1000) not visible to either organisation

**Bid Experiment Isolation Result:** ✅ PASS
- Bid experiment analysis queries filtered by `organisation_id`
- Two organisations with identical keyword identities remain isolated
- No mixing of metrics in experiment calculations

**IDOR Test Result:** ✅ PASS (test-p4.1-idor.js)
- Import detail: Returns null (404 equivalent)
- Campaign update: Not found (404 equivalent)
- Annotation update: Not found (404 equivalent)
- Annotation delete: Not found (404 equivalent)
- Goal update: Not found (404 equivalent)
- Goal delete: Not found (404 equivalent)
- All Organisation A data remains intact after cross-tenant attempts

**Development Organisation Reconciliation Result:** ✅ PASS
- Development Organisation (ID: 1) intact
- 40 imports preserved
- No data contamination from test organisations
- All existing data unchanged

**Test Cleanup Result:** ✅ PASS
- All test data successfully removed
- Organisations 5 and 6 deleted with all child data
- No orphaned records

**Backend Restart Result:** ✅ PASS
- Backend restarted successfully
- Development Organisation application loads normally
- `/api/apps` endpoint returns expected data
- No migration errors
- Server operational

#### Files Changed

- `backend/bidExperiments.js` - 6 functions updated, ~200 lines
- `backend/imports.js` - bid detection call updated
- `P4.1-VERIFICATION-REPORT.md` - comprehensive verification results
- `P4.1-SQL-AUDIT.md` - complete SQL audit
- `test-p4.1-isolation.js` - isolation test script

#### Summary

**Critical issues found:** 1 (bid experiments tenant leak)

**All issues resolved:** YES ✅

**Backend tenant-safe:** YES ✅ (PROVEN through execution)

**Ready for P5:** YES ✅

**P4.1 Fully Verified:** YES ✅

P4.1 verification EXECUTED AND PASSED. The backend is completely tenant-safe. Two organisations with identical advertising identities remain fully isolated. All tests passed, including:
- Dashboard isolation
- Campaign isolation
- Keyword isolation
- Bid experiment isolation
- Import isolation
- Goals/Annotations isolation
- IDOR protection
- Fail-closed behavior
- Development Organisation preservation

#### Next Phase

**Phase P5B: Organisation resolution** — implemented in the P5B section below. `GET /api/auth/context` resolves `req.organisationId` from `organisation_users`. Existing Apple Ads routes still call `getTransitionalOrganisationId()` until P5C. Clerk Organisations are not the tenancy source of truth.

---

### Phase P5A: Clerk Authentication Foundation ✅ IMPLEMENTED

**Scope:** Trusted user authentication only. Organisation resolution, route protection for Apple Ads APIs, and frontend sign-in are not part of this phase.

**Provider:** [Clerk](https://clerk.com/) via the official Express SDK `@clerk/express`.

**Verified API (current Clerk Express docs):**

- `clerkMiddleware()` verifies the session JWT from cookies or headers and attaches auth state
- `getAuth(req)` reads that verified state (`isAuthenticated`, `userId`)
- `clerkClient.users.getUser(userId)` loads the trusted Backend User when a local row is provisioned or synced
- `requireAuth()` is deprecated and is not used

**Local identity:**

| Clerk | Local `users` column |
|-------|----------------------|
| constant `'clerk'` | `auth_provider` |
| Clerk user id (`user_...`) | `auth_provider_user_id` |
| primary email, when present | `email` |
| full name / display name, when present | `full_name` |

Email is not the identity key. A later Clerk email change updates the same local row. Uniqueness is the existing partial unique index `idx_users_provider_identity` on `(auth_provider, auth_provider_user_id)`. No password columns and no application session table were added. Clerk holds credentials.

**Request flow:**

```
clerkMiddleware()          verified session, or signed-out state
        ↓
requireAuthenticatedUser   401 unless getAuth reports a session user id
        ↓
resolveLocalUser           find or create users row; sync email and name
        ↓
req.user                   local id, email, fullName, authProvider, authProviderUserId
```

`req.user.id` is the PostgreSQL `users.id`. The Clerk user id stays on `req.user.authProviderUserId`.

**Protected in P5A:** `GET /api/auth/me` only. Authenticated response is `{ id, email, fullName }`. Missing, invalid, or expired authentication returns `401` with `{ "error": "Unauthorized" }`. Existing Apple Ads routes are unchanged and still call `getTransitionalOrganisationId()`.

**Environment variables (backend only):**

| Variable | Role |
|----------|------|
| `CLERK_PUBLISHABLE_KEY` | Clerk publishable key (`pk_test_` or `pk_live_`) |
| `CLERK_SECRET_KEY` | Clerk secret key (`sk_test_` or `sk_live_`). Server only. |

Names match the current Clerk Express quickstart. See `backend/.env.example`. The process exits on startup when Clerk authentication is enabled and either value is missing or not a Clerk key. The secret is not returned by the API and is not written to logs by this phase.

**Manual session check (no frontend in this phase):**

```bash
curl -s http://localhost:3001/api/auth/me
# {"error":"Unauthorized"}

curl -s http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer <Clerk session token>" \
  -H "Accept: application/json"
```

The temporary P5A sign-in page has been removed. A later manual check still needs a genuine Clerk session token from a signed-in Clerk session. Do not put the secret key in the curl command or in frontend environment variables. API clients should send `Accept: application/json`. A browser navigation to an API route can receive Clerk's handshake redirect instead of JSON.

**Implemented in P5B:** organisation resolution for an authenticated local user, including `req.organisationId` on routes that opt in. Replacing `getTransitionalOrganisationId()` on existing Apple Ads routes was not part of that work.

**P5C.1 implemented:** the shared `requireAuthenticatedTenant` chain. **P5C.2 implemented:** Imports use that chain. **P5C.3 implemented:** Dashboard, campaigns, keywords, and core analytics use that chain. **P5C.4 implemented:** Goals, annotations, and bid experiments use that chain.

**Still deferred:** organisation switching, invitations, and RBAC beyond the existing owner/admin/analyst values. Clerk Organisations are not the tenancy source of truth.

**Deferred to P5D:** `ClerkProvider`, sign-in UI, and frontend route guards.

---

### Phase P5B: Organisation Resolution ✅ IMPLEMENTED

**Scope:** Resolve one local organisation for an authenticated user. Existing Apple Ads routes are unchanged and still call `getTransitionalOrganisationId()`.

**Tenancy source of truth:** PostgreSQL `users`, `organisations`, and `organisation_users`. Clerk answers who the user is. It is not the application tenancy model.

**Request flow for routes that opt in:**

```
clerkMiddleware()
        ↓
requireAuthenticatedUser     req.user from P5A
        ↓
requireOrganisationContext    organisation_users → organisations
        ↓
req.organisationId            local organisations.id
req.organisation              { id, name, role }
```

`GET /api/auth/me` stops at `req.user`. `GET /api/auth/context` runs both steps. Authenticated response:

```json
{
  "user": { "id": 33, "email": "..." },
  "organisation": { "id": 14, "name": "P5A Test User's Organisation", "role": "owner" }
}
```

Missing or invalid authentication returns `401` with `{ "error": "Unauthorized" }`. Resolution failures return `500` with `{ "error": "Organisation could not be resolved" }`. The client does not receive membership diagnostics. The server log includes the local user id, an error code, and the organisation ids when more than one membership exists.

**Single active membership:** The product phase assumes one active membership per user. `organisation_users` stays unique on `(organisation_id, user_id)` only, so a later switching phase can store more than one membership. Resolution does not use `LIMIT 1`. Zero memberships provisions or bootstraps. Exactly one valid membership resolves that organisation. More than one membership, a membership whose organisation row is missing, or a database error fails closed. None of those paths attach the user to the Development Organisation.

**Normal new user:** An authenticated local user with no membership, who is not the configured bootstrap identity, gets a new `organisations` row and an `organisation_users` row with `role = 'owner'`. The default name is the local full name plus `'s Organisation` (for example `P5A Test User's Organisation`), or `User's Organisation` when the full name is blank. The new organisation is empty. Campaigns, keywords, imports, metrics, annotations, goals, and bid experiments are not copied.

**Concurrency:** Provisioning locks the local user row inside a transaction (`SELECT id FROM users WHERE id = $1 FOR UPDATE`) before the membership check and insert. A second simultaneous first request waits, then sees the committed membership. No extra uniqueness constraint was added on `user_id`.

**Development Organisation bootstrap:** Set `DEVELOPMENT_ORGANISATION_BOOTSTRAP_CLERK_USER_ID` to the Clerk user id (`user_...`) of the existing developer/operator. On the first organisation-context request for that local user, if they have no membership, they are attached to the existing organisation named `Development Organisation` as `owner`. The attach is idempotent (`ON CONFLICT` on `uq_organisation_user`). The organisation is not recreated, renamed, or given a second copy of its data. If that name is missing or not unique, resolution fails. Unset means nobody is bootstrapped. The value is not inferred from the first user, the lowest `users.id`, an email domain, or local user 33.

See `backend/.env.example`. The secret Clerk key stays server-only and is unrelated to this variable.

**Verified with real Clerk sessions:** local user 73, the configured developer bootstrap identity, resolves Development Organisation id 1 as `owner`. Local user 33, the normal test account, resolves organisation 14, `P5A Test User's Organisation`, as `owner`. Repeated requests did not create another organisation or membership. The temporary `/p5a-test/sign-in` page used for those manual checks has been removed.

**Not switched in P5B:** Dashboard, Campaigns, Keywords, Imports, and the other Apple Ads routes still used the transitional Development Organisation helper at the end of P5B. P5C.2 moved Imports onto `requireAuthenticatedTenant`. P5C.3 moved Dashboard, Campaigns, Keywords, and core analytics. Goals, annotations, and bid experiments move in P5C.4.

**Explicitly deferred from P5B:** route-group migration, P5D frontend authentication, organisation switching, invitations, team management, Clerk Organisations, SSO, billing, and frontend onboarding. Imports were migrated in P5C.2. Frontend authentication was brought forward as P5D.1. Dashboard, campaigns, and keywords were migrated in P5C.3. P5C.4 remains.

---

### Phase P5C.1: Shared Authenticated Tenant Middleware ✅ IMPLEMENTED

**Scope:** One reusable middleware chain for routes that should run as the authenticated user's organisation. Existing Apple Ads routes are not migrated in this step.

**Canonical request path for a protected route:**

```
Clerk session
        ↓
local users row                         req.user
        ↓
organisation_users → organisations      req.organisationId
        ↓
organisation-scoped service
```

The chain is `requireAuthenticatedTenant` in `backend/auth/tenantMiddleware.js`. It is the existing P5A `requireAuthenticatedUser` middleware followed by the existing P5B `requireOrganisationContext` middleware. `GET /api/auth/context` uses that array. P6A.1 removed `GET /api/auth/tenant-test`. `GET /api/auth/context` remains the authenticated application view of the caller and their organisation.

Unauthenticated and invalid sessions return `401`. A membership that cannot be resolved, including multiple memberships, a missing organisation, or a database error, returns `500` and does not select the Development Organisation. The organisation id is taken from the membership row. Query parameters, the body, and headers are ignored.

The Development Organisation bootstrap rule remains inside P5B resolution. It runs only when the authenticated Clerk user id equals `DEVELOPMENT_ORGANISATION_BOOTSTRAP_CLERK_USER_ID` and that user has no membership. It is not a fallback for other requests.

**Transitional resolver:** `getTransitionalOrganisationId()` previously lived in `backend/db.js`. P5C.4 removed it. Apple Ads routes no longer resolve the Development Organisation for request handling. The P5B bootstrap in `backend/auth/organisationContext.js` remains the only production path that attaches the configured Clerk user to the existing Development Organisation.

**Not done in P5C.1:** switching imports, campaigns, keywords, dashboard/overview, annotations, goals, or bid experiments onto `req.organisationId`.

---

### Phase P5C.2: Imports on the authenticated tenant ✅ IMPLEMENTED

**Scope:** Apple Ads import routes and the import processing pipeline. At the time of P5C.2, campaigns, keywords, dashboard analytics, annotations, goals, and bid-experiment HTTP routes stayed on the transitional Development Organisation resolver. P5C.3 moved dashboard, campaigns, and keywords. P5C.4 moved annotations, goals, and bid experiments.

**Import request path:**

```
authenticated user
        ↓
req.organisationId
        ↓
import pipeline
```

`requireAuthenticatedTenant` protects:

- `POST /api/imports`
- `GET /api/imports`
- `GET /api/imports/:id`
- `GET /api/imports/:id/rows`
- `GET /api/imports/:id/profile`
- `GET /api/imports/:id/metrics-summary`
- `GET /api/imports/:id/campaign-summary`
- `GET /api/imports/:id/keyword-summary`
- `GET /api/compare` (import-to-import comparison)

There is no import delete, retry, or reprocess route. Unauthenticated and invalid sessions return `401`. A missing or foreign import returns `404`.

`organisationId` is taken only from `req.organisationId`. The upload handler does not read an organisation id from the body, query, headers, route parameters, or CSV. `createImport` requires that id and writes it onto `imports` and every `import_rows` row. Normalisation passes the same id into campaign creation, `daily_campaign_metrics`, and `daily_keyword_metrics`. Bid observations and bid-experiment detection for that upload use the same id. The startup daily-metrics backfill passes each import's stored `organisation_id`.

`getTransitionalOrganisationId()` is forbidden in the Imports domain. P5C.4 removed it from production code. `GET /api/apps` was unscoped at the end of P5C.2; P5C.3 requires authentication and filters those rows by `req.organisationId`.

Record-key deduplication stays tenant-scoped: `(organisation_id, record_key)`. The startup record-key backfill no longer deletes a row because another organisation holds the same key, and it no longer rebuilds a global unique index once `organisation_id` exists.

---

### Phase P5D.1: Frontend Clerk authentication ✅ IMPLEMENTED

**Why this came before P5C.3:** P5C.2 correctly requires a Clerk session on Imports. The frontend was still calling `GET /api/imports` with no session token, so the page showed "Failed to load imports". Protecting Dashboard, Campaigns, or Keywords first would have produced the same failure. Frontend authentication was brought forward so those later route migrations have a client that can send a session.

**Request path:**

```
Frontend Clerk
        ↓
authenticated API client
        ↓
backend Clerk middleware
        ↓
local user
        ↓
organisation membership
        ↓
tenant-scoped service
```

`@clerk/react` wraps the app. The publishable key is `VITE_CLERK_PUBLISHABLE_KEY`. The Clerk secret key stays in `backend/.env` only.

Signed-out users see Clerk's sign-in screen. The analytics shell, including Imports, mounts only after Clerk has loaded a signed-in session. One API client, `frontend/src/auth/apiClient.js`, attaches `Authorization: Bearer <session token>` from Clerk's `getToken()`. It does not store the token, and it does not send an organisation id. The backend still derives `req.organisationId` from the membership.

Switching users remounts the application state on the Clerk user id, so the previous tenant's imports are not kept on screen. Sign-out clears the token getter and unmounts that state.

At the end of P5D.1, Dashboard, Campaigns, Keywords, Goals, Annotations, and Bid Experiments backend routes were still unauthenticated. P5C.3 then protected Dashboard, Campaigns, and Keywords. P5C.4 protected Goals, Annotations, and Bid Experiments.

---

### Phase P5C.3: Campaigns, Keywords and Core Analytics ✅ IMPLEMENTED

**Scope:** Dashboard, campaign list and detail, weekly campaign performance, keyword analytics, app and campaign filters, date-range comparisons, summary metrics, and charts. P5C is not complete. Goals, annotations, and bid experiments stay on the transitional resolver for P5C.4.

P5D.1 was brought forward, so every frontend caller of these routes already uses the shared authenticated API client. The client sends the Clerk session token and does not send an organisation id.

```
Frontend Clerk session
        ↓
authenticated API client
        ↓
backend Clerk authentication
        ↓
local user
        ↓
organisation membership
        ↓
req.organisationId
        ↓
organisation-scoped analytics
```

`GET /api/apps`, `GET /api/alerts`, `GET /api/insights`, `PATCH /api/campaigns/:id`, `GET /api/campaigns/weekly-performance`, and `GET /api/compare/period` use `requireAuthenticatedTenant`. A missing or invalid session returns 401. A campaign id that belongs to another organisation returns 404. The latest-date window, comparison period, weekly context week, app list, and keyword bids are filtered by that organisation. The weekly context week is still fetched for the previous-week comparison and is still omitted from the displayed weeks.

At the end of P5C.3, Keyword Details still loaded Bid History from unmigrated experiment routes. P5C.4 protects those routes.

---

### Phase P5C.4: Goals, Annotations and Bid Experiments ✅ IMPLEMENTED

**Scope:** Performance goals, annotations, bid experiment history, experiment detail, detection, analysis, and the default observation-window setting. This completes the Apple Ads route migration. P5C application tenant migration is complete.

Every route uses `requireAuthenticatedTenant`. Creates write `organisation_id = req.organisationId`. Reads, updates, and deletes require the resource id and that organisation. A foreign id returns 404. A missing or invalid session returns 401. Request bodies, query parameters, and headers cannot choose the organisation.

Bid experiment analysis reads `daily_keyword_metrics` with `organisation_id` plus the keyword identity and date window. The latest report date used for observation status is also limited to that organisation. The default observation window is stored per organisation. Detection no longer falls back to the Development Organisation.

The only remaining Development Organisation special case is the P5B bootstrap: the configured Clerk user, when they have no membership, joins the existing Development Organisation. Other users do not fall back to it.

Frontend callers continue to use the P5D.1 authenticated API client.

---

### Phase P6A.1: HTTP, Error and Security Baseline ✅ IMPLEMENTED

**Scope:** Stop unexpected server failures from revealing internals. Restrict browser origins. Add standard API security headers. Remove the mounted tenant test route. Ignore secret files at the repository root. Fail production startup when the allowed frontend origin is missing.

Tenant resolution, analytics calculations, CSV row limits, upload rate limits, analytics day caps, RBAC, invitations, and production deployment are unchanged.

**Generic production error policy:** An unexpected internal failure returns HTTP 500 and `{ "error": "The server could not complete this request" }`. The client does not receive `err.message`, SQL or PostgreSQL text, a stack trace, a filesystem path, environment information, or Clerk internals. The same body is used when `NODE_ENV` is unset and when it is `production`. Express's default error handler is not the response path. The final middleware in `backend/index.js` handles errors passed to `next(err)`, including JSON parse failures and Multer failures. Route `catch` blocks use the same helper and do not call `next(err)` after sending a response.

Legitimate client errors stay specific:

| Status | When |
|--------|------|
| 400 | Invalid request, including goal and annotation validation, an invalid campaign segment, a non-CSV upload, a CSV that cannot be parsed, and a body that is not JSON |
| 401 | Missing or invalid authentication. Body remains `{ "error": "Unauthorized" }` |
| 404 | Missing or inaccessible resource, including a foreign id |
| 413 | Request body over the JSON parser limit, or a CSV over the P6A.2 file or row limit. The JSON body is `{ "error": "Request body is too large" }`. CSV limit messages are in P6A.2 |
| 500 | Unexpected internal failure, using the generic sentence above |

Organisation resolution still returns its existing safe 500, `{ "error": "Organisation could not be resolved" }`, and still does not describe membership internals. A plain `Error` is not treated as a client error just because some other code set `status`. Validation errors opt in with `httpError()`.

Server logs for these failures may include the method, the path without the query string, the organisation id, a short error code, and a redacted internal message. They do not include the bearer token, `CLERK_SECRET_KEY`, `DATABASE_URL`, or CSV body contents. This phase does not add a logging product.

**CORS:** `cors()` is no longer unrestricted. `FRONTEND_ORIGIN` lists allowed browser origins, separated by commas. Each value must be an absolute `http` or `https` origin, without a path, query, hash, or credentials. A wildcard is rejected in production.

Development always allows `http://localhost:5173`, including when `FRONTEND_ORIGIN` is unset. `NODE_ENV=production` requires `FRONTEND_ORIGIN` and does not add localhost. Startup exits before listen when that value is missing, empty, a wildcard, or not an origin. The failure message names the variable and does not print secret values. Requests with no `Origin` header, such as a health check from the same machine, are still accepted. An unapproved browser origin receives no `Access-Control-Allow-Origin` permission.

`Authorization`, `Content-Type`, and `Accept` are allowed request headers. Cookie credentials are not enabled. The frontend continues to send `Authorization: Bearer`.

**Security headers:** `helmet` sets the usual API headers, including `X-Content-Type-Options: nosniff` and a cross-origin resource policy so a browser on an allowed origin can read the JSON. `Content-Security-Policy` is not set on this API. The API does not serve the Clerk sign-in page. A later host that serves the frontend HTML must follow Clerk's current CSP requirements for script, connect, frame, worker, and image sources. Do not turn on a restrictive policy until that host is checked. `Cross-Origin-Embedder-Policy` is off. HSTS is sent only when `NODE_ENV=production`, so the HTTP development server and the Vite proxy are not asked to upgrade to HTTPS. `trust proxy` stays at the Express default.

**Removed route:** `GET /api/auth/tenant-test` is not mounted. No frontend caller used it. `GET /api/auth/context` remains. An unknown `/api` path returns `{ "error": "Not found" }`.

**Environment and ignore rules:** Required server configuration remains `DATABASE_URL`, `CLERK_PUBLISHABLE_KEY`, and `CLERK_SECRET_KEY`. Production also requires `FRONTEND_ORIGIN`. See `backend/.env.example` and `frontend/.env.example`. Example files use placeholders only. The repository root `.gitignore` ignores `.env`, `.env.*` with an exception for `.env.example`, `backend/.env`, `frontend/.env`, `node_modules`, build output, logs, and OS or editor temporary files.

---

### Phase P6A.2: CSV Upload Protection ✅ IMPLEMENTED

**Scope:** Cap Apple Ads CSV uploads before they reach the database. Keep the existing import pipeline, tenant resolution, and analytics calculations.

**Limits:** The defaults are `MAX_CSV_FILE_SIZE_MB=16`, `MAX_CSV_ROWS=100000`, `MAX_CSV_UPLOADS_PER_WINDOW=10`, and `MAX_CSV_UPLOAD_WINDOW_MINUTES=15`. Blank values use those defaults. Startup rejects a value outside the allowed range and does not print the value. The ranges are 1–32 MB, 1–200,000 rows, 1–60 uploads, and 1–1,440 minutes.

The previous upload cap was 50 MB, with no row cap. Stored imports were measured before choosing the new default. 53 imports average about 3,351 rows. The largest is 60,005 rows and about 12.7 MB of CSV text. A 10 MB cap would reject that file. 16 MB is the smallest power-of-two megabyte cap above it. 100,000 rows remains above every stored report. A 100,000-row file in the current 26-column shape is about 21 MB, so the row cap is not the binding limit until `MAX_CSV_FILE_SIZE_MB` is raised within the 32 MB range.

**File size:** Multer rejects a larger file before CSV parsing or database work. A file at the configured size is accepted. A larger file is HTTP 413 `{ "error": "CSV file exceeds the maximum allowed size" }`. Multer's own error text is not returned. The multipart parser allows one file, ten text fields, twenty parts, and one level of field-name nesting.

**Row count:** `csv-parse` stops after one row past the limit. The response is HTTP 413 `{ "error": "CSV contains more rows than the maximum allowed" }`. Parsing and database work stop there, so no import, import row, campaign, or daily metric is kept for that failed file.

**Upload validation:** The file name must end in `.csv`. The MIME type may be `text/csv`, `application/csv`, `application/vnd.ms-excel`, `text/plain`, `application/octet-stream`, or absent. Other MIME types are rejected. The body is also checked for binary signatures and for obvious HTML or JSON. The parser then requires a Date column and a Campaign Name column, using the existing alias rules. `Keyword Max Bid` and `Keyword Max CPT Bid` both remain accepted. A malformed file or an unsupported shape returns HTTP 400 with a fixed sentence. Parser text, stacks, and filesystem paths are not returned.

**Rate limit:** `POST /api/imports` allows 10 attempts per 15 minutes for each authenticated local user (`req.user.id`). The limiter runs after authentication and tenant resolution. It does not read an organisation id from the client, and it does not key off the IP address. Other analytics routes are not limited in this phase. The 11th attempt is HTTP 429 `{ "error": "Too many upload attempts. Try again later." }`.

**Transactions:** File-size, row-count, malformed, and structure failures happen before `createImport`, so they do not insert an import. If a database write inside `createImport` fails, that transaction rolls back. The rollback does not delete unrelated rows. Bid observations and bid-experiment detection still run after a successful commit, as they did before this phase.

**memoryStorage:** Multer still holds the file in memory. That is a deliberate beta decision. One accepted file is at most 16 MB, and one user can start at most 10 uploads in 15 minutes. A streaming or disk storage rewrite is deferred. The in-memory rate limit is per process and resets on restart.

**Multer advisory:** The high-severity connection-drop issue `GHSA-v52c-386h-88mc` (CVE-2026-2359) is fixed in 2.1.0. Later 2.x advisories remain on 2.1.1, including nested field names (`GHSA-72gw-mp4g-v24j`), crafted field names (`GHSA-wc9g-mqfw-jrwm`), an oversized field index (`GHSA-535w-7cp7-47q4`), and a file-size bypass (`GHSA-qvfw-j98x-7q72`). Those are fixed by 2.4.0, which also fixes `GHSA-3pph-fpjx-jg34`. Multer was upgraded from the installed 2.1.1 to 2.4.0 only. The upload form still uses `memoryStorage` and `single('file')`. No other packages were upgraded. `npm audit fix --force` was not run.

**Frontend:** The Imports screen states the 16 MB and 100,000-row limits. An obviously oversized or non-CSV file is rejected in the browser before the request. The backend remains authoritative. Responses use the server sentence for 400, 413, and 429. 401 says sign-in is required. 500 stays the generic server sentence.

---

### Phase P6A.3: API Input and Analytics Limits ✅ IMPLEMENTED

**Scope:** Bound user-controlled API inputs that can drive expensive queries or store unbounded text. Analytics formulas, tenant resolution, and existing 7, 14, and 30 day controls are unchanged. These limits are code constants. They are not environment variables.

**Analytics window:** `days` must be a whole number from 1 to 90. `7.5`, `0`, `-1`, `abc`, and values above 90 are HTTP 400 `{ "error": "days must be a whole number from 1 to 90" }`. The value is not clamped. The dashboard presets remain 7, 14, and 30 days. All Time does not call the period API. A custom range uses calendar dates instead of `days`.

**Dates:** `startDate` and `endDate` must be real `YYYY-MM-DD` calendar dates. The comparison uses those UTC calendar days, as before. One date without the other, a reversed range, or a span longer than 90 inclusive days is HTTP 400. `GET /api/compare/period` and `GET /api/insights` require either `days` or both dates, so a missing window is no longer an unbounded scan. `GET /api/campaigns/weekly-performance` requires both dates. The dashboard already sends them whenever it requests that series. The weekly query's internal seven-day lookback is not part of the user cap.

**Resource ids:** Import, campaign, goal, annotation, and bid-experiment ids must be canonical positive integers up to the PostgreSQL serial maximum, checked before the query. `abc`, `0`, negatives, decimals, and `Infinity` are HTTP 400. A well-formed id that is missing or belongs to another organisation stays HTTP 404.

**Annotations:** `note_text` is at most 2,000 characters. There is no title field. `entity_key` is at most 500 characters. A longer note is HTTP 400 and is not truncated. The notes form uses the same 2,000-character limit. Stored notes were far below that limit when the cap was chosen.

**Goals:** Entity type, metric, and operator stay on their existing lists. `period_days` stays 7, 14, or 30. `threshold` must be a finite number from 0 through 1,000,000,000,000. `NaN`, `Infinity`, and negative values are HTTP 400 `{ "error": "Threshold must be a non-negative number" }`.

**Bid experiments:** `defaultObservationDays` accepts only 3, 7, 14, and 30, as a whole number. Other values are HTTP 400. Changing the setting does not rewrite existing experiment rows.

**Filters and pages:** Equality filters such as `appId`, `campaignName`, and `keywordText` are at most 300 characters. A keyword identity key is at most 1,000. Values are still query parameters, not SQL text. Import rows accept `limit` 1–500 and `offset` 0–100,000. Bid-experiment history accepts `limit` 1–200 and the same offset range. Out-of-range page values are HTTP 400. Apps, goals, annotations for one entity, and campaign analytics lists are not paginated. They stay bounded by the tenant's imported data. This phase does not add a new pager.

**Errors:** Invalid input is HTTP 400 and may name the field. It does not include SQL or other internals. 401, 404, 413, 429, and 500 keep the P6A.1 meanings. A foreign resource id is still 404, including when the caller also sends another organisation id.

---

### Phase P6A.4: Hardening Close-out ✅ IMPLEMENTED

**Scope:** Audit application security and production readiness after P6A.1–P6A.3. Apply only compatible security updates. Remove unused unscoped tenant-data helpers. Do not add product functionality, deploy, or start P6B.

**P6A summary:**

- P6A.1 — HTTP, error, and security baseline
- P6A.2 — CSV upload protection
- P6A.3 — API input and analytics limits
- P6A.4 — Hardening close-out

**Dependency audit:** Backend and frontend production trees were audited separately. `npm audit fix --force` was not run. No major upgrade was taken only to clear the report.

| Package | Tree | Severity | Direct | Installed | Safe compatible update | Used path |
|---------|------|----------|--------|-----------|------------------------|-----------|
| multer | backend | none remaining from the P6A.2 advisories | yes | 2.4.0 | already applied in P6A.2 | CSV upload |
| body-parser | backend | high, fixed | transitive via Express | 2.3.0 | applied | JSON body parser |
| qs | backend | moderate, fixed | transitive | 6.16.0 | applied | query parsing |
| proxy-addr | backend | low, fixed | transitive | 2.0.8 | applied | Express address helper. `trust proxy` remains off, so `X-Forwarded-For` is not trusted |
| csv-parse | backend | moderate, `GHSA-8cw4-87c7-c6xx`, columns path, fixed in 7.0.3 | yes | 5.6.0 | no. 7.0.3 is a breaking major | `parseCsv` uses `columns: true`. A local header probe did not set an inherited prototype property |
| react-router / react-router-dom | frontend production | fixed | yes | 7.18.4 | applied within `^7.16.0` | client routing |
| vite, postcss, nanoid, browserslist, brace-expansion, source-map-js, baseline-browser-mapping | frontend dev | 1 moderate, 6 high | vite direct; the rest transitive | current dev tree | not applied. They are not in the production bundle | build and test only |

Frontend `npm audit --omit=dev` reports 0 vulnerabilities. The full frontend tree reports 7 development-tool findings. Backend production audit has the one remaining `csv-parse` finding.

**Debug and test artefacts:** Production request handling has no `tenant-test` route, no debug or test-only route, no hard-coded user 73 or 33, no hard-coded organisation 1 or 14, and no temporary bearer token or test Clerk identity. Console output on the server is startup and migration progress, not an API response. Users 73 and 33 and organisations 1 and 14 appear in test scripts. Historical sections of this document describe the earlier single-tenant model. They are not the runtime path.

**Development Organisation:** The only request-time special case remains P5B bootstrap. It applies when `DEVELOPMENT_ORGANISATION_BOOTSTRAP_CLERK_USER_ID` matches and that user has no membership. A missing organisation, multiple memberships, or a database error fails closed with `{ "error": "Organisation could not be resolved" }`. There is no missing-organisation fallback to organisation 1. Authenticated Apple Ads routes resolve the organisation through `requireAuthenticatedTenant`.

**Tenant-query audit:** Request-path reads and writes for imports, import rows, campaigns, daily campaign metrics, daily keyword metrics, annotations, performance goals, bid experiments, and campaign budget history keep `organisation_id` on the query. Unused helpers that queried tenant tables without an organisation were removed or forced to require one:

- `getBidChanges` in `analyticsService.js` was unused and did not take an organisation. Removed.
- Unscoped `getPeriodCompare` and `loadAllRows` in `compare.js` were unused. The live period route uses `compareStructured.js`. Removed. `getImportCompare` remains and is tenant-scoped.
- Unscoped aggregate and breakdown queries in `analyticsMetrics.js` had no production caller. Removed. Pure metric helpers remain.
- `summarizeReconstructableBudgetHistory` now requires `organisationId` and always filters by it.

Standalone scripts `backfill-bid-history.js`, `backfill-bid-snapshot-dates.js`, and `backfill-keyword-bids.js` are not mounted by the server. They are deployment scripts, not request handlers.

**Secret hygiene:** The workspace is not a Git repository, so commit history cannot be searched. The root `.gitignore` is ready for an initial commit. It ignores `.env`, `.env.*` except examples, `backend/.env`, and `frontend/.env`. Example files contain placeholders only. Source, tests, and this document do not contain a Clerk secret, a database URL, or a bearer token. Test files use dummy `sk_test_` strings.

**Error disclosure:** Production routes do not return `err.message` on HTTP 500. Unexpected failures use `The server could not complete this request`. Organisation resolution uses `Organisation could not be resolved`. Stack traces, database errors, and filesystem paths are not response bodies.

**CORS and headers:** Unrestricted `cors()` is not mounted. Development allows `http://localhost:5173`. Production requires `FRONTEND_ORIGIN` and does not add localhost or a wildcard. A foreign origin receives no allow-origin permission. `Authorization` remains an allowed header. Helmet stays on, without a content security policy. Clerk sign-in still reaches the application shell.

**Resource protection:** P6A.2 remains: 16 MB file cap, 100,000 row cap, upload validation, 10 uploads per 15 minutes per authenticated user, transaction rollback before a failed import is kept, and Multer 2.4.0. P6A.3 remains: 90-day analytics cap, calendar date checks, canonical resource ids, annotation and goal limits, and 3/7/14/30 experiment windows.

**Startup classification:**

| Task | Classification | P6C note |
|------|----------------|----------|
| Clerk, CORS, and CSV configuration assertions | SAFE FOR PRODUCTION STARTUP | Keep. They exit before listen when required production config is missing |
| HTTP listen | SAFE FOR PRODUCTION STARTUP | Keep |
| `initDb` schema CREATE and ALTER | SHOULD MOVE TO DEPLOYMENT/MIGRATION STEP | Do not run the full schema migrator on every process start |
| `backfillRecordKeys` | SHOULD MOVE TO DEPLOYMENT/MIGRATION STEP | Scans import rows across tenants |
| `migrateOrganisationOwnership` NULL backfill onto Development Organisation | SHOULD MOVE TO DEPLOYMENT/MIGRATION STEP | One-time data repair, not a request fallback |
| Unique-constraint and keyword bid-history migrations | SHOULD MOVE TO DEPLOYMENT/MIGRATION STEP | Schema work belongs in the deployment step |
| `backfillDailyMetricsFromImportRows` and `backfillBidExperiments` after listen | SHOULD MOVE TO DEPLOYMENT/MIGRATION STEP | Full historical rebuild on every boot |
| P5B bootstrap attach for the configured Clerk user | DEVELOPMENT ONLY | Do not use as customer onboarding |
| Creating the Development Organisation row when it is missing | DEVELOPMENT ONLY | Do not create it on a production boot |

Two duplicate `(app_id, campaign_name)` pairs still skip creation of the campaigns unique constraint. That is existing data, recorded at startup. It is not a new isolation bug. P6C should resolve those duplicates before relying on that constraint.

**Production frontend build:** `npm run build` succeeded. Output is `dist/index.html`, `dist/assets/index-CEYRmYYd.css` (54.56 kB), and `dist/assets/index-D1-LKWco.js` (502.47 kB), plus Vite's chunk-size warning. The bundle has no `localhost:3001`, no `localhost:5173`, no secret key, no `postgresql://` URL, and no bearer token. API calls stay relative `/api`. The Clerk publishable key is read from `VITE_CLERK_PUBLISHABLE_KEY` at build time, so the client bundle contains that publishable value. It is not a server secret. The build was not deployed.

**Regression:** Security suites passed after the dependency updates and the dead-code removal: HTTP security, tenant middleware, API input limits, CSV upload protection, import tenant isolation, analytics tenant isolation, feature tenant isolation, campaign budget history, analytics metrics, and bid experiments. Frontend unit tests passed (5 files, 31 tests). The API was restarted on port 3001 so the process loads the patched dependencies. That restart is local only.

The signed-in frontend was exercised at the development Vite origin: Dashboard 7, 14, and 30 day ranges, Imports, Campaigns with app filter, daily budget and budget history, Goals and Annotations panels, Keywords with campaign filter, campaign-name wrapping, current and previous bids, and Bid History. Sign out returned to the Clerk sign-in screen. A first recorded keyword bid shows the current bid and marks the previous bid and the change as not recorded. Campaigns with a known daily budget show that amount. "Not recorded" appears only when the current budget itself is absent. Budget history states that the first recorded budget is not a change.

**Remaining blockers:** None at the application security or tenant-isolation layer.

**Gate:** P6A hardening verification passed. Self-service registration is P6B. Production hosting, moving startup migrations off the boot path, and the deferred `csv-parse` major upgrade are P6C.

---

### Phase P6B: Self-Service Registration & Organisation Provisioning ✅ IMPLEMENTED

**Scope:** Any legitimate Clerk user can register and receive their own organisation. There is no email allowlist, invite list, or approval queue. Clerk authenticates the person. PostgreSQL remains the source of truth for users, organisations, and memberships. Clerk Organisations are not the tenancy model.

**Architecture:**

```
Clerk identity
  -> local users row
  -> organisations row
  -> organisation_users owner membership
  -> req.organisationId
```

**Registration:** The signed-out screen uses Clerk `<SignIn withSignUp />`, so the same screen can create an account or sign in. The application does not collect or store passwords. The frontend never receives `CLERK_SECRET_KEY`. The first authenticated request that needs a tenant (`/api/auth/context`, or any Apple Ads route) resolves the local user and, when that user has no membership, creates one organisation and one owner membership. `/api/auth/me` still returns only the local user and does not create an organisation.

**Organisation name:** The name is the local full name plus `'s Organisation`, for example `Ava Customer's Organisation`. A blank name becomes `User's Organisation`. The name is not the email address. The client cannot send `organisation_id`.

**Idempotency and concurrency:** Provisioning locks the local user row (`SELECT … FOR UPDATE`) inside a transaction, then inserts the organisation and membership, then confirms the membership before commit. A second request waits, sees the membership, and does not insert another organisation. A failed insert rolls back, so a failed race does not leave an orphan organisation. More than one membership fails closed and does not pick a row with `LIMIT 1`.

**Development Organisation:** The configured bootstrap Clerk user, and only that user, still joins the existing Development Organisation when they have no membership. A normal new user always receives a new empty organisation.

**Empty organisation:** Dashboard, Campaigns, Keywords, and History show a welcome panel with **Upload Apple Ads CSV** when the organisation has no imports. Those screens do not invent metrics. Goals, annotations, and bid history stay on the campaign and keyword screens, which are empty until a report is uploaded.

**P6A protections:** CSV size and row caps, upload rate limiting, analytics window limits, input validation, generic 500 responses, restricted CORS, and security headers stay in place.

**Clerk settings for P6C:** The production Clerk instance needs sign-up enabled for the public, with restrictions and the allowlist turned off. Allowed origins and redirect URLs must include the production frontend. The publishable key stays in the frontend environment. The secret key stays on the server. Do not enable Clerk Organisations as the application tenant source. Email verification and social providers are Clerk dashboard choices. This phase does not deploy those production settings.

---

## Summary

**Current state:** Tenant foundation and backend scoping are complete (P1–P4.1). P5A authenticates a Clerk session into `req.user`. P5B resolves that user's organisation. P5C.1 is the shared authenticated tenant chain. P5C.2 puts Imports on that chain. P5D.1 adds frontend Clerk sign-in and the authenticated API client. P5C.3 puts Dashboard, Campaigns, Keywords, and core analytics on that chain. P5C.4 puts Goals, Annotations, and Bid Experiments on that chain. All Apple Ads production route groups now derive tenant context from the authenticated membership. There is no general Development Organisation fallback. The configured P5B bootstrap identity can still join the existing Development Organisation when that user has no membership. P6A.1 hides unexpected server errors, restricts CORS to the configured frontend origin, adds API security headers, removes `GET /api/auth/tenant-test`, and ignores secret env files. P6A.2 caps CSV file size, row count, and upload attempts. P6A.3 caps the analytics window at 90 days and validates dates, resource ids, annotation text, goal thresholds, experiment windows, and filter strings. P6A.4 audited dependencies, tenant queries, debug artefacts, secrets, startup work, and the production frontend build, and removed unused unscoped helpers. P6B lets any new Clerk user register and receive one owner organisation. None of these phases deploys the application.

**Completed phases:**
- ✅ **P1:** Multi-tenant foundation tables (users, organisations, organisation_users)
- ✅ **P2:** Organisation ownership columns on all customer data
- ✅ **P3:** Tenant-scoped unique constraints preventing cross-org data collisions
- ✅ **P4:** Tenant-scoped query execution - all backend operations require organisation context
- ✅ **P4.1:** Tenant-isolation verification and hardening (EXECUTED AND PASSED)
- ✅ **P5A:** Clerk authentication foundation — verified session → local `users` row → `req.user`
- ✅ **P5B:** Organisation resolution — `req.user` → `organisation_users` → `req.organisationId` on opted-in routes
- ✅ **P5C.1:** Shared `requireAuthenticatedTenant` chain
- ✅ **P5C.2:** Apple Ads Imports use `req.organisationId` through the import pipeline
- ✅ **P5D.1:** Frontend Clerk sign-in and one authenticated API client. Brought forward after P5C.2 so Imports can send a session token. Frontend auth does not choose the organisation.
- ✅ **P5C.3:** Dashboard, campaigns, keywords, filters, and core analytics use `req.organisationId`. Frontend callers use the P5D.1 authenticated API client.
- ✅ **P5C.4:** Goals, annotations, and bid experiments use `req.organisationId`. The transitional Development Organisation resolver is removed from production routes. P5C application tenant migration is complete.
- ✅ **P6A.1:** Generic 500 responses, configurable CORS, API security headers, removal of `GET /api/auth/tenant-test`, production `FRONTEND_ORIGIN` validation, and a root `.gitignore`.
- ✅ **P6A.2:** CSV file-size cap, row cap, upload validation, and a per-user upload rate limit. Analytics day caps are not part of this phase.
- ✅ **P6A.3:** 90-day analytics window, calendar-date checks, positive resource ids, annotation and goal limits, and the existing 3/7/14/30 experiment windows. Invalid input is HTTP 400 before the analytics query.
- ✅ **P6A.4:** Hardening close-out. Compatible dependency updates, removal of unused unscoped helpers, and a production-gate review. No application-level security or tenant-isolation blocker remains.
- ✅ **P6B:** Self-service registration. A new Clerk user gets one local user, one organisation, and one owner membership. There is no email allowlist. PostgreSQL remains the tenancy source.

**Storage safety:** ✅ Two organisations can store identical Apple Ads data independently

**Query safety:** ✅ All analytics and CRUD operations scoped by `organisation_id` - cross-tenant access prevented

**IDOR Protection:** ✅ Update/delete operations verify `id + organisation_id` ownership

**Backend safety:** ✅ Tenant-safe - organisation context required for all customer-data operations

**Authentication:** ✅ P5A — Clerk session verification and local user identity on `GET /api/auth/me`. Imports, dashboard, campaigns, keywords, goals, annotations, and bid experiments require that session.

**Organisation context:** ✅ P5B, and ✅ P5C.1 as the shared `requireAuthenticatedTenant` chain. Every Apple Ads production route group uses `req.organisationId`. The only Development Organisation special case is explicit P5B bootstrap provisioning for the configured Clerk user.

**Frontend isolation:** ✅ P5D.1 — Clerk sign-in gates the application shell. The shared API client sends the Clerk session token. Organisation ownership still comes only from the backend membership.

**Required work:** P6C is the production host, Clerk production sign-up settings, and moving schema migrations and historical backfills off process startup. Organisation management and billing remain outstanding. Apple Ads route tenancy, CSV upload limits, analytics input limits, and self-service organisation provisioning are in place. P6B does not deploy the application.

**Migration approach:** Phased, sequential. P5D.1 frontend authentication was brought forward after P5C.2. P5C.3 moved dashboard, campaign, and keyword requests onto that client. P5C.4 moved goals, annotations, and bid experiments.

**Risk mitigation:** Apple Ads production routes require a Clerk session and membership organisation context. Frontend authentication identifies the user. It does not choose the organisation. There is no application fallback to the Development Organisation.

**Timeline:** P5C application tenant migration is complete.

**Readiness for external SaaS:** Apple Ads routes are tenant-scoped behind authentication. Organisation management, invitations, and billing are still outstanding.

---

**End of PRODUCTION.md**
