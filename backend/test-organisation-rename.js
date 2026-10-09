/**
 * Phase 7B.2 owner-only organisation rename.
 * Run: node test-organisation-rename.js
 *
 * Unauthenticated requests use the real application.
 * Authenticated requests inject the local user at the Clerk boundary.
 * They do not forge session JWTs.
 * Synthetic organisations and users are removed afterwards.
 */
require('dotenv').config()

const assert = require('assert')
const express = require('express')
const http = require('http')
const { pool } = require('./db')
const { assertClerkConfigured } = require('./auth/clerkConfig')
const { createAuthRouter } = require('./auth/routes')
const { createRequireAuthenticatedTenant } = require('./auth/tenantMiddleware')
const { MAX_ORGANISATION_NAME } = require('./http/requestValidation')

process.env.CLERK_TELEMETRY_DISABLED = 'true'
process.env.CLERK_PUBLISHABLE_KEY =
  'pk_test_' + Buffer.from('example.clerk.accounts.dev$').toString('base64url')
process.env.CLERK_SECRET_KEY = 'sk_test_p7b2_dummy_secret_not_a_real_key'

assertClerkConfigured()

const { app } = require('./index')

let passed = 0
const stamp = `${process.pid}_${Date.now()}`
const createdUserIds = []
const createdOrganisationIds = []

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

function renameApp(user) {
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
    })
  )
  expressApp.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })
  return expressApp
}

async function organisationRow(id) {
  const result = await pool.query(
    `SELECT id, organisation_name, updated_at
     FROM organisations
     WHERE id = $1`,
    [id]
  )
  return result.rows[0]
}

async function organisationCount() {
  const result = await pool.query('SELECT COUNT(*)::int AS n FROM organisations')
  return result.rows[0].n
}

async function insertUser(roleLabel) {
  const result = await pool.query(
    `INSERT INTO users (email, full_name, auth_provider, auth_provider_user_id)
     VALUES ($1, $2, 'clerk', $3)
     RETURNING id, email, full_name, auth_provider, auth_provider_user_id`,
    [
      `p7b2-${roleLabel}-${stamp}@example.com`,
      `P7B2 ${roleLabel}`,
      `user_p7b2_${stamp}_${roleLabel}`,
    ]
  )
  const user = asReqUser(result.rows[0])
  createdUserIds.push(user.id)
  return user
}

async function insertOrganisation(name) {
  const result = await pool.query(
    `INSERT INTO organisations (organisation_name)
     VALUES ($1)
     RETURNING id`,
    [name]
  )
  createdOrganisationIds.push(result.rows[0].id)
  return result.rows[0].id
}

async function insertMembership(organisationId, userId, role) {
  await pool.query(
    `INSERT INTO organisation_users (organisation_id, user_id, role)
     VALUES ($1, $2, $3)`,
    [organisationId, userId, role]
  )
}

async function cleanup(userIds, organisationIds) {
  if (userIds.length > 0) {
    await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [userIds])
  }
  if (organisationIds.length > 0) {
    await pool.query(
      `DELETE FROM organisations o
       WHERE o.id = ANY($1::int[])
         AND NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.organisation_id = o.id)
         AND NOT EXISTS (SELECT 1 FROM imports i WHERE i.organisation_id = o.id)
         AND NOT EXISTS (SELECT 1 FROM organisation_users ou WHERE ou.organisation_id = o.id)`,
      [organisationIds]
    )
  }
}

async function main() {
  console.log('\n=== Phase 7B.2 organisation rename ===')

  const server = await listen(app)
  const owner = await insertUser('owner')
  const admin = await insertUser('admin')
  const analyst = await insertUser('analyst')
  const ownOrganisationId = await insertOrganisation(`P7B2 Own ${stamp}`)
  const otherOrganisationId = await insertOrganisation(`P7B2 Other ${stamp}`)
  const userIds = [owner.id, admin.id, analyst.id]
  const organisationIds = [ownOrganisationId, otherOrganisationId]
  await insertMembership(ownOrganisationId, owner.id, 'owner')
  await insertMembership(ownOrganisationId, admin.id, 'admin')
  await insertMembership(ownOrganisationId, analyst.id, 'analyst')

  const ownerServer = await listen(renameApp(owner))
  const adminServer = await listen(renameApp(admin))
  const analystServer = await listen(renameApp(analyst))
  const otherBefore = await organisationRow(otherOrganisationId)
  const countBefore = await organisationCount()

  try {
    await testAsync('unauthenticated rename is rejected', async () => {
      const res = await request(server, '/api/auth/organisation', {
        method: 'PATCH',
        body: { name: 'Should not apply', organisationId: ownOrganisationId },
        headers: { 'x-organisation-id': String(otherOrganisationId) },
      })
      assert.strictEqual(res.status, 401)
      assert.deepStrictEqual(res.body, { error: 'Unauthorized' })
      assert.strictEqual(
        (await organisationRow(ownOrganisationId)).organisation_name,
        `P7B2 Own ${stamp}`
      )
    })

    await testAsync('an organisation id in the URL is not a rename route', async () => {
      const byId = await request(server, `/api/organisations/${otherOrganisationId}`, {
        method: 'PATCH',
        body: { name: 'Should not apply' },
      })
      const authById = await request(
        ownerServer,
        `/api/auth/organisation/${otherOrganisationId}`,
        { method: 'PATCH', body: { name: 'Should not apply' } }
      )
      assert.strictEqual(byId.status, 404)
      assert.strictEqual(authById.status, 404)
      assert.strictEqual(
        (await organisationRow(otherOrganisationId)).organisation_name,
        otherBefore.organisation_name
      )
    })

    await testAsync('admin and analyst cannot rename, including a supplied owner role', async () => {
      for (const memberServer of [adminServer, analystServer]) {
        const res = await request(memberServer, '/api/auth/organisation', {
          method: 'PATCH',
          body: {
            name: 'Hijacked',
            role: 'owner',
            organisationId: ownOrganisationId,
          },
        })
        assert.strictEqual(res.status, 403)
        assert.deepStrictEqual(res.body, { error: 'You do not have access to this' })
      }
      assert.strictEqual(
        (await organisationRow(ownOrganisationId)).organisation_name,
        `P7B2 Own ${stamp}`
      )
    })

    await testAsync('empty, whitespace, oversized, and non-string names are rejected', async () => {
      const cases = [
        ['', 'Organisation name is required'],
        ['   ', 'Organisation name is required'],
        ['A'.repeat(MAX_ORGANISATION_NAME + 1), 'Organisation name is too long'],
        [12, 'Organisation name must be text'],
        [{ nested: true }, 'Organisation name must be text'],
        [null, 'Organisation name must be text'],
        [true, 'Organisation name must be text'],
      ]
      for (const [name, error] of cases) {
        const res = await request(ownerServer, '/api/auth/organisation', {
          method: 'PATCH',
          body: name === undefined ? {} : { name },
        })
        assert.strictEqual(res.status, 400)
        assert.deepStrictEqual(res.body, { error })
      }
      const missing = await request(ownerServer, '/api/auth/organisation', {
        method: 'PATCH',
        body: {},
      })
      assert.strictEqual(missing.status, 400)
      assert.deepStrictEqual(missing.body, { error: 'Organisation name must be text' })
      assert.strictEqual(
        (await organisationRow(ownOrganisationId)).organisation_name,
        `P7B2 Own ${stamp}`
      )
    })

    await testAsync('owner rename ignores organisation ids and leaves the other organisation unchanged', async () => {
      const res = await request(
        ownerServer,
        `/api/auth/organisation?organisationId=${otherOrganisationId}&organisation_id=${otherOrganisationId}`,
        {
          method: 'PATCH',
          headers: { 'x-organisation-id': String(otherOrganisationId) },
          body: {
            name: '  Owner renamed  ',
            organisationId: otherOrganisationId,
            organisation_id: otherOrganisationId,
            id: otherOrganisationId,
            role: 'analyst',
          },
        }
      )
      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(res.body, {
        organisation: {
          id: ownOrganisationId,
          name: 'Owner renamed',
          role: 'owner',
        },
      })
      const own = await organisationRow(ownOrganisationId)
      const other = await organisationRow(otherOrganisationId)
      assert.strictEqual(own.id, ownOrganisationId)
      assert.strictEqual(own.organisation_name, 'Owner renamed')
      assert.strictEqual(other.organisation_name, otherBefore.organisation_name)
      assert.strictEqual(String(other.updated_at), String(otherBefore.updated_at))
      assert.strictEqual(await organisationCount(), countBefore)
      const membership = await pool.query(
        `SELECT organisation_id, role FROM organisation_users WHERE user_id = $1`,
        [owner.id]
      )
      assert.deepStrictEqual(membership.rows, [
        { organisation_id: ownOrganisationId, role: 'owner' },
      ])
    })

    await testAsync('a name at the maximum length is saved and one extra character is rejected', async () => {
      const maxName = 'N'.repeat(MAX_ORGANISATION_NAME)
      const saved = await request(ownerServer, '/api/auth/organisation', {
        method: 'PATCH',
        body: { name: maxName },
      })
      assert.strictEqual(saved.status, 200)
      assert.strictEqual(saved.body.organisation.name, maxName)
      assert.strictEqual(saved.body.organisation.id, ownOrganisationId)
      const tooLong = await request(ownerServer, '/api/auth/organisation', {
        method: 'PATCH',
        body: { name: `${maxName}!` },
      })
      assert.strictEqual(tooLong.status, 400)
      assert.strictEqual(
        (await organisationRow(ownOrganisationId)).organisation_name,
        maxName
      )
      assert.strictEqual(
        (await organisationRow(otherOrganisationId)).organisation_name,
        otherBefore.organisation_name
      )
    })
  } finally {
    await new Promise((resolve) => ownerServer.close(resolve))
    await new Promise((resolve) => adminServer.close(resolve))
    await new Promise((resolve) => analystServer.close(resolve))
    await new Promise((resolve) => server.close(resolve))
    await cleanup(userIds, organisationIds)
    const remaining = await pool.query(
      'SELECT COUNT(*)::int AS n FROM organisations WHERE id = ANY($1::int[])',
      [organisationIds]
    )
    if (remaining.rows[0].n !== 0) {
      throw new Error('Synthetic organisations were not removed')
    }
  }

  console.log(`\n${passed} passed`)
  await pool.end()
}

main().catch(async (err) => {
  console.error(err)
  try {
    await cleanup(createdUserIds, createdOrganisationIds)
  } catch (cleanupErr) {
    console.error(cleanupErr)
  }
  try {
    await pool.end()
  } catch {
    // pool may already be closed
  }
  process.exit(1)
})
