# P6C.3 — Production Application Preparation

**Delm8 Ads Analyser**

**Date:** 7 October 2026

**Verdict:** CODE PREPARATION PASS

**PRODUCTION SCHEMA HOLD POINT REACHED**

**PRODUCTION DATABASE REMAINS EMPTY**

Normal startup no longer migrates, backfills, or creates Development Organisation. The first schema write to `seoanalyser_production` has not been run.

No password, password hash, or unredacted database URL is recorded here.

---

## 1. Startup architecture

Three operations replace the old boot path.

| Operation | Command | What it does |
|---|---|---|
| Schema preparation | `npm run db:migrate` | Creates and upgrades tables, indexes, and constraints |
| Maintenance | `npm run db:backfill:*` and `npm run db:bootstrap-dev` | Historical rebuilds and the development tenant, only when invoked |
| Normal start | `npm start` | Checks that required tables exist, then serves the API |

`npm start` does not run `CREATE` or `ALTER`, record-key backfill, ownership backfill, daily-metric rebuild, bid-experiment rebuild, keyword-bid-history rebuild, or Development Organisation creation. If required tables are missing, the process exits with `SCHEMA_NOT_READY` and tells the operator to run `npm run db:migrate`.

In `NODE_ENV=production` the API binds `127.0.0.1`. Development keeps the previous listen behaviour.

---

## 2. What startup used to do

`node index.js` called `initDb()`, which:

- created and altered the application tables
- backfilled import record keys
- migrated daily tables, install columns, campaigns, and bid experiments
- created users, organisations, and memberships
- inserted Development Organisation when that name was missing
- copied NULL `organisation_id` values onto Development Organisation
- replaced unique constraints with tenant-scoped indexes
- created keyword bid history
- after listen, rebuilt daily metrics from every import and rebuilt bid experiments

The request path could also attach the configured Clerk user to the existing Development Organisation whenever `DEVELOPMENT_ORGANISATION_BOOTSTRAP_CLERK_USER_ID` was set, including if `NODE_ENV` were production.

---

## 3. Development Organisation rule

Both of these must be true before the bootstrap identity can join Development Organisation:

- `NODE_ENV` is not `production`
- `DEVELOPMENT_ORGANISATION_BOOTSTRAP_CLERK_USER_ID` is set

If `NODE_ENV=production`, bootstrap does not run even when the variable is present. Startup logs a warning that names the variable and does not print its value.

Creating the organisation row is only `npm run db:bootstrap-dev`. That command refuses to run when `NODE_ENV=production`, and it refuses to run when the bootstrap variable is unset. Request handling never inserts Development Organisation. A missing organisation still does not cause a replacement organisation for the bootstrap user.

---

## 4. Commands

From `backend/`:

```
npm run db:migrate
npm run db:bootstrap-dev
npm run db:backfill:ownership
npm run db:backfill:record-keys
npm run db:backfill:metrics
npm run db:backfill:bids
npm run db:backfill:bid-history
npm run db:backfill:bid-snapshot-dates
npm run db:backfill:keyword-bids
npm start
```

`db:migrate` fails closed when `DATABASE_URL` is missing. It does not create Development Organisation, test users, or imports, and it does not rebuild historical metrics.

`db:backfill:ownership` assigns existing NULL ownership to the existing Development Organisation. It refuses `NODE_ENV=production` and does not create that organisation.

---

## 5. Development workflow

The development database remains `seoanalyser` and the role remains `myappuser`.

```
cd backend
npm run db:migrate
npm start
```

Run `db:migrate` when the schema changes. The current development database already contains Development Organisation, so `db:bootstrap-dev` is not required for this database. Do not point development `DATABASE_URL` at `seoanalyser_production`.

---

## 6. Production environment

Names only. Live Clerk keys and the production hostname are later phases. Do not set `DEVELOPMENT_ORGANISATION_BOOTSTRAP_CLERK_USER_ID`.

| Name | Production |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3002` |
| `DATABASE_URL` | `postgresql://seoanalyser_prod:***@localhost:5432/seoanalyser_production` |
| `CLERK_PUBLISHABLE_KEY` | live publishable key, later |
| `CLERK_SECRET_KEY` | live secret key, later |
| `FRONTEND_ORIGIN` | production HTTPS origin, later |
| CSV limit variables | optional; defaults already match the beta limits |

The password file stays at `/home/mohamed/.local/share/seoanalyser/production-db.password`. It was not copied into Git.

The release directories were not created, because this change is not committed:

```
/var/www/seoanalyser/releases/<commit>
/var/www/seoanalyser/current
/var/www/seoanalyser/shared
```

Production must be checked out from a reviewed commit, not from this working tree.

---

## 7. Hold point

Do not run the schema command against production until this refactor is approved.

Exact command, with the password redacted. Run it from the reviewed `backend/` directory. Supply `DATABASE_URL` from the password file. Leave the bootstrap variable unset.

```
NODE_ENV=production DATABASE_URL=postgresql://seoanalyser_prod:***@localhost:5432/seoanalyser_production npm run db:migrate
```

This command was not run. `seoanalyser_production` has no application tables and no Development Organisation.

---

## 8. Verification

| Check | Result |
|---|---|
| Development schema command | PASS. Counts stayed at the P6C.2 baseline |
| Development server start | PASS. Readiness check only. No migration or backfill log |
| `NODE_ENV=production` bootstrap | PASS. Command refused. Identity value was not printed |
| Production-mode startup on a fresh database | PASS. Missing schema exits. After migrate, startup creates no organisation |
| `db:migrate` without `DATABASE_URL` | PASS. Exit 1 |
| Disposable fresh database | PASS. Required tables exist. Organisation count is 0 |
| Organisation, auth, imports, analytics, goals, annotations, bid experiments | PASS |
| Cross-tenant foreign ids | PASS. 404 |
| Development counts after the suites | Unchanged: users 2, organisations 5, memberships 2, imports 53, import rows 68445, campaigns 35, daily campaign metrics 14245, daily keyword metrics 68417, annotations 31, goals 4, bid experiments 157 |
| Production public tables | 0 |
| Disposable cluster | Removed |

The disposable database was a temporary PostgreSQL 16 cluster on `127.0.0.1:54329`, not `seoanalyser_production`.

One existing P5A assertion expected `GET /api/apps` to return 200 without a session. That route has required an authenticated organisation since the tenant migration. The assertion now expects 401. `GET /api/health` remains public.

---

P6C.3 CODE PREPARATION: PASS

PRODUCTION SCHEMA HOLD POINT REACHED

PRODUCTION DATABASE REMAINS EMPTY

AWAITING APPROVAL BEFORE FIRST PRODUCTION SCHEMA MIGRATION
