# P5 Production Readiness Review

**Delm8 Ads Analyser — audit only**

**Date:** 4 October 2026

**Scope:** Integrated system after P5A, P5B, P5C.1, P5C.2, P5D.1, P5C.3, and P5C.4. No code was changed for this review.

**Verdict:** READY AFTER IDENTIFIED BLOCKERS

Two unrelated organisations can be isolated. The current developer process is not an external beta host.

---

## 1. Verdict

Company A and Company B can each sign in, receive a separate organisation, upload an Apple Ads CSV, and use analytics. Existing P5C tests and the user 73 / user 33 browser checks support that they cannot see, change, or aggregate each other's data, and that identical CSV keys stay inside each organisation.

That evidence does not make this workstation a beta environment. Before the first external customer:

- stand up a separate host, live Clerk instance, and production database
- restrict sign-in to invited people
- cap CSV ingestion and hide internal errors

Repeat the two-organisation check on that production database after those blockers.

There is no critical tenant-isolation defect in the application code.

---

## 2. Findings

| Area | Finding | Severity | Beta blocker? | Recommended action |
|---|---|---|---|---|
| Tenant isolation | Apple Ads routes take organisation id only from the authenticated membership. Foreign goals, annotations, imports, campaigns, and experiments return 404. Identical business keys stay separate. | OK | No | Keep this chain. Do not add a client-supplied organisation id. |
| Authentication | Clerk verifies the session before route handlers. Missing and invalid tokens return 401. The frontend sends a bearer token and does not store it. The secret key is not in frontend code. | OK | No | Use a live Clerk instance for external customers. Keep `sk_test_` off that host. |
| Deployment runtime | The running system is a developer process: Vite on 5173, `node index.js` on 3001, HTTP, test Clerk keys, `NODE_ENV` unset, and the same database as Development Organisation. | CRITICAL | Yes | Do not point external customers at this process. Stand up HTTPS, live Clerk keys, and a separate database. |
| Provisioning | The first successful sign-in creates a local user and an owner organisation, except the configured bootstrap Clerk id, which joins Development Organisation. Sign-up is not restricted in application code. | HIGH | Yes | Invite-only or an allowlist before the first external account. Leave the bootstrap id set only to the developer. |
| CSV upload | Uploads allow a 50 MB `.csv` in memory, with no row cap and no rate limit. Each row is written inside one transaction. `npm audit` reports a high Multer denial-of-service advisory. | HIGH | Yes | Cap rows, limit upload rate, and review the Multer advisory before a customer can upload. |
| Error disclosure | Many handlers return `err.message`. Multer failures are not mapped to a 400. With `NODE_ENV` unset, Express can include a stack for errors passed to the default handler. | HIGH | Yes | Return a generic 500. Set `NODE_ENV=production`. Map upload failures to 400. |
| Roles | `owner`, `admin`, and `analyst` are stored and validated, then ignored. Every member can upload, edit segments, and delete goals and notes. | MEDIUM | No | Beta policy: one owner per organisation. Do not create analyst or admin memberships until RBAC exists. |
| Abuse controls | No rate limit on sign-in traffic, CSV upload, period comparison, or mutations. `days` is not capped, so a large window can scan a tenant's metrics. | MEDIUM | Yes | Add a small upload limit and an analytics days cap before the shared database is exposed. |
| CORS and headers | `cors()` allows every origin. There is no helmet, no HTTPS terminator, and `trust proxy` is left at the Express default of false. | MEDIUM | No | Allow only the beta origin. Terminate TLS in the proxy. Do not enable `trust proxy` until that proxy is fixed. |
| Startup work | Every boot runs schema migration and a full import backfill in the request process. A restart can hold the database while customers are using it. | MEDIUM | No | Run migrations as a separate step. Do not backfill all imports on each process start. |
| Secrets handling | `DATABASE_URL` and `CLERK_SECRET_KEY` are required at startup and are not returned by routes. There is no git repository and no root `.gitignore`. `frontend/.gitignore` ignores `.env`. `backend/.env` is only protected by not being committed yet. | MEDIUM | Yes | Add a root `.gitignore` before any remote. Never commit `backend/.env`. |
| Dependencies | Backend audit: Multer high, `csv-parse` moderate, `qs` moderate. Frontend audit: React Router high denial-of-service and moderate open-redirect advisories. Vite high findings are development and Windows path issues. | MEDIUM | No | Review advisories. Do not upgrade blindly. |
| Input validation | Goals and annotations check enums. Dates are checked when both ends are present. Import ids, note length, and comparison days are loosely accepted. NaN campaign ids are rejected. | MEDIUM | No | Cap note text and days. Reject non-numeric import ids with 400. |
| Logging | Authentication failures log a code, not the bearer token. Import and analytics handlers log the full error object, which can include driver detail. | LOW | No | Log organisation id, route, and error code. Do not log tokens, CSV bodies, or raw driver errors. |
| Debug route | `GET /api/auth/tenant-test` is mounted in the production router. It requires a session and returns only that caller's user id and organisation id. | LOW | No | Remove it before production. `GET /api/auth/context` already covers the legitimate need. |
| Unused query | `getBidChanges` reads `daily_keyword_metrics` without `organisation_id`. No route calls it. | LOW | No | Leave it unwired. Scope it or delete it before any future caller. |
| Session expiry UX | A 401 becomes "Sign in required" inside the signed-in shell. Clerk normally refreshes the token. A dead session does not itself sign the user out. | LOW | No | On 401, clear the shell and show the Clerk sign-in screen. |
| Database tenancy | Customer tables have `organisation_id NOT NULL`, a foreign key, an organisation index, and tenant-leading unique constraints. `organisation_users` cascades from users and organisations. Customer data does not cascade on organisation delete. | OK | No | Keep `organisation_id` as the first filter. No schema change is required for a two-customer beta. |

---

## 3. Critical beta blockers

There is no critical cross-tenant leak in the route and query design.

The critical gate is the runtime. External customers must not use this developer process: Vite, a manually started Node server, HTTP, test Clerk keys, unset `NODE_ENV`, and the database that already holds Development Organisation.

---

## 4. High-priority fixes before beta

- Restrict sign-in to invited people. The first successful Clerk sign-in creates a local user and an owner organisation. Only `DEVELOPMENT_ORGANISATION_BOOTSTRAP_CLERK_USER_ID` joins the existing Development Organisation.
- Cap CSV size in rows, not only the existing 50 MB file limit, and rate-limit uploads. Each row is written inside one transaction. `npm audit` reports a high Multer denial-of-service advisory.
- Stop returning `err.message` from server failures. Map Multer failures to 400. Set `NODE_ENV=production`.
- Add a root `.gitignore` before this project is shared. `backend/.env` holds `DATABASE_URL` and `CLERK_SECRET_KEY`. `frontend/.gitignore` already ignores `.env`. There is no git repository yet, so those files are not committed.

---

## 5. Improvements that can wait

- Roles are stored and not enforced. For this beta, allow one owner per organisation and do not create other memberships.
- Restrict CORS to the beta origin. Add security headers and HTTPS at the proxy. Leave `trust proxy` off until that proxy is fixed.
- Cap comparison `days`, note length, and non-numeric import ids.
- Move schema migration and the full import backfill out of process startup.
- Review dependency advisories later. No packages were upgraded in this audit.
- On 401, return the user to the Clerk sign-in screen.

---

## 6. Existing controls that are already strong

Clerk verifies the session before handlers. Missing and invalid tokens return 401. The frontend has one API client, sends the bearer token, strips organisation id from the query and headers, and does not store the token. `CLERK_SECRET_KEY` is not in frontend code.

`req.organisationId` comes from `organisation_users`. Multiple memberships fail closed. Resolution does not fall back to Development Organisation. The bootstrap identity is the only production special case.

Imports, dashboard, campaigns, keywords, goals, annotations, and bid experiments are on that chain. Foreign resources return 404. Identical campaign and keyword identities do not merge. Switching Clerk users remounts application state.

Customer tables have `organisation_id NOT NULL`, a foreign key, an organisation index, and tenant-scoped unique constraints.

---

## 7. Route inventory

| Route | Classification | Note |
|---|---|---|
| `GET /api/health` | Public intentionally | Liveness only. No tenant data. |
| `GET /api/auth/me` | Authenticated user | Local profile. Does not resolve an organisation. |
| `GET /api/auth/context` | Authenticated tenant | Own user and organisation, including role. |
| `GET /api/auth/tenant-test` | Internal test, still mounted | Own user id and organisation id. Remove before production. |
| `POST /api/imports` | Authenticated tenant | CSV upload. Mutating. |
| `GET /api/imports` and import detail routes | Authenticated tenant | List, rows, summaries, profile. |
| `GET /api/compare` | Authenticated tenant | Import-to-import comparison. |
| `GET /api/apps`, `GET /api/alerts`, `GET /api/insights` | Authenticated tenant | Dashboard metadata and insights. |
| `GET /api/compare/period` | Authenticated tenant | Dashboard, campaigns, and keywords. |
| `GET /api/campaigns/weekly-performance` | Authenticated tenant | Weekly comparison. |
| `PATCH /api/campaigns/:id` | Authenticated tenant | Segment update. Foreign id is 404. |
| `GET/POST/PUT/DELETE /api/goals` | Authenticated tenant | Foreign id is 404. |
| `GET/POST/PUT/DELETE /api/annotations` | Authenticated tenant | Foreign id is 404. |
| `GET /api/bid-experiments` and `GET /api/bid-experiments/:id` | Authenticated tenant | History and detail. Foreign id is 404. |
| `GET/PATCH /api/bid-experiment-settings` | Authenticated tenant | Per-organisation observation default. |

No customer mutation is public.

---

## 8. Authentication

- Backend: `@clerk/express` `clerkMiddleware()`, then `getAuth({ acceptsToken: 'session_token' })`, then local user resolution, then organisation resolution on tenant routes.
- Frontend: `ClerkProvider` and `SignIn`. The shell mounts only after a signed-in session. `frontend/src/auth/apiClient.js` attaches `Authorization: Bearer` from `getToken()` and does not persist the token.
- `GET /api/auth/me` returns the local profile and does not create an organisation.
- `GET /api/auth/context` returns the local user and the resolved organisation.
- Invalid and missing sessions return `401` with `{ "error": "Unauthorized" }`.
- Startup refuses to boot when `CLERK_PUBLISHABLE_KEY` or `CLERK_SECRET_KEY` is missing or not Clerk key material.
- One API client. No second auth mechanism. No debug sign-in page remains in the frontend.

---

## 9. Tenant isolation

Canonical path:

```
Clerk session
  -> authenticated API client
  -> backend Clerk authentication
  -> local user
  -> organisation membership
  -> req.organisationId
  -> organisation-scoped service
```

Production routes do not read organisation id from the query, body, header, route parameter, app id, campaign, keyword, or experiment id.

The only Development Organisation special case is P5B bootstrap: `DEVELOPMENT_ORGANISATION_BOOTSTRAP_CLERK_USER_ID`, when that user has no membership, joins the existing Development Organisation. Other users receive a new empty organisation. `getTransitionalOrganisationId()` is not in backend application code.

`getBidChanges` in `backend/analyticsService.js` still queries `daily_keyword_metrics` without `organisation_id`. It has no HTTP caller. It must stay unwired until it is scoped.

---

## 10. Roles and provisioning

`organisation_users.role` allows `owner`, `admin`, and `analyst`. Resolution checks that the stored role is one of those values. No route checks the role before a read or a write.

Minimum beta policy: one owner per organisation. Do not insert `admin` or `analyst` rows, and do not send invitations, until a later role phase.

First login inserts the local user on `(auth_provider, auth_provider_user_id)` with `ON CONFLICT DO NOTHING`. Organisation provisioning runs in a transaction that locks the user row. A second concurrent first request sees the membership the first request committed. More than one membership fails closed with `500` and `{ "error": "Organisation could not be resolved" }`. The response does not list the foreign organisations.

---

## 11. Frontend states

- Loading and Clerk failure have their own screens.
- Signed-out users see Clerk sign-in. The analytics shell is not mounted.
- Signed-in users remount `AppProvider` on the Clerk user id, so a user switch drops the previous organisation's component state.
- Empty organisations show empty states: no apps beyond All Apps, no campaigns, zero keywords, no imports.
- API 401 surfaces as "Sign in required". API 404 surfaces as "Not found". API 500 surfaces as "The server could not complete this request". Validation 400 can show the server's error string.
- A 401 does not by itself return the UI to the sign-in screen.

---

## 12. CSV upload

`POST /api/imports` accepts one file, extension `.csv`, up to 50 MB, stored in memory. The parser uses `csv-parse` with `columns: true`. There is no row cap, no content-type check beyond the filename, and no rate limit.

`createImport` writes the import and its rows in one transaction, scoped by `req.organisationId`, with conflict handling on `(organisation_id, record_key)`. Daily metrics for that import run on the same transaction. Bid observations and experiment detection run after commit, still with that organisation id. A failure there is logged and does not roll back the import.

A large file can hold a long transaction and the Node process memory. That is an availability risk on a shared database. The filename is stored as metadata and is not used as a filesystem path.

---

## 13. Database

Tenant tables covered: `imports`, `import_rows`, `campaigns`, `daily_campaign_metrics`, `daily_keyword_metrics`, `annotations`, `performance_goals`, `bid_experiments`, `keyword_bid_history`.

Each has `organisation_id` indexed. Unique constraints that define a business identity lead with `organisation_id`. Foreign keys reference `organisations(id)` without cascading customer-data deletes. `organisation_users` uses `ON DELETE CASCADE` from both `organisations` and `users`.

`application_settings` has no organisation column. The bid-experiment default is stored under a key that includes the organisation id. Request handlers do not read the global seed row.

Connection pooling is a single `pg` `Pool` from `DATABASE_URL`. The pool has no explicit max, idle timeout, or statement timeout.

---

## 14. Errors, secrets, CORS, logging

| Topic | Status |
|---|---|
| 401 | Missing or invalid session. Body is `{ "error": "Unauthorized" }`. |
| 404 | Foreign or missing tenant resource. Body does not describe another organisation. |
| 400 | Invalid request on several analytics and feature paths. Some 500 paths also return the raw driver or exception message. |
| 500 | Organisation resolution failure is generic. Import, analytics, and feature catch blocks often return `err.message`. |
| Secrets | `CLERK_SECRET_KEY` and `DATABASE_URL` stay in `backend/.env`. Frontend env example contains only `VITE_CLERK_PUBLISHABLE_KEY`. Routes do not print secret values. |
| CORS | `app.use(cors())` reflects any origin. Bearer tokens are not cookies, so a random site still cannot read the Clerk token. Restrict the origin before production anyway. |
| Headers | No security headers. No HTTPS in the current process. |
| Rate limits | None. |
| Logs | Auth logs an error code. Organisation resolution logs the local user id and a failure code. Import handlers log the full error. Tokens were not found in application logs. |

---

## 15. Test and debug artefacts

Safe to keep as files, because they are not served:

- `backend/test-*.js`
- `test-bid-history.js`
- dummy `sk_test_` strings inside those tests

Remove from the production router before go-live:

- `GET /api/auth/tenant-test`

Do not call until scoped:

- `getBidChanges`

---

## 16. Dependencies

Local `npm audit` on 4 October 2026. No packages were upgraded.

Backend production tree: 1 high (Multer denial of service), 2 moderate (`csv-parse` prototype pollution via the columns path, `qs` array-limit and `isBuffer` issues), 1 low.

Frontend tree: high findings in `brace-expansion`, `browserslist`, `nanoid`, `postcss`, `react-router` (route-matching denial of service), and `vite` (Windows `server.fs.deny` bypass). React Router also has moderate open-redirect and XSS advisories. Vite findings apply to the development server.

---

## 17. Deployment still required

- Production frontend build, not the Vite dev server.
- A supervised Node process with restart policy.
- `NODE_ENV=production`.
- Live Clerk keys and an invite-only or allowlisted instance.
- HTTPS in front of the app.
- A database that is not the developer database, plus backups.
- Migrations run as their own step, not as part of every server boot.
- The Vite proxy to `http://localhost:3001` stays a development setting.

---

## 18. Two-customer acceptance

| Check | Evidence |
|---|---|
| Separate organisations | User 73 resolves organisation 1. User 33 resolves organisation 14. A new Clerk user with no membership receives a new empty organisation. |
| Upload isolation | P5C.2: the same CSV can exist in both organisations. A foreign import is 404. |
| Analytics isolation | P5C.3 and the browser checks: organisation 1 dashboard spend stayed on organisation 1. Organisation 14 showed £0.00, no campaigns, and no keywords. |
| Goals, notes, experiments | P5C.4: foreign ids return 404. Identical keyword identity did not mix observation spend. |
| Spoofing | Query, body, and `x-organisation-id` do not change `req.organisationId`. |
| User switch | Signing out and signing in as the other user remounts the shell. Organisation 1 data did not remain on screen for organisation 14, and the reverse restored organisation 1. |

---

## 19. Recommended corrective phases

These phases were not started.

1. Production host: live Clerk, invite-only, separate database, HTTPS, `NODE_ENV=production`, root `.gitignore`.
2. Upload safety: row cap, rate limit, Multer advisory review, generic upload errors.
3. Response hygiene: generic 500s, remove `/api/auth/tenant-test`, cap analytics windows.
4. After beta: role enforcement, invitations, boot-time backfill removed from the server process, and dependency upgrades chosen from the audit above.

---

**End of P5 production readiness review.**
