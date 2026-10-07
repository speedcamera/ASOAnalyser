/**
 * P5A Clerk authentication foundation.
 * Run: node test-clerk-auth.js
 *
 * Missing and invalid sessions go through the real @clerk/express middleware.
 * Valid-user cases inject the verified Clerk user id at the application
 * middleware boundary (the value getAuth returns after verification) and a
 * trusted profile fetch. They do not forge session JWTs.
 */
require('dotenv').config()

const assert = require('assert')
const express = require('express')
const { spawnSync } = require('child_process')
const { initDb, pool } = require('./db')
const { assertClerkConfigured } = require('./auth/clerkConfig')
const { resolveLocalUser, AUTH_PROVIDER } = require('./auth/localUser')
const { createRequireAuthenticatedUser } = require('./auth/middleware')
const { createAuthRouter } = require('./auth/routes')

process.env.CLERK_TELEMETRY_DISABLED = 'true'
process.env.CLERK_PUBLISHABLE_KEY =
  'pk_test_' + Buffer.from('example.clerk.accounts.dev$').toString('base64url')
process.env.CLERK_SECRET_KEY = 'sk_test_p5a_dummy_secret_not_a_real_key'

assertClerkConfigured()

const { app } = require('./index')

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

async function request(server, path, { method = 'GET', headers, body } = {}) {
  const { port } = server.address()
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let parsed = text
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = text
  }
  return { status: response.status, body: parsed, text }
}

function clerkId(label) {
  return `user_p5a_${process.pid}_${label}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

async function counts() {
  const organisations = await pool.query('SELECT COUNT(*)::int AS n FROM organisations')
  const memberships = await pool.query('SELECT COUNT(*)::int AS n FROM organisation_users')
  return {
    organisations: organisations.rows[0].n,
    memberships: memberships.rows[0].n,
  }
}

async function usersFor(providerUserId) {
  const result = await pool.query(
    `SELECT id, email, full_name, auth_provider, auth_provider_user_id
     FROM users
     WHERE auth_provider = $1 AND auth_provider_user_id = $2
     ORDER BY id`,
    [AUTH_PROVIDER, providerUserId]
  )
  return result.rows
}

async function main() {
  console.log('\n=== P5A Clerk authentication ===')
  await initDb()

  const createdIds = []

  await testAsync('startup fails clearly when Clerk keys are missing', async () => {
    const env = { ...process.env }
    // Empty values count as missing, and dotenv will not replace variables
    // that are already present. Deleting them lets backend/.env supply real keys.
    env.CLERK_PUBLISHABLE_KEY = ''
    env.CLERK_SECRET_KEY = ''
    const result = spawnSync(process.execPath, ['index.js'], {
      cwd: __dirname,
      env,
      encoding: 'utf8',
      timeout: 15000,
    })
    assert.strictEqual(result.status, 1)
    const output = `${result.stdout || ''}\n${result.stderr || ''}`
    assert.match(output, /CLERK_PUBLISHABLE_KEY/)
    assert.match(output, /CLERK_SECRET_KEY/)
    assert.doesNotMatch(output, /sk_test_|sk_live_|pk_test_|pk_live_|Bearer /)
  })

  const server = await listen(app)
  try {
    await testAsync('A. no authentication on GET /api/auth/me returns 401', async () => {
      const res = await request(server, '/api/auth/me')
      assert.strictEqual(res.status, 401)
      assert.deepStrictEqual(res.body, { error: 'Unauthorized' })
    })

    await testAsync('B. invalid authentication returns 401', async () => {
      const res = await request(server, '/api/auth/me', {
        headers: { authorization: 'Bearer not-a-valid-session' },
      })
      assert.strictEqual(res.status, 401)
      assert.deepStrictEqual(res.body, { error: 'Unauthorized' })
    })

    await testAsync('B. expired-looking authentication returns 401', async () => {
      const res = await request(server, '/api/auth/me', {
        headers: {
          authorization:
            'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyX3Rlc3QiLCJleHAiOjEwfQ.sig',
        },
      })
      assert.strictEqual(res.status, 401)
      assert.deepStrictEqual(res.body, { error: 'Unauthorized' })
    })

    await testAsync('G. spoofed identity headers do not authenticate the real endpoint', async () => {
      const res = await request(server, '/api/auth/me?userId=user_spoofed', {
        headers: {
          'x-user-id': 'user_spoofed',
          'x-user-email': 'spoof@example.com',
        },
      })
      assert.strictEqual(res.status, 401)
    })

    await testAsync('J. health stays public and apps require a session', async () => {
      const before = await counts()
      const beforeUsers = await pool.query('SELECT COUNT(*)::int AS n FROM users')
      const health = await request(server, '/api/health')
      const apps = await request(server, '/api/apps')
      const after = await counts()
      const afterUsers = await pool.query('SELECT COUNT(*)::int AS n FROM users')
      assert.strictEqual(health.status, 200)
      assert.deepStrictEqual(health.body, { ok: true })
      assert.strictEqual(apps.status, 401)
      assert.deepStrictEqual(before, after)
      assert.strictEqual(beforeUsers.rows[0].n, afterUsers.rows[0].n)
    })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }

const verifiedClerkId = clerkId('verified')
const spoofClerkId = clerkId('spoof')
const profile = {
  email: `ada.${process.pid}.${Date.now()}@example.com`,
  fullName: 'Ada Lovelace',
}
  const profiles = new Map([[verifiedClerkId, { ...profile }]])

  async function fetchClerkProfile(id) {
    const found = profiles.get(id)
    if (!found) {
      const err = new Error('Unauthorized')
      err.status = 401
      throw err
    }
    return { email: found.email, fullName: found.fullName }
  }

  const authed = express()
  authed.use(express.json())
  const requireUser = createRequireAuthenticatedUser({
    getAuthFn: () => ({ isAuthenticated: true, userId: verifiedClerkId }),
    resolveUser: (id) => resolveLocalUser(id, { fetchClerkProfile }),
  })
  authed.use('/api/auth', createAuthRouter({ requireAuthenticatedUser: requireUser }))
  authed.post('/probe', requireUser, (req, res) => {
    res.json({
      id: req.user.id,
      email: req.user.email,
      fullName: req.user.fullName,
    })
  })
  authed.get('/internal-user', requireUser, (req, res) => {
    res.json(req.user)
  })

  const authedServer = await listen(authed)
  try {
    await testAsync('C. first verified login creates exactly one local user', async () => {
      createdIds.push(verifiedClerkId)
      const before = await counts()
      const res = await request(authedServer, '/api/auth/me', {
        headers: {
          'x-user-id': spoofClerkId,
          'x-user-email': 'spoof@example.com',
        },
      })
      const rows = await usersFor(verifiedClerkId)
      assert.strictEqual(res.status, 200)
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(res.body.id, rows[0].id)
      assert.notStrictEqual(res.body.id, verifiedClerkId)
      assert.strictEqual(res.body.email, profile.email)
      assert.strictEqual(res.body.fullName, profile.fullName)
      assert.deepStrictEqual(Object.keys(res.body).sort(), ['email', 'fullName', 'id'])
      assert.strictEqual(JSON.stringify(res.body).includes(verifiedClerkId), false)
      const internal = await request(authedServer, '/internal-user')
      assert.strictEqual(internal.body.authProvider, AUTH_PROVIDER)
      assert.strictEqual(internal.body.authProviderUserId, verifiedClerkId)
      assert.strictEqual(internal.body.id, rows[0].id)
      const memberships = await pool.query(
        'SELECT COUNT(*)::int AS n FROM organisation_users WHERE user_id = $1',
        [rows[0].id]
      )
      assert.strictEqual(memberships.rows[0].n, 0)
      assert.deepStrictEqual(before, await counts())
    })

    await testAsync('D. repeat authenticated request reuses the same local user', async () => {
      const res = await request(authedServer, '/api/auth/me')
      const rows = await usersFor(verifiedClerkId)
      assert.strictEqual(res.status, 200)
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(res.body.id, rows[0].id)
    })

    await testAsync('E. concurrent first requests create one user and both succeed', async () => {
      const concurrentId = clerkId('concurrent')
      profiles.set(concurrentId, {
        email: `grace.${process.pid}.${Date.now()}@example.com`,
        fullName: 'Grace Hopper',
      })
      createdIds.push(concurrentId)
      const before = await counts()
      const [first, second] = await Promise.all([
        resolveLocalUser(concurrentId, { fetchClerkProfile }),
        resolveLocalUser(concurrentId, { fetchClerkProfile }),
      ])
      const rows = await usersFor(concurrentId)
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(first.id, rows[0].id)
      assert.strictEqual(second.id, rows[0].id)
      assert.strictEqual(first.email, profiles.get(concurrentId).email)
      const memberships = await pool.query(
        'SELECT COUNT(*)::int AS n FROM organisation_users WHERE user_id = $1',
        [rows[0].id]
      )
      assert.strictEqual(memberships.rows[0].n, 0)
      assert.deepStrictEqual(before, await counts())
    })

    await testAsync('F. changed trusted email updates the same local user', async () => {
      const rowsBefore = await usersFor(verifiedClerkId)
      const nextEmail = `ada.moved.${process.pid}.${Date.now()}@example.com`
      profiles.set(verifiedClerkId, {
        email: nextEmail,
        fullName: 'Ada Lovelace Byron',
      })
      const res = await request(authedServer, '/api/auth/me')
      const rows = await usersFor(verifiedClerkId)
      assert.strictEqual(res.status, 200)
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(rows[0].id, rowsBefore[0].id)
      assert.strictEqual(res.body.id, rowsBefore[0].id)
      assert.strictEqual(res.body.email, nextEmail)
      assert.strictEqual(res.body.fullName, 'Ada Lovelace Byron')
      assert.strictEqual(rows[0].email, nextEmail)
    })

    await testAsync('G. body, query, and header identity are ignored', async () => {
      const headerQuery = await request(
        authedServer,
        `/api/auth/me?userId=${encodeURIComponent(spoofClerkId)}&email=spoof@example.com`,
        {
          headers: {
            'x-user-id': spoofClerkId,
            'x-user-email': 'spoof@example.com',
          },
        }
      )
      const withBody = await request(
        authedServer,
        `/probe?userId=${encodeURIComponent(spoofClerkId)}&email=spoof@example.com`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-user-id': spoofClerkId,
            'x-user-email': 'spoof@example.com',
          },
          body: {
            userId: spoofClerkId,
            email: 'spoof@example.com',
            fullName: 'Spoofed Name',
          },
        }
      )
      const rows = await usersFor(verifiedClerkId)
      const spoofRows = await usersFor(spoofClerkId)
      assert.strictEqual(headerQuery.status, 200)
      assert.strictEqual(withBody.status, 200)
      assert.strictEqual(headerQuery.body.id, rows[0].id)
      assert.strictEqual(withBody.body.id, rows[0].id)
      assert.strictEqual(withBody.body.email, profiles.get(verifiedClerkId).email)
      assert.strictEqual(withBody.body.fullName, profiles.get(verifiedClerkId).fullName)
      assert.notStrictEqual(withBody.body.email, 'spoof@example.com')
      assert.strictEqual(spoofRows.length, 0)
    })
  } finally {
    await new Promise((resolve) => authedServer.close(resolve))
    if (createdIds.length > 0) {
      await pool.query(
        `DELETE FROM users
         WHERE auth_provider = 'clerk'
           AND auth_provider_user_id = ANY($1::text[])`,
        [createdIds]
      )
    }
  }

  await testAsync('H. users table has no password or session storage', async () => {
    const columns = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'users'`
    )
    const names = columns.rows.map((row) => row.column_name)
    assert.ok(names.includes('auth_provider'))
    assert.ok(names.includes('auth_provider_user_id'))
    assert.ok(!names.some((name) => name.toLowerCase().includes('password')))
    const tables = await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND (
           table_name ILIKE '%session%'
           OR table_name ILIKE '%password%'
         )`
    )
    assert.deepStrictEqual(tables.rows, [])
    const index = await pool.query(
      `SELECT indexdef
       FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'idx_users_provider_identity'`
    )
    assert.strictEqual(index.rows.length, 1)
    assert.match(index.rows[0].indexdef, /UNIQUE/)
    assert.match(index.rows[0].indexdef, /auth_provider/)
    assert.match(index.rows[0].indexdef, /auth_provider_user_id/)
  })

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
