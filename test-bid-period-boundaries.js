/**
 * Bid Period Boundary Tests
 * 
 * Tests to verify that bid changes are correctly detected as inside or outside
 * the selected period, with proper handling of start and end boundaries.
 */

const { pool } = require('./backend/db')
const { resolveKeywordBidsFromHistory } = require('./backend/keywordBidHistory')

async function runTests() {
  console.log('Bid Period Boundary Tests\n')
  console.log('=' .repeat(60))
  
  // Get Development Organisation ID
  const orgResult = await pool.query(
    `SELECT id FROM organisations WHERE organisation_name = 'Development Organisation' LIMIT 1`
  )
  
  if (orgResult.rows.length === 0) {
    throw new Error('Development Organisation not found')
  }
  
  const testOrgId = orgResult.rows[0].id
  console.log(`Using organisation ID: ${testOrgId}\n`)
  
  // Test identity
  const testIdentity = {
    app_id: 'test-boundary-app',
    campaign_name: 'Test Boundary Campaign',
    ad_group_name: 'Test Ad Group',
    keyword_text: 'test boundary keyword',
  }
  
  let allPassed = true
  
  // ========== TEST 1: End Boundary (26 Aug) ==========
  console.log('\n' + '='.repeat(60))
  console.log('TEST 1: Change on period END boundary (26 Aug)')
  console.log('='.repeat(60))
  
  try {
    // Clean slate
    await pool.query(
      `DELETE FROM keyword_bid_history 
       WHERE organisation_id = $1 AND app_id = $2`,
      [testOrgId, testIdentity.app_id]
    )
    
    // Insert bid observations with explicit report_snapshot_date
    await pool.query(
      `INSERT INTO keyword_bid_history (
        organisation_id, app_id, campaign_name, ad_group_name, keyword_text,
        bid_amount, currency, observed_at, report_snapshot_date, import_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [testOrgId, testIdentity.app_id, testIdentity.campaign_name, 
       testIdentity.ad_group_name, testIdentity.keyword_text,
       10.00, 'GBP', new Date('2026-08-20T10:00:00Z'), '2026-08-20', null]
    )
    
    await pool.query(
      `INSERT INTO keyword_bid_history (
        organisation_id, app_id, campaign_name, ad_group_name, keyword_text,
        bid_amount, currency, observed_at, report_snapshot_date, import_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [testOrgId, testIdentity.app_id, testIdentity.campaign_name, 
       testIdentity.ad_group_name, testIdentity.keyword_text,
       30.00, 'GBP', new Date('2026-08-26T10:00:00Z'), '2026-08-26', null]
    )
    
    // Query with period 20 Aug - 26 Aug
    const result = await resolveKeywordBidsFromHistory({
      organisationId: testOrgId,
      keywordIdentities: [testIdentity],
      periodStartDate: '2026-08-20',
      periodEndDate: '2026-08-26',
    })
    
    const key = `${testIdentity.app_id}|${testIdentity.campaign_name}|${testIdentity.ad_group_name}|${testIdentity.keyword_text}`
    const bidData = result.get(key)
    
    console.log('Period: 20 Aug → 26 Aug')
    console.log('Observations:')
    console.log('  20 Aug: £10')
    console.log('  26 Aug: £30')
    console.log('\nResult:', JSON.stringify(bidData, null, 2))
    
    const test1 = 
      bidData.currentBid === 30 &&
      bidData.previousBid === 10 &&
      bidData.bidChangedInSelectedPeriod === true
    
    if (test1) {
      console.log('✓ TEST 1 PASSED - Change on end boundary correctly detected as IN period')
    } else {
      console.log('✗ TEST 1 FAILED')
      console.log('  Expected: bidChangedInSelectedPeriod = true')
      console.log(`  Got: bidChangedInSelectedPeriod = ${bidData.bidChangedInSelectedPeriod}`)
      allPassed = false
    }
    
  } catch (err) {
    console.log('✗ TEST 1 FAILED:', err.message)
    allPassed = false
  }
  
  // ========== TEST 2: Start Boundary (20 Aug) ==========
  console.log('\n' + '='.repeat(60))
  console.log('TEST 2: Change on period START boundary (20 Aug)')
  console.log('='.repeat(60))
  
  try {
    // Clean slate
    await pool.query(
      `DELETE FROM keyword_bid_history 
       WHERE organisation_id = $1 AND app_id = $2`,
      [testOrgId, testIdentity.app_id]
    )
    
    // Insert observations: £10 before period, £30 on start boundary
    await pool.query(
      `INSERT INTO keyword_bid_history (
        organisation_id, app_id, campaign_name, ad_group_name, keyword_text,
        bid_amount, currency, observed_at, report_snapshot_date, import_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [testOrgId, testIdentity.app_id, testIdentity.campaign_name, 
       testIdentity.ad_group_name, testIdentity.keyword_text,
       10.00, 'GBP', new Date('2026-08-15T10:00:00Z'), '2026-08-15', null]
    )
    
    await pool.query(
      `INSERT INTO keyword_bid_history (
        organisation_id, app_id, campaign_name, ad_group_name, keyword_text,
        bid_amount, currency, observed_at, report_snapshot_date, import_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [testOrgId, testIdentity.app_id, testIdentity.campaign_name, 
       testIdentity.ad_group_name, testIdentity.keyword_text,
       30.00, 'GBP', new Date('2026-08-20T10:00:00Z'), '2026-08-20', null]
    )
    
    // Query with period 20 Aug - 26 Aug
    const result = await resolveKeywordBidsFromHistory({
      organisationId: testOrgId,
      keywordIdentities: [testIdentity],
      periodStartDate: '2026-08-20',
      periodEndDate: '2026-08-26',
    })
    
    const key = `${testIdentity.app_id}|${testIdentity.campaign_name}|${testIdentity.ad_group_name}|${testIdentity.keyword_text}`
    const bidData = result.get(key)
    
    console.log('Period: 20 Aug → 26 Aug')
    console.log('Observations:')
    console.log('  15 Aug: £10 (before period)')
    console.log('  20 Aug: £30 (on start boundary)')
    console.log('\nResult:', JSON.stringify(bidData, null, 2))
    
    const test2 = 
      bidData.currentBid === 30 &&
      bidData.previousBid === 10 &&
      bidData.bidChangedInSelectedPeriod === true
    
    if (test2) {
      console.log('✓ TEST 2 PASSED - Change on start boundary correctly detected as IN period')
    } else {
      console.log('✗ TEST 2 FAILED')
      console.log('  Expected: bidChangedInSelectedPeriod = true')
      console.log(`  Got: bidChangedInSelectedPeriod = ${bidData.bidChangedInSelectedPeriod}`)
      allPassed = false
    }
    
  } catch (err) {
    console.log('✗ TEST 2 FAILED:', err.message)
    allPassed = false
  }
  
  // ========== TEST 3: Outside Period (10 Aug) ==========
  console.log('\n' + '='.repeat(60))
  console.log('TEST 3: Change OUTSIDE period (10 Aug)')
  console.log('='.repeat(60))
  
  try {
    // Clean slate
    await pool.query(
      `DELETE FROM keyword_bid_history 
       WHERE organisation_id = $1 AND app_id = $2`,
      [testOrgId, testIdentity.app_id]
    )
    
    // Insert observation before period: £10 on 10 Aug
    await pool.query(
      `INSERT INTO keyword_bid_history (
        organisation_id, app_id, campaign_name, ad_group_name, keyword_text,
        bid_amount, currency, observed_at, report_snapshot_date, import_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [testOrgId, testIdentity.app_id, testIdentity.campaign_name, 
       testIdentity.ad_group_name, testIdentity.keyword_text,
       10.00, 'GBP', new Date('2026-08-10T10:00:00Z'), '2026-08-10', null]
    )
    
    // Query with period 20 Aug - 26 Aug
    const result = await resolveKeywordBidsFromHistory({
      organisationId: testOrgId,
      keywordIdentities: [testIdentity],
      periodStartDate: '2026-08-20',
      periodEndDate: '2026-08-26',
    })
    
    const key = `${testIdentity.app_id}|${testIdentity.campaign_name}|${testIdentity.ad_group_name}|${testIdentity.keyword_text}`
    const bidData = result.get(key)
    
    console.log('Period: 20 Aug → 26 Aug')
    console.log('Observations:')
    console.log('  10 Aug: £10 (before period, no later changes)')
    console.log('\nResult:', JSON.stringify(bidData, null, 2))
    
    const test3 = 
      bidData.currentBid === 10 &&
      bidData.previousBid === null &&
      bidData.bidChangedInSelectedPeriod === false
    
    if (test3) {
      console.log('✓ TEST 3 PASSED - Single observation before period correctly detected as NOT in period')
    } else {
      console.log('✗ TEST 3 FAILED')
      console.log('  Expected: bidChangedInSelectedPeriod = false')
      console.log(`  Got: bidChangedInSelectedPeriod = ${bidData.bidChangedInSelectedPeriod}`)
      allPassed = false
    }
    
  } catch (err) {
    console.log('✗ TEST 3 FAILED:', err.message)
    allPassed = false
  }
  
  // ========== TEST 4: Real Case - delm8 pro ==========
  console.log('\n' + '='.repeat(60))
  console.log('TEST 4: Real case - delm8 pro keyword')
  console.log('='.repeat(60))
  
  try {
    // Query actual delm8 pro data
    const result = await resolveKeywordBidsFromHistory({
      organisationId: testOrgId,
      keywordIdentities: [{
        app_id: 'id1441893881',
        campaign_name: 'Delm8_route_planner_Brand',
        ad_group_name: 'Delm8_route_planner_Brand',
        keyword_text: 'delm8 pro',
      }],
      periodStartDate: '2026-08-20',
      periodEndDate: '2026-08-26',
    })
    
    const key = 'id1441893881|Delm8_route_planner_Brand|Delm8_route_planner_Brand|delm8 pro'
    const bidData = result.get(key)
    
    console.log('Period: 20 Aug → 26 Aug (7D)')
    console.log('Keyword: delm8 pro')
    console.log('Campaign: Delm8_route_planner_Brand')
    console.log('\nResult:', JSON.stringify(bidData, null, 2))
    
    // Expected: currentBid = 30, previousBid = 10, bidChangedInSelectedPeriod = true
    const test4 = 
      bidData.currentBid === 30 &&
      bidData.previousBid === 10 &&
      bidData.bidChangedInSelectedPeriod === true
    
    if (test4) {
      console.log('✓ TEST 4 PASSED - delm8 pro correctly shows change IN period')
      console.log('\nExpected UI display:')
      console.log('  Current Bid: £30.00')
      console.log('  Prev Bid: £10.00')
      console.log('  Bid Change: +£20.00')
      console.log('  Bid %: +200%')
      console.log('  First observed: 26 Aug 2026')
    } else {
      console.log('✗ TEST 4 FAILED')
      console.log('  Expected: currentBid=30, previousBid=10, bidChangedInSelectedPeriod=true')
      console.log(`  Got: currentBid=${bidData.currentBid}, previousBid=${bidData.previousBid}, bidChangedInSelectedPeriod=${bidData.bidChangedInSelectedPeriod}`)
      allPassed = false
    }
    
  } catch (err) {
    console.log('✗ TEST 4 FAILED:', err.message)
    allPassed = false
  }
  
  // Cleanup test data
  await pool.query(
    `DELETE FROM keyword_bid_history 
     WHERE organisation_id = $1 AND app_id = $2`,
    [testOrgId, testIdentity.app_id]
  )
  
  console.log('\n' + '='.repeat(60))
  if (allPassed) {
    console.log('✓ ALL TESTS PASSED')
  } else {
    console.log('✗ SOME TESTS FAILED')
  }
  console.log('='.repeat(60))
  
  return allPassed
}

// Run tests
runTests()
  .then(passed => {
    process.exit(passed ? 0 : 1)
  })
  .catch(err => {
    console.error('\n✗ Fatal error:', err)
    process.exit(1)
  })
