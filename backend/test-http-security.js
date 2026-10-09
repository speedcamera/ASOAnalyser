/**
 * P6A.1 HTTP, error, and security baseline.
 * Run: node test-http-security.js
 *
 * Controlled failures stay inside this process. Responses must not include
 * database text, stack traces, or filesystem paths. CORS is checked against
 * the development frontend origin and an unapproved origin.
 */
require('dotenv').config()

const assert = require('assert')
const express = require('express')
const http = require('http')
const { spawnSync } = require('child_process')
const { pool } = require('./db')
const {
  GENERIC_SERVER_ERROR,
  errorHandler,
  httpError,
  publicError,
  sendRouteError,
} = require('./http/clientError')
const {
  allowedFrontendOrigins,
  assertHttpSecurityConfigured,
  createCorsMiddleware,
  createSecurityHeaders,
} = require('./http/security')
const { registerFeatureRoutes } = require('./featureRoutes')
const { csvUpload } = require('./importRoutes')
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

function listen(expressApp) {
  return new Promise((resolve) => {
    const server = expressApp.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function request(server, path, { method = 'GET', headers, body } = {}) {
  const { port } = server.address()
  const payload = body === undefined || body === null
    ? null
    : Buffer.isBuffer(body)
      ? body
      : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
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
                'content-type': headers?.['content-type'] || 'application/json',
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
          const responseHeaders = {}
          for (const [key, value] of Object.entries(res.headers)) {
            responseHeaders[key.toLowerCase()] = value
          }
          resolve({ status: res.statusCode, body: parsed, text, headers: responseHeaders })
        })
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function assertNoDisclosure(text) {
  const body = String(text)
  assert.ok(!body.includes('password authentication'))
  assert.ok(!body.includes('duplicate key'))
  assert.ok(!body.includes('/home/'))
  assert.ok(!body.includes('node_modules'))
  assert.ok(!body.includes('28P01'))
  assert.ok(!body.includes('23505'))
  assert.ok(!body.includes('at Client'))
  assert.ok(!body.includes('postgresql://'))
  assert.ok(!body.includes('sk_test_'))
  assert.ok(!body.includes('sk_live_'))
}

function probeApp() {
  const expressApp = express()
  expressApp.use(createSecurityHeaders({ NODE_ENV: 'development' }))
  expressApp.use(createCorsMiddleware({ NODE_ENV: 'development' }))
  expressApp.use(express.json())
  expressApp.get('/boom', async () => {
    const err = new Error(
      'password authentication failed for user "dbuser" at /home/mohamed/projects/seoanalyser/backend/db.js:10'
    )
    err.code = '28P01'
    err.stack =
      'Error: password authentication failed\n    at Client._connect (/home/mohamed/projects/seoanalyser/backend/node_modules/pg/lib/client.js:1:1)'
    throw err
  })
  expressApp.get('/caught', (req, res) => {
    const err = new Error('duplicate key value violates unique constraint "users_pkey"')
    err.code = '23505'
    err.stack = 'Error: duplicate key\n    at Query (/home/mohamed/projects/seoanalyser/backend/goals.js:10:1)'
    sendRouteError(req, res, err)
  })
  registerFeatureRoutes(expressApp, [
    (req, _res, next) => {
      req.user = { id: 33 }
      req.organisationId = 14
      next()
    },
  ])
  expressApp.post('/upload', csvUpload, (req, res) => {
    res.status(201).json({ ok: true })
  })
  expressApp.use(errorHandler)
  return expressApp
}

function multipart(filename, content) {
  const boundary = '----p6a1boundary'
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n`
    ),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return {
    body,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

function headerValue(headers, name) {
  const value = headers[name.toLowerCase()]
  return Array.isArray(value) ? value.join(',') : value
}

async function main() {
  console.log('\n=== P6A.1 HTTP security baseline ===')

  test('unexpected errors become the generic 500', () => {
    const err = new Error('relation "daily_campaign_metrics" does not exist')
    err.code = '42P01'
    err.stack = 'Error: relation\n    at /home/mohamed/projects/seoanalyser/backend/db.js:4:2'
    const result = publicError(err)
    assert.strictEqual(result.status, 500)
    assert.deepStrictEqual(result.body, { error: GENERIC_SERVER_ERROR })
    assertNoDisclosure(JSON.stringify(result.body))
  })

  test('validation errors stay useful 400s', () => {
    const result = publicError(httpError(400, 'Invalid metric. Must be one of: spend, installs'))
    assert.strictEqual(result.status, 400)
    assert.strictEqual(result.body.error, 'Invalid metric. Must be one of: spend, installs')
  })

  test('permission errors stay 403', () => {
    const result = publicError(httpError(403, 'You do not have access to this'))
    assert.strictEqual(result.status, 403)
    assert.strictEqual(result.body.error, 'You do not have access to this')
  })

  test('not-found errors stay 404', () => {
    const result = publicError(httpError(404, 'Campaign not found'))
    assert.strictEqual(result.status, 404)
    assert.strictEqual(result.body.error, 'Campaign not found')
  })

  test('a status code without expose does not leak the message', () => {
    const err = new Error('password authentication failed at /home/mohamed/projects/seoanalyser/backend/db.js:1')
    err.status = 400
    const result = publicError(err)
    assert.strictEqual(result.status, 500)
    assert.deepStrictEqual(result.body, { error: GENERIC_SERVER_ERROR })
  })

  test('development allows the Vite origin and production does not assume it', () => {
    assert.ok(allowedFrontendOrigins({}).includes('http://localhost:5173'))
    assert.ok(
      allowedFrontendOrigins({
        NODE_ENV: 'development',
        FRONTEND_ORIGIN: 'https://preview.example.com',
      }).includes('http://localhost:5173')
    )
    assert.deepStrictEqual(
      allowedFrontendOrigins({
        NODE_ENV: 'production',
        FRONTEND_ORIGIN: 'https://app.example.com',
      }),
      ['https://app.example.com']
    )
    assert.doesNotThrow(() => assertHttpSecurityConfigured({ NODE_ENV: 'development' }))
    assert.throws(() => assertHttpSecurityConfigured({ NODE_ENV: 'production' }), /FRONTEND_ORIGIN/)
    assert.throws(
      () => assertHttpSecurityConfigured({ NODE_ENV: 'production', FRONTEND_ORIGIN: '*' }),
      /wildcard/i
    )
    assert.throws(
      () =>
        assertHttpSecurityConfigured({
          NODE_ENV: 'production',
          FRONTEND_ORIGIN: 'https://user:secret@app.example.com',
        }),
      (err) => {
        assert.match(err.message, /credentials/)
        assert.ok(!err.message.includes('secret'))
        return true
      }
    )
  })

  test('startup logs do not include bearer tokens or the database url', () => {
    const databaseUrl = process.env.DATABASE_URL
    assert.ok(databaseUrl)
    const logs = []
    const original = console.error
    console.error = (...args) => logs.push(args)
    const res = {
      headersSent: false,
      statusCode: 0,
      status(code) {
        this.statusCode = code
        return this
      },
      json() {
        return this
      },
    }
    try {
      const err = new Error(`connect failed ${databaseUrl}`)
      err.code = '28P01'
      sendRouteError(
        {
          method: 'POST',
          originalUrl: '/api/imports?access_token=abc',
          organisationId: 14,
          headers: { authorization: 'Bearer session-token-value' },
        },
        res,
        err
      )
    } finally {
      console.error = original
    }
    const logged = JSON.stringify(logs)
    if (logged.includes(databaseUrl) || logged.includes('session-token-value') || logged.includes('access_token')) {
      throw new Error('request log contained a secret or query credential')
    }
    assert.ok(logged.includes('[redacted]'))
    assert.ok(logged.includes('/api/imports'))
    assert.ok(logged.includes('"organisationId":14') || logged.includes('"organisationId": 14'))
  })

  const server = await listen(probeApp())
  const api = await listen(app)
  try {
    await testAsync('thrown internal error returns only the generic 500', async () => {
      const res = await request(server, '/boom')
      assert.strictEqual(res.status, 500)
      assert.deepStrictEqual(res.body, { error: GENERIC_SERVER_ERROR })
      assertNoDisclosure(res.text)
      assert.ok(!res.text.includes('stack'))
    })

    await testAsync('caught internal error returns only the generic 500', async () => {
      const res = await request(server, '/caught')
      assert.strictEqual(res.status, 500)
      assert.deepStrictEqual(res.body, { error: GENERIC_SERVER_ERROR })
      assertNoDisclosure(res.text)
    })

    await testAsync('goal validation remains a useful 400', async () => {
      const res = await request(server, '/api/goals', {
        method: 'POST',
        body: { entityType: 'nope' },
      })
      assert.strictEqual(res.status, 400)
      assert.match(res.body.error, /Invalid entity_type/)
      assert.notStrictEqual(res.body.error, GENERIC_SERVER_ERROR)
    })

    await testAsync('invalid JSON remains a useful 400', async () => {
      const res = await request(server, '/api/goals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      })
      assert.strictEqual(res.status, 400)
      assert.strictEqual(res.body.error, 'Request body must be valid JSON')
      assertNoDisclosure(res.text)
    })

    await testAsync('non-CSV upload is a useful 400', async () => {
      const file = multipart('notes.txt', 'not,a,csv\n')
      const res = await request(server, '/upload', {
        method: 'POST',
        headers: file.headers,
        body: file.body,
      })
      assert.strictEqual(res.status, 400)
      assert.strictEqual(res.body.error, 'Only CSV files are allowed')
    })

    await testAsync('development localhost origin receives CORS permission', async () => {
      const res = await request(api, '/api/health', {
        headers: { origin: 'http://localhost:5173' },
      })
      assert.strictEqual(res.status, 200)
      assert.strictEqual(headerValue(res.headers, 'access-control-allow-origin'), 'http://localhost:5173')
      assert.notStrictEqual(headerValue(res.headers, 'access-control-allow-credentials'), 'true')
    })

    await testAsync('unapproved origin does not receive CORS permission', async () => {
      const res = await request(api, '/api/health', {
        headers: { origin: 'https://evil.example' },
      })
      assert.notStrictEqual(headerValue(res.headers, 'access-control-allow-origin'), 'https://evil.example')
      assert.ok(!headerValue(res.headers, 'access-control-allow-origin'))
    })

    await testAsync('Authorization preflight is allowed for the development origin', async () => {
      const res = await request(api, '/api/goals', {
        method: 'OPTIONS',
        headers: {
          origin: 'http://localhost:5173',
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization,content-type',
        },
      })
      assert.ok(res.status === 204 || res.status === 200)
      assert.strictEqual(headerValue(res.headers, 'access-control-allow-origin'), 'http://localhost:5173')
      assert.match(String(headerValue(res.headers, 'access-control-allow-headers')).toLowerCase(), /authorization/)
      assert.notStrictEqual(headerValue(res.headers, 'access-control-allow-credentials'), 'true')
    })

    await testAsync('Authorization bearer still reaches authentication', async () => {
      const res = await request(api, '/api/goals', {
        headers: {
          origin: 'http://localhost:5173',
          authorization: 'Bearer not-a-valid-session',
        },
      })
      assert.strictEqual(res.status, 401)
      assert.deepStrictEqual(res.body, { error: 'Unauthorized' })
      assert.strictEqual(headerValue(res.headers, 'access-control-allow-origin'), 'http://localhost:5173')
    })

    await testAsync('security headers are present and CSP is not set on the API', async () => {
      const res = await request(api, '/api/health', {
        headers: { origin: 'http://localhost:5173' },
      })
      assert.strictEqual(headerValue(res.headers, 'x-content-type-options'), 'nosniff')
      assert.strictEqual(headerValue(res.headers, 'cross-origin-resource-policy'), 'cross-origin')
      assert.ok(!headerValue(res.headers, 'content-security-policy'))
      assert.ok(!headerValue(res.headers, 'cross-origin-embedder-policy'))
      if (process.env.NODE_ENV !== 'production') {
        assert.ok(!headerValue(res.headers, 'strict-transport-security'))
      }
    })

    await testAsync('tenant-test is not mounted on the application', async () => {
      const res = await request(api, '/api/auth/tenant-test')
      assert.strictEqual(res.status, 404)
      assert.deepStrictEqual(res.body, { error: 'Not found' })
    })

    await testAsync('production CORS config does not allow localhost automatically', async () => {
      const production = express()
      production.use(
        createCorsMiddleware({
          NODE_ENV: 'production',
          FRONTEND_ORIGIN: 'https://app.example.com',
        })
      )
      production.get('/api/health', (_req, res) => res.json({ ok: true }))
      const prodServer = await listen(production)
      try {
        const local = await request(prodServer, '/api/health', {
          headers: { origin: 'http://localhost:5173' },
        })
        const approved = await request(prodServer, '/api/health', {
          headers: { origin: 'https://app.example.com' },
        })
        assert.ok(!headerValue(local.headers, 'access-control-allow-origin'))
        assert.strictEqual(headerValue(approved.headers, 'access-control-allow-origin'), 'https://app.example.com')
      } finally {
        await new Promise((resolve) => prodServer.close(resolve))
      }
    })
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await new Promise((resolve) => api.close(resolve))
  }

  await testAsync('production startup fails when FRONTEND_ORIGIN is missing', async () => {
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        "process.env.NODE_ENV='production'; delete process.env.FRONTEND_ORIGIN; require('./index.js')",
      ],
      { cwd: __dirname, encoding: 'utf8' }
    )
    const output = `${result.stdout || ''}\n${result.stderr || ''}`
    if (/sk_test_|sk_live_|postgresql:\/\//i.test(output)) {
      throw new Error('production startup failure printed a secret')
    }
    assert.notStrictEqual(result.status, 0)
    assert.match(output, /FRONTEND_ORIGIN/)
    assert.match(output, /localhost is not used automatically/)
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
