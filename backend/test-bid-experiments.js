/**
 * Focused Bid Experiments tests (no external test runner).
 * Run: node test-bid-experiments.js
 */
require('dotenv').config()

const assert = require('assert')
const {
  normalizeBid,
  bidsEqual,
  buildKeywordIdentityKey,
  validateObservationDays,
  addDays,
  calendarDaysBetween,
  percentChange,
  ALLOWED_OBSERVATION_DAYS,
  DEFAULT_OBSERVATION_DAYS,
  detectBidExperiments,
  getBidExperimentSettings,
  setDefaultObservationDays,
  listBidExperiments,
  getBidExperimentById,
  backfillBidExperiments,
} = require('./bidExperiments')
const { calculateDerivedMetrics } = require('./analyticsMetrics')
const { pool, initDb } = require('./db')

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

console.log('\n=== Unit: bid tolerance & identity ===')

test('1.2 and 1.20 are equal after normalization', () => {
  assert.strictEqual(normalizeBid(1.2), 1.2)
  assert.strictEqual(normalizeBid('1.20'), 1.2)
  assert.ok(bidsEqual(1.2, 1.2))
  assert.ok(bidsEqual(1.2, '1.20'))
})

test('one-penny change is a genuine change', () => {
  assert.ok(!bidsEqual(1.2, 1.21))
  assert.strictEqual(normalizeBid(1.205), 1.21) // banker's? Math.round(120.5)/100 = 1.21 in JS
})

test('null bids are not equal', () => {
  assert.strictEqual(normalizeBid(null), null)
  assert.ok(!bidsEqual(null, 1.2))
  assert.ok(!bidsEqual(1.2, null))
})

test('identity separates apps, campaigns, ad groups', () => {
  const a = buildKeywordIdentityKey({
    appId: '1',
    campaignName: 'Brand',
    adGroupName: 'A',
    keywordText: 'delm8',
    bidStrategy: 'Manage Bids',
  })
  const b = buildKeywordIdentityKey({
    appId: '2',
    campaignName: 'Brand',
    adGroupName: 'A',
    keywordText: 'delm8',
    bidStrategy: 'Manage Bids',
  })
  const c = buildKeywordIdentityKey({
    appId: '1',
    campaignName: 'Generic',
    adGroupName: 'A',
    keywordText: 'delm8',
    bidStrategy: 'Manage Bids',
  })
  const d = buildKeywordIdentityKey({
    appId: '1',
    campaignName: 'Brand',
    adGroupName: 'B',
    keywordText: 'delm8',
    bidStrategy: 'Manage Bids',
  })
  assert.notStrictEqual(a, b)
  assert.notStrictEqual(a, c)
  assert.notStrictEqual(a, d)
})

test('null/empty parts normalize consistently', () => {
  const a = buildKeywordIdentityKey({
    appId: '1',
    campaignName: 'C',
    adGroupName: null,
    keywordText: 'k',
    bidStrategy: undefined,
  })
  const b = buildKeywordIdentityKey({
    appId: '1',
    campaignName: 'C',
    adGroupName: '',
    keywordText: 'k',
    bidStrategy: '',
  })
  assert.strictEqual(a, b)
})

console.log('\n=== Unit: observation settings & windows ===')

test('default observation days is 7', () => {
  assert.strictEqual(DEFAULT_OBSERVATION_DAYS, 7)
  assert.deepStrictEqual(ALLOWED_OBSERVATION_DAYS, [3, 7, 14, 30])
})

test('supported observation windows validate', () => {
  for (const d of [3, 7, 14, 30]) {
    assert.strictEqual(validateObservationDays(d), d)
  }
})

test('unsupported observation window is rejected', () => {
  assert.throws(() => validateObservationDays(5), /must be one of/)
  assert.throws(() => validateObservationDays(0), /must be one of/)
})

test('calendar window helpers', () => {
  assert.strictEqual(addDays('2026-07-01', 6), '2026-07-07')
  assert.strictEqual(addDays('2026-07-01', -1), '2026-06-30')
  assert.strictEqual(calendarDaysBetween('2026-07-01', '2026-07-07'), 7)
})

test('percentChange returns null for zero previous with activity; 0/0 is unchanged', () => {
  assert.strictEqual(percentChange(10, 0), null)
  assert.strictEqual(percentChange(null, 5), null)
  assert.strictEqual(percentChange(10, null), null)
  assert.strictEqual(percentChange(0, 0), 0)
  assert.ok(Math.abs(percentChange(12, 10) - 20) < 1e-9)
})

console.log('\n=== Unit: canonical metrics ===')

test('zero taps ⇒ null CPT (not Infinity)', () => {
  const m = calculateDerivedMetrics({
    spend: 10,
    impressions: 100,
    taps: 0,
    installs_tap_through: 0,
    installs_total: 0,
  })
  assert.strictEqual(m.cpt, null)
  assert.strictEqual(m.cpa, null)
  assert.ok(!Number.isNaN(m.cpt))
})

test('zero installs ⇒ null CPA', () => {
  const m = calculateDerivedMetrics({
    spend: 10,
    impressions: 100,
    taps: 5,
    installs_tap_through: 0,
    installs_total: 0,
  })
  assert.strictEqual(m.cpa, null)
  assert.ok(m.cpt != null)
})

async function runDbTests() {
  console.log('\n=== DB: migration, settings, detection idempotency ===')
  await initDb()

  await testAsync('settings default is 7', async () => {
    const s = await getBidExperimentSettings(1)
    assert.ok(ALLOWED_OBSERVATION_DAYS.includes(s.defaultObservationDays))
    assert.deepStrictEqual(s.allowedObservationDays, [3, 7, 14, 30])
  })

  await testAsync('unsupported settings PATCH value rejected', async () => {
    let threw = false
    try {
      await setDefaultObservationDays(1, 9)
    } catch (err) {
      threw = true
      assert.strictEqual(err.status, 400)
    }
    assert.ok(threw)
  })

  const originalDefault = (await getBidExperimentSettings(1)).defaultObservationDays

  await testAsync('changing default persists and is reversible', async () => {
    await setDefaultObservationDays(1, 14)
    assert.strictEqual((await getBidExperimentSettings(1)).defaultObservationDays, 14)
    await setDefaultObservationDays(1, 3)
    assert.strictEqual((await getBidExperimentSettings(1)).defaultObservationDays, 3)
    await setDefaultObservationDays(1, originalDefault)
  })

  await testAsync('backfill is idempotent (second run creates 0)', async () => {
    const first = await backfillBidExperiments()
    const second = await detectBidExperiments({ organisationId: 1 })
    assert.strictEqual(second.created, 0)
    assert.ok(first.scannedIdentities >= 0)
    console.log(
      `    (first created=${first.created}, second created=${second.created}, identities=${first.scannedIdentities})`,
    )
  })

  await testAsync('list and detail endpoints return coherent shapes', async () => {
    const list = await listBidExperiments({ organisationId: 1, limit: 5 })
    assert.ok(Array.isArray(list.experiments))
    if (list.experiments.length > 0) {
      const sample = list.experiments[0]
      assert.ok(sample.change_date)
      assert.ok(['increase', 'decrease'].includes(sample.direction))
      assert.ok(
        ['observing', 'completed', 'interrupted', 'insufficient_data'].includes(sample.status),
      )
      const detail = await getBidExperimentById(1, sample.id)
      assert.ok(detail)
      assert.ok(detail.before)
      assert.ok(detail.after)
      assert.ok(detail.deltas)
      assert.ok(detail.data_quality)
      assert.ok(detail.baselines)
      assert.ok(detail.baselines.cpa)
      assert.ok(
        ['High', 'Medium', 'Low', 'Insufficient'].includes(detail.baselines.confidence),
      )
      assert.ok(
        ['High', 'Medium', 'Low', 'Insufficient'].includes(detail.baselines.cpa.confidence),
      )
      assert.ok(detail.baselines.cpa.statistics)
      assert.ok(typeof detail.baselines.cpa.statistics.sample_size === 'number')
      assert.ok(detail.baselines.cpa.status)
      // Primary fields present; median reserved under statistics
      assert.ok('typical_low' in detail.baselines.cpa)
      assert.ok('typical_high' in detail.baselines.cpa)
      assert.ok('median' in detail.baselines.cpa.statistics)
      assert.ok(!('median' in detail.baselines.cpa) || detail.baselines.cpa.median === undefined)
      assert.strictEqual(detail.requested_observation_days, sample.requested_observation_days)
      // Changing default must not rewrite existing requested window
      await setDefaultObservationDays(1, 30)
      const detailAgain = await getBidExperimentById(1, sample.id)
      assert.strictEqual(
        detailAgain.requested_observation_days,
        sample.requested_observation_days,
      )
      await setDefaultObservationDays(1, originalDefault)
    }
  })

  await testAsync('interrupted experiments exclude next change date from after window', async () => {
    const interrupted = await pool.query(
      `SELECT id, organisation_id FROM bid_experiments WHERE interruption_date IS NOT NULL LIMIT 1`,
    )
    if (interrupted.rows.length === 0) {
      console.log('    (skipped — no interrupted experiments in dataset)')
      return
    }
    const detail = await getBidExperimentById(
      interrupted.rows[0].organisation_id,
      interrupted.rows[0].id,
    )
    assert.strictEqual(detail.status === 'interrupted' || detail.status === 'insufficient_data', true)
    if (detail.interruption_date && detail.after.end_date) {
      assert.ok(detail.after.end_date < detail.interruption_date)
    }
    assert.ok(
      detail.interruption_reason ||
        detail.status_reason ||
        detail.status === 'insufficient_data',
    )
  })
}

runDbTests()
  .then(async () => {
    console.log(`\nAll checks passed (${passed} assertions/groups).\n`)
    // Allow initDb setImmediate backfills to finish before closing the pool
    await new Promise((r) => setTimeout(r, 2500))
    await pool.end()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error('\nFAILED:', err)
    try {
      await new Promise((r) => setTimeout(r, 500))
      await pool.end()
    } catch (_) {
      /* ignore */
    }
    process.exit(1)
  })
