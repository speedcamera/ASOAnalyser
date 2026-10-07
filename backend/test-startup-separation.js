/**
 * P6C.3 startup separation.
 * Schema preparation is deliberate. Normal startup only checks that the schema exists.
 * A disposable PostgreSQL cluster is used for the fresh-database checks.
 * seoanalyser_production is not used.
 */
require('dotenv').config()

const assert = require('assert')
const fs = require('fs')
const { spawn, spawnSync } = require('child_process')
const path = require('path')
const { Pool } = require('pg')

const PG_BIN = '/usr/lib/postgresql/16/bin'
const CLUSTER_DIR = '/tmp/p6c3-pg'
const CLUSTER_PORT = 54329
const DEV_BASELINE = {
  users: 2,
  organisations: 5,
  organisation_users: 2,
  imports: 53,
  import_rows: 68445,
  campaigns: 35,
  daily_campaign_metrics: 14245,
  daily_keyword_metrics: 68417,
  annotations: 31,
  performance_goals: 4,
  bid_experiments: 157,
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeout || 120000,
    cwd: options.cwd || __dirname,
    env: options.env || process.env,
  })
  return result
}

function assertOk(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${(result.stderr || result.stdout || '').slice(0, 500)}`)
  }
}

async function devCounts() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const result = await pool.query(`SELECT
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM organisations) AS organisations,
      (SELECT COUNT(*)::int FROM organisation_users) AS organisation_users,
      (SELECT COUNT(*)::int FROM imports) AS imports,
      (SELECT COUNT(*)::int FROM import_rows) AS import_rows,
      (SELECT COUNT(*)::int FROM campaigns) AS campaigns,
      (SELECT COUNT(*)::int FROM daily_campaign_metrics) AS daily_campaign_metrics,
      (SELECT COUNT(*)::int FROM daily_keyword_metrics) AS daily_keyword_metrics,
      (SELECT COUNT(*)::int FROM annotations) AS annotations,
      (SELECT COUNT(*)::int FROM performance_goals) AS performance_goals,
      (SELECT COUNT(*)::int FROM bid_experiments) AS bid_experiments`)
    return result.rows[0]
  } finally {
    await pool.end()
  }
}

function startDisposableCluster() {
  fs.rmSync(CLUSTER_DIR, { recursive: true, force: true })
  assertOk(
    run(path.join(PG_BIN, 'initdb'), ['-D', CLUSTER_DIR, '--username=p6c3', '--auth=trust', '--no-sync']),
    'initdb'
  )
  assertOk(
    run(path.join(PG_BIN, 'pg_ctl'), [
      '-D',
      CLUSTER_DIR,
      '-l',
      path.join(CLUSTER_DIR, 'server.log'),
      '-o',
      `-p ${CLUSTER_PORT} -k ${CLUSTER_DIR} -c listen_addresses=127.0.0.1`,
      'start',
    ]),
    'pg_ctl start'
  )
}

function stopDisposableCluster() {
  run(path.join(PG_BIN, 'pg_ctl'), ['-D', CLUSTER_DIR, 'stop', '-m', 'fast'])
  fs.rmSync(CLUSTER_DIR, { recursive: true, force: true })
}

function disposableUrl(database) {
  return `postgresql://p6c3@127.0.0.1:${CLUSTER_PORT}/${database}`
}

function spawnNode(script, env, timeout = 20000) {
  return run(process.execPath, [script], { env, timeout })
}

async function waitForHealth(port) {
  const started = Date.now()
  let lastError = null
  while (Date.now() - started < 10000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (response.status === 200) return
    } catch (err) {
      lastError = err
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw lastError || new Error('server did not become ready')
}

async function main() {
  assert.ok(process.env.DATABASE_URL, 'development DATABASE_URL is required for this test')
  const before = await devCounts()
  assert.deepStrictEqual(before, DEV_BASELINE)

  const missingUrl = spawnNode('scripts/db-migrate.js', {
    ...process.env,
    DATABASE_URL: '',
  })
  assert.strictEqual(missingUrl.status, 1)
  const missingOutput = `${missingUrl.stdout || ''}\n${missingUrl.stderr || ''}`
  assert.match(missingOutput, /DATABASE_URL is required/)
  assert.doesNotMatch(missingOutput, /postgresql:\/\//)

  const refused = spawnNode('scripts/db-bootstrap-dev.js', {
    ...process.env,
    NODE_ENV: 'production',
    DEVELOPMENT_ORGANISATION_BOOTSTRAP_CLERK_USER_ID: 'user_must_not_be_printed',
  })
  assert.strictEqual(refused.status, 1)
  const refusedOutput = `${refused.stdout || ''}\n${refused.stderr || ''}`
  assert.match(refusedOutput, /Refusing to create Development Organisation when NODE_ENV=production/)
  assert.doesNotMatch(refusedOutput, /user_must_not_be_printed/)
  assert.deepStrictEqual(await devCounts(), before)

  console.log('Running schema preparation against the development database')
  const migrated = spawnNode('scripts/db-migrate.js', process.env, 180000)
  if (migrated.status !== 0) {
    throw new Error((migrated.stderr || migrated.stdout || 'db:migrate failed').slice(0, 2000))
  }
  const migrateOutput = `${migrated.stdout || ''}\n${migrated.stderr || ''}`
  assert.match(migrateOutput, /Schema preparation completed/)
  assert.match(migrateOutput, /does not create Development Organisation/)
  assert.doesNotMatch(migrateOutput, /Backfilling daily metrics/)
  assert.doesNotMatch(migrateOutput, /Backfilling bid experiments/)
  assert.deepStrictEqual(await devCounts(), before)

  const devPort = 3099
  const devServer = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(devPort), NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let devLogs = ''
  devServer.stdout.on('data', (chunk) => {
    devLogs += chunk.toString()
  })
  devServer.stderr.on('data', (chunk) => {
    devLogs += chunk.toString()
  })
  try {
    await waitForHealth(devPort)
    assert.match(devLogs, /Database schema readiness check passed/)
    assert.doesNotMatch(devLogs, /Migrating /)
    assert.doesNotMatch(devLogs, /Backfilling/)
    assert.doesNotMatch(devLogs, /Schema preparation completed/)
  } finally {
    devServer.kill('SIGTERM')
    await new Promise((resolve) => devServer.once('exit', resolve))
  }
  assert.deepStrictEqual(await devCounts(), before)

  startDisposableCluster()
  const admin = new Pool({ connectionString: disposableUrl('postgres') })
  try {
    await admin.query('CREATE DATABASE p6c3_fresh')
  } finally {
    await admin.end()
  }

  const freshUrl = disposableUrl('p6c3_fresh')
  const freshEnv = {
    ...process.env,
    DATABASE_URL: freshUrl,
    NODE_ENV: 'production',
    PORT: '3101',
    FRONTEND_ORIGIN: 'https://hold.example.com',
    DEVELOPMENT_ORGANISATION_BOOTSTRAP_CLERK_USER_ID: 'user_production_must_not_bootstrap',
  }

  const earlyServer = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: freshEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let earlyLogs = ''
  earlyServer.stdout.on('data', (chunk) => {
    earlyLogs += chunk.toString()
  })
  earlyServer.stderr.on('data', (chunk) => {
    earlyLogs += chunk.toString()
  })
  const earlyCode = await new Promise((resolve) => earlyServer.once('exit', resolve))
  assert.strictEqual(earlyCode, 1)
  assert.match(earlyLogs, /Database schema is not ready/)
  assert.match(earlyLogs, /NODE_ENV=production/)
  assert.doesNotMatch(earlyLogs, /user_production_must_not_bootstrap/)
  assert.doesNotMatch(earlyLogs, /Created development organisation/i)

  const freshMigrate = spawnNode('scripts/db-migrate.js', freshEnv, 180000)
  if (freshMigrate.status !== 0) {
    throw new Error((freshMigrate.stderr || freshMigrate.stdout || 'fresh migrate failed').slice(0, 2000))
  }
  const freshOutput = `${freshMigrate.stdout || ''}\n${freshMigrate.stderr || ''}`
  assert.match(freshOutput, /Schema preparation completed/)
  assert.doesNotMatch(freshOutput, /Created Development Organisation/)
  assert.doesNotMatch(freshOutput, /Backfilling daily metrics/)

  const fresh = new Pool({ connectionString: freshUrl })
  try {
    const tables = await fresh.query(
      `SELECT c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
       ORDER BY 1`
    )
    const names = tables.rows.map((row) => row.relname)
    for (const required of [
      'users',
      'organisations',
      'organisation_users',
      'imports',
      'import_rows',
      'campaigns',
      'daily_campaign_metrics',
      'daily_keyword_metrics',
      'keyword_bid_history',
      'annotations',
      'performance_goals',
      'bid_experiments',
      'application_settings',
    ]) {
      assert.ok(names.includes(required), `missing ${required}`)
    }
    const orgs = await fresh.query('SELECT COUNT(*)::int AS n FROM organisations')
    assert.strictEqual(orgs.rows[0].n, 0)
    const devOrg = await fresh.query(
      `SELECT COUNT(*)::int AS n FROM organisations WHERE organisation_name = 'Development Organisation'`
    )
    assert.strictEqual(devOrg.rows[0].n, 0)
  } finally {
    await fresh.end()
  }

  const prodServer = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: freshEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let prodLogs = ''
  prodServer.stdout.on('data', (chunk) => {
    prodLogs += chunk.toString()
  })
  prodServer.stderr.on('data', (chunk) => {
    prodLogs += chunk.toString()
  })
  try {
    await waitForHealth(3101)
    assert.match(prodLogs, /Database schema readiness check passed/)
    assert.match(prodLogs, /Development Organisation bootstrap is disabled/)
    assert.doesNotMatch(prodLogs, /Migrating /)
    assert.doesNotMatch(prodLogs, /Backfilling/)
    assert.doesNotMatch(prodLogs, /user_production_must_not_bootstrap/)
  } finally {
    prodServer.kill('SIGTERM')
    await new Promise((resolve) => prodServer.once('exit', resolve))
  }

  const afterStart = new Pool({ connectionString: freshUrl })
  try {
    const orgs = await afterStart.query('SELECT COUNT(*)::int AS n FROM organisations')
    assert.strictEqual(orgs.rows[0].n, 0)
  } finally {
    await afterStart.end()
  }

  assert.deepStrictEqual(await devCounts(), DEV_BASELINE)
  console.log('P6C.3 startup separation checks passed')
}

main()
  .catch((err) => {
    console.error(err && err.stack ? err.stack : err)
    process.exitCode = 1
  })
  .finally(() => {
    stopDisposableCluster()
  })
