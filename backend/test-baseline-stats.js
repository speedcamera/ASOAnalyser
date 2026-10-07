/**
 * Unit tests for historical baseline statistics.
 * Run: node test-baseline-stats.js
 */
const assert = require('assert')
const {
  CONFIDENCE,
  RANGE_STATUS,
  percentile,
  summariseDistribution,
  confidenceFromSampleSize,
  classifyAgainstTypicalRange,
  buildMetricBaseline,
} = require('./baselineStats')

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

console.log('\n=== Unit: baselineStats ===')

test('percentile on empty and singleton', () => {
  assert.strictEqual(percentile([], 50), null)
  assert.strictEqual(percentile([4.2], 50), 4.2)
})

test('median and quartiles for even sample', () => {
  // 1..8 → Q1=2.75, median=4.5, Q3=6.25
  const stats = summariseDistribution([1, 2, 3, 4, 5, 6, 7, 8])
  assert.strictEqual(stats.sample_size, 8)
  assert.strictEqual(stats.median, 4.5)
  assert.strictEqual(stats.q1, 2.75)
  assert.strictEqual(stats.q3, 6.25)
  assert.strictEqual(stats.iqr, 3.5)
  assert.strictEqual(stats.typical_low, 2.75)
  assert.strictEqual(stats.typical_high, 6.25)
})

test('ignores non-finite values', () => {
  const stats = summariseDistribution([1, null, 'x', Infinity, 3, 5])
  assert.strictEqual(stats.sample_size, 3)
  assert.strictEqual(stats.median, 3)
})

test('confidence tiers by sample size', () => {
  assert.strictEqual(confidenceFromSampleSize(0), CONFIDENCE.INSUFFICIENT)
  assert.strictEqual(confidenceFromSampleSize(4), CONFIDENCE.INSUFFICIENT)
  assert.strictEqual(confidenceFromSampleSize(5), CONFIDENCE.LOW)
  assert.strictEqual(confidenceFromSampleSize(13), CONFIDENCE.LOW)
  assert.strictEqual(confidenceFromSampleSize(14), CONFIDENCE.MEDIUM)
  assert.strictEqual(confidenceFromSampleSize(29), CONFIDENCE.MEDIUM)
  assert.strictEqual(confidenceFromSampleSize(30), CONFIDENCE.HIGH)
})

test('range classification', () => {
  assert.strictEqual(
    classifyAgainstTypicalRange(5.9, 4.2, 5.1, CONFIDENCE.HIGH),
    RANGE_STATUS.ABOVE,
  )
  assert.strictEqual(
    classifyAgainstTypicalRange(4.5, 4.2, 5.1, CONFIDENCE.HIGH),
    RANGE_STATUS.WITHIN,
  )
  assert.strictEqual(
    classifyAgainstTypicalRange(3.0, 4.2, 5.1, CONFIDENCE.MEDIUM),
    RANGE_STATUS.BELOW,
  )
  assert.strictEqual(
    classifyAgainstTypicalRange(5.9, 4.2, 5.1, CONFIDENCE.INSUFFICIENT),
    RANGE_STATUS.INSUFFICIENT,
  )
  assert.strictEqual(
    classifyAgainstTypicalRange(null, 4.2, 5.1, CONFIDENCE.HIGH),
    RANGE_STATUS.UNAVAILABLE,
  )
})

test('buildMetricBaseline presentation fields', () => {
  // Build a large enough sample for High confidence
  const samples = []
  for (let i = 0; i < 40; i++) samples.push(4 + (i % 10) * 0.1)
  const baseline = buildMetricBaseline(samples, 5.9)
  assert.ok(baseline.typical_low != null)
  assert.ok(baseline.typical_high != null)
  assert.strictEqual(baseline.current, 5.9)
  assert.strictEqual(baseline.confidence, CONFIDENCE.HIGH)
  assert.strictEqual(baseline.status, RANGE_STATUS.ABOVE)
  assert.ok(baseline.statistics.median != null)
  assert.ok(baseline.statistics.iqr != null)
  assert.strictEqual(baseline.statistics.sample_size, 40)
})

test('insufficient sample yields insufficient status', () => {
  const baseline = buildMetricBaseline([4.2, 4.5], 5.9)
  assert.strictEqual(baseline.confidence, CONFIDENCE.INSUFFICIENT)
  assert.strictEqual(baseline.status, RANGE_STATUS.INSUFFICIENT)
})

console.log(`\n${passed} tests passed.\n`)
