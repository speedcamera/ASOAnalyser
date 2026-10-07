# P6C.1 — Production Environment Audit & Deployment Design

**Delm8 Ads Analyser — audit only**

**Date:** 7 October 2026

**Host:** the same Ubuntu VPS that already runs development, Nginx, PostgreSQL, CRM, and n8n

**Git:** branch `main`, tracking `origin/main`, commit `3682119` (“Baseline before production deployment”). Working tree was clean. Nothing was committed or pushed for this audit.

**Verdict:** READY TO PROCEED

No packages were installed. No database was created. Nginx, the firewall, Clerk, environment files, and running services were not changed. Nothing was deployed. Secret values are not recorded in this document.

Production will initially run on this VPS and must stay logically separate from development.

---

## 1. Verdict

P6C.2 can start. There is no audit blocker.

A production hostname is not configured. That blocks public HTTPS (P6C.4). It does not block creating a separate database (P6C.2).

The current backend would create Development Organisation if it were pointed at an empty database. That behaviour must be gated before the production process starts (P6C.3). It is not a reason to stop the audit.

**PRODUCTION DOMAIN REQUIRED BEFORE P6C.4**

---

## 2. Current application architecture

The development tree is `/home/mohamed/projects/seoanalyser`.

| Path | Role |
|---|---|
| `frontend/` | Vite React application. `frontend/dist/` is an existing production build from the earlier hardening work. |
| `backend/` | Express API. Schema changes live in `backend/db.js` and run from `initDb()`. There is no separate migrations directory. |
| `docs/` | Living production plan, including `PRODUCTION.md`. |
| Repository root | Phase notes and one-off test scripts. |

There are no upload or storage directories, and no deployment unit files in the repository.

- Backend start script: `node index.js`
- Frontend scripts: `vite`, `vite build`, `vite preview`

---

## 3. Current runtime

Neither the frontend nor the backend is listening. Nothing is supervising them.

`NODE_ENV` is not set in the backend environment file, so a start today would use development CORS behaviour. The backend listens on `PORT`, or 3001 when that variable is unset. The frontend development server is Vite, previously port 5173, with `/api` proxied to `http://localhost:3001`. Those processes were started by hand, owned by the development user, and were not running at audit time.

Nginx and PostgreSQL 16 are systemd services. PM2 is installed and has no applications. Docker publishes the CRM and n8n ports. Those services were left running.

---

## 4. Database architecture

PostgreSQL 16.15 is the local cluster.

| Item | Value |
|---|---|
| Database | `seoanalyser` |
| Role | `myappuser` |
| Host | `localhost` |
| Port | `5432` |
| `listen_addresses` | `localhost` |
| Extensions | `plpgsql` only |

Tables: `users`, `organisations`, `organisation_users`, `imports`, `import_rows`, `campaigns`, `keywords`, `daily_campaign_metrics`, `daily_keyword_metrics`, `keyword_bid_history`, `annotations`, `performance_goals`, `bid_experiments`, `application_settings`, plus leftover `keyword_metrics_old`.

Every backend start runs `initDb()`: create and alter tables, backfill record keys, then daily-metric, campaign, bid-experiment, ownership, unique-constraint, and keyword-bid migrations. After listen, it rebuilds daily metrics and bid experiments. It also creates Development Organisation when that row is missing, and copies NULL ownership onto it.

A separate production database needs a new database name and a new role on this same cluster, with connect and schema rights only on that database. Do not reuse `seoanalyser` or `myappuser`. Do not run the current `initDb()` against the new database until the Development Organisation seed is gated.

Recommended names, not created:

- Database: `seoanalyser_production`
- Role: `seoanalyser_prod`

---

## 5. Startup-task classification

### Safe for production startup

- Clerk, CORS, and CSV configuration checks
- Helmet, CORS, Clerk middleware, and the health route
- Logging whether the bootstrap identity is configured
- HTTP listen

### Deployment-time only

- All `CREATE` and `ALTER` work inside `initDb()`
- Record-key backfill
- NULL ownership backfill
- Unique-constraint and keyword-bid-history migrations
- Post-listen rebuild of daily metrics from import rows
- Post-listen bid-experiment backfill
- Standalone scripts `backfill-bid-history.js`, `backfill-bid-snapshot-dates.js`, and `backfill-keyword-bids.js` are not started by the server

### Development only

- Creating Development Organisation when it is missing
- Attaching the configured bootstrap Clerk user to that organisation
- Test scripts and test tenants

A fresh production boot of the current code would create Development Organisation. Production must not create development or test tenants. Gate that path before the production process starts.

---

## 6. Environment variable inventory

The current environment files can point a second process at another database, port, and Clerk application without a code change. `NODE_ENV` and `FRONTEND_ORIGIN` are absent today. Values are omitted.

| Name | Where | Class |
|---|---|---|
| `DATABASE_URL` | Backend | Security critical, production required |
| `CLERK_SECRET_KEY` | Backend | Security critical, production required |
| `CLERK_PUBLISHABLE_KEY` | Backend | Security critical, production required |
| `VITE_CLERK_PUBLISHABLE_KEY` | Frontend build | Security critical, production required |
| `FRONTEND_ORIGIN` | Backend | Production required |
| `NODE_ENV` | Backend | Production required (`production`) |
| `PORT` | Backend | Production required |
| `DEVELOPMENT_ORGANISATION_BOOTSTRAP_CLERK_USER_ID` | Backend | Development only. It is set now. Leave it unset in production. |
| `MAX_CSV_FILE_SIZE_MB` | Backend | Optional. Default already matches the beta limit. |
| `MAX_CSV_ROWS` | Backend | Optional. Default already matches the beta limit. |
| `MAX_CSV_UPLOADS_PER_WINDOW` | Backend | Optional. Default already matches the beta limit. |
| `MAX_CSV_UPLOAD_WINDOW_MINUTES` | Backend | Optional. Default already matches the beta limit. |

Code supports a separate production configuration through environment variables. Startup still seeds Development Organisation and runs migrations and backfills on boot. That behaviour has to change before the production process starts. It is a P6C.3 change, not a configuration-only switch.

---

## 7. Clerk configuration

| Variable | Process |
|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | Frontend, inlined at build time |
| `CLERK_PUBLISHABLE_KEY` | Backend |
| `CLERK_SECRET_KEY` | Backend, server only |

All three current values use the test prefix. PostgreSQL remains the tenancy source of truth. Clerk Organisations are not the tenant model.

To use live configuration later:

- Create or select the Clerk production instance
- Use a live publishable key and a live secret key
- Rebuild the frontend so the live publishable key is inlined
- Set `FRONTEND_ORIGIN` to the HTTPS origin
- Allow that origin and the redirect URLs in Clerk
- Leave sign-up enabled and the email allowlist off
- Do not enable Clerk Organisations as tenancy
- Leave `DEVELOPMENT_ORGANISATION_BOOTSTRAP_CLERK_USER_ID` unset in production

Clerk was not changed.

---

## 8. Frontend production-build readiness

`npm run build` writes `frontend/dist`.

- API calls are relative `/api`. There is no `VITE_API_URL`.
- The Vite proxy to `localhost:3001` exists only in the development server block. Application source does not hard-code that URL.
- The publishable key is the only frontend environment input.
- Nginx can serve `dist` as static files and proxy `/api` to the production backend.
- A same-origin setup needs no frontend code change.

This audit did not rebuild the frontend.

---

## 9. Backend production runtime

Run a checkout of a known Git commit. Do not run production from the actively edited development tree.

| Choice | Recommendation |
|---|---|
| Directory | `/var/www/seoanalyser/current` |
| Port | `127.0.0.1:3002` |
| Supervisor | systemd |

systemd matches Nginx and PostgreSQL on this host. PM2 is installed and unused. Docker is how CRM and n8n run. The closer existing pattern is Nginx serving a static `dist` and proxying `/api` to a localhost Node port, which is what the aircraft-components site does.

Do not install or configure the unit yet.

---

## 10. Existing web server

Nginx 1.24 is the reverse proxy. Apache is not in use. Certbot manages TLS for named sites.

Existing sites, left unchanged:

| Site | Behaviour |
|---|---|
| `176.58.117.9` | Serves `/var/www/aircraft-components/app/frontend/dist` and proxies `/api/` to `127.0.0.1:5190` |
| `crm.beiyadawa.com` | Proxies to port 8081 |
| `n8n.beiyadawa.com` | Proxies to port 5678 |

Add production as a new site file. Do not edit those three.

---

## 11. Network and firewall

`ufw` could not be read without extra privileges. Bind addresses show what is reachable. The firewall was not changed.

| Port | Exposure | Owner |
|---|---|---|
| 22 | Public | SSH |
| 80, 443 | Public | Nginx |
| 5678 | Public | n8n via Docker |
| 8081 | Public | CRM via Docker |
| 5432 | Localhost only | PostgreSQL 16 |

Development ports 3001 and 5173 were not listening. PostgreSQL is not externally exposed.

The production API should bind `127.0.0.1:3002` and stay off the public interface. PostgreSQL should stay on localhost.

---

## 12. Storage

CSV uploads use Multer memory storage and are parsed into PostgreSQL. They are not written to a durable upload directory. Production does not need a separate CSV disk. The persistent application data is the production database. The frontend build is replaceable files under the release directory.

---

## 13. VPS resource assessment

**SUITABLE FOR INITIAL BETA**

| Resource | At audit time |
|---|---|
| CPU | 2 |
| RAM | 3.8 GB total, about 2.5 GB available |
| Swap | 2.5 GB |
| Disk | 79 GB, 42 GB free |

Production should stay small and on localhost so it does not compete with Nginx, PostgreSQL, CRM, and n8n. The server was not tuned.

---

## 14. Proposed production directory

```
/home/mohamed/projects/seoanalyser          development working tree
/var/www/seoanalyser/releases/<commit>      one Git commit
/var/www/seoanalyser/current                symlink to that release
/var/www/seoanalyser/shared                 production env file, not in Git
```

Deploy from commit `3682119` or a later reviewed commit. Do not run production from the development working tree. This layout was not created.

---

## 15. Proposed production architecture

```
Internet
   |
 HTTPS :443
   |
 Nginx (new site file only)
   |
   +--> production frontend
   |      /var/www/seoanalyser/current/frontend/dist
   |
   +--> production backend
          127.0.0.1:3002   systemd
              |
              +--> production PostgreSQL
                     localhost:5432
                     database seoanalyser_production
```

Development stays separate:

| Piece | Development | Production |
|---|---|---|
| Tree | `/home/mohamed/projects/seoanalyser` | `/var/www/seoanalyser/current` |
| Frontend | Vite port 5173, when started by hand | Static files behind Nginx |
| API | port 3001, when started by hand | `127.0.0.1:3002` |
| Database | `seoanalyser` | `seoanalyser_production` |
| DB role | `myappuser` | `seoanalyser_prod` |

---

## 16. Domain requirement

**PRODUCTION DOMAIN REQUIRED BEFORE P6C.4**

No production hostname is configured. `FRONTEND_ORIGIN` is unset. The VPS address is already used by another site. `beiyadawa.com` is used by CRM and n8n. No SEO Analyser hostname was assumed or invented.

---

## 17. Backup status and recommendation

No PostgreSQL backup job or backup directory was found for this application. User crontab, a Postgres backup timer, and an application backup directory were absent. `/var/backups` holds package-manager files, not database dumps.

Before real customer data is treated as durable:

- Take a daily `pg_dump` of the production database only
- Keep 7 daily copies and 4 weekly copies
- Store at least one copy off this disk
- Restore once before calling the backup done

Implementation is later. Nothing was created.

---

## 18. Blockers and prerequisites

### Blockers

None for starting P6C.2.

### Required before deployment

- A production hostname before Nginx and TLS
- A separate database and role
- A release directory and a systemd unit on `127.0.0.1:3002`
- Gating Development Organisation creation, and moving schema work and historical backfills off process start
- Live Clerk keys, a frontend rebuild, and `FRONTEND_ORIGIN` set to the production origin
- The bootstrap Clerk id left unset in production
- A backup job before customer data is treated as durable

### Safe to defer

- `csv-parse` major upgrade
- Organisation editing, invitations, and billing
- PM2
- Any change to CRM, n8n, the aircraft site, or the firewall

Do not disrupt the aircraft-components site, `crm.beiyadawa.com`, `n8n.beiyadawa.com`, the Docker published ports, or the PostgreSQL listen address.

---

## 19. Git check

| Check | Result |
|---|---|
| Branch | `main` |
| Tracking | `origin/main` |
| HEAD | `3682119` Baseline before production deployment |
| Working tree at audit start | Clean |

This document is the audit record. It was not committed automatically.

---

## 20. Recommended sequence

**P6C.2.** Create the empty production database and role on the existing local cluster. Do not start the app against it, and do not run the current startup seed.

**P6C.3.** Check out a known commit under `/var/www/seoanalyser`, add the production environment file, gate development seeding, run schema setup once, and add systemd on `127.0.0.1:3002`.

**P6C.4.** After the hostname exists, add one Nginx site and TLS. Serve `frontend/dist` and proxy `/api` to port 3002. Leave the other sites alone.

**P6C.5.** Switch the production process and the frontend build to Clerk live keys. Allow the production origin. Leave sign-up open. Leave the bootstrap id unset.

**P6C.6.** Smoke-test health, registration, an empty organisation, and tenant isolation. Confirm the development database is untouched. Add the production backup.

---

P6C.1 AUDIT RESULT: READY TO PROCEED
