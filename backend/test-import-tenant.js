/**
 * P5C.2 import routes use the authenticated tenant.
 * Run: node test-import-tenant.js
 *
 * Users 33 and 73 are resolved through requireAuthenticatedTenant with the
 * verified Clerk user id injected at the P5A boundary. The database is real.
 * The fixture is removed afterwards, including the organisation 1 copy.
 */
require('dotenv').config()

const assert = require('assert')
const express = require('express')
const http = require('http')
const { pool } = require('./db')
const { assertClerkConfigured } = require('./auth/clerkConfig')
const { createAuthRouter } = require('./auth/routes')
const { createRequireAuthenticatedTenant } = require('./auth/tenantMiddleware')
const { registerImportRoutes } = require('./importRoutes')
const { createImport } = require('./imports')

process.env.CLERK_TELEMETRY_DISABLED = 'true'
process.env.CLERK_PUBLISHABLE_KEY =
  'pk_test_' + Buffer.from('example.clerk.accounts.dev$').toString('base64url')
process.env.CLERK_SECRET_KEY = 'sk_test_p5c2_dummy_secret_not_a_real_key'

assertClerkConfigured()

const { app } = require('./index')

const FIXTURE_NAME = 'p5c2-isolation.csv'
const APP_ID = 'p5c2-isolation-app'
const CSV = [
  'Date,Campaign Name,Ad Group Name,Keyword,Bid Strategy,App ID,App Name,Spend,Impressions,Taps,Installs (Total),Keyword Max Bid',
  '2099-01-15,P5C2 Isolation Campaign,P5C2 Isolation Ad Group,p5c2-isolation-keyword,Manual,p5c2-isolation-app,P5C2 Isolation App,1.00,10,2,1,0.40',
  '2099-01-16,P5C2 Isolation Campaign,P5C2 Isolation Ad Group,p5c2-isolation-keyword,Manual,p5c2-isolation-app,P5C2 Isolation App,1.25,12,3,1,0.55',
].join('\n')

const DETAIL_PATHS = [
  (id) => `/api/imports/${id}`,
  (id) => `/api/imports/${id}/rows`,
  (id) => `/api/imports/${id}/profile`,
  (id) => `/api/imports/${id}/metrics-summary`,
  (id) => `/api/imports/${id}/campaign-summary`,
  (id) => `/api/imports/${id}/keyword-summary`,
]

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
  const payload = body
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          accept: 'application/json',
          ...(payload ? { 'content-length': payload.length } : {}),
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
  registerImportRoutes(expressApp, chain)
  return expressApp
}

function multipart({ fields = {}, filename, content }) {
  const boundary = '----p5c2boundary'
  const chunks = []
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    )
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/csv\r\n\r\n`,
    ),
  )
  chunks.push(Buffer.from(content))
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`))
  return {
    body: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

async function count(sql, params = []) {
  const result = await pool.query(sql, params)
  return result.rows[0].n
}

async function idsFor(organisationId) {
  const result = await pool.query(
    'SELECT id FROM imports WHERE organisation_id = $1 ORDER BY id',
    [organisationId],
  )
  return result.rows.map((row) => row.id)
}

async function cleanupFixture() {
  await pool.query(`DELETE FROM bid_experiments WHERE app_id = $1`, [APP_ID])
  await pool.query(`DELETE FROM keyword_bid_history WHERE app_id = $1`, [APP_ID])
  await pool.query(`DELETE FROM daily_keyword_metrics WHERE app_id = $1`, [APP_ID])
  await pool.query(`DELETE FROM daily_campaign_metrics WHERE app_id = $1`, [APP_ID])
  await pool.query(`DELETE FROM campaigns WHERE app_id = $1`, [APP_ID])
  await pool.query(`DELETE FROM imports WHERE original_name = $1`, [FIXTURE_NAME])
}

async function orgCounts(table, organisationId) {
  return count(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE organisation_id = $1 AND app_id <> $2`,
    [organisationId, APP_ID],
  )
}

async function main() {
  console.log('\n=== P5C.2 import tenant context ===')

  const users = await pool.query(
    `SELECT id, email, full_name, auth_provider, auth_provider_user_id
     FROM users WHERE id IN (33, 73) ORDER BY id`,
  )
  assert.strictEqual(users.rows.length, 2)
  const user33 = asReqUser(users.rows.find((row) => row.id === 33))
  const user73 = asReqUser(users.rows.find((row) => row.id === 73))

  await cleanupFixture()

  const org1ImportIds = await idsFor(1)
  const org14ImportIds = await idsFor(14)
  assert.ok(org1ImportIds.length > 0, 'organisation 1 should already have imports')
  const populated = await pool.query(
    `SELECT i.id
     FROM imports i
     WHERE i.organisation_id = 1
       AND EXISTS (
         SELECT 1 FROM import_rows r
         WHERE r.import_id = i.id AND r.organisation_id = 1
       )
     ORDER BY i.id
     LIMIT 1`,
  )
  assert.ok(populated.rows.length === 1, 'organisation 1 should have an import with rows')
  const foreignImportId = populated.rows[0].id
  const org1Campaigns = await orgCounts('campaigns', 1)
  const org1CampaignMetrics = await orgCounts('daily_campaign_metrics', 1)
  const org1KeywordMetrics = await orgCounts('daily_keyword_metrics', 1)

  const publicServer = await listen(app)
  const customerServer = await listen(authedApp(user33))
  const developerServer = await listen(authedApp(user73))

  try {
    await testAsync('unauthenticated import list returns 401', async () => {
      const res = await request(publicServer, '/api/imports')
      assert.strictEqual(res.status, 401)
      assert.deepStrictEqual(res.body, { error: 'Unauthorized' })
    })

    await testAsync('unauthenticated upload returns 401', async () => {
      const file = multipart({ filename: FIXTURE_NAME, content: CSV })
      const res = await request(publicServer, '/api/imports', {
        method: 'POST',
        headers: file.headers,
        body: file.body,
      })
      assert.strictEqual(res.status, 401)
      assert.deepStrictEqual(res.body, { error: 'Unauthorized' })
    })

    await testAsync('invalid authentication returns 401', async () => {
      const listed = await request(publicServer, '/api/imports', {
        headers: { authorization: 'Bearer not-a-valid-session' },
      })
      const file = multipart({ filename: FIXTURE_NAME, content: CSV })
      const uploaded = await request(publicServer, '/api/imports', {
        method: 'POST',
        headers: { ...file.headers, authorization: 'Bearer not-a-valid-session' },
        body: file.body,
      })
      assert.strictEqual(listed.status, 401)
      assert.strictEqual(uploaded.status, 401)
    })

    await testAsync('authenticated context resolves users 73 and 33', async () => {
      const anon = await request(publicServer, '/api/auth/context')
      const developer = await request(developerServer, '/api/auth/context')
      const customer = await request(customerServer, '/api/auth/context')
      assert.strictEqual(anon.status, 401)
      assert.strictEqual(developer.body.user.id, 73)
      assert.strictEqual(developer.body.organisation.id, 1)
      assert.strictEqual(customer.body.user.id, 33)
      assert.strictEqual(customer.body.organisation.id, 14)
    })

    await testAsync('developer import listing is organisation 1 only', async () => {
      const res = await request(developerServer, '/api/imports')
      assert.strictEqual(res.status, 200)
      const ids = res.body.map((row) => row.id).sort((a, b) => a - b)
      assert.deepStrictEqual(ids, org1ImportIds)
    })

    await testAsync('customer import listing is organisation 14 only', async () => {
      const res = await request(customerServer, '/api/imports')
      assert.strictEqual(res.status, 200)
      const ids = res.body.map((row) => row.id).sort((a, b) => a - b)
      assert.deepStrictEqual(ids, org14ImportIds)
    })

    await testAsync('spoofed organisation id is ignored on import listing', async () => {
      const plain = await request(customerServer, '/api/imports')
      const spoofed = await request(customerServer, '/api/imports?organisationId=1', {
        headers: { 'x-organisation-id': '1', 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify({ organisationId: 1 })),
      })
      assert.strictEqual(spoofed.status, 200)
      assert.deepStrictEqual(spoofed.body, plain.body)
    })

    await testAsync('createImport rejects a missing organisation id', async () => {
      const before = await count('SELECT COUNT(*)::int AS n FROM imports')
      await assert.rejects(() => createImport(FIXTURE_NAME, ['Date'], [{ Date: '2099-01-15' }]))
      const after = await count('SELECT COUNT(*)::int AS n FROM imports')
      assert.strictEqual(after, before)
    })

    let customerImportId
    await testAsync('customer CSV upload is owned by organisation 14', async () => {
      const file = multipart({
        filename: FIXTURE_NAME,
        content: CSV,
        fields: { organisationId: '1' },
      })
      const res = await request(customerServer, '/api/imports?organisationId=1', {
        method: 'POST',
        headers: { ...file.headers, 'x-organisation-id': '1' },
        body: file.body,
      })
      assert.strictEqual(res.status, 201)
      customerImportId = res.body.id
      assert.strictEqual(res.body.insertedRows, 2)

      const owned = await pool.query(
        'SELECT organisation_id FROM imports WHERE id = $1',
        [customerImportId],
      )
      assert.strictEqual(owned.rows[0].organisation_id, 14)

      const rows = await pool.query(
        'SELECT organisation_id FROM import_rows WHERE import_id = $1',
        [customerImportId],
      )
      assert.strictEqual(rows.rows.length, 2)
      assert.ok(rows.rows.every((row) => row.organisation_id === 14))

      for (const table of ['campaigns', 'daily_campaign_metrics', 'daily_keyword_metrics']) {
        const result = await pool.query(
          `SELECT organisation_id FROM ${table} WHERE app_id = $1`,
          [APP_ID],
        )
        assert.ok(result.rows.length > 0, `${table} should contain the fixture`)
        assert.ok(result.rows.every((row) => row.organisation_id === 14), table)
      }

      const history = await pool.query(
        'SELECT organisation_id FROM keyword_bid_history WHERE app_id = $1',
        [APP_ID],
      )
      assert.ok(history.rows.length > 0)
      assert.ok(history.rows.every((row) => row.organisation_id === 14))
    })

    await testAsync('customer import appears for organisation 14 and not organisation 1', async () => {
      const customer = await request(customerServer, '/api/imports')
      const developer = await request(developerServer, '/api/imports')
      assert.ok(customer.body.some((row) => row.id === customerImportId))
      assert.ok(developer.body.every((row) => row.id !== customerImportId))
    })

    await testAsync('customer can read the new import detail and rows', async () => {
      for (const pathFor of DETAIL_PATHS) {
        const res = await request(customerServer, pathFor(customerImportId))
        assert.strictEqual(res.status, 200, pathFor(customerImportId))
      }
      const rows = await request(customerServer, `/api/imports/${customerImportId}/rows`)
      assert.strictEqual(rows.body.total, 2)
    })

    await testAsync('developer cannot read the organisation 14 import', async () => {
      for (const pathFor of DETAIL_PATHS) {
        const res = await request(developerServer, pathFor(customerImportId))
        assert.strictEqual(res.status, 404, pathFor(customerImportId))
        assert.deepStrictEqual(res.body, { error: 'Import not found' })
      }
      const comparison = await request(
        developerServer,
        `/api/compare?baseImportId=${customerImportId}&compareImportId=${customerImportId}`,
      )
      assert.strictEqual(comparison.status, 404)
    })

    await testAsync('customer cannot read an organisation 1 import', async () => {
      for (const pathFor of DETAIL_PATHS) {
        const res = await request(customerServer, pathFor(foreignImportId))
        assert.strictEqual(res.status, 404, pathFor(foreignImportId))
        assert.deepStrictEqual(res.body, { error: 'Import not found' })
      }
      const comparison = await request(
        customerServer,
        `/api/compare?baseImportId=${foreignImportId}&compareImportId=${foreignImportId}&organisationId=1`,
      )
      assert.strictEqual(comparison.status, 404)
    })

    await testAsync('customer cannot delete an organisation 1 import', async () => {
      const removed = await request(customerServer, `/api/imports/${foreignImportId}`, {
        method: 'DELETE',
      })
      const reprocess = await request(customerServer, `/api/imports/${foreignImportId}/reprocess`, {
        method: 'POST',
      })
      assert.strictEqual(removed.status, 404)
      assert.strictEqual(reprocess.status, 404)
      const still = await pool.query(
        'SELECT id FROM imports WHERE id = $1 AND organisation_id = 1',
        [foreignImportId],
      )
      assert.strictEqual(still.rows.length, 1)
    })

    await testAsync('developer can still read an existing organisation 1 import', async () => {
      const detail = await request(developerServer, `/api/imports/${foreignImportId}`)
      const rows = await request(developerServer, `/api/imports/${foreignImportId}/rows`)
      assert.strictEqual(detail.status, 200)
      assert.strictEqual(detail.body.id, foreignImportId)
      assert.strictEqual(rows.status, 200)
      assert.ok(rows.body.total > 0)
    })

    let developerImportId
    await testAsync('identical CSV can be stored for both organisations', async () => {
      const file = multipart({ filename: FIXTURE_NAME, content: CSV })
      const res = await request(developerServer, '/api/imports', {
        method: 'POST',
        headers: file.headers,
        body: file.body,
      })
      assert.strictEqual(res.status, 201, JSON.stringify(res.body))
      developerImportId = res.body.id
      assert.strictEqual(res.body.insertedRows, 2)

      const imports = await pool.query(
        `SELECT id, organisation_id FROM imports WHERE id = ANY($1::int[]) ORDER BY organisation_id`,
        [[customerImportId, developerImportId]],
      )
      assert.deepStrictEqual(
        imports.rows.map((row) => row.organisation_id),
        [1, 14],
      )

      for (const table of ['campaigns', 'daily_campaign_metrics', 'daily_keyword_metrics', 'import_rows']) {
        const result = await pool.query(
          table === 'import_rows'
            ? `SELECT organisation_id, COUNT(*)::int AS n
               FROM import_rows
               WHERE import_id = ANY($1::int[])
               GROUP BY organisation_id
               ORDER BY organisation_id`
            : `SELECT organisation_id, COUNT(*)::int AS n
               FROM ${table}
               WHERE app_id = $1
               GROUP BY organisation_id
               ORDER BY organisation_id`,
          table === 'import_rows' ? [[customerImportId, developerImportId]] : [APP_ID],
        )
        assert.deepStrictEqual(
          result.rows.map((row) => row.organisation_id),
          [1, 14],
          table,
        )
        assert.ok(result.rows.every((row) => row.n > 0), table)
      }

      const customerRows = await pool.query(
        'SELECT organisation_id FROM import_rows WHERE import_id = $1',
        [customerImportId],
      )
      assert.ok(customerRows.rows.every((row) => row.organisation_id === 14))

      assert.strictEqual(await orgCounts('campaigns', 1), org1Campaigns)
      assert.strictEqual(await orgCounts('daily_campaign_metrics', 1), org1CampaignMetrics)
      assert.strictEqual(await orgCounts('daily_keyword_metrics', 1), org1KeywordMetrics)

      const developerList = await request(developerServer, '/api/imports')
      const customerList = await request(customerServer, '/api/imports')
      assert.ok(developerList.body.some((row) => row.id === developerImportId))
      assert.ok(developerList.body.every((row) => row.id !== customerImportId))
      assert.ok(customerList.body.some((row) => row.id === customerImportId))
      assert.ok(customerList.body.every((row) => row.id !== developerImportId))
    })

    await testAsync('fixture cleanup restores pre-test organisation 1 counts', async () => {
      await cleanupFixture()
      assert.deepStrictEqual(await idsFor(1), org1ImportIds)
      assert.deepStrictEqual(await idsFor(14), org14ImportIds)
      assert.strictEqual(await count('SELECT COUNT(*)::int AS n FROM campaigns WHERE app_id = $1', [APP_ID]), 0)
      assert.strictEqual(
        await count('SELECT COUNT(*)::int AS n FROM daily_keyword_metrics WHERE app_id = $1', [APP_ID]),
        0,
      )
      assert.strictEqual(
        await count('SELECT COUNT(*)::int AS n FROM imports WHERE original_name = $1', [FIXTURE_NAME]),
        0,
      )
    })
  } finally {
    await cleanupFixture()
    await new Promise((resolve) => publicServer.close(resolve))
    await new Promise((resolve) => customerServer.close(resolve))
    await new Promise((resolve) => developerServer.close(resolve))
    await pool.end()
  }

  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
