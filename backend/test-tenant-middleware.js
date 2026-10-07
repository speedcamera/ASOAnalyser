/**
 * P5C.1 shared authenticated tenant middleware.
 * Run: node test-tenant-middleware.js
 *
 * Real users 33 and 73 are resolved through the shared chain with the
 * verified Clerk user id injected at the P5A boundary. No session JWT is forged.
 * Synthetic fixtures are removed afterwards.
 */
require('dotenv').config()

const assert = require('assert')
const express = require('express')
const http = require('http')
const { pool } = require('./db')
const { assertClerkConfigured } = require('./auth/clerkConfig')
const { createAuthRouter } = require('./auth/routes')
const { createRequireAuthenticatedTenant } = require('./auth/tenantMiddleware')

process.env.CLERK_TELEMETRY_DISABLED = 'true'
process.env.CLERK_PUBLISHABLE_KEY =
  'pk_test_' + Buffer.from('example.clerk.accounts.dev$').toString('base64url')
process.env.CLERK_SECRET_KEY = 'sk_test_p5c1_dummy_secret_not_a_real_key'

assertClerkConfigured()

const { app } = require('./index')

let passed = 0
const syntheticClerkIds = []

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

function request(server, path, { method = 'GET', headers, body } = {}) {
  const { port } = server.address()
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body))
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
      }
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

function tenantApp(user, extra = {}) {
  const expressApp = express()
  expressApp.use(express.json())
  const chain = createRequireAuthenticatedTenant({
    getAuthFn: () => ({ isAuthenticated: true, userId: user.authProviderUserId }),
    resolveUser: async () => user,
    ...extra,
  })
  expressApp.use(
    '/api/auth',
    createAuthRouter({
      requireAuthenticatedUser: chain[0],
      requireAuthenticatedTenant: chain,
    })
  )
  return expressApp
}

async function membershipsFor(userId) {
  const result = await pool.query(
    `SELECT id, organisation_id, role FROM organisation_users WHERE user_id = $1 ORDER BY id`,
    [userId]
  )
  return result.rows
}

async function organisationCount() {
  const result = await pool.query('SELECT COUNT(*)::int AS n FROM organisations')
  return result.rows[0].n
}

async function main() {
  console.log('\n=== P5C.1 shared tenant middleware ===')

  const users = await pool.query(
    `SELECT id, email, full_name, auth_provider, auth_provider_user_id
     FROM users WHERE id IN (33, 73) ORDER BY id`
  )
  assert.strictEqual(users.rows.length, 2)
  const user33 = asReqUser(users.rows.find((row) => row.id === 33))
  const user73 = asReqUser(users.rows.find((row) => row.id === 73))
  const before33 = await membershipsFor(33)
  const before73 = await membershipsFor(73)
  assert.strictEqual(before33.length, 1)
  assert.strictEqual(before33[0].organisation_id, 14)
  assert.strictEqual(before73.length, 1)
  assert.strictEqual(before73[0].organisation_id, 1)

  const server = await listen(app)
  try {
    await testAsync('unauthenticated GET /api/auth/context returns 401', async () => {
      const res = await request(server, '/api/auth/context')
      assert.strictEqual(res.status, 401)
      assert.deepStrictEqual(res.body, { error: 'Unauthorized' })
    })

    await testAsync('removed GET /api/auth/tenant-test is not mounted', async () => {
      const res = await request(server, '/api/auth/tenant-test')
      assert.strictEqual(res.status, 404)
      assert.deepStrictEqual(res.body, { error: 'Not found' })
    })

    await testAsync('invalid authentication returns 401', async () => {
      const res = await request(server, '/api/auth/context', {
        headers: { authorization: 'Bearer not-a-valid-session' },
      })
      assert.strictEqual(res.status, 401)
      assert.deepStrictEqual(res.body, { error: 'Unauthorized' })
    })

    await testAsync('goals, imports, and core analytics require auth', async () => {
      const health = await request(server, '/api/health')
      const goals = await request(server, '/api/goals')
      const imports = await request(server, '/api/imports')
      const period = await request(server, '/api/compare/period?days=7')
      const spoofed = await request(server, '/api/imports?organisationId=14', {
        headers: { 'x-organisation-id': '14' },
      })
      assert.strictEqual(health.status, 200)
      assert.strictEqual(goals.status, 401)
      assert.strictEqual(imports.status, 401)
      assert.strictEqual(period.status, 401)
      assert.deepStrictEqual(goals.body, { error: 'Unauthorized' })
      assert.deepStrictEqual(imports.body, { error: 'Unauthorized' })
      assert.deepStrictEqual(period.body, { error: 'Unauthorized' })
      assert.strictEqual(spoofed.status, 401)
    })

    await testAsync('P5A /api/auth/me remains 401 without a session', async () => {
      const res = await request(server, '/api/auth/me')
      assert.strictEqual(res.status, 401)
      assert.deepStrictEqual(res.body, { error: 'Unauthorized' })
    })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }

  await testAsync('developer user 73 resolves organisation 1 through the shared chain', async () => {
    const authed = await listen(tenantApp(user73))
    try {
      const first = await request(authed, '/api/auth/context')
      const second = await request(authed, '/api/auth/context')
      assert.strictEqual(first.status, 200)
      assert.strictEqual(first.body.user.id, 73)
      assert.strictEqual(first.body.organisation.id, 1)
      assert.strictEqual(second.body.user.id, 73)
      assert.strictEqual(second.body.organisation.id, 1)
      assert.deepStrictEqual(await membershipsFor(73), before73)
    } finally {
      await new Promise((resolve) => authed.close(resolve))
    }
  })

  await testAsync('external user 33 resolves organisation 14 through the shared chain', async () => {
    const authed = await listen(tenantApp(user33))
    try {
      const first = await request(authed, '/api/auth/context')
      const second = await request(authed, '/api/auth/context')
      assert.strictEqual(first.body.user.id, 33)
      assert.strictEqual(first.body.organisation.id, 14)
      assert.strictEqual(second.body.organisation.id, 14)
      assert.notStrictEqual(first.body.organisation.id, 1)
      assert.deepStrictEqual(await membershipsFor(33), before33)
    } finally {
      await new Promise((resolve) => authed.close(resolve))
    }
  })

  await testAsync('spoofed organisation id is ignored by the shared chain', async () => {
    const authed = await listen(tenantApp(user33))
    try {
      const res = await request(
        authed,
        '/api/auth/context?organisationId=1&organisation_id=21&email=spoof@example.com',
        {
          headers: {
            'content-type': 'application/json',
            'x-organisation-id': '1',
          },
          body: { organisationId: 1, organisation_id: 21, email: 'spoof@example.com' },
        }
      )
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.body.user.id, 33)
      assert.strictEqual(res.body.organisation.id, 14)
    } finally {
      await new Promise((resolve) => authed.close(resolve))
    }
  })

  await testAsync('multiple memberships fail closed through the shared chain', async () => {
    const authed = await listen(tenantApp(user33, {
      selectMemberships: async () => [
        { membership_id: 1, organisation_id: 1, role: 'owner', resolved_organisation_id: 1, organisation_name: 'Development Organisation' },
        { membership_id: 2, organisation_id: 14, role: 'owner', resolved_organisation_id: 14, organisation_name: "P5A Test User's Organisation" },
      ],
    }))
    try {
      const res = await request(authed, '/api/auth/context?organisationId=1', {
        headers: { 'x-organisation-id': '1' },
        body: { organisationId: 1 },
      })
      assert.strictEqual(res.status, 500)
      assert.deepStrictEqual(res.body, { error: 'Organisation could not be resolved' })
      assert.deepStrictEqual(await membershipsFor(33), before33)
    } finally {
      await new Promise((resolve) => authed.close(resolve))
    }
  })

  await testAsync('missing organisation fails closed and does not use Development Organisation', async () => {
    const beforeOrgs = await organisationCount()
    const beforeDevMembers = await pool.query(
      'SELECT COUNT(*)::int AS n FROM organisation_users WHERE organisation_id = 1'
    )
    const authed = await listen(tenantApp(user33, {
      selectMemberships: async () => [
        {
          membership_id: 1,
          organisation_id: 424242,
          role: 'owner',
          resolved_organisation_id: null,
          organisation_name: null,
        },
      ],
    }))
    try {
      const res = await request(authed, '/api/auth/context')
      assert.strictEqual(res.status, 500)
      assert.deepStrictEqual(res.body, { error: 'Organisation could not be resolved' })
    } finally {
      await new Promise((resolve) => authed.close(resolve))
    }
    assert.strictEqual(await organisationCount(), beforeOrgs)
    const afterDevMembers = await pool.query(
      'SELECT COUNT(*)::int AS n FROM organisation_users WHERE organisation_id = 1'
    )
    assert.strictEqual(afterDevMembers.rows[0].n, beforeDevMembers.rows[0].n)
    assert.deepStrictEqual(await membershipsFor(33), before33)
  })

  await testAsync('database errors do not fall back to Development Organisation', async () => {
    const authed = await listen(tenantApp(user33, {
      resolveOrganisationForUser: async () => {
        const err = new Error('connection reset')
        err.code = '08006'
        throw err
      },
    }))
    try {
      const res = await request(authed, '/api/auth/context?organisationId=1', {
        headers: { 'x-organisation-id': '1' },
        body: { organisationId: 1 },
      })
      assert.strictEqual(res.status, 500)
      assert.deepStrictEqual(res.body, { error: 'Organisation could not be resolved' })
      assert.deepStrictEqual(await membershipsFor(33), before33)
      assert.deepStrictEqual(await membershipsFor(73), before73)
    } finally {
      await new Promise((resolve) => authed.close(resolve))
    }
  })

  assert.deepStrictEqual(await membershipsFor(33), before33)
  assert.deepStrictEqual(await membershipsFor(73), before73)
  assert.strictEqual(syntheticClerkIds.length, 0)

  console.log(`\n${passed} passed`)
  await pool.end()
}

main().catch(async (err) => {
  console.error(err)
  try {
    await pool.end()
  } catch {
    // pool may already be closed
  }
  process.exit(1)
})
