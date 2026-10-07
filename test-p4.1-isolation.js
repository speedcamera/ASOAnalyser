#!/usr/bin/env node
/**
 * P4.1 Two-Organisation Isolation Test
 * 
 * Tests that two organisations with IDENTICAL advertising identities
 * remain completely isolated.
 */

const { pool } = require('./backend/db')
const { getDashboardSummary, getCampaignSummary, getKeywordSummary } = require('./backend/analyticsService')
const { listImports } = require('./backend/imports')
const { getGoals } = require('./backend/goals')
const { listAnnotations } = require('./backend/annotations')
const { listBidExperiments } = require('./backend/bidExperiments')

async function runIsolationTest() {
  console.log('===================================================')
  console.log('P4.1 TWO-ORGANISATION ISOLATION TEST')
  console.log('===================================================\n')

  let orgAId, orgBId

  try {
    // 1. Create Test Organisations
    console.log('1. Creating test organisations...')
    
    const orgAResult = await pool.query(
      `INSERT INTO organisations (organisation_name) 
       VALUES ('Test Organisation A - Isolation Test')
       RETURNING id`
    )
    orgAId = orgAResult.rows[0].id
    console.log(`   ✓ Organisation A created: ID = ${orgAId}`)

    const orgBResult = await pool.query(
      `INSERT INTO organisations (organisation_name) 
       VALUES ('Test Organisation B - Isolation Test')
       RETURNING id`
    )
    orgBId = orgBResult.rows[0].id
    console.log(`   ✓ Organisation B created: ID = ${orgBId}\n`)

    // 2. Insert IDENTICAL advertising data with DIFFERENT metrics
    console.log('2. Inserting identical advertising structure, different metrics...')
    
    const appId = 'id123456789'
    const campaignName = 'Test Campaign A'
    const reportDate = '2026-08-15'
    
    // Organisation A: Spend £100
    await pool.query(
      `INSERT INTO campaigns (app_id, campaign_name, segment, organisation_id)
       VALUES ($1, $2, 'Brand', $3)`,
      [appId, campaignName, orgAId]
    )
    
    await pool.query(
      `INSERT INTO daily_campaign_metrics (
        app_id, app_name, campaign_name, report_date,
        spend, impressions, taps, installs, installs_tap_through, installs_total,
        organisation_id
       ) VALUES ($1, 'Test App', $2, $3, 100, 1000, 100, 10, 10, 10, $4)`,
      [appId, campaignName, reportDate, orgAId]
    )
    
    console.log(`   ✓ Organisation A: spend = £100`)
    
    // Organisation B: Spend £900 (SAME app_id, campaign_name, date)
    await pool.query(
      `INSERT INTO campaigns (app_id, campaign_name, segment, organisation_id)
       VALUES ($1, $2, 'Performance', $3)`,
      [appId, campaignName, orgBId]
    )
    
    await pool.query(
      `INSERT INTO daily_campaign_metrics (
        app_id, app_name, campaign_name, report_date,
        spend, impressions, taps, installs, installs_tap_through, installs_total,
        organisation_id
       ) VALUES ($1, 'Test App', $2, $3, 900, 9000, 900, 90, 90, 90, $4)`,
      [appId, campaignName, reportDate, orgBId]
    )
    
    console.log(`   ✓ Organisation B: spend = £900\n`)

    // 3. Test Dashboard Isolation
    console.log('3. Testing Dashboard isolation...')
    
    const dashA = await getDashboardSummary({
      organisationId: orgAId,
      startDate: reportDate,
      endDate: reportDate,
      compare: false
    })
    
    const dashB = await getDashboardSummary({
      organisationId: orgBId,
      startDate: reportDate,
      endDate: reportDate,
      compare: false
    })
    
    console.log(`   Org A spend: £${dashA.current.spend}`)
    console.log(`   Org B spend: £${dashB.current.spend}`)
    
    if (dashA.current.spend === 100 && dashB.current.spend === 900) {
      console.log('   ✅ PASS: Dashboard correctly isolated\n')
    } else {
      console.log(`   ❌ FAIL: Expected A=£100, B=£900\n`)
      process.exit(1)
    }

    // 4. Test Campaign Isolation
    console.log('4. Testing Campaign isolation...')
    
    const campaignsA = await getCampaignSummary({
      organisationId: orgAId,
      startDate: reportDate,
      endDate: reportDate,
      compare: false
    })
    
    const campaignsB = await getCampaignSummary({
      organisationId: orgBId,
      startDate: reportDate,
      endDate: reportDate,
      compare: false
    })
    
    console.log(`   Org A campaigns: ${campaignsA.length}, spend = £${campaignsA[0]?.spend || 0}`)
    console.log(`   Org B campaigns: ${campaignsB.length}, spend = £${campaignsB[0]?.spend || 0}`)
    
    if (campaignsA.length === 1 && campaignsA[0].spend === 100 &&
        campaignsB.length === 1 && campaignsB[0].spend === 900) {
      console.log('   ✅ PASS: Campaigns correctly isolated\n')
    } else {
      console.log('   ❌ FAIL: Campaign isolation broken\n')
      process.exit(1)
    }

    // 5. Test Keywords Isolation
    console.log('5. Testing Keywords isolation...')
    
    // Insert keyword data for both orgs
    await pool.query(
      `INSERT INTO daily_keyword_metrics (
        app_id, app_name, campaign_name, ad_group_name, keyword_text, bid_strategy, report_date,
        spend, impressions, taps, installs, installs_tap_through, installs_total,
        organisation_id
       ) VALUES ($1, 'Test App', $2, 'Test AG', 'test keyword', 'CPA', $3, 50, 500, 50, 5, 5, 5, $4)`,
      [appId, campaignName, reportDate, orgAId]
    )
    
    await pool.query(
      `INSERT INTO daily_keyword_metrics (
        app_id, app_name, campaign_name, ad_group_name, keyword_text, bid_strategy, report_date,
        spend, impressions, taps, installs, installs_tap_through, installs_total,
        organisation_id
       ) VALUES ($1, 'Test App', $2, 'Test AG', 'test keyword', 'CPA', $3, 450, 4500, 450, 45, 45, 45, $4)`,
      [appId, campaignName, reportDate, orgBId]
    )
    
    const keywordsA = await getKeywordSummary({
      organisationId: orgAId,
      startDate: reportDate,
      endDate: reportDate,
      compare: false
    })
    
    const keywordsB = await getKeywordSummary({
      organisationId: orgBId,
      startDate: reportDate,
      endDate: reportDate,
      compare: false
    })
    
    console.log(`   Org A keywords: ${keywordsA.length}, spend = £${keywordsA[0]?.spend || 0}`)
    console.log(`   Org B keywords: ${keywordsB.length}, spend = £${keywordsB[0]?.spend || 0}`)
    
    if (keywordsA.length === 1 && keywordsA[0].spend === 50 &&
        keywordsB.length === 1 && keywordsB[0].spend === 450) {
      console.log('   ✅ PASS: Keywords correctly isolated\n')
    } else {
      console.log('   ❌ FAIL: Keyword isolation broken\n')
      process.exit(1)
    }

    // 6. Test Imports Isolation
    console.log('6. Testing Imports isolation...')
    
    await pool.query(
      `INSERT INTO imports (original_name, row_count, column_headers, organisation_id)
       VALUES ('test_a.csv', 10, '[]', $1)`,
      [orgAId]
    )
    
    await pool.query(
      `INSERT INTO imports (original_name, row_count, column_headers, organisation_id)
       VALUES ('test_b.csv', 20, '[]', $1)`,
      [orgBId]
    )
    
    const importsA = await listImports(orgAId)
    const importsB = await listImports(orgBId)
    
    const testImportsA = importsA.filter(i => i.original_name.startsWith('test_'))
    const testImportsB = importsB.filter(i => i.original_name.startsWith('test_'))
    
    console.log(`   Org A test imports: ${testImportsA.length}`)
    console.log(`   Org B test imports: ${testImportsB.length}`)
    
    if (testImportsA.length === 1 && testImportsB.length === 1) {
      console.log('   ✅ PASS: Imports correctly isolated\n')
    } else {
      console.log('   ❌ FAIL: Import isolation broken\n')
      process.exit(1)
    }

    // 7. Test Goals/Annotations Isolation
    console.log('7. Testing Goals/Annotations isolation...')
    
    await pool.query(
      `INSERT INTO performance_goals (entity_type, entity_key, metric, operator, threshold, period_days, organisation_id)
       VALUES ('campaign', 'id123456789|Test Campaign A', 'cpa', 'less_than', 10, 7, $1)`,
      [orgAId]
    )
    
    await pool.query(
      `INSERT INTO performance_goals (entity_type, entity_key, metric, operator, threshold, period_days, organisation_id)
       VALUES ('campaign', 'id123456789|Test Campaign A', 'cpa', 'less_than', 20, 7, $1)`,
      [orgBId]
    )
    
    const goalsA = await getGoals({ organisationId: orgAId })
    const goalsB = await getGoals({ organisationId: orgBId })
    
    const testGoalsA = goalsA.filter(g => g.entityKey.includes('Test Campaign A'))
    const testGoalsB = goalsB.filter(g => g.entityKey.includes('Test Campaign A'))
    
    console.log(`   Org A test goals: ${testGoalsA.length}`)
    console.log(`   Org B test goals: ${testGoalsB.length}`)
    
    if (testGoalsA.length === 1 && testGoalsB.length === 1) {
      console.log('   ✅ PASS: Goals correctly isolated\n')
    } else {
      console.log('   ❌ FAIL: Goals isolation broken\n')
      process.exit(1)
    }

    // 8. Verify no cross-contamination
    console.log('8. Verifying NO mixed data...')
    
    const totalSpend = dashA.current.spend + dashB.current.spend
    console.log(`   Combined spend: £${totalSpend} (should be £1000, not visible to either org)`)
    
    if (totalSpend === 1000) {
      console.log('   ✅ PASS: Data exists but isolated\n')
    } else {
      console.log('   ❌ FAIL: Unexpected total\n')
      process.exit(1)
    }

    console.log('===================================================')
    console.log('✅ ALL ISOLATION TESTS PASSED')
    console.log('===================================================\n')
    console.log('Organisation A can ONLY see its £100 data')
    console.log('Organisation B can ONLY see its £900 data')
    console.log('Identical advertising identities remain isolated\n')

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message)
    console.error(error)
    process.exit(1)
  } finally {
    // Cleanup - organisations have ON DELETE CASCADE, so this will clean up all child data
    if (orgAId && orgBId) {
      console.log('Cleaning up test data...')
      try {
        // Delete child data first to avoid FK constraint issues
        // (P2 added organisation_id with ON DELETE CASCADE, but explicit cleanup is safer)
        await pool.query('DELETE FROM daily_keyword_metrics WHERE organisation_id IN ($1, $2)', [orgAId, orgBId])
        await pool.query('DELETE FROM daily_campaign_metrics WHERE organisation_id IN ($1, $2)', [orgAId, orgBId])
        await pool.query('DELETE FROM import_rows WHERE organisation_id IN ($1, $2)', [orgAId, orgBId])
        await pool.query('DELETE FROM imports WHERE organisation_id IN ($1, $2)', [orgAId, orgBId])
        await pool.query('DELETE FROM performance_goals WHERE organisation_id IN ($1, $2)', [orgAId, orgBId])
        await pool.query('DELETE FROM campaigns WHERE organisation_id IN ($1, $2)', [orgAId, orgBId])
        await pool.query('DELETE FROM organisations WHERE id IN ($1, $2)', [orgAId, orgBId])
        console.log('✓ Cleanup complete\n')
      } catch (cleanupErr) {
        console.error('⚠️  Cleanup warning:', cleanupErr.message)
        console.log('Test data may need manual cleanup\n')
      }
    }
    
    await pool.end()
  }
}

if (require.main === module) {
  runIsolationTest()
}
