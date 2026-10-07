# PostgreSQL Connection Management Fix

## Problem
**Error**: `Release called on client which has already been released to the pool`

The CSV upload flow had a **double release** bug where a database client was released twice:
1. Once after COMMIT (line 278 in original code)
2. Again in the finally block (line 287 in original code)

## Root Cause

The `createImport()` function in `backend/imports.js` was:
1. Calling `client.release()` immediately after successful COMMIT
2. Then calling `client.release()` again in the finally block

This violated the rule: **A client must be released exactly once**.

## Secondary Issue

The structured metrics upsert was happening **after COMMIT**, outside the transaction:
- Raw import rows were committed
- Then structured metrics were inserted using separate `pool.query()` calls
- If structured metrics failed, raw rows were already committed (inconsistent state)

## Solution

### 1. Fixed Double Release
Removed the duplicate release call after COMMIT. The client is now released **exactly once** in the finally block.

### 2. Unified Transaction
Moved structured metrics upsert **before COMMIT** so everything happens in one atomic transaction:
- Raw rows
- Structured campaign metrics  
- Structured keyword metrics
- All commit together or all rollback together

### 3. Client Passing Pattern
Updated all functions in the upload chain to accept and pass the client:

**Owner (acquires and releases)**:
- `createImport()` - calls `pool.connect()` and releases in finally

**Helpers (accept client, never release)**:
- `upsertDailyMetricsForImport(importId, client)` - passes client through
- `upsertDailyCampaignMetrics(records, client)` - uses client if provided
- `upsertDailyKeywordMetrics(records, client)` - uses client if provided

All helper functions use pattern: `const db = client || pool`

## Files Changed

### 1. backend/imports.js
- **createImport()**: Removed duplicate release, moved upsert before COMMIT, passes client
- **upsertDailyMetricsForImport()**: Added client parameter, passes to nested functions

### 2. backend/dailyMetrics.js
- **upsertDailyCampaignMetrics()**: Added client parameter with fallback to pool
- **upsertDailyKeywordMetrics()**: Added client parameter with fallback to pool

## Transaction Flow (Corrected)

```javascript
async function createImport(originalName, headers, records) {
  const client = await pool.connect()  // 1. Acquire client (OWNER)
  
  try {
    await client.query('BEGIN')  // 2. Start transaction
    
    // 3. Insert import record
    const importResult = await client.query('INSERT INTO imports...')
    const importId = importResult.rows[0].id
    
    // 4. Insert/update raw rows
    for (const record of records) {
      await client.query('INSERT INTO import_rows...')
    }
    
    // 5. Count total rows
    const totalResult = await client.query('SELECT COUNT(*)...')
    
    // 6. Upsert structured metrics (INSIDE TRANSACTION)
    await upsertDailyMetricsForImport(importId, client)
    
    // 7. Commit everything atomically
    await client.query('COMMIT')
    
    return result
    
  } catch (err) {
    await client.query('ROLLBACK')  // 8. Rollback on error
    throw err
    
  } finally {
    client.release()  // 9. Release exactly once
  }
}
```

## Connection Management Rules (Applied)

✅ **Rule 1**: A client obtained using `pool.connect()` must be released exactly once  
✅ **Rule 2**: `pool.query()` must never call `client.release()`  
✅ **Rule 3**: Shared services must not release a client they did not create  
✅ **Rule 4**: Use try/finally so release happens exactly once  
✅ **Rule 5**: Remove duplicate release calls  
✅ **Rule 6**: Preserve transaction consistency (raw + structured in one transaction)

## Verification

### Connection Usage Summary
**Only one place uses manual connection management**:
- `backend/imports.js` - `createImport()` (FIXED)

**All other files use pool.query() only** (safe, no manual release):
- `backend/analyticsService.js`
- `backend/analyticsMetrics.js`
- `backend/campaignWeekly.js`
- `backend/compareStructured.js`
- `backend/db.js`
- `backend/annotations.js`
- `backend/compare.js`

### Test Scenarios

**Successful Upload**:
1. Upload CSV file
2. Verify all raw rows inserted
3. Verify structured metrics inserted
4. Verify no connection errors
5. Connection properly returned to pool

**Failed Upload**:
1. Upload invalid CSV (trigger error during import)
2. Verify ROLLBACK occurs
3. Verify no partial data committed
4. Verify connection properly returned to pool
5. Verify connection is still usable for next request

## Before vs After

### Before (BROKEN)
```javascript
await client.query('COMMIT')
client.release()  // ❌ First release
await upsertDailyMetricsForImport(importId)  // Uses pool.query
return result
} catch (err) {
  throw err
} finally {
  client.release()  // ❌ Second release - ERROR!
}
```

### After (FIXED)
```javascript
await upsertDailyMetricsForImport(importId, client)  // ✅ Uses passed client
await client.query('COMMIT')
return result
} catch (err) {
  await client.query('ROLLBACK')
  throw err
} finally {
  client.release()  // ✅ Single release
}
```
