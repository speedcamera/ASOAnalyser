/**
 * P5C.3 dashboard, campaign, and keyword analytics use the authenticated tenant.
 * Run: node test-analytics-tenant.js
 *
 * Users 33 and 73 are resolved through requireAuthenticatedTenant with the
 * verified Clerk user id injected at the P5A boundary. The database is real.
 * The fixture is removed afterwards. Existing organisation 1 analytics stay.
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
const { registerImportRoutes } = require('./importRoutes')
const { weekStartingMonday } = require('./campaignWeekly')

process.env.CLERK_TELEMETRY_DISABLED = 'true'
process.env.CLERK_PUBLISHABLE_KEY =
  'pk_test_' + Buffer.from('example.clerk.accounts.dev$').toString('base64url')
process.env.CLERK_SECRET_KEY = 'sk_test_p5c3_dummy_secret_not_a_real_key'

assertClerkConfigured()

const { app } = require('./index')

const FIXTURE_NAME = 'p5c3-isolation.csv'
const ORG1_APP = 'p5c3-org1-app'
const ORG14_APP = 'p5c3-org14-app'
const ORG1_APP_NAME = 'P5C3 Org1 Only'
const ORG14_APP_NAME = 'P5C3 Org14 Only'
const ORG1_CAMPAIGN = 'P5C3 Org1 Campaign'
const ORG14_CAMPAIGN = 'P5C3 Org14 Campaign'
const ORG1_KEYWORD = 'p5c3-org1-keyword'
const ORG14_KEYWORD = 'p5c3-org14-keyword'
const ORG1_NEW_KEYWORD = 'p5c3-org1-new-keyword'
const AD_GROUP = 'P5C3 Isolation Ad Group'
const APP_IDS = [ORG1_APP, ORG14_APP]

const displayStart = weekStartingMonday('2099-06-16')
const displayEnd = addDays(displayStart, 6)
const contextDay = addDays(displayStart, -7)

let passed = 0

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

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
  registerAnalyticsRoutes(expressApp, chain)
  registerImportRoutes(expressApp, chain)
  return expressApp
}

function periodPath(extra = '') {
  const params = new URLSearchParams({
    startDate: displayStart,
    endDate: displayEnd,
  })
  return `/api/compare/period?${params}${extra}`
}

function weeklyPath(appId) {
  const params = new URLSearchParams({
    startDate: displayStart,
    endDate: displayEnd,
    appId,
  })
  return `/api/campaigns/weekly-performance?${params}`
}

function closeTo(actual, expected) {
  assert.ok(Number.isFinite(Number(actual)), `expected a number, got ${actual}`)
  assert.ok(Math.abs(Number(actual) - expected) < 0.001, `expected ${expected}, got ${actual}`)
}

async function cleanupFixture() {
  await pool.query('DELETE FROM keyword_bid_history WHERE app_id = ANY($1::text[])', [APP_IDS])
  await pool.query('DELETE FROM daily_keyword_metrics WHERE app_id = ANY($1::text[])', [APP_IDS])
  await pool.query('DELETE FROM daily_campaign_metrics WHERE app_id = ANY($1::text[])', [APP_IDS])
  await pool.query('DELETE FROM campaigns WHERE app_id = ANY($1::text[])', [APP_IDS])
  await pool.query(
    `DELETE FROM import_rows
     WHERE import_id IN (SELECT id FROM imports WHERE original_name = $1)`,
    [FIXTURE_NAME],
  )
  await pool.query('DELETE FROM imports WHERE original_name = $1', [FIXTURE_NAME])
}

async function insertMetric(table, row) {
  const columns = Object.keys(row)
  const values = Object.values(row)
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ')
  await pool.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
    values,
  )
}

async function insertTenant(organisationId, appId, appName, campaignName, keyword, display, context) {
  const imported = await pool.query(
    `INSERT INTO imports (original_name, status, row_count, column_headers, organisation_id)
     VALUES ($1, 'completed', 1, $2::jsonb, $3)
     RETURNING id`,
    [FIXTURE_NAME, JSON.stringify(['App ID', 'App Name', 'Campaign Name']), organisationId],
  )
  const importId = imported.rows[0].id
  await pool.query(
    `INSERT INTO import_rows (import_id, row_number, data, organisation_id, record_key)
     VALUES ($1, 1, $2::jsonb, $3, $4)`,
    [
      importId,
      JSON.stringify({
        'App ID': appId,
        'App Name': appName,
        'Campaign Name': campaignName,
      }),
      organisationId,
      `p5c3-${organisationId}-${appId}`,
    ],
  )

  const campaign = await pool.query(
    `INSERT INTO campaigns (organisation_id, app_id, campaign_name, segment)
     VALUES ($1, $2, $3, 'Other')
     RETURNING id`,
    [organisationId, appId, campaignName],
  )

  for (const point of [display, context]) {
    await insertMetric('daily_campaign_metrics', {
      organisation_id: organisationId,
      app_id: appId,
      app_name: appName,
      campaign_name: campaignName,
      report_date: point.date,
      spend: point.spend,
      impressions: point.impressions,
      taps: point.taps,
      installs: point.installs,
      installs_tap_through: point.installs,
      installs_view_through: 0,
      installs_total: point.installs,
    })
    await insertMetric('daily_keyword_metrics', {
      organisation_id: organisationId,
      app_id: appId,
      app_name: appName,
      campaign_name: campaignName,
      ad_group_name: AD_GROUP,
      keyword_text: keyword,
      bid_strategy: 'Manual',
      report_date: point.date,
      spend: point.spend,
      impressions: point.impressions,
      taps: point.taps,
      installs: point.installs,
      installs_tap_through: point.installs,
      installs_view_through: 0,
      installs_total: point.installs,
      keyword_max_cpt_bid: point.bid,
    })
  }

  await pool.query(
    `INSERT INTO keyword_bid_history (
       organisation_id, app_id, campaign_name, ad_group_name, keyword_text,
       bid_amount, currency, observed_at, report_snapshot_date, import_id
     ) VALUES
       ($1, $2, $3, $4, $5, $6, 'GBP', $7, $8, $9),
       ($1, $2, $3, $4, $5, $10, 'GBP', $11, $12, $9)`,
    [
      organisationId,
      appId,
      campaignName,
      AD_GROUP,
      keyword,
      display.bid,
      `${display.date}T12:00:00Z`,
      display.date,
      importId,
      context.bid,
      `${context.date}T12:00:00Z`,
      context.date,
    ],
  )

  return campaign.rows[0].id
}

async function main() {
  console.log('\n=== P5C.3 analytics tenant context ===')
  console.log(`  fixture window ${displayStart} to ${displayEnd}, context ${contextDay}`)

  const users = await pool.query(
    `SELECT id, email, full_name, auth_provider, auth_provider_user_id
     FROM users WHERE id IN (33, 73) ORDER BY id`,
  )
  assert.strictEqual(users.rows.length, 2)
  const user33 = asReqUser(users.rows.find((row) => row.id === 33))
  const user73 = asReqUser(users.rows.find((row) => row.id === 73))

  await cleanupFixture()

  const publicServer = await listen(app)
  const server73 = await listen(authedApp(user73))
  const server33 = await listen(authedApp(user33))

  let org1CampaignId = null
  let org1Segment = null
  let org14CampaignId = null

  try {
    await testAsync('unauthenticated analytics routes return 401', async () => {
      const paths = [
        '/api/apps',
        '/api/alerts',
        '/api/insights?days=7',
        '/api/campaigns/weekly-performance',
        periodPath(),
      ]
      for (const path of paths) {
        const res = await request(publicServer, path)
        assert.strictEqual(res.status, 401, path)
        assert.deepStrictEqual(res.body, { error: 'Unauthorized' })
      }
      const patch = await request(publicServer, '/api/campaigns/1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ segment: 'Brand' }),
      })
      assert.strictEqual(patch.status, 401)
    })

    await testAsync('invalid authentication returns 401', async () => {
      const res = await request(publicServer, periodPath(), {
        headers: { authorization: 'Bearer not-a-valid-session' },
      })
      assert.strictEqual(res.status, 401)
      assert.deepStrictEqual(res.body, { error: 'Unauthorized' })
    })

    await testAsync('goals and bid experiments require a session', async () => {
      const goals = await request(publicServer, '/api/goals')
      const experiments = await request(publicServer, '/api/bid-experiments')
      assert.strictEqual(goals.status, 401)
      assert.strictEqual(experiments.status, 401)
      assert.deepStrictEqual(goals.body, { error: 'Unauthorized' })
      assert.deepStrictEqual(experiments.body, { error: 'Unauthorized' })
    })

    await testAsync('authenticated tenant context resolves both users', async () => {
      const dev = await request(server73, '/api/auth/context')
      const customer = await request(server33, '/api/auth/context')
      assert.strictEqual(dev.status, 200)
      assert.strictEqual(customer.status, 200)
      assert.strictEqual(dev.body.user.id, 73)
      assert.strictEqual(dev.body.organisation.id, 1)
      assert.strictEqual(customer.body.user.id, 33)
      assert.strictEqual(customer.body.organisation.id, 14)
    })

    const developerBefore = await request(server73, '/api/compare/period?days=7')
    assert.strictEqual(developerBefore.status, 200)
    const developerWindow = developerBefore.body.periods.current_period
    const developerSpendBefore = Number(developerBefore.body.overall.current_spend) || 0

    await testAsync('existing organisation 1 dashboard matches its own metrics', async () => {
      const sql = await pool.query(
        `SELECT COALESCE(SUM(spend), 0)::float AS spend
         FROM daily_campaign_metrics
         WHERE organisation_id = 1
           AND report_date >= $1
           AND report_date <= $2`,
        [developerWindow.start_date, developerWindow.end_date],
      )
      closeTo(developerSpendBefore, sql.rows[0].spend)
    })

    const existingCampaign = await pool.query(
      `SELECT id, segment FROM campaigns WHERE organisation_id = 1 ORDER BY id LIMIT 1`,
    )
    assert.ok(existingCampaign.rows.length === 1)
    org1CampaignId = existingCampaign.rows[0].id
    org1Segment = existingCampaign.rows[0].segment

    org14CampaignId = await insertTenant(14, ORG14_APP, ORG14_APP_NAME, ORG14_CAMPAIGN, ORG14_KEYWORD, {
      date: displayStart,
      spend: 900,
      impressions: 9000,
      taps: 900,
      installs: 90,
      bid: 9.5,
    }, {
      date: contextDay,
      spend: 11,
      impressions: 110,
      taps: 22,
      installs: 1,
      bid: 8,
    })
    const fixtureOrg1CampaignId = await insertTenant(1, ORG1_APP, ORG1_APP_NAME, ORG1_CAMPAIGN, ORG1_KEYWORD, {
      date: displayStart,
      spend: 100,
      impressions: 1000,
      taps: 100,
      installs: 10,
      bid: 1.25,
    }, {
      date: contextDay,
      spend: 7,
      impressions: 70,
      taps: 7,
      installs: 1,
      bid: 1,
    })
    await insertMetric('daily_keyword_metrics', {
      organisation_id: 1,
      app_id: ORG1_APP,
      app_name: ORG1_APP_NAME,
      campaign_name: ORG1_CAMPAIGN,
      ad_group_name: AD_GROUP,
      keyword_text: ORG1_NEW_KEYWORD,
      bid_strategy: 'Manual',
      report_date: displayStart,
      spend: 3,
      impressions: 30,
      taps: 3,
      installs: 1,
      installs_tap_through: 1,
      installs_view_through: 0,
      installs_total: 1,
    })

    await testAsync('dashboard date range isolates campaign and keyword spend', async () => {
      const dev = await request(server73, periodPath(`&appId=${ORG1_APP}`))
      const customer = await request(server33, periodPath(`&appId=${ORG14_APP}`))
      assert.strictEqual(dev.status, 200)
      assert.strictEqual(customer.status, 200)
      closeTo(dev.body.overall.current_spend, 100)
      closeTo(dev.body.overall.previous_spend, 7)
      closeTo(customer.body.overall.current_spend, 900)
      closeTo(customer.body.overall.previous_spend, 11)
      assert.ok(!dev.body.campaigns.some((row) => row.campaign_name === ORG14_CAMPAIGN))
      assert.ok(!customer.body.campaigns.some((row) => row.campaign_name === ORG1_CAMPAIGN))
      const devKeyword = dev.body.keywords.find((row) => row.keyword === ORG1_KEYWORD)
      const customerKeyword = customer.body.keywords.find((row) => row.keyword === ORG14_KEYWORD)
      assert.ok(devKeyword)
      assert.ok(customerKeyword)
      closeTo(devKeyword.current_spend, 100)
      closeTo(customerKeyword.current_spend, 900)
      assert.ok(!dev.body.keywords.some((row) => row.keyword === ORG14_KEYWORD))
      assert.ok(!customer.body.keywords.some((row) => row.keyword === ORG1_KEYWORD))
      assert.ok(!customer.body.keywords.some((row) => row.keyword === ORG1_NEW_KEYWORD))
    })

    await testAsync('keyword bids and new-keyword status stay inside the tenant', async () => {
      const dev = await request(server73, periodPath(`&appId=${ORG1_APP}`))
      const customer = await request(server33, periodPath(`&appId=${ORG14_APP}`))
      const devKeyword = dev.body.keywords.find((row) => row.keyword === ORG1_KEYWORD)
      const customerKeyword = customer.body.keywords.find((row) => row.keyword === ORG14_KEYWORD)
      const fresh = dev.body.keywords.find((row) => row.keyword === ORG1_NEW_KEYWORD)
      closeTo(devKeyword.current_bid, 1.25)
      closeTo(devKeyword.previous_bid, 1)
      closeTo(customerKeyword.current_bid, 9.5)
      closeTo(customerKeyword.previous_bid, 8)
      assert.strictEqual(fresh.comparison_status, 'new')
      assert.strictEqual(devKeyword.comparison_status, 'comparable')
    })

    await testAsync('app and campaign filter metadata stay inside the tenant', async () => {
      const devApps = await request(server73, '/api/apps')
      const customerApps = await request(server33, '/api/apps')
      assert.strictEqual(devApps.status, 200)
      assert.strictEqual(customerApps.status, 200)
      assert.ok(devApps.body.some((app) => app.app_id === ORG1_APP && app.app_name === ORG1_APP_NAME))
      assert.ok(customerApps.body.some((app) => app.app_id === ORG14_APP && app.app_name === ORG14_APP_NAME))
      assert.ok(!devApps.body.some((app) => app.app_id === ORG14_APP || app.app_name === ORG14_APP_NAME))
      assert.ok(!customerApps.body.some((app) => app.app_id === ORG1_APP || app.app_name === ORG1_APP_NAME))

      const dev = await request(server73, periodPath())
      const customer = await request(server33, periodPath())
      assert.ok(dev.body.apps.some((app) => app.app_id === ORG1_APP))
      assert.ok(customer.body.apps.some((app) => app.app_id === ORG14_APP))
      assert.ok(!dev.body.apps.some((app) => app.app_id === ORG14_APP))
      assert.ok(!customer.body.apps.some((app) => app.app_id === ORG1_APP))
      assert.ok(dev.body.campaigns.some((row) => row.campaign_name === ORG1_CAMPAIGN))
      assert.ok(customer.body.campaigns.some((row) => row.campaign_name === ORG14_CAMPAIGN))
    })

    await testAsync('weekly comparison context is tenant-scoped and not displayed', async () => {
      const dev = await request(server73, weeklyPath(ORG1_APP))
      const customer = await request(server33, weeklyPath(ORG14_APP))
      assert.strictEqual(dev.status, 200)
      assert.strictEqual(customer.status, 200)
      const devWeek = dev.body.weeks.find((week) => week.weekStarting === displayStart)
      const customerWeek = customer.body.weeks.find((week) => week.weekStarting === displayStart)
      assert.ok(devWeek)
      assert.ok(customerWeek)
      assert.ok(!dev.body.weeks.some((week) => week.weekStarting === contextDay))
      assert.ok(!customer.body.weeks.some((week) => week.weekStarting === contextDay))
      assert.ok(!dev.body.days.some((day) => day.date === contextDay))
      closeTo(devWeek.spend, 100)
      closeTo(devWeek.installs, 10)
      closeTo(devWeek.previous_spend, 7)
      closeTo(devWeek.previous_installs, 1)
      closeTo(devWeek.previous_cpa, 7)
      closeTo(devWeek.previous_cpt, 1)
      closeTo(devWeek.previous_ttr, 10)
      closeTo(customerWeek.spend, 900)
      closeTo(customerWeek.installs, 90)
      closeTo(customerWeek.previous_spend, 11)
      closeTo(customerWeek.previous_installs, 1)
      closeTo(customerWeek.previous_cpa, 11)
      closeTo(customerWeek.previous_cpt, 0.5)
      closeTo(customerWeek.previous_ttr, 20)
    })

    await testAsync('cross-tenant aggregation does not add the two spends', async () => {
      const dev = await request(server73, periodPath())
      const customer = await request(server33, periodPath())
      const devCampaign = dev.body.campaigns.find((row) => row.campaign_name === ORG1_CAMPAIGN)
      const customerCampaign = customer.body.campaigns.find((row) => row.campaign_name === ORG14_CAMPAIGN)
      const devKeyword = dev.body.keywords.find((row) => row.keyword === ORG1_KEYWORD)
      const customerKeyword = customer.body.keywords.find((row) => row.keyword === ORG14_KEYWORD)
      closeTo(devCampaign.current_spend, 100)
      closeTo(customerCampaign.current_spend, 900)
      closeTo(devKeyword.current_spend, 100)
      closeTo(customerKeyword.current_spend, 900)
      assert.notStrictEqual(Number(dev.body.overall.current_spend), 1000)
      assert.notStrictEqual(Number(customer.body.overall.current_spend), 1000)
    })

    await testAsync('organisation spoofing does not change req.organisationId', async () => {
      const clean = await request(server33, periodPath(`&appId=${ORG14_APP}`))
      const spoofed = await request(
        server33,
        `${periodPath(`&appId=${ORG14_APP}`)}&organisationId=1&organisation_id=1`,
        {
          headers: {
            'x-organisation-id': '1',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ organisationId: 1, organisation_id: 1 }),
        },
      )
      assert.strictEqual(spoofed.status, 200)
      closeTo(spoofed.body.overall.current_spend, 900)
      assert.strictEqual(
        spoofed.body.overall.current_spend,
        clean.body.overall.current_spend,
      )
      assert.ok(!spoofed.body.campaigns.some((row) => row.campaign_name === ORG1_CAMPAIGN))
      const context = await request(server33, '/api/auth/context?organisationId=1', {
        headers: { 'x-organisation-id': '1' },
      })
      assert.strictEqual(context.body.organisation.id, 14)
    })

    await testAsync('foreign campaign id returns 404 and does not change the row', async () => {
      const other = org1Segment === 'Brand' ? 'Non-Brand' : 'Brand'
      const res = await request(server33, `/api/campaigns/${org1CampaignId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-organisation-id': '1',
        },
        body: JSON.stringify({ segment: other, organisationId: 1 }),
      })
      assert.strictEqual(res.status, 404)
      assert.strictEqual(res.body.error, 'Campaign not found')
      const fixture = await request(server33, `/api/campaigns/${fixtureOrg1CampaignId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ segment: other }),
      })
      assert.strictEqual(fixture.status, 404)
      const stored = await pool.query('SELECT segment FROM campaigns WHERE id = $1', [org1CampaignId])
      assert.strictEqual(stored.rows[0].segment, org1Segment)
      const fixtureStored = await pool.query(
        'SELECT segment FROM campaigns WHERE id = $1 AND organisation_id = 1',
        [fixtureOrg1CampaignId],
      )
      assert.strictEqual(fixtureStored.rows[0].segment, 'Other')
    })

    await testAsync('customer campaign update stays on organisation 14', async () => {
      const res = await request(server33, `/api/campaigns/${org14CampaignId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-organisation-id': '1',
        },
        body: JSON.stringify({ segment: 'Brand', organisationId: 1 }),
      })
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.body.segment, 'Brand')
      const stored = await pool.query(
        'SELECT organisation_id, segment FROM campaigns WHERE id = $1',
        [org14CampaignId],
      )
      assert.strictEqual(stored.rows[0].organisation_id, 14)
      assert.strictEqual(stored.rows[0].segment, 'Brand')
    })

    await testAsync('developer dashboard window is unchanged by the other tenant', async () => {
      const again = await request(
        server73,
        `/api/compare/period?startDate=${developerWindow.start_date}&endDate=${developerWindow.end_date}`,
      )
      assert.strictEqual(again.status, 200)
      closeTo(again.body.overall.current_spend, developerSpendBefore)
      assert.ok(!again.body.campaigns.some((row) => row.campaign_name === ORG14_CAMPAIGN))
      assert.ok(!again.body.keywords.some((row) => row.keyword === ORG14_KEYWORD))
    })

    await testAsync('customer default window does not contain organisation 1 campaigns', async () => {
      const customer = await request(server33, '/api/compare/period?days=7')
      assert.strictEqual(customer.status, 200)
      const sample = await pool.query(
        `SELECT campaign_name
         FROM daily_campaign_metrics
         WHERE organisation_id = 1
           AND report_date >= $1
           AND report_date <= $2
         LIMIT 5`,
        [developerWindow.start_date, developerWindow.end_date],
      )
      const names = new Set((customer.body.campaigns || []).map((row) => row.campaign_name))
      for (const row of sample.rows) {
        assert.ok(!names.has(row.campaign_name))
      }
      assert.ok(!names.has(ORG1_CAMPAIGN))
    })

    await testAsync('imports remain tenant scoped', async () => {
      const dev = await request(server73, '/api/imports')
      const customer = await request(server33, '/api/imports')
      const anonymous = await request(publicServer, '/api/imports')
      assert.strictEqual(dev.status, 200)
      assert.strictEqual(customer.status, 200)
      assert.strictEqual(anonymous.status, 401)
      const devIds = new Set(dev.body.map((row) => row.id))
      const customerIds = new Set(customer.body.map((row) => row.id))
      for (const id of customerIds) assert.ok(!devIds.has(id))
      const owned = await pool.query(
        'SELECT id FROM imports WHERE organisation_id = 1',
      )
      assert.ok(owned.rows.length > 0)
      for (const row of owned.rows) {
        assert.ok(devIds.has(row.id))
        assert.ok(!customerIds.has(row.id))
      }
    })

    await testAsync('empty tenant does not receive organisation 1 analytics', async () => {
      await cleanupFixture()
      const customer = await request(server33, periodPath())
      const apps = await request(server33, '/api/apps')
      const recent = await request(server33, '/api/compare/period?days=7')
      assert.strictEqual(customer.status, 200)
      assert.strictEqual(apps.status, 200)
      assert.strictEqual(recent.status, 200)
      closeTo(customer.body.overall.current_spend || 0, 0)
      assert.ok(!customer.body.campaigns.some((row) => row.campaign_name === ORG1_CAMPAIGN))
      assert.ok(!customer.body.keywords.some((row) => row.keyword === ORG1_KEYWORD))
      assert.ok(!apps.body.some((app) => app.app_id === ORG1_APP || app.app_name === ORG1_APP_NAME))
      const org1App = await pool.query(
        `SELECT app_id FROM daily_campaign_metrics
         WHERE organisation_id = 1 AND app_id IS NOT NULL
         LIMIT 1`,
      )
      if (org1App.rows[0]) {
        assert.ok(!apps.body.some((app) => app.app_id === org1App.rows[0].app_id))
        assert.ok(!recent.body.apps.some((app) => app.app_id === org1App.rows[0].app_id))
      }
      const restored = await request(
        server73,
        `/api/compare/period?startDate=${developerWindow.start_date}&endDate=${developerWindow.end_date}`,
      )
      closeTo(restored.body.overall.current_spend, developerSpendBefore)
    })

    await testAsync('insights and alerts require the authenticated tenant', async () => {
      const devInsights = await request(server73, '/api/insights?days=7')
      const customerInsights = await request(server33, '/api/insights?days=7')
      const devAlerts = await request(server73, '/api/alerts')
      const customerAlerts = await request(server33, '/api/alerts')
      assert.strictEqual(devInsights.status, 200)
      assert.strictEqual(customerInsights.status, 200)
      assert.strictEqual(devAlerts.status, 200)
      assert.strictEqual(customerAlerts.status, 200)
      assert.ok(Array.isArray(devAlerts.body))
      assert.ok(Array.isArray(customerAlerts.body))
    })
  } finally {
    await cleanupFixture()
    await new Promise((resolve) => publicServer.close(resolve))
    await new Promise((resolve) => server73.close(resolve))
    await new Promise((resolve) => server33.close(resolve))
  }

  const leftover = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM daily_campaign_metrics WHERE app_id = ANY($1::text[])) AS campaigns,
       (SELECT COUNT(*)::int FROM daily_keyword_metrics WHERE app_id = ANY($1::text[])) AS keywords,
       (SELECT COUNT(*)::int FROM campaigns WHERE app_id = ANY($1::text[])) AS rows,
       (SELECT COUNT(*)::int FROM imports WHERE original_name = $2) AS imports`,
    [APP_IDS, FIXTURE_NAME],
  )
  assert.deepStrictEqual(leftover.rows[0], {
    campaigns: 0,
    keywords: 0,
    rows: 0,
    imports: 0,
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
