/**
 * Campaign daily budget history.
 * Run: node test-campaign-budget-history.js
 *
 * History is derived from daily_campaign_metrics by report date.
 * The fixture uses 2099 dates and is removed afterwards.
 * Users 33 and 73 are injected at the authenticated-tenant boundary.
 */
require('dotenv').config()

const assert = require('assert')
const express = require('express')
const http = require('http')

process.env.CLERK_TELEMETRY_DISABLED = 'true'
process.env.CLERK_PUBLISHABLE_KEY =
  'pk_test_' + Buffer.from('example.clerk.accounts.dev$').toString('base64url')
process.env.CLERK_SECRET_KEY = 'sk_test_budget_history_dummy_secret'

const { assertClerkConfigured } = require('./auth/clerkConfig')
assertClerkConfigured()

const { pool } = require('./db')
const { createAuthRouter } = require('./auth/routes')
const { createRequireAuthenticatedTenant } = require('./auth/tenantMiddleware')
const { registerAnalyticsRoutes } = require('./analyticsRoutes')
const { getCampaignBudgetHistory } = require('./campaignBudgetHistory')
const { app } = require('./index')

const APP = 'budget-hist-app'
const OTHER_APP = 'budget-hist-other-app'
const PERIOD_START = '2099-10-01'
const PERIOD_END = '2099-10-07'

let passed = 0

function testAsync(name, fn) {
  return fn()
    .then(() => {
      passed++
      console.log(`  ✓ ${name}`)
    })
    .catch((err) => {
      console.error(`  ✗ ${name}`)
      console.error(`    ${err.message}`)
      throw err
    })
}

function closeTo(actual, expected) {
  assert.ok(Math.abs(Number(actual) - expected) < 0.05, `expected ${expected}, got ${actual}`)
}

function listen(expressApp) {
  return new Promise((resolve) => {
    const server = expressApp.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function request(server, path, { headers = {} } = {}) {
  const { port } = server.address()
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'GET', headers },
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
  return expressApp
}

async function upsertDay({ organisationId, appId = APP, campaignName, reportDate, budget, spend = 1 }) {
  await pool.query(
    `INSERT INTO daily_campaign_metrics (
       organisation_id, app_id, app_name, campaign_name, report_date,
       spend, impressions, taps, installs, installs_tap_through,
       installs_view_through, installs_total, daily_budget
     ) VALUES ($1, $2, 'Budget History Fixture', $3, $4, $5, 10, 2, 1, 1, 0, 1, $6)
     ON CONFLICT (organisation_id, app_id, report_date, campaign_name)
     DO UPDATE SET daily_budget = EXCLUDED.daily_budget, spend = EXCLUDED.spend, updated_at = NOW()`,
    [organisationId, appId, campaignName, reportDate, spend, budget],
  )
}

async function days(organisationId, campaignName, pairs, appId = APP) {
  for (const [reportDate, budget] of pairs) {
    await upsertDay({ organisationId, appId, campaignName, reportDate, budget })
  }
}

async function history(organisationId, campaignName, appId = APP) {
  return getCampaignBudgetHistory({ organisationId, appId, campaignName })
}

async function cleanup() {
  await pool.query(
    'DELETE FROM daily_campaign_metrics WHERE app_id = ANY($1::text[])',
    [[APP, OTHER_APP]],
  )
  await pool.query('DELETE FROM campaigns WHERE app_id = ANY($1::text[])', [[APP, OTHER_APP]])
}

async function main() {
  console.log('\n=== Campaign daily budget history ===')
  const users = await pool.query(
    `SELECT id, email, full_name, auth_provider, auth_provider_user_id
     FROM users WHERE id IN (33, 73) ORDER BY id`,
  )
  assert.strictEqual(users.rows.length, 2)
  const user33 = asReqUser(users.rows.find((row) => row.id === 33))
  const user73 = asReqUser(users.rows.find((row) => row.id === 73))

  await cleanup()

  const publicServer = await listen(app)
  const server73 = await listen(authedApp(user73))
  const server33 = await listen(authedApp(user33))

  try {
    await testAsync('A. first recorded budget is not a change', async () => {
      await days(1, 'Budget A First', [['2099-10-01', 25]])
      const result = await history(1, 'Budget A First')
      assert.strictEqual(result.current_daily_budget, 25)
      assert.strictEqual(result.previous_daily_budget, null)
      assert.strictEqual(result.budget_change, null)
      assert.strictEqual(result.budget_observation_count, 1)
      assert.strictEqual(result.budget_comparison_status, 'new')
      assert.strictEqual(result.budget_first_observed_date, '2099-10-01')
      assert.deepStrictEqual(result.changes, [])
    })

    await testAsync('B. genuine increase £20 to £30', async () => {
      await days(1, 'Budget B Increase', [
        ['2099-10-01', 20],
        ['2099-10-02', 20],
        ['2099-10-03', 20],
        ['2099-10-04', 30],
        ['2099-10-05', 30],
      ])
      const result = await history(1, 'Budget B Increase')
      assert.strictEqual(result.current_daily_budget, 30)
      assert.strictEqual(result.previous_daily_budget, 20)
      assert.strictEqual(result.budget_change, 10)
      closeTo(result.budget_change_percent, 50)
      assert.strictEqual(result.changes.length, 1)
      assert.strictEqual(result.changes[0].change_date, '2099-10-04')
      assert.strictEqual(result.changes[0].previous_daily_budget, 20)
      assert.strictEqual(result.changes[0].new_daily_budget, 30)
    })

    await testAsync('C. genuine decrease £30 to £20', async () => {
      await days(1, 'Budget C Decrease', [
        ['2099-10-01', 30],
        ['2099-10-02', 20],
      ])
      const result = await history(1, 'Budget C Decrease')
      assert.strictEqual(result.budget_change, -10)
      closeTo(result.budget_change_percent, -33.333)
      assert.strictEqual(result.previous_daily_budget, 30)
      assert.strictEqual(result.current_daily_budget, 20)
    })

    await testAsync('D. repeated budget does not create a change', async () => {
      await days(1, 'Budget D Repeat', [
        ['2099-10-01', 20],
        ['2099-10-02', 20],
        ['2099-10-03', 20],
      ])
      const result = await history(1, 'Budget D Repeat')
      assert.strictEqual(result.budget_comparison_status, 'unchanged')
      assert.strictEqual(result.budget_observation_count, 3)
      assert.strictEqual(result.previous_daily_budget, null)
      assert.deepStrictEqual(result.changes, [])
      assert.strictEqual(result.current_daily_budget, 20)
    })

    await testAsync('E. multiple changes stay in report-date order', async () => {
      await days(1, 'Budget E Multi', [
        ['2099-10-01', 20],
        ['2099-10-02', 25],
        ['2099-10-03', 30],
      ])
      const result = await history(1, 'Budget E Multi')
      assert.deepStrictEqual(
        result.changes.map((change) => [change.change_date, change.previous_daily_budget, change.new_daily_budget]),
        [
          ['2099-10-02', 20, 25],
          ['2099-10-03', 25, 30],
        ],
      )
      assert.strictEqual(result.current_daily_budget, 30)
      assert.strictEqual(result.previous_daily_budget, 25)
    })

    await testAsync('F. out-of-order imports keep report-date chronology', async () => {
      await days(1, 'Budget F Order', [
        ['2099-10-04', 30],
        ['2099-10-05', 30],
      ])
      const early = await history(1, 'Budget F Order')
      assert.strictEqual(early.budget_comparison_status, 'unchanged')
      assert.strictEqual(early.current_daily_budget, 30)
      assert.strictEqual(early.previous_daily_budget, null)

      await days(1, 'Budget F Order', [
        ['2099-10-01', 20],
        ['2099-10-02', 20],
        ['2099-10-03', 20],
      ])
      const result = await history(1, 'Budget F Order')
      assert.strictEqual(result.previous_daily_budget, 20)
      assert.strictEqual(result.current_daily_budget, 30)
      assert.strictEqual(result.changes.length, 1)
      assert.strictEqual(result.changes[0].change_date, '2099-10-04')
      assert.strictEqual(result.changes[0].previous_daily_budget, 20)
      assert.strictEqual(result.changes[0].new_daily_budget, 30)
    })

    await testAsync('G. overlapping imports do not duplicate history', async () => {
      await days(1, 'Budget G Overlap', [
        ['2099-10-01', 20],
        ['2099-10-02', 20],
        ['2099-10-04', 30],
        ['2099-10-05', 30],
      ])
      await days(1, 'Budget G Overlap', [
        ['2099-10-01', 20],
        ['2099-10-04', 30],
        ['2099-10-05', 30],
      ])
      const result = await history(1, 'Budget G Overlap')
      assert.strictEqual(result.changes.length, 1)
      const again = await history(1, 'Budget G Overlap')
      assert.strictEqual(again.changes.length, 1)
      const stored = await pool.query(
        `SELECT COUNT(*)::int AS days
         FROM daily_campaign_metrics
         WHERE organisation_id = 1 AND app_id = $1 AND campaign_name = $2`,
        [APP, 'Budget G Overlap'],
      )
      assert.strictEqual(stored.rows[0].days, 4)
    })

    await testAsync('H. identical campaign identity stays independent per organisation', async () => {
      await days(1, 'Budget H Shared', [
        ['2099-10-01', 20],
        ['2099-10-04', 30],
      ])
      await days(14, 'Budget H Shared', [['2099-10-01', 50]])
      const org1 = await history(1, 'Budget H Shared')
      const org14 = await history(14, 'Budget H Shared')
      assert.strictEqual(org1.current_daily_budget, 30)
      assert.strictEqual(org1.previous_daily_budget, 20)
      assert.strictEqual(org14.current_daily_budget, 50)
      assert.strictEqual(org14.previous_daily_budget, null)
      assert.deepStrictEqual(org14.changes, [])
    })

    await testAsync('same campaign name in another app does not share history', async () => {
      await days(1, 'Budget B Increase', [['2099-10-01', 99]], OTHER_APP)
      const original = await history(1, 'Budget B Increase', APP)
      const other = await history(1, 'Budget B Increase', OTHER_APP)
      assert.strictEqual(original.current_daily_budget, 30)
      assert.strictEqual(original.previous_daily_budget, 20)
      assert.strictEqual(other.current_daily_budget, 99)
      assert.strictEqual(other.previous_daily_budget, null)
    })

    await testAsync('I. a change outside the selected period stays historical', async () => {
      await days(1, 'Budget I Outside', [
        ['2099-08-01', 20],
        ['2099-08-20', 30],
        ['2099-10-02', 30],
      ])
      const listed = await request(
        server73,
        `/api/compare/period?startDate=${PERIOD_START}&endDate=${PERIOD_END}&appId=${APP}`,
      )
      assert.strictEqual(listed.status, 200)
      const row = listed.body.campaigns.find((campaign) => campaign.campaign_name === 'Budget I Outside')
      assert.ok(row)
      assert.strictEqual(row.current_daily_budget, 30)
      assert.strictEqual(row.previous_daily_budget, 20)
      assert.strictEqual(row.budget_changed_in_selected_period, false)
      assert.strictEqual(row.last_budget_change_at, '2099-08-20')
      assert.strictEqual(row.budget_comparison_status, 'comparable')
      assert.strictEqual(row.daily_budget, 30)
    })

    await testAsync('J. missing daily budget is not recorded and is not zero', async () => {
      await upsertDay({
        organisationId: 1,
        campaignName: 'Budget J Missing',
        reportDate: '2099-10-01',
        budget: null,
        spend: 4,
      })
      const result = await history(1, 'Budget J Missing')
      assert.strictEqual(result.current_daily_budget, null)
      assert.strictEqual(result.previous_daily_budget, null)
      assert.strictEqual(result.budget_comparison_status, 'unavailable')
      assert.deepStrictEqual(result.changes, [])

      await days(1, 'Budget J Zero', [['2099-10-01', 0]])
      const zero = await history(1, 'Budget J Zero')
      assert.strictEqual(zero.current_daily_budget, 0)
      assert.strictEqual(zero.budget_comparison_status, 'new')
    })

    await testAsync('rounded equal budgets are one observation', async () => {
      await days(1, 'Budget Round', [
        ['2099-10-01', 20.001],
        ['2099-10-02', 20.004],
      ])
      const result = await history(1, 'Budget Round')
      assert.deepStrictEqual(result.changes, [])
      assert.strictEqual(result.current_daily_budget, 20)
    })

    await testAsync('period API marks an in-period change and ignores a spoofed organisation id', async () => {
      const listed = await request(
        server73,
        `/api/compare/period?startDate=${PERIOD_START}&endDate=${PERIOD_END}&appId=${APP}&organisationId=14`,
      )
      assert.strictEqual(listed.status, 200)
      const increase = listed.body.campaigns.find((campaign) => campaign.campaign_name === 'Budget B Increase')
      assert.strictEqual(increase.budget_changed_in_selected_period, true)
      assert.strictEqual(increase.current_daily_budget, 30)
      assert.strictEqual(increase.previous_daily_budget, 20)
      closeTo(increase.budget_change_percent, 50)
      const shared = listed.body.campaigns.find((campaign) => campaign.campaign_name === 'Budget H Shared')
      assert.strictEqual(shared.current_daily_budget, 30)

      const foreign = await request(
        server33,
        `/api/campaigns/budget-history?appId=${APP}&campaignName=${encodeURIComponent('Budget H Shared')}&organisationId=1`,
      )
      assert.strictEqual(foreign.status, 200)
      assert.strictEqual(foreign.body.current_daily_budget, 50)
      assert.strictEqual(foreign.body.previous_daily_budget, null)

      const owner = await request(
        server73,
        `/api/campaigns/budget-history?appId=${APP}&campaignName=${encodeURIComponent('Budget H Shared')}`,
      )
      assert.strictEqual(owner.status, 200)
      assert.strictEqual(owner.body.current_daily_budget, 30)
      assert.strictEqual(owner.body.changes.length, 1)
    })

    await testAsync('unauthenticated budget history returns 401', async () => {
      const response = await request(
        publicServer,
        `/api/campaigns/budget-history?appId=${APP}&campaignName=Budget%20A%20First`,
      )
      assert.strictEqual(response.status, 401)
    })
  } finally {
    await cleanup()
    publicServer.close()
    server73.close()
    server33.close()
    await pool.end()
  }

  console.log(`\n${passed} passed`)
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
