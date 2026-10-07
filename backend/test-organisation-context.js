/**
 * P5B organisation resolution.
 * Run: node test-organisation-context.js
 *
 * Unauthenticated requests go through the real Clerk middleware.
 * Authenticated cases inject the verified Clerk user at the P5A boundary.
 * They do not forge session JWTs.
 *
 * Local user 33 is the persistent normal-user case. This file does not delete
 * that user's organisation or membership.
 */
require('dotenv').config()

const assert = require('assert')
const express = require('express')
const http = require('http')
const { pool } = require('./db')
const { assertClerkConfigured } = require('./auth/clerkConfig')
const { createRequireAuthenticatedUser } = require('./auth/middleware')
const { createAuthRouter } = require('./auth/routes')
const {
  BOOTSTRAP_CLERK_USER_ID_ENV,
  DEVELOPMENT_ORGANISATION_NAME,
  OrganisationResolutionError,
  createRequireOrganisationContext,
  isDevelopmentBootstrapUser,
  organisationNameForUser,
  requireOrganisationContext,
  resolveOrganisationForUser,
} = require('./auth/organisationContext')

process.env.CLERK_TELEMETRY_DISABLED = 'true'
process.env.CLERK_PUBLISHABLE_KEY =
  'pk_test_' + Buffer.from('example.clerk.accounts.dev$').toString('base64url')
process.env.CLERK_SECRET_KEY = 'sk_test_p5b_dummy_secret_not_a_real_key'

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
            ? {
                'content-type': 'application/json',
                'content-length': payload.length,
              }
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
          resolve({ status: res.statusCode, body: parsed, text })
        })
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function clerkId(label) {
  return `user_p5b_${process.pid}_${label}_${Date.now()}_${Math.random().toString(16).slice(2)}`
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

async function insertUser({ clerkUserId, email, fullName }) {
  const result = await pool.query(
    `INSERT INTO users (email, full_name, auth_provider, auth_provider_user_id)
     VALUES ($1, $2, 'clerk', $3)
     RETURNING id, email, full_name, auth_provider, auth_provider_user_id`,
    [email, fullName, clerkUserId]
  )
  syntheticClerkIds.push(clerkUserId)
  return result.rows[0]
}

async function membershipsFor(userId) {
  const result = await pool.query(
    `SELECT id, organisation_id, user_id, role
     FROM organisation_users
     WHERE user_id = $1
     ORDER BY id`,
    [userId]
  )
  return result.rows
}

async function organisationCount() {
  const result = await pool.query('SELECT COUNT(*)::int AS n FROM organisations')
  return result.rows[0].n
}

async function developmentOrganisations() {
  const result = await pool.query(
    `SELECT id, organisation_name
     FROM organisations
     WHERE organisation_name = $1
     ORDER BY id`,
    [DEVELOPMENT_ORGANISATION_NAME]
  )
  return result.rows
}

async function customerCounts(organisationId) {
  const tables = await pool.query(
    `SELECT table_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND column_name = 'organisation_id'
       AND table_name <> 'organisation_users'
     ORDER BY table_name`
  )
  const counts = {}
  for (const table of tables.rows) {
    const name = table.table_name
    if (!/^[a-z_]+$/.test(name)) continue
    const result = await pool.query(
      `SELECT COUNT(*)::int AS n FROM ${name} WHERE organisation_id = $1`,
      [organisationId]
    )
    counts[name] = result.rows[0].n
  }
  return counts
}

function contextApp({ user, env, selectMemberships, resolveOrganisation }) {
  const expressApp = express()
  expressApp.use(express.json())
  const requireUser = createRequireAuthenticatedUser({
    getAuthFn: () => ({ isAuthenticated: true, userId: user.authProviderUserId }),
    resolveUser: async () => user,
  })
  const requireOrg = createRequireOrganisationContext({
    env,
    selectMemberships,
    resolveOrganisationForUser: resolveOrganisation,
  })
  expressApp.use(
    '/api/auth',
    createAuthRouter({
      requireAuthenticatedUser: requireUser,
      requireOrganisationContext: requireOrg,
    })
  )
  return expressApp
}

async function cleanupSyntheticUsers(devOrgId) {
  if (syntheticClerkIds.length === 0) return
  const linked = await pool.query(
    `SELECT DISTINCT ou.organisation_id
     FROM organisation_users ou
     JOIN users u ON u.id = ou.user_id
     WHERE u.auth_provider = 'clerk'
       AND u.auth_provider_user_id = ANY($1::text[])
       AND ou.organisation_id <> $2`,
    [syntheticClerkIds, devOrgId]
  )
  const orgIds = linked.rows.map((row) => row.organisation_id)
  await pool.query(
    `DELETE FROM users
     WHERE auth_provider = 'clerk'
       AND auth_provider_user_id = ANY($1::text[])`,
    [syntheticClerkIds]
  )
  if (orgIds.length > 0) {
    await pool.query(
      `DELETE FROM organisations o
       WHERE o.id = ANY($1::int[])
         AND o.id <> $2
         AND o.organisation_name <> $3
         AND NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.organisation_id = o.id)
         AND NOT EXISTS (SELECT 1 FROM imports i WHERE i.organisation_id = o.id)`,
      [orgIds, devOrgId, DEVELOPMENT_ORGANISATION_NAME]
    )
  }
}

async function main() {
  console.log('\n=== P5B organisation resolution ===')

  // The schema is already migrated. initDb() also schedules the import
  // backfill in the background, which this test does not need.
  const devOrgs = await developmentOrganisations()
  assert.strictEqual(devOrgs.length, 1)
  const devOrgId = devOrgs[0].id
  const devCountsBefore = await customerCounts(devOrgId)

  const user33Result = await pool.query(
    `SELECT id, email, full_name, auth_provider, auth_provider_user_id
     FROM users
     WHERE id = 33`
  )
  assert.strictEqual(user33Result.rows.length, 1)
  const user33 = asReqUser(user33Result.rows[0])
  const configuredBootstrap = process.env[BOOTSTRAP_CLERK_USER_ID_ENV]
  assert.notStrictEqual(
    configuredBootstrap,
    user33.authProviderUserId,
    'User 33 must not be configured as the Development Organisation bootstrap identity'
  )
  assert.strictEqual(isDevelopmentBootstrapUser(user33), false)
  assert.strictEqual(
    isDevelopmentBootstrapUser({
      id: 1,
      email: 'dev@example.com',
      authProvider: 'clerk',
      authProviderUserId: 'user_not_configured',
    }),
    false
  )

  const server = await listen(app)
  try {
    await testAsync('A. unauthenticated GET /api/auth/context returns 401', async () => {
      const beforeOrgs = await organisationCount()
      const beforeMemberships = await pool.query('SELECT COUNT(*)::int AS n FROM organisation_users')
      const res = await request(server, '/api/auth/context')
      assert.strictEqual(res.status, 401)
      assert.deepStrictEqual(res.body, { error: 'Unauthorized' })
      assert.strictEqual(await organisationCount(), beforeOrgs)
      const afterMemberships = await pool.query('SELECT COUNT(*)::int AS n FROM organisation_users')
      assert.strictEqual(afterMemberships.rows[0].n, beforeMemberships.rows[0].n)
    })

    await testAsync('A. invalid authentication on organisation context returns 401', async () => {
      const res = await request(server, '/api/auth/context', {
        headers: { authorization: 'Bearer not-a-valid-session' },
      })
      assert.strictEqual(res.status, 401)
      assert.deepStrictEqual(res.body, { error: 'Unauthorized' })
    })

    await testAsync('P5A regression: GET /api/auth/me still returns 401 without a session', async () => {
      const res = await request(server, '/api/auth/me')
      assert.strictEqual(res.status, 401)
      assert.deepStrictEqual(res.body, { error: 'Unauthorized' })
    })

    await testAsync('goals require a session and ignore organisation spoofing', async () => {
      const health = await request(server, '/api/health')
      const goals = await request(server, '/api/goals')
      const spoofed = await request(server, '/api/goals?organisationId=2&organisation_id=4', {
        headers: {
          'x-organisation-id': '2',
          'x-organisationid': '4',
        },
      })
      assert.strictEqual(health.status, 200)
      assert.deepStrictEqual(health.body, { ok: true })
      assert.strictEqual(goals.status, 401)
      assert.strictEqual(spoofed.status, 401)
      assert.deepStrictEqual(goals.body, { error: 'Unauthorized' })
      assert.deepStrictEqual(spoofed.body, { error: 'Unauthorized' })
    })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }

  await testAsync('P5A regression: /api/auth/me does not provision an organisation', async () => {
    const row = await insertUser({
      clerkUserId: clerkId('me'),
      email: `p5b.me.${process.pid}.${Date.now()}@example.com`,
      fullName: 'Me Only',
    })
    const user = asReqUser(row)
    const beforeOrgs = await organisationCount()
    const meApp = express()
    meApp.use(express.json())
    meApp.use(
      '/api/auth',
      createAuthRouter({
        requireAuthenticatedUser: createRequireAuthenticatedUser({
          getAuthFn: () => ({ isAuthenticated: true, userId: user.authProviderUserId }),
          resolveUser: async () => user,
        }),
        requireOrganisationContext,
      })
    )
    const meServer = await listen(meApp)
    try {
      const res = await request(meServer, '/api/auth/me')
      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(res.body, {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      })
      assert.deepStrictEqual(await membershipsFor(user.id), [])
      assert.strictEqual(await organisationCount(), beforeOrgs)
    } finally {
      await new Promise((resolve) => meServer.close(resolve))
    }
  })

  await testAsync('C/G. normal user with no membership gets an isolated owner organisation', async () => {
    const row = await insertUser({
      clerkUserId: clerkId('normal'),
      email: `p5b.normal.${process.pid}.${Date.now()}@example.com`,
      fullName: 'Normal P5B User',
    })
    const user = asReqUser(row)
    const serverApp = contextApp({ user, env: {} })
    const authed = await listen(serverApp)
    try {
      const res = await request(authed, '/api/auth/context')
      const memberships = await membershipsFor(user.id)
      assert.strictEqual(res.status, 200)
      assert.strictEqual(memberships.length, 1)
      assert.strictEqual(memberships[0].role, 'owner')
      assert.strictEqual(res.body.user.id, user.id)
      assert.strictEqual(res.body.user.email, user.email)
      assert.strictEqual(res.body.organisation.id, memberships[0].organisation_id)
      assert.strictEqual(res.body.organisation.role, 'owner')
      assert.strictEqual(res.body.organisation.name, "Normal P5B User's Organisation")
      assert.notStrictEqual(res.body.organisation.id, devOrgId)
      assert.deepStrictEqual(await customerCounts(res.body.organisation.id), emptyCounts(devCountsBefore))
    } finally {
      await new Promise((resolve) => authed.close(resolve))
    }
  })

  await testAsync('D. repeat request keeps the same organisation and membership', async () => {
    const row = await insertUser({
      clerkUserId: clerkId('repeat'),
      email: `p5b.repeat.${process.pid}.${Date.now()}@example.com`,
      fullName: 'Repeat User',
    })
    const user = asReqUser(row)
    const first = await resolveOrganisationForUser(user, { env: {} })
    const orgsAfterFirst = await organisationCount()
    const second = await resolveOrganisationForUser(user, { env: {} })
    const memberships = await membershipsFor(user.id)
    assert.strictEqual(second.id, first.id)
    assert.strictEqual(second.role, 'owner')
    assert.strictEqual(memberships.length, 1)
    assert.strictEqual(memberships[0].organisation_id, first.id)
    assert.strictEqual(await organisationCount(), orgsAfterFirst)
  })

  await testAsync('E. concurrent first requests create one organisation and one membership', async () => {
    const row = await insertUser({
      clerkUserId: clerkId('concurrent'),
      email: `p5b.concurrent.${process.pid}.${Date.now()}@example.com`,
      fullName: 'Concurrent User',
    })
    const user = asReqUser(row)
    const results = await Promise.all(
      [0, 1, 2, 3, 4].map(() => resolveOrganisationForUser(user, { env: {} }))
    )
    const memberships = await membershipsFor(user.id)
    const orgIds = new Set(results.map((item) => item.id))
    assert.strictEqual(orgIds.size, 1)
    assert.strictEqual(memberships.length, 1)
    assert.strictEqual(memberships[0].role, 'owner')
    assert.notStrictEqual(memberships[0].organisation_id, devOrgId)
    assert.deepStrictEqual(await customerCounts(memberships[0].organisation_id), emptyCounts(devCountsBefore))
  })

  await testAsync('F. configured bootstrap identity joins the existing Development Organisation', async () => {
    const bootstrapClerkUserId = clerkId('bootstrap')
    const row = await insertUser({
      clerkUserId: bootstrapClerkUserId,
      email: `p5b.bootstrap.${process.pid}.${Date.now()}@example.com`,
      fullName: 'Configured Developer',
    })
    const user = asReqUser(row)
    const env = { [BOOTSTRAP_CLERK_USER_ID_ENV]: bootstrapClerkUserId }
    assert.strictEqual(isDevelopmentBootstrapUser(user, env), true)
    assert.strictEqual(isDevelopmentBootstrapUser(user33, env), false)
    const beforeOrgs = await organisationCount()
    const beforeDev = await developmentOrganisations()
    const authed = await listen(contextApp({ user, env }))
    try {
      const first = await request(authed, '/api/auth/context')
      const second = await request(authed, '/api/auth/context')
      const memberships = await membershipsFor(user.id)
      assert.strictEqual(first.status, 200)
      assert.strictEqual(second.status, 200)
      assert.strictEqual(first.body.organisation.id, devOrgId)
      assert.strictEqual(second.body.organisation.id, devOrgId)
      assert.strictEqual(first.body.organisation.name, DEVELOPMENT_ORGANISATION_NAME)
      assert.strictEqual(first.body.organisation.role, 'owner')
      assert.strictEqual(memberships.length, 1)
      assert.strictEqual(memberships[0].organisation_id, devOrgId)
      assert.strictEqual(memberships[0].role, 'owner')
      assert.strictEqual(await organisationCount(), beforeOrgs)
      assert.deepStrictEqual(await developmentOrganisations(), beforeDev)
      assert.deepStrictEqual(await customerCounts(devOrgId), devCountsBefore)
    } finally {
      await new Promise((resolve) => authed.close(resolve))
    }
  })

  await testAsync('user 33 resolves an organisation other than Development Organisation', async () => {
    const before = await membershipsFor(33)
    const authed = await listen(contextApp({ user: user33, env: {} }))
    try {
      const first = await request(authed, '/api/auth/context', {
        headers: {
          'x-organisation-id': String(devOrgId),
          'x-user-id': 'user_spoofed',
          'x-user-email': 'spoof@example.com',
        },
      })
      const second = await request(
        authed,
        `/api/auth/context?organisationId=${devOrgId}&organisation_id=2&email=spoof@example.com`,
        {
          method: 'GET',
          headers: {
            'content-type': 'application/json',
            'x-organisation-id': '2',
          },
          body: { organisationId: devOrgId, organisation_id: 4 },
        }
      )
      const memberships = await membershipsFor(33)
      assert.strictEqual(first.status, 200)
      assert.strictEqual(second.status, 200)
      assert.strictEqual(memberships.length, 1)
      assert.strictEqual(memberships[0].role, 'owner')
      assert.strictEqual(first.body.organisation.id, memberships[0].organisation_id)
      assert.strictEqual(second.body.organisation.id, first.body.organisation.id)
      assert.strictEqual(first.body.organisation.name, "P5A Test User's Organisation")
      assert.strictEqual(first.body.user.id, 33)
      assert.strictEqual(first.body.user.email, user33.email)
      assert.notStrictEqual(first.body.organisation.id, devOrgId)
      assert.deepStrictEqual(
        await customerCounts(first.body.organisation.id),
        emptyCounts(devCountsBefore)
      )
      assert.deepStrictEqual(Object.keys(first.body).sort(), ['organisation', 'user'])
      assert.deepStrictEqual(Object.keys(first.body.organisation).sort(), ['id', 'name', 'role'])
      assert.deepStrictEqual(Object.keys(first.body.user).sort(), ['email', 'id'])
      if (before.length === 0) {
        console.log(`    created organisation ${first.body.organisation.id} for user 33`)
      } else {
        console.log(`    reused organisation ${first.body.organisation.id} for user 33`)
      }
      console.log(`    Development Organisation id ${devOrgId}`)
    } finally {
      await new Promise((resolve) => authed.close(resolve))
    }
  })

  await testAsync('H. spoofed organisation id in query, body, and header is ignored', async () => {
    const row = await insertUser({
      clerkUserId: clerkId('spoof'),
      email: `p5b.spoof.${process.pid}.${Date.now()}@example.com`,
      fullName: 'Spoof Target',
    })
    const user = asReqUser(row)
    const authed = await listen(contextApp({ user, env: {} }))
    try {
      const res = await request(authed, `/api/auth/context?organisationId=${devOrgId}&organisation_id=2`, {
        headers: {
          'content-type': 'application/json',
          'x-organisation-id': String(devOrgId),
          'x-organisationid': '2',
        },
        body: {
          organisationId: devOrgId,
          organisation_id: 2,
          email: 'spoof@example.com',
        },
      })
      const memberships = await membershipsFor(user.id)
      assert.strictEqual(res.status, 200)
      assert.strictEqual(memberships.length, 1)
      assert.strictEqual(res.body.organisation.id, memberships[0].organisation_id)
      assert.notStrictEqual(res.body.organisation.id, devOrgId)
      assert.notStrictEqual(res.body.organisation.id, 2)
      assert.strictEqual(res.body.user.email, user.email)
    } finally {
      await new Promise((resolve) => authed.close(resolve))
    }
  })

  await testAsync('I. multiple memberships fail closed', async () => {
    const row = await insertUser({
      clerkUserId: clerkId('multi'),
      email: `p5b.multi.${process.pid}.${Date.now()}@example.com`,
      fullName: 'Multi User',
    })
    const user = asReqUser(row)
    const orgA = await pool.query(
      `INSERT INTO organisations (organisation_name) VALUES ('P5B Multi A') RETURNING id`
    )
    const orgB = await pool.query(
      `INSERT INTO organisations (organisation_name) VALUES ('P5B Multi B') RETURNING id`
    )
    await pool.query(
      `INSERT INTO organisation_users (organisation_id, user_id, role)
       VALUES ($1, $2, 'owner'), ($3, $2, 'admin')`,
      [orgA.rows[0].id, user.id, orgB.rows[0].id]
    )
    await assert.rejects(
      () => resolveOrganisationForUser(user, { env: {} }),
      (err) => {
        assert.ok(err instanceof OrganisationResolutionError)
        assert.strictEqual(err.code, 'multiple_memberships')
        assert.strictEqual(err.status, 500)
        assert.strictEqual(err.details.membershipCount, 2)
        return true
      }
    )
    const authed = await listen(contextApp({ user, env: {} }))
    try {
      const res = await request(authed, `/api/auth/context?organisationId=${orgA.rows[0].id}`, {
        headers: { 'x-organisation-id': String(orgA.rows[0].id) },
        body: { organisationId: orgB.rows[0].id },
      })
      assert.strictEqual(res.status, 500)
      assert.deepStrictEqual(res.body, { error: 'Organisation could not be resolved' })
      assert.strictEqual(JSON.stringify(res.body).includes(String(devOrgId)), false)
    } finally {
      await new Promise((resolve) => authed.close(resolve))
    }
    const memberships = await membershipsFor(user.id)
    assert.strictEqual(memberships.length, 2)
  })

  await testAsync('J. membership pointing at a missing organisation fails closed', async () => {
    const row = await insertUser({
      clerkUserId: clerkId('invalid'),
      email: `p5b.invalid.${process.pid}.${Date.now()}@example.com`,
      fullName: 'Invalid Membership',
    })
    const user = asReqUser(row)
    const beforeOrgs = await organisationCount()
    const selectMemberships = async () => [
      {
        membership_id: 1,
        organisation_id: 424242,
        role: 'owner',
        resolved_organisation_id: null,
        organisation_name: null,
      },
    ]
    await assert.rejects(
      () => resolveOrganisationForUser(user, { env: {}, selectMemberships }),
      (err) => {
        assert.strictEqual(err.code, 'invalid_membership')
        assert.notStrictEqual(err.code, undefined)
        return true
      }
    )
    const authed = await listen(contextApp({ user, env: {}, selectMemberships }))
    try {
      const res = await request(authed, '/api/auth/context')
      assert.strictEqual(res.status, 500)
      assert.deepStrictEqual(res.body, { error: 'Organisation could not be resolved' })
    } finally {
      await new Promise((resolve) => authed.close(resolve))
    }
    assert.deepStrictEqual(await membershipsFor(user.id), [])
    assert.strictEqual(await organisationCount(), beforeOrgs)
  })

  await testAsync('K. database error does not fall back to Development Organisation', async () => {
    const row = await insertUser({
      clerkUserId: clerkId('dberror'),
      email: `p5b.dberror.${process.pid}.${Date.now()}@example.com`,
      fullName: 'Database Error',
    })
    const user = asReqUser(row)
    const beforeOrgs = await organisationCount()
    const beforeDevMemberships = await pool.query(
      'SELECT COUNT(*)::int AS n FROM organisation_users WHERE organisation_id = $1',
      [devOrgId]
    )
    await assert.rejects(
      () =>
        resolveOrganisationForUser(user, {
          env: {},
          selectMemberships: async () => {
            const err = new Error('connection reset')
            err.code = '08006'
            throw err
          },
        }),
      (err) => {
        assert.strictEqual(err.code, '08006')
        assert.notStrictEqual(err.id, devOrgId)
        return true
      }
    )

    const authed = await listen(
      contextApp({
        user,
        env: {},
        resolveOrganisation: async () => {
          const err = new Error('connection reset')
          err.code = '08006'
          throw err
        },
      })
    )
    try {
      const res = await request(authed, `/api/auth/context?organisationId=${devOrgId}`, {
        headers: { 'x-organisation-id': String(devOrgId) },
        body: { organisationId: devOrgId },
      })
      assert.strictEqual(res.status, 500)
      assert.deepStrictEqual(res.body, { error: 'Organisation could not be resolved' })
    } finally {
      await new Promise((resolve) => authed.close(resolve))
    }

    assert.deepStrictEqual(await membershipsFor(user.id), [])
    assert.strictEqual(await organisationCount(), beforeOrgs)
    const afterDevMemberships = await pool.query(
      'SELECT COUNT(*)::int AS n FROM organisation_users WHERE organisation_id = $1',
      [devOrgId]
    )
    assert.strictEqual(afterDevMemberships.rows[0].n, beforeDevMemberships.rows[0].n)
  })

  await testAsync('missing Development Organisation does not provision a replacement', async () => {
    const calls = []
    const fakePool = {
      async connect() {
        return {
          async query(sql) {
            calls.push(sql)
            if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [] }
            if (sql.includes('FOR UPDATE')) return { rows: [{ id: 1 }] }
            if (sql.includes('FROM organisation_users')) return { rows: [] }
            if (sql.includes('FROM organisations')) return { rows: [] }
            if (sql.includes('INSERT INTO organisations')) {
              throw new Error('bootstrap failure provisioned an organisation')
            }
            throw new Error(`unexpected query: ${sql}`)
          },
          release() {},
        }
      },
    }
    await assert.rejects(
      () =>
        resolveOrganisationForUser(
          {
            id: 1,
            authProvider: 'clerk',
            authProviderUserId: 'user_configured_missing_org',
            fullName: 'Missing Org',
          },
          {
            pool: fakePool,
            env: { [BOOTSTRAP_CLERK_USER_ID_ENV]: 'user_configured_missing_org' },
          }
        ),
      (err) => {
        assert.strictEqual(err.code, 'development_organisation_unresolved')
        return true
      }
    )
    assert.ok(!calls.some((sql) => sql.includes('INSERT INTO organisations')))
  })

  await testAsync('bootstrap is not inferred from email, user id, or request order', async () => {
    assert.strictEqual(organisationNameForUser({ fullName: 'P5A Test User' }), "P5A Test User's Organisation")
    assert.strictEqual(organisationNameForUser({ fullName: '  ' }), "User's Organisation")
    assert.strictEqual(
      isDevelopmentBootstrapUser(
        {
          id: 33,
          email: 'owner@yourdomain.com',
          authProvider: 'clerk',
          authProviderUserId: user33.authProviderUserId,
        },
        { [BOOTSTRAP_CLERK_USER_ID_ENV]: 'user_someone_else' }
      ),
      false
    )
    assert.strictEqual(
      isDevelopmentBootstrapUser(
        {
          id: 1,
          email: 'first@example.com',
          authProvider: 'clerk',
          authProviderUserId: 'user_first',
        },
        {}
      ),
      false
    )
  })

  const user33Memberships = await membershipsFor(33)
  assert.strictEqual(user33Memberships.length, 1)
  assert.notStrictEqual(user33Memberships[0].organisation_id, devOrgId)

  await cleanupSyntheticUsers(devOrgId)

  const devAfter = await developmentOrganisations()
  assert.deepStrictEqual(devAfter, devOrgs)
  assert.deepStrictEqual(await customerCounts(devOrgId), devCountsBefore)
  const user33After = await membershipsFor(33)
  assert.strictEqual(user33After.length, 1)
  assert.strictEqual(user33After[0].organisation_id, user33Memberships[0].organisation_id)

  console.log(`\n${passed} passed`)
  console.log(
    `user 33 organisation id ${user33After[0].organisation_id}; Development Organisation id ${devOrgId}`
  )
  await pool.end()
}

function emptyCounts(template) {
  return Object.fromEntries(Object.keys(template).map((key) => [key, 0]))
}

main().catch(async (err) => {
  console.error(err)
  try {
    const dev = await developmentOrganisations()
    if (dev.length === 1) await cleanupSyntheticUsers(dev[0].id)
  } catch (cleanupErr) {
    console.error('cleanup failed', cleanupErr.code || cleanupErr.message)
  }
  try {
    await pool.end()
  } catch {
    // pool may already be closed
  }
  process.exit(1)
})
