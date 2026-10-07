# P6C.2 — Production Database Foundation

**Delm8 Ads Analyser**

**Date:** 7 October 2026

**Host:** the same Ubuntu VPS audited in P6C.1

**Verdict:** PASS

The empty production database and login role exist. They are separate from development. The application was not started against production. No schema, migration, or backfill was run. No Development Organisation was created. No development data was copied.

The password is not recorded in this document.

---

## 1. Result

| Item | Value |
|---|---|
| Production database | `seoanalyser_production` |
| Production role | `seoanalyser_prod` |
| Owner | `seoanalyser_prod` |
| Encoding | UTF8 |
| Collate / ctype | `en_US.UTF-8` / `en_US.UTF-8` |
| PostgreSQL | 16.15, `localhost:5432` only |
| Password file | `/home/mohamed/.local/share/seoanalyser/production-db.password` |
| Password file owner / mode | `mohamed`, mode `600` |
| Connection URL | `postgresql://seoanalyser_prod:***@localhost:5432/seoanalyser_production` |

**NO DEVELOPMENT DATA COPIED**

**NO APPLICATION SCHEMA RUN YET**

**NO DEVELOPMENT ORGANISATION CREATED**

**APPLICATION HAS NOT BEEN STARTED AGAINST PRODUCTION**

---

## 2. How it was created

The first attempt from the agent session could not run `sudo`, so nothing was created then. The corrected script was then run manually and printed `CREATED`.

That script did **not** run:

```sql
REVOKE CONNECT ON DATABASE seoanalyser FROM PUBLIC;
```

The development database ACL is unchanged.

The new database was created from `template0`, not from `seoanalyser`.

---

## 3. Production role

`seoanalyser_prod` attributes, from `pg_roles`. The password hash was not read.

| Attribute | Value |
|---|---|
| LOGIN | true |
| SUPERUSER | false |
| CREATEDB | false |
| CREATEROLE | false |
| REPLICATION | false |
| BYPASSRLS | false |

---

## 4. Production database

`seoanalyser_production` is a different database from `seoanalyser`.

| Database | Owner | Encoding |
|---|---|---|
| `seoanalyser` | `myappuser` | UTF8 |
| `seoanalyser_production` | `seoanalyser_prod` | UTF8 |

Production database ACL grants `CREATE`, `TEMP`, and `CONNECT` to `seoanalyser_prod` only. `PUBLIC` has no grant on that database.

The only extension is `plpgsql`.

---

## 5. Connectivity

A connection to `127.0.0.1:5432` as `seoanalyser_prod`, using the password file and not printing it, returned:

| Column | Value |
|---|---|
| `current_database()` | `seoanalyser_production` |
| `current_user` | `seoanalyser_prod` |

---

## 6. Empty database

There are no non-system tables. These application relations are absent:

`users`, `organisations`, `organisation_users`, `imports`, `import_rows`, `campaigns`, `keywords`, `daily_campaign_metrics`, `daily_keyword_metrics`, `keyword_bid_history`, `annotations`, `performance_goals`, `bid_experiments`, `application_settings`.

Development Organisation does not exist, because `organisations` does not exist. No application migration has been run.

---

## 7. Schema privileges for P6C.3

In `seoanalyser_production`, schema `public` is owned by `seoanalyser_prod`.

| Privilege | Result |
|---|---|
| USAGE | yes |
| CREATE | yes |
| `PUBLIC` grant | none |

P6C.3 can create the application tables in this schema. No probe table was created during this check.

---

## 8. Development safety

Connected to `seoanalyser` as `myappuser`. Counts match the pre-change baseline.

| Table | Before | After |
|---|---|---|
| `users` | 2 | 2 |
| `organisations` | 5 | 5 |
| `organisation_users` | 2 | 2 |
| `imports` | 53 | 53 |
| `import_rows` | 68445 | 68445 |
| `campaigns` | 35 | 35 |
| `keywords` | 0 | 0 |
| `daily_campaign_metrics` | 14245 | 14245 |
| `daily_keyword_metrics` | 68417 | 68417 |
| `annotations` | 31 | 31 |
| `performance_goals` | 4 | 4 |
| `bid_experiments` | 157 | 157 |

The application tables are still present, including `keyword_metrics_old`.

Development database ACL, unchanged:

- Database: `{=Tc/myappuser,myappuser=CTc/myappuser}`
- Schema `public`: owner `myappuser`, `{myappuser=UC/myappuser,=U/myappuser}`

`PUBLIC` still has `CONNECT` and `TEMP` on `seoanalyser`, and `USAGE` on its `public` schema. That matches the baseline from before creation.

---

## 9. Network and backups

`listen_addresses` is `localhost`. Port `5432` accepts connections on `127.0.0.1` and `[::1]` only. The firewall was not changed.

`pg_dump` is PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1). No backup job was created. The database is empty.

---

## 10. Verification table

| Test | Result |
|---|---|
| A. PostgreSQL healthy | PASS |
| B. Development database exists | PASS |
| C. Production database exists | PASS |
| D. Production role exists | PASS |
| E. Production role is not superuser | PASS |
| F. Production role has no `CREATEDB` | PASS |
| G. Production role has no `CREATEROLE` | PASS |
| H. Production role connects to production database | PASS |
| I. `current_database()` = `seoanalyser_production` | PASS |
| J. `current_user` = `seoanalyser_prod` | PASS |
| K. Production database contains no application tables | PASS |
| L. Production contains no Development Organisation | PASS |
| M. Development application tables remain intact | PASS |
| N. Development data counts unchanged | PASS |
| O. PostgreSQL remains localhost-only | PASS |
| P. No firewall exposure added | PASS |
| Q. `pg_dump` available | PASS |
| R. Password file owner/mode correct | PASS |
| S. Production schema privileges appropriate | PASS |

---

P6C.2 PRODUCTION DATABASE VERIFICATION: PASS

READY FOR P6C.3 — PRODUCTION APPLICATION PREPARATION
