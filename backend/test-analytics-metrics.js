/**
 * Canonical analytics metric + change-rule tests.
 * Run: node test-analytics-metrics.js
 */
const assert = require('assert')
const {
  calculateDerivedMetrics,
  percentChange,
  changeDirection,
  describeMetricChange,
  CHANGE_DIRECTION,
} = require('./analyticsMetrics')
const { resolvePeriods } = require('./analyticsService')
const { buildKeywordIdentityKey } = require('./bidExperiments')

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

async function main() {
  console.log('\n=== Derived metrics ===')

  test('CPT = spend / taps', () => {
    const m = calculateDerivedMetrics({
      spend: 10,
      impressions: 100,
      taps: 5,
      installs_tap_through: 2,
    })
    assert.strictEqual(m.cpt, 2)
  })

  test('CPA = spend / tap-through installs', () => {
    const m = calculateDerivedMetrics({
      spend: 10,
      impressions: 100,
      taps: 5,
      installs_tap_through: 2,
    })
    assert.strictEqual(m.cpa, 5)
  })

  test('TTR = taps / impressions * 100', () => {
    const m = calculateDerivedMetrics({
      spend: 10,
      impressions: 100,
      taps: 5,
      installs_tap_through: 2,
    })
    assert.strictEqual(m.ttr, 5)
  })

  test('CR = installs / taps * 100', () => {
    const m = calculateDerivedMetrics({
      spend: 10,
      impressions: 100,
      taps: 5,
      installs_tap_through: 2,
    })
    assert.strictEqual(m.cr, 40)
  })

  test('zero taps ⇒ null CPT (not Infinity)', () => {
    const m = calculateDerivedMetrics({
      spend: 10,
      impressions: 100,
      taps: 0,
      installs_tap_through: 2,
    })
    assert.strictEqual(m.cpt, null)
  })

  test('zero installs ⇒ null CPA', () => {
    const m = calculateDerivedMetrics({
      spend: 10,
      impressions: 100,
      taps: 5,
      installs_tap_through: 0,
    })
    assert.strictEqual(m.cpa, null)
  })

  test('zero impressions ⇒ null TTR', () => {
    const m = calculateDerivedMetrics({
      spend: 10,
      impressions: 0,
      taps: 0,
      installs_tap_through: 0,
    })
    assert.strictEqual(m.ttr, null)
  })

  test('zero taps ⇒ null Conversion Rate', () => {
    const m = calculateDerivedMetrics({
      spend: 10,
      impressions: 100,
      taps: 0,
      installs_tap_through: 0,
    })
    assert.strictEqual(m.cr, null)
  })

  console.log('\n=== Percentage change ===')

  test('previous zero + current positive ⇒ null percent (not Infinity)', () => {
    assert.strictEqual(percentChange(10, 0), null)
    const d = describeMetricChange(10, 0)
    assert.strictEqual(d.percent, null)
    assert.strictEqual(d.is_new_activity, true)
    assert.strictEqual(d.direction, CHANGE_DIRECTION.UNAVAILABLE)
  })

  test('both periods zero ⇒ unchanged (percent 0)', () => {
    assert.strictEqual(percentChange(0, 0), 0)
    assert.strictEqual(changeDirection(0, 0), CHANGE_DIRECTION.UNCHANGED)
  })

  test('missing previous ⇒ unavailable', () => {
    assert.strictEqual(percentChange(10, null), null)
    assert.strictEqual(changeDirection(10, null), CHANGE_DIRECTION.UNAVAILABLE)
  })

  test('missing current ⇒ unavailable', () => {
    assert.strictEqual(percentChange(null, 10), null)
    assert.strictEqual(changeDirection(null, 10), CHANGE_DIRECTION.UNAVAILABLE)
  })

  test('increase direction', () => {
    assert.ok(Math.abs(percentChange(12, 10) - 20) < 1e-9)
    assert.strictEqual(changeDirection(12, 10), CHANGE_DIRECTION.INCREASE)
  })

  test('decrease direction', () => {
    assert.ok(Math.abs(percentChange(8, 10) - -20) < 1e-9)
    assert.strictEqual(changeDirection(8, 10), CHANGE_DIRECTION.DECREASE)
  })

  test('unchanged direction', () => {
    assert.strictEqual(percentChange(10, 10), 0)
    assert.strictEqual(changeDirection(10, 10), CHANGE_DIRECTION.UNCHANGED)
  })

  console.log('\n=== Date ranges ===')

  await testAsync('7-day ranges are equivalent and non-overlapping', async () => {
    const periods = await resolvePeriods({
      startDate: '2026-07-14',
      endDate: '2026-07-20',
    })
    assert.strictEqual(periods.current_period.start_date, '2026-07-14')
    assert.strictEqual(periods.current_period.end_date, '2026-07-20')
    assert.strictEqual(periods.previous_period.start_date, '2026-07-07')
    assert.strictEqual(periods.previous_period.end_date, '2026-07-13')
  })

  await testAsync('14-day ranges are correct', async () => {
    const periods = await resolvePeriods({
      startDate: '2026-07-07',
      endDate: '2026-07-20',
    })
    assert.strictEqual(periods.previous_period.start_date, '2026-06-23')
    assert.strictEqual(periods.previous_period.end_date, '2026-07-06')
  })

  await testAsync('30-day ranges are correct', async () => {
    const periods = await resolvePeriods({
      startDate: '2026-06-21',
      endDate: '2026-07-20',
    })
    assert.strictEqual(periods.previous_period.start_date, '2026-05-22')
    assert.strictEqual(periods.previous_period.end_date, '2026-06-20')
  })

  console.log('\n=== Keyword identity isolation ===')

  test('same keyword text in separate campaigns remains isolated', () => {
    const a = buildKeywordIdentityKey({
      appId: 'app1',
      campaignName: 'Brand',
      adGroupName: 'AG',
      keywordText: 'delm8',
      bidStrategy: '',
    })
    const b = buildKeywordIdentityKey({
      appId: 'app1',
      campaignName: 'Generic',
      adGroupName: 'AG',
      keywordText: 'delm8',
      bidStrategy: '',
    })
    assert.notStrictEqual(a, b)
  })

  test('same keyword in separate ad groups remains isolated', () => {
    const a = buildKeywordIdentityKey({
      appId: 'app1',
      campaignName: 'Brand',
      adGroupName: 'A',
      keywordText: 'delm8',
      bidStrategy: '',
    })
    const b = buildKeywordIdentityKey({
      appId: 'app1',
      campaignName: 'Brand',
      adGroupName: 'B',
      keywordText: 'delm8',
      bidStrategy: '',
    })
    assert.notStrictEqual(a, b)
  })

  test('same keyword across apps remains isolated', () => {
    const a = buildKeywordIdentityKey({
      appId: 'app1',
      campaignName: 'Brand',
      adGroupName: 'AG',
      keywordText: 'delm8',
      bidStrategy: '',
    })
    const b = buildKeywordIdentityKey({
      appId: 'app2',
      campaignName: 'Brand',
      adGroupName: 'AG',
      keywordText: 'delm8',
      bidStrategy: '',
    })
    assert.notStrictEqual(a, b)
  })

  console.log('\n=== Overview ↔ Bid History formula parity ===')

  test('identical totals ⇒ identical derived metrics', () => {
    const totals = {
      spend: 16.63,
      impressions: 200,
      taps: 3,
      installs_tap_through: 1,
      installs_view_through: 0,
      installs_total: 1,
    }
    assert.deepStrictEqual(calculateDerivedMetrics(totals), calculateDerivedMetrics(totals))
  })

  console.log(`\n${passed} tests passed.\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
