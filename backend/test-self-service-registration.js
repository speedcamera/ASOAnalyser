/**
 * P6B self-service registration against the real Clerk instance and database.
 * Creates two Clerk users, provisions one organisation each, uploads the same
 * CSV, checks isolation, then deletes the Clerk users and their tenant rows.
 *
 * Run: node test-self-service-registration.js
 */
require('dotenv').config()

const assert = require('assert')
const http = require('http')
const { createClerkClient } = require('@clerk/backend')
const { pool } = require('./db')
const { app } = require('./index')

const CSV = [
  'Date,Campaign Name,Ad Group Name,Keyword,Bid Strategy,App ID,App Name,Spend,Impressions,Taps,Installs (Total),Keyword Max Bid',
  '2099-06-01,P6B Shared Campaign,P6B Ad Group,p6b-shared-keyword,Manual,p6b-shared-app,P6B Shared App,2.00,20,4,1,0.80',
].join('\n')

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
const created = []

function listen(serverApp) {
  return new Promise((resolve) => {
    const server = http.createServer(serverApp)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

async function api(base, token, path, options = {}) {
  const headers = { ...(options.headers || {}) }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${base}${path}`, { ...options, headers })
  const text = await response.text()
  let body = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  return { status: response.status, body }
}

async function sessionToken(clerkUserId) {
  const session = await clerk.sessions.createSession({ userId: clerkUserId })
  const token = await clerk.sessions.getToken(session.id)
  return token.jwt
}

async function createCustomer(label, firstName, lastName) {
  const email = `p6b.${label}.${Date.now()}@example.com`
  const user = await clerk.users.createUser({
    emailAddress: [email],
    firstName,
    lastName,
    skipPasswordRequirement: true,
  })
  created.push(user.id)
  return { clerkUserId: user.id, email, firstName, lastName }
}

async function countsForClerk(clerkUserId) {
  const users = await pool.query(
    `SELECT id FROM users WHERE auth_provider = 'clerk' AND auth_provider_user_id = $1`,
    [clerkUserId]
  )
  if (users.rows.length !== 1) {
    return { users: users.rows.length, memberships: 0, organisations: 0, organisationId: null, role: null, localUserId: null }
  }
  const localUserId = users.rows[0].id
  const memberships = await pool.query(
    `SELECT organisation_id, role FROM organisation_users WHERE user_id = $1 ORDER BY id`,
    [localUserId]
  )
  return {
    users: 1,
    localUserId,
    memberships: memberships.rows.length,
    organisations: new Set(memberships.rows.map((row) => row.organisation_id)).size,
    organisationId: memberships.rows[0]?.organisation_id ?? null,
    role: memberships.rows[0]?.role ?? null,
  }
}

async function wipeCustomer(clerkUserId) {
  const counts = await countsForClerk(clerkUserId)
  if (counts.localUserId && counts.organisationId) {
    const orgId = counts.organisationId
    const tables = [
      'annotations',
      'performance_goals',
      'bid_experiments',
      'keyword_bid_history',
      'daily_keyword_metrics',
      'daily_campaign_metrics',
      'campaigns',
      'import_rows',
      'imports',
      'organisation_users',
    ]
    for (const table of tables) {
      await pool.query(`DELETE FROM ${table} WHERE organisation_id = $1`, [orgId])
    }
    await pool.query('DELETE FROM organisations WHERE id = $1', [orgId])
    await pool.query('DELETE FROM users WHERE id = $1', [counts.localUserId])
  } else if (counts.localUserId) {
    await pool.query('DELETE FROM users WHERE id = $1', [counts.localUserId])
  }
  try {
    await clerk.users.deleteUser(clerkUserId)
  } catch (err) {
    console.error('Clerk user cleanup failed', err.status || err.code || 'error')
  }
}

async function upload(base, token) {
  const form = new FormData()
  form.append('file', new Blob([CSV], { type: 'text/csv' }), 'p6b-shared.csv')
  return api(base, token, '/api/imports', { method: 'POST', body: form })
}

async function main() {
  const before73 = await pool.query(
    `SELECT organisation_id, role FROM organisation_users WHERE user_id = 73`
  )
  const before33 = await pool.query(
    `SELECT organisation_id, role FROM organisation_users WHERE user_id = 33`
  )

  const server = await listen(app)
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}`

  try {
    const ava = await createCustomer('ava', 'Ava', 'Customer')
    const tokenA = await sessionToken(ava.clerkUserId)
    const firstWave = await Promise.all(
      Array.from({ length: 8 }, () => api(base, tokenA, '/api/auth/context'))
    )
    assert.ok(firstWave.every((item) => item.status === 200), 'concurrent context did not all succeed')
    const orgIds = new Set(firstWave.map((item) => item.body.organisation.id))
    assert.strictEqual(orgIds.size, 1)
    const afterFirst = await countsForClerk(ava.clerkUserId)
    assert.strictEqual(afterFirst.users, 1)
    assert.strictEqual(afterFirst.memberships, 1)
    assert.strictEqual(afterFirst.organisations, 1)
    assert.strictEqual(afterFirst.role, 'owner')
    assert.strictEqual(firstWave[0].body.organisation.name, "Ava Customer's Organisation")
    assert.notStrictEqual(afterFirst.organisationId, 1)
    assert.notStrictEqual(afterFirst.organisationId, 14)

    const repeat = await api(base, tokenA, '/api/auth/context')
    const me = await api(base, tokenA, '/api/auth/me')
    const afterRepeat = await countsForClerk(ava.clerkUserId)
    assert.strictEqual(repeat.body.organisation.id, afterFirst.organisationId)
    assert.strictEqual(me.body.id, afterFirst.localUserId)
    assert.strictEqual(afterRepeat.memberships, 1)
    assert.strictEqual(afterRepeat.organisations, 1)

    const tokenA2 = await sessionToken(ava.clerkUserId)
    const signedBack = await api(base, tokenA2, '/api/auth/context')
    assert.strictEqual(signedBack.body.organisation.id, afterFirst.organisationId)
    assert.strictEqual((await countsForClerk(ava.clerkUserId)).organisations, 1)

    const emptyImports = await api(base, tokenA, '/api/imports')
    assert.strictEqual(emptyImports.status, 200)
    assert.deepStrictEqual(emptyImports.body, [])
    const emptyPeriod = await api(base, tokenA, '/api/compare/period?days=7')
    assert.strictEqual(emptyPeriod.status, 200)
    assert.deepStrictEqual(emptyPeriod.body.campaigns, [])
    assert.deepStrictEqual(emptyPeriod.body.keywords, [])

    const ben = await createCustomer('ben', 'Ben', 'Customer')
    const tokenB = await sessionToken(ben.clerkUserId)
    const contextB = await api(base, tokenB, '/api/auth/context')
    assert.strictEqual(contextB.status, 200)
    assert.strictEqual(contextB.body.organisation.name, "Ben Customer's Organisation")
    assert.notStrictEqual(contextB.body.organisation.id, afterFirst.organisationId)
    const benCounts = await countsForClerk(ben.clerkUserId)
    assert.strictEqual(benCounts.memberships, 1)
    assert.strictEqual(benCounts.role, 'owner')

    const uploadA = await upload(base, tokenA)
    const uploadB = await upload(base, tokenB)
    assert.strictEqual(uploadA.status, 201, JSON.stringify(uploadA.body))
    assert.strictEqual(uploadB.status, 201, JSON.stringify(uploadB.body))
    assert.notStrictEqual(uploadA.body.id, uploadB.body.id)

    const importsA = await api(base, tokenA, '/api/imports')
    const importsB = await api(base, tokenB, '/api/imports')
    assert.strictEqual(importsA.body.length, 1)
    assert.strictEqual(importsB.body.length, 1)
    assert.notStrictEqual(importsA.body[0].id, importsB.body[0].id)

    const periodA = await api(base, tokenA, '/api/compare/period?days=30')
    const periodB = await api(base, tokenB, '/api/compare/period?days=30')
    assert.strictEqual(periodA.body.campaigns.length, 1)
    assert.strictEqual(periodB.body.campaigns.length, 1)
    assert.strictEqual(periodA.body.campaigns[0].campaign_name, 'P6B Shared Campaign')
    assert.strictEqual(periodB.body.campaigns[0].campaign_name, 'P6B Shared Campaign')
    assert.strictEqual(periodA.body.keywords.length, 1)
    assert.strictEqual(periodB.body.keywords.length, 1)

    const foreignImport = await api(base, tokenB, `/api/imports/${uploadA.body.id}`)
    assert.strictEqual(foreignImport.status, 404)

    const spoof = await api(
      base,
      tokenB,
      `/api/auth/context?organisationId=${afterFirst.organisationId}`,
      {
        headers: { 'x-organisation-id': String(afterFirst.organisationId) },
        method: 'GET',
      }
    )
    assert.strictEqual(spoof.status, 200)
    assert.strictEqual(spoof.body.organisation.id, contextB.body.organisation.id)

    const unauth = await api(base, null, '/api/imports')
    assert.strictEqual(unauth.status, 401)

    const badDays = await api(base, tokenA, '/api/compare/period?days=999')
    assert.strictEqual(badDays.status, 400)

    const note = await api(base, tokenA, '/api/annotations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entityType: 'campaign',
        entityKey: 'p6b-shared-app:P6B Shared Campaign',
        noteText: 'Ava only',
      }),
    })
    assert.strictEqual(note.status, 201, JSON.stringify(note.body))
    const notesA = await api(
      base,
      tokenA,
      '/api/annotations?entityType=campaign&entityKey=p6b-shared-app:P6B%20Shared%20Campaign'
    )
    const notesB = await api(
      base,
      tokenB,
      '/api/annotations?entityType=campaign&entityKey=p6b-shared-app:P6B%20Shared%20Campaign'
    )
    assert.strictEqual(notesA.body.length, 1)
    assert.strictEqual(notesB.body.length, 0)
    const foreignNote = await api(base, tokenB, `/api/annotations/${note.body.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ noteText: 'stolen' }) })
    assert.strictEqual(foreignNote.status, 404)

    const goal = await api(base, tokenA, '/api/goals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entityType: 'campaign',
        entityKey: 'p6b-shared-app:P6B Shared Campaign',
        metric: 'cpa',
        operator: 'greater_than',
        threshold: 5,
        periodDays: 7,
      }),
    })
    assert.strictEqual(goal.status, 200, JSON.stringify(goal.body))
    const goalsA = await api(base, tokenA, '/api/goals')
    const goalsB = await api(base, tokenB, '/api/goals')
    assert.ok(goalsA.body.some((item) => item.id === goal.body.id))
    assert.ok(!goalsB.body.some((item) => item.id === goal.body.id))
    const foreignGoal = await api(base, tokenB, `/api/goals/${goal.body.id}`)
    assert.strictEqual(foreignGoal.status, 404)

    const bidsA = await api(base, tokenA, '/api/bid-experiments')
    const bidsB = await api(base, tokenB, '/api/bid-experiments')
    assert.strictEqual(bidsA.status, 200)
    assert.strictEqual(bidsB.status, 200)
    const bidIdsA = new Set((bidsA.body.experiments || bidsA.body || []).map((item) => item.id))
    const bidIdsB = new Set((bidsB.body.experiments || bidsB.body || []).map((item) => item.id))
    for (const id of bidIdsA) assert.ok(!bidIdsB.has(id))

    const historyA = await api(
      base,
      tokenA,
      '/api/campaigns/budget-history?appId=p6b-shared-app&campaignName=P6B%20Shared%20Campaign'
    )
    const historyB = await api(
      base,
      tokenB,
      '/api/campaigns/budget-history?appId=p6b-shared-app&campaignName=P6B%20Shared%20Campaign'
    )
    assert.strictEqual(historyA.status, 200)
    assert.strictEqual(historyB.status, 200)

    const orphans = await pool.query(
      `SELECT COUNT(*)::int AS n
       FROM organisations o
       WHERE o.id IN ($1, $2)
         AND NOT EXISTS (SELECT 1 FROM organisation_users ou WHERE ou.organisation_id = o.id)`,
      [afterFirst.organisationId, contextB.body.organisation.id]
    )
    assert.strictEqual(orphans.rows[0].n, 0)

    const after73 = await pool.query(
      `SELECT organisation_id, role FROM organisation_users WHERE user_id = 73`
    )
    const after33 = await pool.query(
      `SELECT organisation_id, role FROM organisation_users WHERE user_id = 33`
    )
    assert.deepStrictEqual(after73.rows, before73.rows)
    assert.deepStrictEqual(after33.rows, before33.rows)

    console.log('P6B self-service registration checks passed')
    console.log(`organisations ${afterFirst.organisationId} and ${contextB.body.organisation.id}`)
  } finally {
    server.close()
    for (const clerkUserId of created) {
      await wipeCustomer(clerkUserId)
    }
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : 'P6B registration test failed')
  process.exit(1)
})
