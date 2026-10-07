/**
 * P6A.3 API input and analytics limits.
 * Run: node test-api-input-limits.js
 */
require('dotenv').config()

const assert = require('assert')
const express = require('express')
const http = require('http')
const { pool } = require('./db')
const { assertClerkConfigured } = require('./auth/clerkConfig')
const { createAuthRouter } = require('./auth/routes')
const { createRequireAuthenticatedTenant } = require('./auth/tenantMiddleware')
const { registerAnalyticsRoutes } = require('./analyticsRoutes')
const { registerFeatureRoutes } = require('./featureRoutes')
const { registerImportRoutes } = require('./importRoutes')
const { errorHandler } = require('./http/clientError')
const { readAnalyticsQuery, MAX_ANALYTICS_DAYS, MAX_NOTE_TEXT } = require('./http/requestValidation')

process.env.CLERK_TELEMETRY_DISABLED = 'true'
process.env.CLERK_PUBLISHABLE_KEY =
  'pk_test_' + Buffer.from('example.clerk.accounts.dev$').toString('base64url')
process.env.CLERK_SECRET_KEY = 'sk_test_p6a3_dummy_secret_not_a_real_key'

assertClerkConfigured()

const { app } = require('./index')

const GOAL_KEY = 'p6a3-goal'
const NOTE_KEY = 'p6a3-note'

let passed = 0

async function testAsync(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
    throw err
  }
}

function listen(expressApp) {
  return new Promise((resolve) => {
    const server = expressApp.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function request(server, path, { method = 'GET', headers = {}, body = null } = {}) {
  const { port } = server.address()
  const payload = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(body)
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          accept: 'application/json',
          ...(payload ? { 'content-length': payload.length, 'content-type': 'application/json' } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let parsed = text
          try {
            parsed = JSON.parse(text)
          } catch {
            parsed = text
          }
          resolve({ status: res.statusCode, body: parsed, text })
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function asReqUser(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    authProvider: row.auth_provider,
    authProviderUserId: row.auth_provider_user_id,
  }
}

function authedApp(user) {
  const expressApp = express()
  expressApp.use(express.json())
  const chain = createRequireAuthenticatedTenant({
    getAuthFn: () => ({ isAuthenticated: true, userId: user.authProviderUserId }),
    resolveUser: async () => user,
  })
  expressApp.use(
    '/api/auth',
    createAuthRouter({
      requireAuthenticatedUser: chain[0],
      requireAuthenticatedTenant: chain,
    }),
  )
  registerAnalyticsRoutes(expressApp, chain)
  registerFeatureRoutes(expressApp, chain)
  registerImportRoutes(expressApp, chain)
  expressApp.use(errorHandler)
  return expressApp
}

function assertSafe(res) {
  assert.ok(!/syntax error|\/home\/|node_modules|postgresql:\/\//i.test(res.text))
}

async function cleanup() {
  await pool.query(`DELETE FROM annotations WHERE entity_key LIKE 'p6a3-%'`)
  await pool.query(`DELETE FROM performance_goals WHERE entity_key LIKE 'p6a3-%'`)
}

async function main() {
  console.log('\n=== P6A.3 API input and analytics limits ===')

  await testAsync('oversized days are rejected before a comparison is built', async () => {
    assert.throws(
      () => readAnalyticsQuery({ days: '999999999' }, { requireChoice: true }),
      (err) => err.status === 400 && err.message.includes('1 to 90'),
    )
  })

  const users = await pool.query(
    `SELECT id, email, full_name, auth_provider, auth_provider_user_id
     FROM users WHERE id IN (33, 73) ORDER BY id`,
  )
  assert.strictEqual(users.rows.length, 2)
  const user33 = asReqUser(users.rows.find((row) => row.id === 33))
  const user73 = asReqUser(users.rows.find((row) => row.id === 73))
  const ownImport = await pool.query(
    `SELECT id FROM imports WHERE organisation_id = 1 ORDER BY id LIMIT 1`,
  )
  assert.strictEqual(ownImport.rows.length, 1)
  const importId = ownImport.rows[0].id

  await cleanup()
  const settings = await pool.query(
    `SELECT setting_value FROM application_settings WHERE setting_key = $1`,
    ['bid_experiment_default_observation_days:1'],
  )
  const originalObservation = settings.rows[0] ? Number(settings.rows[0].setting_value) : 7

  const publicServer = await listen(app)
  const developerServer = await listen(authedApp(user73))
  const customerServer = await listen(authedApp(user33))

  try {
    await testAsync('days 7, 14, 30, and 90 succeed', async () => {
      for (const days of [7, 14, 30, MAX_ANALYTICS_DAYS]) {
        const res = await request(developerServer, `/api/compare/period?days=${days}`)
        assert.strictEqual(res.status, 200, `${days} ${res.text}`)
        assert.ok(res.body.periods)
      }
    })

    await testAsync('days above the maximum and malformed days are 400', async () => {
      for (const days of ['91', '999999999', '0', '-1', 'abc', '7.5']) {
        const res = await request(developerServer, `/api/compare/period?days=${encodeURIComponent(days)}`)
        assert.strictEqual(res.status, 400, days)
        assert.match(res.body.error, /days must be a whole number from 1 to 90/)
        assert.ok(!res.body.periods)
        assertSafe(res)
      }
    })

    await testAsync('a valid date range succeeds', async () => {
      const res = await request(
        developerServer,
        '/api/compare/period?startDate=2099-01-01&endDate=2099-01-07',
      )
      assert.strictEqual(res.status, 200, res.text)
      assert.strictEqual(res.body.periods.current_period.start_date, '2099-01-01')
      assert.strictEqual(res.body.periods.current_period.end_date, '2099-01-07')
    })

    await testAsync('an invalid or reversed date range is 400', async () => {
      const invalid = await request(
        developerServer,
        '/api/compare/period?startDate=2099-02-31&endDate=2099-03-02',
      )
      const reversed = await request(
        developerServer,
        '/api/compare/period?startDate=2099-03-10&endDate=2099-03-01',
      )
      const tooLong = await request(
        developerServer,
        '/api/compare/period?startDate=2099-01-01&endDate=2099-04-01',
      )
      assert.strictEqual(invalid.status, 400)
      assert.match(invalid.body.error, /valid calendar date/)
      assert.strictEqual(reversed.status, 400)
      assert.strictEqual(reversed.body.error, 'startDate must be on or before endDate')
      assert.strictEqual(tooLong.status, 400)
      assert.match(tooLong.body.error, /90 days or fewer/)
      assertSafe(invalid)
    })

    await testAsync('own import id succeeds and a foreign id is 404', async () => {
      const developer = await request(developerServer, '/api/auth/context')
      const customer = await request(customerServer, '/api/auth/context')
      assert.strictEqual(developer.body.user.id, 73)
      assert.strictEqual(developer.body.organisation.id, 1)
      assert.strictEqual(customer.body.user.id, 33)
      assert.strictEqual(customer.body.organisation.id, 14)

      const own = await request(developerServer, `/api/imports/${importId}`)
      const foreign = await request(customerServer, `/api/imports/${importId}`)
      const plain = await request(customerServer, '/api/compare/period?days=7')
      const spoofed = await request(customerServer, '/api/compare/period?days=7&organisationId=1', {
        headers: { 'x-organisation-id': '1' },
      })
      assert.strictEqual(own.status, 200)
      assert.strictEqual(own.body.id, importId)
      assert.strictEqual(foreign.status, 404)
      assert.deepStrictEqual(foreign.body, { error: 'Import not found' })
      assert.strictEqual(plain.status, 200)
      assert.strictEqual(spoofed.status, 200)
      assert.deepStrictEqual(spoofed.body.overall, plain.body.overall)
      assert.deepStrictEqual(spoofed.body.periods, plain.body.periods)
    })

    await testAsync('malformed resource ids are 400', async () => {
      for (const id of ['abc', '0', '-1', '1.5', 'Infinity']) {
        const res = await request(developerServer, `/api/imports/${encodeURIComponent(id)}`)
        assert.strictEqual(res.status, 400, id)
        assert.strictEqual(res.body.error, 'Invalid import id')
        assertSafe(res)
      }
      const goal = await request(developerServer, '/api/goals/abc', {
        method: 'PUT',
        body: JSON.stringify({ threshold: 1 }),
      })
      assert.strictEqual(goal.status, 400)
      assert.strictEqual(goal.body.error, 'Invalid goal id')
    })

    await testAsync('annotation text at the limit is accepted and above it is 400', async () => {
      const atLimit = await request(developerServer, '/api/annotations', {
        method: 'POST',
        body: JSON.stringify({
          entityType: 'campaign',
          entityKey: NOTE_KEY,
          noteType: 'note',
          noteText: 'n'.repeat(MAX_NOTE_TEXT),
        }),
      })
      const tooLong = await request(developerServer, '/api/annotations', {
        method: 'POST',
        body: JSON.stringify({
          entityType: 'campaign',
          entityKey: NOTE_KEY,
          noteType: 'note',
          noteText: 'n'.repeat(MAX_NOTE_TEXT + 1),
        }),
      })
      assert.strictEqual(atLimit.status, 201, atLimit.text)
      assert.strictEqual(atLimit.body.noteText.length, MAX_NOTE_TEXT)
      assert.strictEqual(tooLong.status, 400)
      assert.match(tooLong.body.error, /2000 characters or fewer/)
      const stored = await pool.query(
        `SELECT COUNT(*)::int AS n FROM annotations WHERE entity_key = $1 AND char_length(note_text) > $2`,
        [NOTE_KEY, MAX_NOTE_TEXT],
      )
      assert.strictEqual(stored.rows[0].n, 0)
    })

    await testAsync('a valid goal is accepted and an invalid threshold is 400', async () => {
      const created = await request(developerServer, '/api/goals', {
        method: 'POST',
        body: JSON.stringify({
          entityType: 'campaign',
          entityKey: GOAL_KEY,
          metric: 'cpa',
          operator: 'greater_than',
          threshold: 2.5,
          periodDays: 7,
        }),
      })
      const negative = await request(developerServer, '/api/goals', {
        method: 'POST',
        body: JSON.stringify({
          entityType: 'campaign',
          entityKey: GOAL_KEY,
          metric: 'cpa',
          operator: 'greater_than',
          threshold: -1,
          periodDays: 7,
        }),
      })
      const infinite = await request(developerServer, '/api/goals', {
        method: 'POST',
        body: '{"entityType":"campaign","entityKey":"p6a3-goal","metric":"cpa","operator":"greater_than","threshold":1e309,"periodDays":7}',
      })
      assert.strictEqual(created.status, 200, created.text)
      assert.strictEqual(created.body.threshold, 2.5)
      assert.strictEqual(negative.status, 400)
      assert.strictEqual(negative.body.error, 'Threshold must be a non-negative number')
      assert.strictEqual(infinite.status, 400)
      assert.strictEqual(infinite.body.error, 'Threshold must be a non-negative number')
    })

    await testAsync('supported experiment windows are accepted and others are 400', async () => {
      const supported = await request(developerServer, '/api/bid-experiment-settings', {
        method: 'PATCH',
        body: JSON.stringify({ defaultObservationDays: 7 }),
      })
      const unsupported = await request(developerServer, '/api/bid-experiment-settings', {
        method: 'PATCH',
        body: JSON.stringify({ defaultObservationDays: 45 }),
      })
      const decimal = await request(developerServer, '/api/bid-experiment-settings', {
        method: 'PATCH',
        body: JSON.stringify({ defaultObservationDays: 7.5 }),
      })
      assert.strictEqual(supported.status, 200, supported.text)
      assert.strictEqual(supported.body.defaultObservationDays, 7)
      assert.strictEqual(unsupported.status, 400)
      assert.match(unsupported.body.error, /must be one of: 3, 7, 14, 30/)
      assert.strictEqual(decimal.status, 400)
    })

    await testAsync('a normal filter works and an excessive filter is 400', async () => {
      const normal = await request(developerServer, '/api/compare/period?days=7&appId=delm8')
      const excessive = await request(
        developerServer,
        `/api/compare/period?days=7&appId=${'a'.repeat(301)}`,
      )
      const weekly = await request(
        developerServer,
        `/api/campaigns/weekly-performance?startDate=2099-01-01&endDate=2099-01-07&campaignName=${'c'.repeat(301)}`,
      )
      assert.strictEqual(normal.status, 200, normal.text)
      assert.strictEqual(excessive.status, 400)
      assert.strictEqual(excessive.body.error, 'appId is too long')
      assert.strictEqual(weekly.status, 400)
      assert.strictEqual(weekly.body.error, 'campaignName is too long')
      assertSafe(excessive)
    })

    await testAsync('unauthenticated analytics stay 401', async () => {
      const res = await request(publicServer, '/api/compare/period?days=999999999')
      assert.strictEqual(res.status, 401)
      assert.deepStrictEqual(res.body, { error: 'Unauthorized' })
    })
  } finally {
    await request(developerServer, '/api/bid-experiment-settings', {
      method: 'PATCH',
      body: JSON.stringify({ defaultObservationDays: originalObservation }),
    }).catch(() => {})
    await cleanup()
    await Promise.all(
      [publicServer, developerServer, customerServer].map(
        (server) => new Promise((resolve) => server.close(resolve)),
      ),
    )
  }

  console.log(`\n${passed} passed`)
  await pool.end()
}

main().catch(async (err) => {
  console.error(err)
  try {
    await cleanup()
    await pool.end()
  } catch {
    // The pool may already be closed.
  }
  process.exit(1)
})
