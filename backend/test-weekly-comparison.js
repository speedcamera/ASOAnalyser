/**
 * Weekly performance comparison boundary tests.
 * Run: node test-weekly-comparison.js
 *
 * Display weeks stay inside the selected period.
 * The preceding week is comparison context only.
 */
const assert = require('assert')
const { pool } = require('./db')
const {
  comparisonFetchStart,
  buildWeeklyRows,
  getCampaignWeeklyPerformance,
  weekStartingMonday,
} = require('./campaignWeekly')

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

function day(date, spend, extras = {}) {
  const installs = extras.installs ?? 2
  const taps = extras.taps ?? 10
  const impressions = extras.impressions ?? 100
  return {
    date,
    spend,
    impressions,
    taps,
    installs,
    installs_tap_through: extras.installs_tap_through ?? installs,
    installs_view_through: extras.installs_view_through ?? 0,
    installs_total: extras.installs_total ?? installs,
  }
}

function weekByStart(weeks, weekStarting) {
  return weeks.find((week) => week.weekStarting === weekStarting)
}

function visibleStarts(weeks) {
  return weeks.map((week) => week.weekStarting)
}

async function main() {
  console.log('\n=== Week boundary ===')

  test('week start stays Monday via the existing helper', () => {
    assert.strictEqual(weekStartingMonday('2026-09-14'), '2026-09-14')
    assert.strictEqual(weekStartingMonday('2026-09-16'), '2026-09-14')
    assert.strictEqual(weekStartingMonday('2026-09-20'), '2026-09-14')
    assert.strictEqual(weekStartingMonday('2026-09-21'), '2026-09-21')
  })

  test('comparison fetch starts on the Monday before the display week', () => {
    assert.strictEqual(comparisonFetchStart('2026-09-14'), '2026-09-07')
    assert.strictEqual(comparisonFetchStart('2026-09-16'), '2026-09-07')
    assert.strictEqual(comparisonFetchStart('2026-08-29'), '2026-08-17')
    assert.strictEqual(comparisonFetchStart(null), null)
  })

  console.log('\n=== 14D ===')

  test('14D shows W3 and W2, and W2 compares with comparison-only W1', () => {
    const rows = buildWeeklyRows(
      [
        day('2026-09-07', 10),
        day('2026-09-14', 20),
        day('2026-09-21', 40),
      ],
      { displayStart: '2026-09-14', displayEnd: '2026-09-27' },
    )

    assert.deepStrictEqual(visibleStarts(rows.weeks), ['2026-09-14', '2026-09-21'])
    assert.deepStrictEqual(
      rows.days.map((entry) => entry.date),
      ['2026-09-14', '2026-09-21'],
    )

    const w2 = weekByStart(rows.weeks, '2026-09-14')
    const w3 = weekByStart(rows.weeks, '2026-09-21')
    assert.strictEqual(w3.previous_week_starting, '2026-09-14')
    assert.strictEqual(w3.previous_spend, 20)
    assert.strictEqual(w2.previous_week_starting, '2026-09-07')
    assert.strictEqual(w2.previous_spend, 10)
    assert.strictEqual(w2.previous_installs, 2)
    assert.ok(rows.weeks.every((week) => week.weekStarting !== '2026-09-07'))
  })

  console.log('\n=== 7D ===')

  test('7D shows one week and compares it with the preceding week', () => {
    const rows = buildWeeklyRows(
      [
        day('2026-09-14', 15),
        day('2026-09-21', 25),
      ],
      { displayStart: '2026-09-21', displayEnd: '2026-09-27' },
    )

    assert.deepStrictEqual(visibleStarts(rows.weeks), ['2026-09-21'])
    assert.deepStrictEqual(rows.days.map((entry) => entry.date), ['2026-09-21'])
    const visible = rows.weeks[0]
    assert.strictEqual(visible.spend, 25)
    assert.strictEqual(visible.previous_week_starting, '2026-09-14')
    assert.strictEqual(visible.previous_spend, 15)
    assert.strictEqual(visible.previous_installs, 2)
    assert.strictEqual(visible.previous_cpa, 15 / 2)
    assert.strictEqual(visible.previous_cpt, 15 / 10)
    assert.strictEqual(visible.previous_ttr, (10 / 100) * 100)
  })

  console.log('\n=== 30D ===')

  test('30D oldest displayed week compares with the preceding week, which stays hidden', () => {
    const rows = buildWeeklyRows(
      [
        day('2026-08-17', 10),
        day('2026-08-24', 1000),
        day('2026-08-29', 20),
        day('2026-08-31', 30),
        day('2026-09-21', 50),
      ],
      { displayStart: '2026-08-29', displayEnd: '2026-09-27' },
    )

    assert.deepStrictEqual(visibleStarts(rows.weeks), [
      '2026-08-24',
      '2026-08-31',
      '2026-09-21',
    ])
    assert.ok(!visibleStarts(rows.weeks).includes('2026-08-17'))
    assert.deepStrictEqual(
      rows.days.map((entry) => entry.date),
      ['2026-08-29', '2026-08-31', '2026-09-21'],
    )

    const oldest = weekByStart(rows.weeks, '2026-08-24')
    const next = weekByStart(rows.weeks, '2026-08-31')
    assert.strictEqual(oldest.spend, 20)
    assert.strictEqual(oldest.previous_week_starting, '2026-08-17')
    assert.strictEqual(oldest.previous_spend, 10)
    assert.strictEqual(next.previous_week_starting, '2026-08-24')
    assert.strictEqual(next.previous_spend, 20)
  })

  console.log('\n=== ALL ===')

  test('ALL keeps every historical week and leaves only the first week without a predecessor', () => {
    const rows = buildWeeklyRows(
      [
        day('2026-09-07', 10),
        day('2026-09-14', 20),
        day('2026-09-21', 40),
      ],
      { displayStart: null, displayEnd: null },
    )

    assert.deepStrictEqual(visibleStarts(rows.weeks), [
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
    ])
    const first = weekByStart(rows.weeks, '2026-09-07')
    const second = weekByStart(rows.weeks, '2026-09-14')
    assert.strictEqual(first.previous_week_starting, null)
    assert.strictEqual(first.previous_spend, null)
    assert.strictEqual(first.previous_cpa, null)
    assert.strictEqual(second.previous_week_starting, '2026-09-07')
    assert.strictEqual(second.previous_spend, 10)
  })

  console.log('\n=== Missing and zero previous weeks ===')

  test('a genuinely absent previous week stays unavailable', () => {
    const rows = buildWeeklyRows(
      [
        day('2026-09-14', 20),
        day('2026-09-21', 40),
      ],
      { displayStart: '2026-09-14', displayEnd: '2026-09-27' },
    )

    const oldest = weekByStart(rows.weeks, '2026-09-14')
    assert.strictEqual(oldest.previous_week_starting, null)
    assert.strictEqual(oldest.previous_spend, null)
    assert.strictEqual(oldest.previous_installs, null)
    assert.strictEqual(oldest.previous_cpa, null)
    assert.strictEqual(oldest.previous_cpt, null)
    assert.strictEqual(oldest.previous_ttr, null)
    assert.strictEqual(weekByStart(rows.weeks, '2026-09-21').previous_spend, 20)
  })

  test('a previous week with zero spend is real data', () => {
    const rows = buildWeeklyRows(
      [
        day('2026-09-07', 0, { taps: 5, impressions: 0, installs: 0 }),
        day('2026-09-14', 20),
      ],
      { displayStart: '2026-09-14', displayEnd: '2026-09-20' },
    )

    assert.deepStrictEqual(visibleStarts(rows.weeks), ['2026-09-14'])
    const visible = rows.weeks[0]
    assert.strictEqual(visible.previous_week_starting, '2026-09-07')
    assert.strictEqual(visible.previous_spend, 0)
    assert.strictEqual(visible.previous_installs, 0)
    assert.strictEqual(visible.previous_cpt, 0)
    assert.strictEqual(visible.previous_cpa, null)
    assert.strictEqual(visible.previous_ttr, null)
  })

  test('a gap does not skip back to an older week', () => {
    const rows = buildWeeklyRows(
      [
        day('2026-09-07', 10),
        day('2026-09-21', 40),
      ],
      { displayStart: '2026-09-14', displayEnd: '2026-09-27' },
    )

    assert.deepStrictEqual(visibleStarts(rows.weeks), ['2026-09-21'])
    assert.strictEqual(rows.weeks[0].previous_week_starting, null)
    assert.strictEqual(rows.weeks[0].previous_spend, null)
  })

  console.log('\n=== Sorting ===')

  test('display weeks stay sorted by week start ascending', () => {
    const rows = buildWeeklyRows(
      [
        day('2026-09-21', 40),
        day('2026-09-07', 10),
        day('2026-09-14', 20),
      ],
      { displayStart: '2026-09-14', displayEnd: '2026-09-27' },
    )

    assert.deepStrictEqual(visibleStarts(rows.weeks), ['2026-09-14', '2026-09-21'])
    const starts = visibleStarts(rows.weeks)
    const sorted = [...starts].sort((a, b) => a.localeCompare(b))
    assert.deepStrictEqual(starts, sorted)
  })

  console.log('\n=== Tenant isolation ===')

  await testAsync('another organisation with the same campaign week is never used', async () => {
    const appId = `weekly-cmp-${Date.now()}`
    const campaignName = 'Weekly Compare Campaign'
    let orgAId = null
    let orgBId = null

    try {
      const orgA = await pool.query(
        `INSERT INTO organisations (organisation_name) VALUES ($1) RETURNING id`,
        ['Weekly Compare Org A'],
      )
      const orgB = await pool.query(
        `INSERT INTO organisations (organisation_name) VALUES ($1) RETURNING id`,
        ['Weekly Compare Org B'],
      )
      orgAId = orgA.rows[0].id
      orgBId = orgB.rows[0].id

      const insertMetric = (organisationId, reportDate, spend) => pool.query(
        `INSERT INTO daily_campaign_metrics (
           app_id, app_name, campaign_name, report_date,
           spend, impressions, taps, installs,
           installs_tap_through, installs_view_through, installs_total,
           organisation_id
         ) VALUES ($1, 'Weekly Compare App', $2, $3, $4, 100, 10, 2, 2, 0, 2, $5)`,
        [appId, campaignName, reportDate, spend, organisationId],
      )

      await insertMetric(orgAId, '2026-09-07', 40)
      await insertMetric(orgAId, '2026-09-14', 100)
      await insertMetric(orgBId, '2026-09-07', 888)
      await insertMetric(orgBId, '2026-09-14', 999)

      const orgAResult = await getCampaignWeeklyPerformance({
        organisationId: orgAId,
        startDate: '2026-09-14',
        endDate: '2026-09-20',
        appId,
        campaignName,
      })

      assert.deepStrictEqual(visibleStarts(orgAResult.weeks), ['2026-09-14'])
      assert.strictEqual(orgAResult.weeks[0].spend, 100)
      assert.strictEqual(orgAResult.weeks[0].previous_week_starting, '2026-09-07')
      assert.strictEqual(orgAResult.weeks[0].previous_spend, 40)
      assert.ok(orgAResult.days.every((entry) => entry.date >= '2026-09-14'))
      assert.ok(!orgAResult.days.some((entry) => entry.date === '2026-09-07'))

      const orgBResult = await getCampaignWeeklyPerformance({
        organisationId: orgBId,
        startDate: '2026-09-14',
        endDate: '2026-09-20',
        appId,
        campaignName,
      })
      assert.strictEqual(orgBResult.weeks[0].previous_spend, 888)
      assert.strictEqual(orgBResult.weeks[0].spend, 999)

      await pool.query(
        `DELETE FROM daily_campaign_metrics
         WHERE organisation_id = $1 AND report_date = '2026-09-07'`,
        [orgAId],
      )

      const orgAWithoutHistory = await getCampaignWeeklyPerformance({
        organisationId: orgAId,
        startDate: '2026-09-14',
        endDate: '2026-09-20',
        appId,
        campaignName,
      })
      assert.strictEqual(orgAWithoutHistory.weeks[0].previous_week_starting, null)
      assert.strictEqual(orgAWithoutHistory.weeks[0].previous_spend, null)
    } finally {
      if (orgAId || orgBId) {
        const ids = [orgAId, orgBId].filter(Boolean)
        await pool.query(
          'DELETE FROM daily_campaign_metrics WHERE organisation_id = ANY($1::int[])',
          [ids],
        )
        await pool.query(
          'DELETE FROM organisations WHERE id = ANY($1::int[])',
          [ids],
        )
      }
    }
  })

  console.log(`\n${passed} weekly comparison tests passed\n`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
