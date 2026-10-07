# P6C.3a — csv-parse Security Upgrade

**Delm8 Ads Analyser**

**Date:** 7 October 2026

**Base:** P6C.3 committed as `e1fd43e`

**Verdict:** PASS

The production dependency `csv-parse` was upgraded from 5.6.0 to 7.0.3 to clear advisory GHSA-8cw4-87c7-c6xx. The importer source was not changed. Nothing was committed, pushed, or deployed. The production release, production database, Clerk, Nginx, and systemd were not modified.

---

## 1. Advisory

| Item | Value |
|---|---|
| Package | `csv-parse` |
| Previous dependency | `^5.6.0` |
| Installed before | 5.6.0 |
| Severity | moderate |
| Advisory | GHSA-8cw4-87c7-c6xx |
| Required fix | `csv-parse` >= 7.0.2 |
| Installed after | 7.0.3 |
| Dependency range after | `^7.0.3` |

`npm audit fix --force` was not used. No other dependency was upgraded.

---

## 2. How the parser is used

The only application import is in `backend/imports.js`:

```js
const { parse } = require('csv-parse/sync')
```

`parseCsv()` calls it with:

| Option | Value | Behaviour kept |
|---|---|---|
| `columns` | `true` | First row becomes the field names |
| `skip_empty_lines` | `true` | Blank lines are ignored |
| `trim` | `true` | Surrounding whitespace is removed |
| `to` | `maxRows + 1` | Parsing stops once the row cap can be detected |

The delimiter is the library default, a comma. A parse error whose name is `CsvError`, or whose code starts with `CSV_`, is returned to the caller. Other parse failures become HTTP 400, `The CSV file could not be parsed`. More rows than the cap become HTTP 413, `ROW_LIMIT`. Headers must include a date column and a campaign column. Upload size limits, row limits, tenant ownership, and Apple Ads field mapping stay in the existing import code.

Version 7 still publishes a CommonJS `require` entry for `csv-parse/sync`. Those four options still produce the same records, so `backend/imports.js` did not need a change.

---

## 3. Files changed

| File | Change |
|---|---|
| `backend/package.json` | `csv-parse` range `^5.6.0` to `^7.0.3` |
| `backend/package-lock.json` | Resolved package 5.6.0 to 7.0.3 |
| `backend/test-csv-upload-protection.js` | One parser check: a `__proto__` column does not change `Object.prototype` |

`backend/imports.js` was not modified.

---

## 4. Tests

| Suite | Result |
|---|---|
| `npm run test:csv-upload` | PASS |
| `npm run test:imports` | PASS |

Covered by those suites:

- A valid Apple Search Ads CSV imports.
- `Keyword Max Bid` and `Keyword Max CPT Bid` both import.
- A malformed CSV returns 400 and leaves no residue.
- The 16 MB file cap and the row cap still return 413.
- Uploading the same CSV again stays inside the same organisation.
- Organisation 1 and organisation 14 do not see each other's imports.
- A column named `__proto__` remains an own key. `Object.prototype` is unchanged.

---

## 5. Audit

`npm audit --omit=dev` in `backend/` reported **found 0 vulnerabilities**. The `csv-parse` advisory is no longer reported.

---

## 6. Development data

Counts after the tests match the counts from before the tests:

| Table | Rows |
|---|---|
| `users` | 2 |
| `organisations` | 5 |
| `organisation_users` | 2 |
| `imports` | 53 |
| `import_rows` | 68445 |
| `campaigns` | 35 |
| `daily_campaign_metrics` | 14245 |
| `daily_keyword_metrics` | 68417 |
| `annotations` | 31 |
| `performance_goals` | 4 |
| `bid_experiments` | 157 |

The production database was not used.

---

## 7. Git

Branch `main`, up to date with `origin/main` at the time of the change. Not committed and not pushed.

```
backend/package-lock.json             |  8 ++++----
backend/package.json                  |  2 +-
backend/test-csv-upload-protection.js | 10 ++++++++++
3 files changed, 15 insertions(+), 5 deletions(-)
```

---

## 8. Remaining risk

This is a major version upgrade. The options this importer uses were checked. Options the importer does not use were not. The default delimiter remains a comma. Production release `e1fd43e` does not yet contain this upgrade.

---

P6C.3a CSV-PARSE SECURITY UPGRADE: PASS
