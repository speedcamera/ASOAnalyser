/**
 * P5C.4 goals, annotations, and bid experiments use the authenticated tenant.
 * Run: node test-feature-tenant.js
 *
 * Users 33 and 73 are resolved through requireAuthenticatedTenant. The
 * database is real. Fixtures are removed afterwards.
 */
require('dotenv').config()

const assert = require('assert')
const express = require('express')
const http = require('http')
const { pool } = require('./db')
const { assertClerkConfigured } = require('./auth/clerkConfig')
const { createAuthRouter } = require('./auth/routes')
const { createRequireAuthenticatedTenant } = require('./auth/tenantMiddleware')
const { registerFeatureRoutes } = require('./featureRoutes')
const { detectBidExperiments } = require('./bidExperiments')

process.env.CLERK_TELEMETRY_DISABLED = 'true'
process.env.CLERK_PUBLISHABLE_KEY =
  'pk_test_' + Buffer.from('example.clerk.accounts.dev$').toString('base64url')
process.env.CLERK_SECRET_KEY = 'sk_test_p5c4_dummy_secret_not_a_real_key'

assertClerkConfigured()

const { app } = require('./index')

const APP_ID = 'p5c4-app'
const CAMPAIGN = 'P5C4 Campaign'
const AD_GROUP = 'P5C4 Group'
const KEYWORD = 'p5c4-keyword'
const ENTITY_KEY = `${APP_ID}|${CAMPAIGN}`

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
  const payload = body == null ? null : Buffer.from(body)
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          accept: 'application/json',
          ...(payload
            ? { 'content-type': 'application/json', 'content-length': payload.length }
            : {}),
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
          resolve({ status: res.statusCode, body: parsed })
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
  registerFeatureRoutes(expressApp, chain)
  return expressApp
}

function closeTo(actual, expected) {
  assert.ok(Math.abs(Number(actual) - expected) < 0.001, `expected ${expected}, got ${actual}`)
}

async function cleanupFixture() {
  await pool.query('DELETE FROM bid_experiments WHERE app_id = $1', [APP_ID])
  await pool.query('DELETE FROM daily_keyword_metrics WHERE app_id = $1', [APP_ID])
  await pool.query('DELETE FROM performance_goals WHERE entity_key = $1', [ENTITY_KEY])
  await pool.query('DELETE FROM annotations WHERE entity_key = $1', [ENTITY_KEY])
  await pool.query(
    `DELETE FROM application_settings
     WHERE setting_key = ANY($1::text[])`,
    [
      [
        'bid_experiment_default_observation_days:1',
        'bid_experiment_default_observation_days:14',
      ],
    ],
  )
}

async function insertKeywordDay(organisationId, date, bid, spend) {
  await pool.query(
    `INSERT INTO daily_keyword_metrics (
       organisation_id, app_id, app_name, campaign_name, ad_group_name,
       keyword_text, bid_strategy, report_date, spend, impressions, taps, installs,
       installs_tap_through, installs_view_through, installs_total, keyword_max_cpt_bid
     ) VALUES (
       $1, $2, 'P5C4 App', $3, $4, $5, 'Manual', $6, $7, 100, 10, 1, 1, 0, 1, $8
     )`,
    [organisationId, APP_ID, CAMPAIGN, AD_GROUP, KEYWORD, date, spend, bid],
  )
}

async function seedIdentity(organisationId, observationSpend) {
  await insertKeywordDay(organisationId, '2099-08-01', 1, 1)
  await insertKeywordDay(organisationId, '2099-08-02', 1, 1)
  await insertKeywordDay(organisationId, '2099-08-03', 2, observationSpend)
  await insertKeywordDay(organisationId, '2099-08-04', 2, 0)
  await insertKeywordDay(organisationId, '2099-08-05', 3, 5)
  return detectBidExperiments({ organisationId })
}

function goalBody(threshold) {
  return {
    entityType: 'campaign',
    entityKey: ENTITY_KEY,
    metric: 'cpa',
    operator: 'less_than',
    threshold,
    periodDays: 7,
    organisationId: 1,
    organisation_id: 1,
  }
}

function noteBody(text) {
  return {
    entityType: 'campaign',
    entityKey: ENTITY_KEY,
    noteType: 'note',
    noteText: text,
    organisationId: 1,
    organisation_id: 1,
  }
}

async function main() {
  console.log('\n=== P5C.4 goals, annotations, bid experiments ===')

  const users = await pool.query(
    `SELECT id, email, full_name, auth_provider, auth_provider_user_id
     FROM users WHERE id IN (33, 73) ORDER BY id`,
  )
  assert.strictEqual(users.rows.length, 2)
  const user33 = asReqUser(users.rows.find((row) => row.id === 33))
  const user73 = asReqUser(users.rows.find((row) => row.id === 73))

  await cleanupFixture()

  const existingGoal = await pool.query(
    `SELECT id FROM performance_goals WHERE organisation_id = 1 ORDER BY id LIMIT 1`,
  )
  const existingAnnotation = await pool.query(
    `SELECT id FROM annotations WHERE organisation_id = 1 ORDER BY id LIMIT 1`,
  )
  const existingExperiment = await pool.query(
    `SELECT id FROM bid_experiments WHERE organisation_id = 1 ORDER BY id LIMIT 1`,
  )
  assert.ok(existingExperiment.rows.length === 1, 'organisation 1 should already have a bid experiment')

  const publicServer = await listen(app)
  const server73 = await listen(authedApp(user73))
  const server33 = await listen(authedApp(user33))

  try {
    await testAsync('unauthenticated feature routes return 401', async () => {
      const paths = [
        ['GET', '/api/goals'],
        ['POST', '/api/goals'],
        ['PUT', '/api/goals/1'],
        ['DELETE', '/api/goals/1'],
        ['GET', '/api/annotations?entityType=campaign&entityKey=a'],
        ['POST', '/api/annotations'],
        ['PUT', '/api/annotations/1'],
        ['DELETE', '/api/annotations/1'],
        ['GET', '/api/bid-experiments'],
        ['GET', '/api/bid-experiments/1'],
        ['GET', '/api/bid-experiment-settings'],
        ['PATCH', '/api/bid-experiment-settings'],
      ]
      for (const [method, path] of paths) {
        const res = await request(publicServer, path, {
          method,
          body: method === 'GET' ? null : JSON.stringify({ segment: 'Brand', defaultObservationDays: 7 }),
        })
        assert.strictEqual(res.status, 401, `${method} ${path}`)
        assert.deepStrictEqual(res.body, { error: 'Unauthorized' })
      }
    })

    await testAsync('invalid authentication returns 401', async () => {
      const res = await request(publicServer, '/api/goals', {
        headers: { authorization: 'Bearer not-a-valid-session' },
      })
      assert.strictEqual(res.status, 401)
    })

    await testAsync('goal create, list, update, and delete stay inside the tenant', async () => {
      const created73 = await request(server73, '/api/goals', {
        method: 'POST',
        body: JSON.stringify(goalBody(11)),
      })
      const created33 = await request(server33, '/api/goals', {
        method: 'POST',
        headers: { 'x-organisation-id': '1' },
        body: JSON.stringify(goalBody(99)),
      })
      assert.strictEqual(created73.status, 200)
      assert.strictEqual(created33.status, 200)
      const owned = await pool.query(
        `SELECT id, organisation_id, threshold FROM performance_goals WHERE entity_key = $1 ORDER BY organisation_id`,
        [ENTITY_KEY],
      )
      assert.deepStrictEqual(
        owned.rows.map((row) => ({ organisation_id: row.organisation_id, threshold: Number(row.threshold) })),
        [
          { organisation_id: 1, threshold: 11 },
          { organisation_id: 14, threshold: 99 },
        ],
      )

      const list73 = await request(server73, `/api/goals?entityKey=${encodeURIComponent(ENTITY_KEY)}`)
      const list33 = await request(
        server33,
        `/api/goals?entityKey=${encodeURIComponent(ENTITY_KEY)}&organisationId=1`,
        { headers: { 'x-organisation-id': '1' } },
      )
      assert.strictEqual(list73.body.length, 1)
      assert.strictEqual(list33.body.length, 1)
      assert.strictEqual(list73.body[0].threshold, 11)
      assert.strictEqual(list33.body[0].threshold, 99)

      const foreignUpdate = await request(server33, `/api/goals/${created73.body.id}`, {
        method: 'PUT',
        body: JSON.stringify({ threshold: 1, organisationId: 1 }),
      })
      const foreignDelete = await request(server33, `/api/goals/${created73.body.id}`, {
        method: 'DELETE',
        headers: { 'x-organisation-id': '1' },
      })
      assert.strictEqual(foreignUpdate.status, 404)
      assert.strictEqual(foreignDelete.status, 404)
      assert.strictEqual(foreignUpdate.body.error, 'Goal not found')

      const updated = await request(server33, `/api/goals/${created33.body.id}`, {
        method: 'PUT',
        body: JSON.stringify({ threshold: 98, organisationId: 1 }),
      })
      assert.strictEqual(updated.status, 200)
      assert.strictEqual(updated.body.threshold, 98)
      const still = await pool.query(
        'SELECT organisation_id, threshold FROM performance_goals WHERE id = $1',
        [created33.body.id],
      )
      assert.strictEqual(still.rows[0].organisation_id, 14)
      assert.strictEqual(Number(still.rows[0].threshold), 98)

      const removed = await request(server33, `/api/goals/${created33.body.id}`, { method: 'DELETE' })
      assert.strictEqual(removed.status, 200)
      const survivor = await pool.query(
        'SELECT organisation_id FROM performance_goals WHERE id = $1',
        [created73.body.id],
      )
      assert.strictEqual(survivor.rows[0].organisation_id, 1)
    })

    await testAsync('annotation create, list, update, and delete stay inside the tenant', async () => {
      const created73 = await request(server73, '/api/annotations', {
        method: 'POST',
        body: JSON.stringify(noteBody('P5C4 org 1 note')),
      })
      const created33 = await request(server33, '/api/annotations', {
        method: 'POST',
        headers: { 'x-organisation-id': '1' },
        body: JSON.stringify(noteBody('P5C4 org 14 note')),
      })
      assert.strictEqual(created73.status, 201)
      assert.strictEqual(created33.status, 201)
      const path = `/api/annotations?entityType=campaign&entityKey=${encodeURIComponent(ENTITY_KEY)}`
      const list73 = await request(server73, path)
      const list33 = await request(server33, `${path}&organisationId=1`)
      assert.deepStrictEqual(list73.body.map((row) => row.noteText), ['P5C4 org 1 note'])
      assert.deepStrictEqual(list33.body.map((row) => row.noteText), ['P5C4 org 14 note'])

      const foreignUpdate = await request(server33, `/api/annotations/${created73.body.id}`, {
        method: 'PUT',
        body: JSON.stringify({ noteText: 'taken', organisationId: 1 }),
      })
      const foreignDelete = await request(server33, `/api/annotations/${created73.body.id}`, {
        method: 'DELETE',
      })
      assert.strictEqual(foreignUpdate.status, 404)
      assert.strictEqual(foreignDelete.status, 404)

      const updated = await request(server33, `/api/annotations/${created33.body.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          entityType: 'campaign',
          entityKey: ENTITY_KEY,
          noteText: 'P5C4 org 14 updated',
          organisationId: 1,
        }),
      })
      assert.strictEqual(updated.status, 200)
      assert.strictEqual(updated.body.noteText, 'P5C4 org 14 updated')
      const stored = await pool.query(
        'SELECT organisation_id, note_text FROM annotations WHERE id = $1',
        [created33.body.id],
      )
      assert.strictEqual(stored.rows[0].organisation_id, 14)
    })

    await testAsync('identical keyword identities do not mix experiment analysis', async () => {
      const detected1 = await seedIdentity(1, 100)
      const detected14 = await seedIdentity(14, 900)
      assert.strictEqual(detected1.created, 2)
      assert.strictEqual(detected14.created, 2)

      const path = `/api/bid-experiments?appId=${APP_ID}&keywordText=${KEYWORD}&limit=20`
      const list73 = await request(server73, path)
      const list33 = await request(server33, `${path}&organisationId=1`, {
        headers: { 'x-organisation-id': '1' },
        body: JSON.stringify({ organisationId: 1 }),
      })
      assert.strictEqual(list73.status, 200)
      assert.strictEqual(list33.status, 200)
      assert.strictEqual(list73.body.experiments.length, 2)
      assert.strictEqual(list33.body.experiments.length, 2)
      const ids73 = new Set(list73.body.experiments.map((row) => row.id))
      for (const row of list33.body.experiments) assert.ok(!ids73.has(row.id))

      const interrupted73 = list73.body.experiments.find((row) => row.interruption_date)
      const interrupted33 = list33.body.experiments.find((row) => row.interruption_date)
      assert.strictEqual(interrupted73.interruption_date, '2099-08-05')
      assert.strictEqual(interrupted33.interruption_date, '2099-08-05')
      assert.strictEqual(interrupted73.requested_observation_days, 7)
      assert.strictEqual(interrupted73.actual_observation_days, 2)
      assert.strictEqual(interrupted73.status, 'interrupted')

      const detail73 = await request(server73, `/api/bid-experiments/${interrupted73.id}`)
      const detail33 = await request(server33, `/api/bid-experiments/${interrupted33.id}`)
      const foreign = await request(server33, `/api/bid-experiments/${interrupted73.id}?organisationId=1`, {
        headers: { 'x-organisation-id': '1' },
      })
      assert.strictEqual(detail73.status, 200)
      assert.strictEqual(detail33.status, 200)
      assert.strictEqual(foreign.status, 404)
      assert.strictEqual(foreign.body.error, 'Bid experiment not found')
      closeTo(detail73.body.after.metrics.spend, 100)
      closeTo(detail33.body.after.metrics.spend, 900)
      assert.notStrictEqual(Number(detail73.body.after.metrics.spend), 1000)
      assert.strictEqual(detail73.body.interruption_date, '2099-08-05')
      assert.ok(detail73.body.after.end_date < '2099-08-05')
    })

    await testAsync('observation default cannot be written onto another organisation', async () => {
      const before = await request(server73, '/api/bid-experiment-settings')
      const changed = await request(server33, '/api/bid-experiment-settings', {
        method: 'PATCH',
        headers: { 'x-organisation-id': '1' },
        body: JSON.stringify({ defaultObservationDays: 30, organisationId: 1 }),
      })
      const developer = await request(server73, '/api/bid-experiment-settings?organisationId=14')
      const customer = await request(server33, '/api/bid-experiment-settings')
      assert.strictEqual(changed.status, 200)
      assert.strictEqual(changed.body.defaultObservationDays, 30)
      assert.strictEqual(developer.body.defaultObservationDays, before.body.defaultObservationDays)
      assert.strictEqual(customer.body.defaultObservationDays, 30)
    })

    if (existingGoal.rows[0]) {
      await testAsync('foreign existing goal is not visible or mutable', async () => {
        const res = await request(server33, `/api/goals/${existingGoal.rows[0].id}`, {
          method: 'PUT',
          body: JSON.stringify({ threshold: 1, organisationId: 1 }),
        })
        assert.strictEqual(res.status, 404)
      })
    }

    if (existingAnnotation.rows[0]) {
      await testAsync('foreign existing annotation is not mutable', async () => {
        const res = await request(server33, `/api/annotations/${existingAnnotation.rows[0].id}`, {
          method: 'DELETE',
        })
        assert.strictEqual(res.status, 404)
      })
    }

    await testAsync('foreign existing experiment is not readable', async () => {
      const res = await request(server33, `/api/bid-experiments/${existingExperiment.rows[0].id}`)
      assert.strictEqual(res.status, 404)
      assert.strictEqual(res.body.error, 'Bid experiment not found')
    })
  } finally {
    await cleanupFixture()
    await new Promise((resolve) => publicServer.close(resolve))
    await new Promise((resolve) => server73.close(resolve))
    await new Promise((resolve) => server33.close(resolve))
  }

  const leftover = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM bid_experiments WHERE app_id = $1) AS experiments,
       (SELECT COUNT(*)::int FROM daily_keyword_metrics WHERE app_id = $1) AS metrics,
       (SELECT COUNT(*)::int FROM performance_goals WHERE entity_key = $2) AS goals,
       (SELECT COUNT(*)::int FROM annotations WHERE entity_key = $2) AS notes`,
    [APP_ID, ENTITY_KEY],
  )
  assert.deepStrictEqual(leftover.rows[0], {
    experiments: 0,
    metrics: 0,
    goals: 0,
    notes: 0,
  })

  console.log(`\n${passed} passed`)
  await pool.end()
}

main().catch(async (err) => {
  console.error(err)
  try {
    await cleanupFixture()
    await pool.end()
  } catch (cleanupErr) {
    console.error(cleanupErr)
  }
  process.exit(1)
})
