/**
 * P6A.2 CSV upload protection.
 * Run: node test-csv-upload-protection.js
 *
 * Users 33 and 73 are resolved through requireAuthenticatedTenant. The
 * database is real. Fixtures are removed afterwards.
 */
require('dotenv').config()

const assert = require('assert')
const express = require('express')
const http = require('http')
const { spawnSync } = require('child_process')
const { pool } = require('./db')
const { assertClerkConfigured } = require('./auth/clerkConfig')
const { createAuthRouter } = require('./auth/routes')
const { createRequireAuthenticatedTenant } = require('./auth/tenantMiddleware')
const { registerImportRoutes } = require('./importRoutes')
const { parseCsv, createImport } = require('./imports')
const { errorHandler, publicError, GENERIC_SERVER_ERROR } = require('./http/clientError')
const {
  csvUploadLimits,
  DEFAULT_MAX_CSV_FILE_SIZE_MB,
  DEFAULT_MAX_CSV_ROWS,
  DEFAULT_MAX_CSV_UPLOADS_PER_WINDOW,
  DEFAULT_MAX_CSV_UPLOAD_WINDOW_MINUTES,
} = require('./http/csvLimits')

process.env.CLERK_TELEMETRY_DISABLED = 'true'
process.env.CLERK_PUBLISHABLE_KEY =
  'pk_test_' + Buffer.from('example.clerk.accounts.dev$').toString('base64url')
process.env.CLERK_SECRET_KEY = 'sk_test_p6a2_dummy_secret_not_a_real_key'

assertClerkConfigured()

const { app } = require('./index')

const APP_ID = 'p6a2-upload-app'
const FILE_NAME = 'p6a2-report.csv'
const CAMPAIGN = 'P6A2 Keyword Campaign'
const KEYWORD = 'p6a2-keyword'

let passed = 0

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
    throw err
  }
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
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          accept: 'application/json',
          ...(body ? { 'content-length': Buffer.byteLength(body) } : {}),
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
    if (body) req.write(body)
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

function authedApp(user, csvLimits) {
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
  registerImportRoutes(expressApp, chain, { csvLimits })
  expressApp.use(errorHandler)
  return expressApp
}

function switchingApp(getUser, csvLimits) {
  const expressApp = express()
  expressApp.use(express.json())
  const chain = createRequireAuthenticatedTenant({
    getAuthFn: () => {
      const user = getUser()
      return { isAuthenticated: true, userId: user.authProviderUserId }
    },
    resolveUser: async () => getUser(),
  })
  registerImportRoutes(expressApp, chain, { csvLimits })
  expressApp.use(errorHandler)
  return expressApp
}

function multipart({ filename, content, mime = 'text/csv', fields = {} }) {
  const boundary = '----p6a2boundary'
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
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
    ),
  )
  chunks.push(Buffer.isBuffer(content) ? content : Buffer.from(content))
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`))
  return {
    body: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

function keywordCsv(bidHeader, rows) {
  return [
    `Date,Campaign Name,Ad Group Name,Keyword,Bid Strategy,App ID,App Name,Spend,Impressions,Taps,Installs (Total),${bidHeader}`,
    ...rows,
  ].join('\n')
}

const VALID_ROWS = [
  `2097-06-01,${CAMPAIGN},P6A2 Ad Group,${KEYWORD},Manual,${APP_ID},P6A2 App,1.00,10,2,1,0.40`,
  `2097-06-02,${CAMPAIGN},P6A2 Ad Group,${KEYWORD},Manual,${APP_ID},P6A2 App,1.25,12,3,1,0.55`,
]
const VALID_CSV = keywordCsv('Keyword Max Bid', VALID_ROWS)
const LEGACY_BID_CSV = keywordCsv('Keyword Max CPT Bid', [
  `2097-06-03,${CAMPAIGN},P6A2 Ad Group,${KEYWORD},Manual,${APP_ID},P6A2 App,1.50,8,1,1,0.70`,
])

function assertNoDisclosure(res) {
  const raw = res.text || ''
  assert.ok(!/\/home\//.test(raw), raw.slice(0, 180))
  assert.ok(!/node_modules/.test(raw))
  assert.ok(!/\bat\s+\S+:\d+:\d+/.test(raw))
  assert.ok(!/syntax error at or near/i.test(raw))
  assert.ok(!/MulterError/.test(raw))
  assert.ok(!/LIMIT_FILE_SIZE/.test(raw))
  assert.ok(!/postgresql:\/\//i.test(raw))
}

async function count(sql, params = []) {
  const result = await pool.query(sql, params)
  return result.rows[0].n
}

async function residue(fileName, campaignName) {
  return {
    imports: await count('SELECT COUNT(*)::int AS n FROM imports WHERE original_name = $1', [fileName]),
    rows: await count(
      `SELECT COUNT(*)::int AS n FROM import_rows WHERE data->>'Campaign Name' = $1`,
      [campaignName],
    ),
    campaigns: await count('SELECT COUNT(*)::int AS n FROM campaigns WHERE campaign_name = $1', [campaignName]),
    campaignMetrics: await count(
      'SELECT COUNT(*)::int AS n FROM daily_campaign_metrics WHERE campaign_name = $1',
      [campaignName],
    ),
    keywordMetrics: await count(
      'SELECT COUNT(*)::int AS n FROM daily_keyword_metrics WHERE campaign_name = $1',
      [campaignName],
    ),
  }
}

async function cleanup() {
  await pool.query('DELETE FROM bid_experiments WHERE app_id = $1', [APP_ID])
  await pool.query('DELETE FROM keyword_bid_history WHERE app_id = $1', [APP_ID])
  await pool.query('DELETE FROM daily_keyword_metrics WHERE app_id = $1 OR campaign_name = $2', [
    APP_ID,
    CAMPAIGN,
  ])
  await pool.query('DELETE FROM daily_campaign_metrics WHERE app_id = $1 OR campaign_name LIKE $2', [
    APP_ID,
    'P6A2 %',
  ])
  await pool.query('DELETE FROM campaigns WHERE app_id = $1 OR campaign_name LIKE $2', [APP_ID, 'P6A2 %'])
  await pool.query(`DELETE FROM import_rows WHERE data->>'App ID' = $1 OR data->>'Campaign Name' LIKE $2`, [
    APP_ID,
    'P6A2 %',
  ])
  await pool.query(`DELETE FROM imports WHERE original_name LIKE 'p6a2-%'`)
}

async function main() {
  console.log('\n=== P6A.2 CSV upload protection ===')

  const defaults = csvUploadLimits({})
  test('defaults are 16 MB, 100000 rows, and 10 uploads per 15 minutes', () => {
    assert.strictEqual(defaults.maxFileSizeMb, DEFAULT_MAX_CSV_FILE_SIZE_MB)
    assert.strictEqual(defaults.maxFileSizeMb, 16)
    assert.strictEqual(defaults.maxBytes, 16 * 1024 * 1024)
    assert.strictEqual(defaults.maxRows, DEFAULT_MAX_CSV_ROWS)
    assert.strictEqual(defaults.maxRows, 100000)
    assert.strictEqual(defaults.uploadsPerWindow, DEFAULT_MAX_CSV_UPLOADS_PER_WINDOW)
    assert.strictEqual(defaults.uploadsPerWindow, 10)
    assert.strictEqual(defaults.windowMinutes, DEFAULT_MAX_CSV_UPLOAD_WINDOW_MINUTES)
    assert.strictEqual(defaults.windowMinutes, 15)
  })

  test('a hostile column name does not pollute object prototypes', () => {
    const before = Object.prototype.polluted
    const parsed = parseCsv(
      Buffer.from(['Date,Campaign Name,__proto__', '2097-01-01,Safe,polluted'].join('\n')),
    )
    assert.strictEqual(Object.prototype.polluted, before)
    assert.strictEqual(Object.prototype.hasOwnProperty.call(parsed.records[0], 'polluted'), false)
    assert.ok(Object.keys(parsed.records[0]).includes('__proto__'))
  })

  test('parsing stops when the row limit is exceeded', () => {
    const csv = [
      'Date,Campaign Name',
      '2097-01-01,A',
      '2097-01-02,B',
      '2097-01-03,C',
      '"unclosed',
    ].join('\n')
    assert.throws(
      () => parseCsv(Buffer.from(csv), { maxRows: 2 }),
      (err) => {
        assert.strictEqual(err.status, 413)
        assert.strictEqual(err.message, 'CSV contains more rows than the maximum allowed')
        assert.ok(!err.message.includes('unclosed'))
        return true
      },
    )
  })

  const roomy = {
    ...defaults,
    uploadsPerWindow: 100,
  }
  const users = await pool.query(
    `SELECT id, email, full_name, auth_provider, auth_provider_user_id
     FROM users WHERE id IN (33, 73) ORDER BY id`,
  )
  assert.strictEqual(users.rows.length, 2)
  const user33 = asReqUser(users.rows.find((row) => row.id === 33))
  const user73 = asReqUser(users.rows.find((row) => row.id === 73))

  await cleanup()
  const foreign = await pool.query(
    `SELECT id FROM imports WHERE organisation_id = 1 ORDER BY id LIMIT 1`,
  )
  assert.ok(foreign.rows.length === 1)
  const foreignImportId = foreign.rows[0].id

  const publicServer = await listen(app)
  const developerServer = await listen(authedApp(user73, roomy))
  const customerServer = await listen(authedApp(user33, roomy))
  let activeUser = user73
  const rateServer = await listen(
    switchingApp(() => activeUser, { ...defaults, uploadsPerWindow: 10 }),
  )
  const servers = [publicServer, developerServer, customerServer, rateServer]

  try {
    await testAsync('valid Apple Ads CSV succeeds for organisation 1', async () => {
      const context = await request(developerServer, '/api/auth/context')
      assert.strictEqual(context.body.user.id, 73)
      assert.strictEqual(context.body.organisation.id, 1)

      const file = multipart({ filename: FILE_NAME, content: VALID_CSV })
      const res = await request(developerServer, '/api/imports', {
        method: 'POST',
        headers: file.headers,
        body: file.body,
      })
      assert.strictEqual(res.status, 201, res.text)
      assert.strictEqual(res.body.insertedRows, 2)
      const owned = await pool.query('SELECT organisation_id FROM imports WHERE id = $1', [res.body.id])
      assert.strictEqual(owned.rows[0].organisation_id, 1)
    })

    await testAsync('a file below the 16 MB limit succeeds', async () => {
      assert.ok(Buffer.byteLength(VALID_CSV) < defaults.maxBytes)
      const file = multipart({ filename: 'p6a2-below-size.csv', content: VALID_CSV })
      const res = await request(developerServer, '/api/imports', {
        method: 'POST',
        headers: file.headers,
        body: file.body,
      })
      assert.strictEqual(res.status, 201, res.text)
      assert.strictEqual(res.body.updatedRows, 2)
    })

    await testAsync('a file at a configured size limit succeeds and one byte over is 413', async () => {
      const csv = keywordCsv('Keyword Max Bid', [
        `2097-07-01,P6A2 Size Campaign,P6A2 Ad Group,${KEYWORD},Manual,${APP_ID},P6A2 App,1.00,4,1,1,0.20`,
      ])
      const atLimit = await listen(authedApp(user73, { ...roomy, maxBytes: Buffer.byteLength(csv) }))
      const overLimit = await listen(
        authedApp(user73, { ...roomy, maxBytes: Buffer.byteLength(csv) - 1 }),
      )
      try {
        const atFile = multipart({ filename: 'p6a2-at-size.csv', content: csv })
        const at = await request(atLimit, '/api/imports', {
          method: 'POST',
          headers: atFile.headers,
          body: atFile.body,
        })
        assert.strictEqual(at.status, 201, at.text)

        const before = await residue('p6a2-over-size.csv', 'P6A2 Size Campaign')
        const overFile = multipart({ filename: 'p6a2-over-size.csv', content: csv })
        const over = await request(overLimit, '/api/imports', {
          method: 'POST',
          headers: overFile.headers,
          body: overFile.body,
        })
        assert.strictEqual(over.status, 413)
        assert.deepStrictEqual(over.body, { error: 'CSV file exceeds the maximum allowed size' })
        assertNoDisclosure(over)
        assert.deepStrictEqual(await residue('p6a2-over-size.csv', 'P6A2 Size Campaign'), before)
      } finally {
        await new Promise((resolve) => atLimit.close(resolve))
        await new Promise((resolve) => overLimit.close(resolve))
      }
    })

    await testAsync('the default 16 MB Multer limit rejects a larger file', async () => {
      const before = await count('SELECT COUNT(*)::int AS n FROM imports')
      const content = Buffer.alloc(defaults.maxBytes + 1, 0x61)
      const file = multipart({ filename: 'p6a2-default-over-size.csv', content, mime: 'text/csv' })
      const res = await request(developerServer, '/api/imports', {
        method: 'POST',
        headers: file.headers,
        body: file.body,
      })
      assert.strictEqual(res.status, 413)
      assert.deepStrictEqual(res.body, { error: 'CSV file exceeds the maximum allowed size' })
      assertNoDisclosure(res)
      assert.strictEqual(await count('SELECT COUNT(*)::int AS n FROM imports'), before)
    })

    await testAsync('a CSV below the row limit succeeds', async () => {
      const file = multipart({ filename: 'p6a2-below-rows.csv', content: VALID_CSV })
      const res = await request(developerServer, '/api/imports', {
        method: 'POST',
        headers: file.headers,
        body: file.body,
      })
      assert.strictEqual(res.status, 201, res.text)
    })

    await testAsync('a CSV over the row limit is 413 and leaves no rows', async () => {
      const campaign = 'P6A2 Too Many'
      const csv = [
        'Date,Campaign Name,App ID,App Name',
        `2097-02-01,${campaign},${APP_ID},P6A2 App`,
        `2097-02-02,${campaign},${APP_ID},P6A2 App`,
        `2097-02-03,${campaign},${APP_ID},P6A2 App`,
        '"unclosed',
      ].join('\n')
      const rowServer = await listen(authedApp(user73, { ...roomy, maxRows: 2 }))
      const before = await residue('p6a2-too-many.csv', campaign)
      try {
        const file = multipart({ filename: 'p6a2-too-many.csv', content: csv })
        const res = await request(rowServer, '/api/imports', {
          method: 'POST',
          headers: file.headers,
          body: file.body,
        })
        assert.strictEqual(res.status, 413)
        assert.deepStrictEqual(res.body, { error: 'CSV contains more rows than the maximum allowed' })
        assert.ok(!res.text.includes('unclosed'))
        assertNoDisclosure(res)
        assert.deepStrictEqual(await residue('p6a2-too-many.csv', campaign), before)
      } finally {
        await new Promise((resolve) => rowServer.close(resolve))
      }
    })

    await testAsync('malformed CSV is a safe 400', async () => {
      const before = await residue('p6a2-malformed.csv', CAMPAIGN)
      const file = multipart({
        filename: 'p6a2-malformed.csv',
        content: `Date,Campaign Name\n2097-01-01,"${CAMPAIGN}`,
      })
      const res = await request(developerServer, '/api/imports', {
        method: 'POST',
        headers: file.headers,
        body: file.body,
      })
      assert.strictEqual(res.status, 400)
      assert.deepStrictEqual(res.body, { error: 'The CSV file could not be parsed' })
      assert.ok(!res.text.includes(CAMPAIGN))
      assertNoDisclosure(res)
      assert.deepStrictEqual(await residue('p6a2-malformed.csv', CAMPAIGN), before)
    })

    await testAsync('renamed non-CSV content is a 400', async () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      const disguised = multipart({
        filename: 'p6a2-image.csv',
        content: png,
        mime: 'text/plain',
      })
      const typed = multipart({
        filename: 'p6a2-image.csv',
        content: png,
        mime: 'image/png',
      })
      const prose = multipart({
        filename: 'p6a2-notes.csv',
        content: 'Date,Spend\n2097-01-01,1.00\n',
        mime: 'application/octet-stream',
      })
      const before = await count('SELECT COUNT(*)::int AS n FROM imports')
      const pngRes = await request(developerServer, '/api/imports', {
        method: 'POST',
        headers: disguised.headers,
        body: disguised.body,
      })
      const mimeRes = await request(developerServer, '/api/imports', {
        method: 'POST',
        headers: typed.headers,
        body: typed.body,
      })
      const shapeRes = await request(developerServer, '/api/imports', {
        method: 'POST',
        headers: prose.headers,
        body: prose.body,
      })
      assert.strictEqual(pngRes.status, 400)
      assert.deepStrictEqual(pngRes.body, { error: 'Only CSV files are allowed' })
      assert.strictEqual(mimeRes.status, 400)
      assert.deepStrictEqual(mimeRes.body, { error: 'Only CSV files are allowed' })
      assert.strictEqual(shapeRes.status, 400)
      assert.deepStrictEqual(shapeRes.body, { error: 'CSV is missing required Apple Ads columns' })
      assertNoDisclosure(pngRes)
      assert.strictEqual(await count('SELECT COUNT(*)::int AS n FROM imports'), before)
    })

    await testAsync('Keyword Max Bid and Keyword Max CPT Bid both import', async () => {
      const legacy = multipart({
        filename: 'p6a2-legacy-bid.csv',
        content: LEGACY_BID_CSV,
        mime: 'application/vnd.ms-excel',
      })
      const res = await request(developerServer, '/api/imports', {
        method: 'POST',
        headers: legacy.headers,
        body: legacy.body,
      })
      assert.strictEqual(res.status, 201, res.text)
      assert.strictEqual(res.body.insertedRows, 1)
    })

    await testAsync('uploading the same CSV again updates the organisation rows', async () => {
      const beforeRows = await count(
        `SELECT COUNT(*)::int AS n FROM import_rows WHERE organisation_id = 1 AND data->>'Keyword' = $1`,
        [KEYWORD],
      )
      const file = multipart({ filename: FILE_NAME, content: VALID_CSV })
      const res = await request(developerServer, '/api/imports', {
        method: 'POST',
        headers: file.headers,
        body: file.body,
      })
      assert.strictEqual(res.status, 201, res.text)
      assert.strictEqual(res.body.insertedRows, 0)
      assert.strictEqual(res.body.updatedRows, 2)
      const afterRows = await count(
        `SELECT COUNT(*)::int AS n FROM import_rows WHERE organisation_id = 1 AND data->>'Keyword' = $1`,
        [KEYWORD],
      )
      assert.strictEqual(afterRows, beforeRows)
    })

    await testAsync('the same CSV in organisation 14 stays isolated', async () => {
      const context = await request(customerServer, '/api/auth/context')
      assert.strictEqual(context.body.user.id, 33)
      assert.strictEqual(context.body.organisation.id, 14)

      const file = multipart({
        filename: FILE_NAME,
        content: VALID_CSV,
        fields: { organisationId: '1' },
      })
      const res = await request(customerServer, '/api/imports?organisationId=1', {
        method: 'POST',
        headers: { ...file.headers, 'x-organisation-id': '1' },
        body: file.body,
      })
      assert.strictEqual(res.status, 201, res.text)
      assert.strictEqual(res.body.insertedRows, 2)
      const owned = await pool.query('SELECT organisation_id FROM imports WHERE id = $1', [res.body.id])
      assert.strictEqual(owned.rows[0].organisation_id, 14)

      const split = await pool.query(
        `SELECT organisation_id, COUNT(*)::int AS n
         FROM import_rows
         WHERE data->>'Keyword' = $1
         GROUP BY organisation_id
         ORDER BY organisation_id`,
        [KEYWORD],
      )
      assert.deepStrictEqual(
        split.rows.map((row) => row.organisation_id),
        [1, 14],
      )

      const hidden = await request(customerServer, `/api/imports/${foreignImportId}`)
      assert.strictEqual(hidden.status, 404)
      assert.deepStrictEqual(hidden.body, { error: 'Import not found' })
    })

    await testAsync('unauthenticated uploads stay 401', async () => {
      const file = multipart({ filename: FILE_NAME, content: VALID_CSV })
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const res = await request(publicServer, '/api/imports', {
          method: 'POST',
          headers: file.headers,
          body: file.body,
        })
        assert.strictEqual(res.status, 401)
        assert.deepStrictEqual(res.body, { error: 'Unauthorized' })
      }
    })

    await testAsync('upload attempts past the user limit are 429', async () => {
      const bad = multipart({
        filename: 'p6a2-rate.csv',
        content: 'Date,Spend\n2097-01-01,1\n',
      })
      const first = await request(rateServer, '/api/imports', {
        method: 'POST',
        headers: multipart({ filename: 'p6a2-rate-ok.csv', content: VALID_CSV }).headers,
        body: multipart({ filename: 'p6a2-rate-ok.csv', content: VALID_CSV }).body,
      })
      assert.strictEqual(first.status, 201, first.text)

      for (let attempt = 0; attempt < 9; attempt += 1) {
        const res = await request(rateServer, '/api/imports', {
          method: 'POST',
          headers: bad.headers,
          body: bad.body,
        })
        assert.strictEqual(res.status, 400, `attempt ${attempt + 2}`)
      }

      const limited = await request(rateServer, '/api/imports', {
        method: 'POST',
        headers: bad.headers,
        body: bad.body,
      })
      assert.strictEqual(limited.status, 429)
      assert.deepStrictEqual(limited.body, { error: 'Too many upload attempts. Try again later.' })
      assertNoDisclosure(limited)

      activeUser = user33
      const other = await request(rateServer, '/api/imports', {
        method: 'POST',
        headers: multipart({ filename: 'p6a2-other-user.csv', content: LEGACY_BID_CSV }).headers,
        body: multipart({ filename: 'p6a2-other-user.csv', content: LEGACY_BID_CSV }).body,
      })
      assert.strictEqual(other.status, 201, other.text)
      const owned = await pool.query('SELECT organisation_id FROM imports WHERE id = $1', [other.body.id])
      assert.strictEqual(owned.rows[0].organisation_id, 14)
    })

    await testAsync('a database failure during import rolls back and stays generic', async () => {
      const before = {
        imports: await count('SELECT COUNT(*)::int AS n FROM imports'),
        rows: await count('SELECT COUNT(*)::int AS n FROM import_rows'),
        campaigns: await count('SELECT COUNT(*)::int AS n FROM campaigns'),
        campaignMetrics: await count('SELECT COUNT(*)::int AS n FROM daily_campaign_metrics'),
        keywordMetrics: await count('SELECT COUNT(*)::int AS n FROM daily_keyword_metrics'),
      }
      const parsed = parseCsv(Buffer.from(VALID_CSV))
      const err = await createImport('p6a2-rollback.csv', parsed.headers, parsed.records, 2147483646).then(
        () => null,
        (failure) => failure,
      )
      assert.ok(err)
      const outcome = publicError(err)
      assert.strictEqual(outcome.status, 500)
      assert.deepStrictEqual(outcome.body, { error: GENERIC_SERVER_ERROR })
      assert.ok(!JSON.stringify(outcome.body).includes('violates'))
      assert.deepStrictEqual(
        {
          imports: await count('SELECT COUNT(*)::int AS n FROM imports'),
          rows: await count('SELECT COUNT(*)::int AS n FROM import_rows'),
          campaigns: await count('SELECT COUNT(*)::int AS n FROM campaigns'),
          campaignMetrics: await count('SELECT COUNT(*)::int AS n FROM daily_campaign_metrics'),
          keywordMetrics: await count('SELECT COUNT(*)::int AS n FROM daily_keyword_metrics'),
        },
        before,
      )
    })

    await testAsync('startup rejects an invalid CSV limit without printing secrets', async () => {
      const result = spawnSync(
        process.execPath,
        ['-e', "process.env.MAX_CSV_ROWS='0'; require('./index.js')"],
        {
          cwd: __dirname,
          encoding: 'utf8',
          env: { ...process.env, MAX_CSV_ROWS: '0', NODE_ENV: 'development' },
        },
      )
      const output = `${result.stdout || ''}\n${result.stderr || ''}`
      assert.ok(!/sk_test_|sk_live_|postgresql:\/\//i.test(output))
      assert.notStrictEqual(result.status, 0)
      assert.match(output, /MAX_CSV_ROWS/)
      assert.doesNotMatch(output, /got /)
    })
  } finally {
    await cleanup()
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
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
