/**
 * Keyword Bid History Hardening Tests
 * 
 * Tests period-aware bid change detection and old report reimport protection
 */

const { pool } = require('./backend/db')
const { recordBidObservations, resolveKeywordBidsFromHistory } = require('./backend/keywordBidHistory')

async function runTests() {
  console.log('Keyword Bid History Hardening Tests\n')
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
    app_id: 'test-hardening-app',
    campaign_name: 'Test Hardening Campaign',
    ad_group_name: 'Test Ad Group',
    keyword_text: 'test keyword hardening',
  }
  
  // Clean up any existing test data
  await pool.query(
    `DELETE FROM keyword_bid_history 
     WHERE organisation_id = $1 
       AND app_id = $2 
       AND campaign_name = $3
       AND keyword_text = $4`,
    [testOrgId, testIdentity.app_id, testIdentity.campaign_name, testIdentity.keyword_text]
  )
  
  let allPassed = true
  
  // ========== TEST A: Change inside 7D ==========
  console.log('\n' + '='.repeat(60))
  console.log('TEST A: Change inside 7D')
  console.log('='.repeat(60))
  
  try {
    // Clean slate
    await pool.query(
      `DELETE FROM keyword_bid_history 
       WHERE organisation_id = $1 AND app_id = $2`,
      [testOrgId, testIdentity.app_id]
    )
    
    // Record £10 on 20 Aug
    await recordBidObservations({
      organisationId: testOrgId,
      importId: null,
      observedAt: new Date('2026-08-20T10:00:00Z'),
      reportSnapshotDate: '2026-08-20',
      keywordBids: [{
        ...testIdentity,
        bid_amount: 10.00,
        currency: 'GBP',
      }],
    })
    
    // Record £30 on 25 Aug
    await recordBidObservations({
      organisationId: testOrgId,
      importId: null,
      observedAt: new Date('2026-08-25T10:00:00Z'),
      reportSnapshotDate: '2026-08-25',
      keywordBids: [{
        ...testIdentity,
        bid_amount: 30.00,
        currency: 'GBP',
      }],
    })
    
    // Analyze on 26 Aug with 7D window (starts 19 Aug)
    const result = await resolveKeywordBidsFromHistory({
      organisationId: testOrgId,
      keywordIdentities: [testIdentity],
      periodStartDate: '2026-08-19',
      periodEndDate: '2026-08-26',
    })
    
    const key = `${testIdentity.app_id}|${testIdentity.campaign_name}|${testIdentity.ad_group_name}|${testIdentity.keyword_text}`
    const bidData = result.get(key)
    
    console.log('Result:', JSON.stringify(bidData, null, 2))
    
    const testA = 
      bidData.currentBid === 30 &&
      bidData.previousBid === 10 &&
      bidData.bidChangedInSelectedPeriod === true
    
    if (testA) {
      console.log('✓ TEST A PASSED')
    } else {
      console.log('✗ TEST A FAILED')
      console.log('  Expected: currentBid=30, previousBid=10, bidChangedInSelectedPeriod=true')
      console.log(`  Got: currentBid=${bidData.currentBid}, previousBid=${bidData.previousBid}, bidChangedInSelectedPeriod=${bidData.bidChangedInSelectedPeriod}`)
      allPassed = false
    }
    
  } catch (err) {
    console.log('✗ TEST A FAILED:', err.message)
    allPassed = false
  }
  
  // ========== TEST B: Change outside 7D ==========
  console.log('\n' + '='.repeat(60))
  console.log('TEST B: Change outside 7D')
  console.log('='.repeat(60))
  
  try {
    // Clean slate
    await pool.query(
      `DELETE FROM keyword_bid_history 
       WHERE organisation_id = $1 AND app_id = $2`,
      [testOrgId, testIdentity.app_id]
    )
    
    // Record £7 on 1 Aug
    await recordBidObservations({
      organisationId: testOrgId,
      importId: null,
      observedAt: new Date('2026-08-01T10:00:00Z'),
      reportSnapshotDate: '2026-08-01',
      keywordBids: [{
        ...testIdentity,
        bid_amount: 7.00,
        currency: 'GBP',
      }],
    })
    
    // Record £10 on 10 Aug
    await recordBidObservations({
      organisationId: testOrgId,
      importId: null,
      observedAt: new Date('2026-08-10T10:00:00Z'),
      reportSnapshotDate: '2026-08-10',
      keywordBids: [{
        ...testIdentity,
        bid_amount: 10.00,
        currency: 'GBP',
      }],
    })
    
    // Analyze on 26 Aug with 7D window (starts 19 Aug)
    const result = await resolveKeywordBidsFromHistory({
      organisationId: testOrgId,
      keywordIdentities: [testIdentity],
      periodStartDate: '2026-08-19',
      periodEndDate: '2026-08-26',
    })
    
    const key = `${testIdentity.app_id}|${testIdentity.campaign_name}|${testIdentity.ad_group_name}|${testIdentity.keyword_text}`
    const bidData = result.get(key)
    
    console.log('Result:', JSON.stringify(bidData, null, 2))
    
    const testB = 
      bidData.currentBid === 10 &&
      bidData.previousBid === 7 &&
      bidData.bidChangedInSelectedPeriod === false
    
    if (testB) {
      console.log('✓ TEST B PASSED')
    } else {
      console.log('✗ TEST B FAILED')
      console.log('  Expected: currentBid=10, previousBid=7, bidChangedInSelectedPeriod=false')
      console.log(`  Got: currentBid=${bidData.currentBid}, previousBid=${bidData.previousBid}, bidChangedInSelectedPeriod=${bidData.bidChangedInSelectedPeriod}`)
      allPassed = false
    }
    
  } catch (err) {
    console.log('✗ TEST B FAILED:', err.message)
    allPassed = false
  }
  
  // ========== TEST C: Change inside 30D but outside 7D ==========
  console.log('\n' + '='.repeat(60))
  console.log('TEST C: Change inside 30D but outside 7D')
  console.log('='.repeat(60))
  
  try {
    // Use same data as Test B (change on 10 Aug)
    
    // Analyze with 7D window (starts 19 Aug)
    const result7D = await resolveKeywordBidsFromHistory({
      organisationId: testOrgId,
      keywordIdentities: [testIdentity],
      periodStartDate: '2026-08-19',
      periodEndDate: '2026-08-26',
    })
    
    // Analyze with 30D window (starts 27 Jul)
    const result30D = await resolveKeywordBidsFromHistory({
      organisationId: testOrgId,
      keywordIdentities: [testIdentity],
      periodStartDate: '2026-07-27',
      periodEndDate: '2026-08-26',
    })
    
    const key = `${testIdentity.app_id}|${testIdentity.campaign_name}|${testIdentity.ad_group_name}|${testIdentity.keyword_text}`
    const bidData7D = result7D.get(key)
    const bidData30D = result30D.get(key)
    
    console.log('7D Result:', JSON.stringify(bidData7D, null, 2))
    console.log('30D Result:', JSON.stringify(bidData30D, null, 2))
    
    const testC = 
      bidData7D.bidChangedInSelectedPeriod === false &&
      bidData30D.bidChangedInSelectedPeriod === true
    
    if (testC) {
      console.log('✓ TEST C PASSED')
    } else {
      console.log('✗ TEST C FAILED')
      console.log('  Expected: 7D=false, 30D=true')
      console.log(`  Got: 7D=${bidData7D.bidChangedInSelectedPeriod}, 30D=${bidData30D.bidChangedInSelectedPeriod}`)
      allPassed = false
    }
    
  } catch (err) {
    console.log('✗ TEST C FAILED:', err.message)
    allPassed = false
  }
  
  // ========== TEST D: Old report reimport ==========
  console.log('\n' + '='.repeat(60))
  console.log('TEST D: Old report reimport')
  console.log('='.repeat(60))
  
  try {
    // Clean slate
    await pool.query(
      `DELETE FROM keyword_bid_history 
       WHERE organisation_id = $1 AND app_id = $2`,
      [testOrgId, testIdentity.app_id]
    )
    
    // Import 20 Aug report on 20 Aug: £10
    await recordBidObservations({
      organisationId: testOrgId,
      importId: null,
      observedAt: new Date('2026-08-20T10:00:00Z'),
      reportSnapshotDate: '2026-08-20',
      keywordBids: [{
        ...testIdentity,
        bid_amount: 10.00,
        currency: 'GBP',
      }],
    })
    
    // Import 26 Aug report on 26 Aug: £30
    await recordBidObservations({
      organisationId: testOrgId,
      importId: null,
      observedAt: new Date('2026-08-26T10:00:00Z'),
      reportSnapshotDate: '2026-08-26',
      keywordBids: [{
        ...testIdentity,
        bid_amount: 30.00,
        currency: 'GBP',
      }],
    })
    
    // Reimport 20 Aug report on 30 Aug (but report snapshot is still 20 Aug): £10
    // This should NOT create a new observation because report_snapshot_date is older
    const beforeCount = await pool.query(
      `SELECT COUNT(*) as count FROM keyword_bid_history 
       WHERE organisation_id = $1 AND app_id = $2`,
      [testOrgId, testIdentity.app_id]
    )
    
    await recordBidObservations({
      organisationId: testOrgId,
      importId: null,
      observedAt: new Date('2026-08-30T10:00:00Z'),
      reportSnapshotDate: '2026-08-20',  // Old report date
      keywordBids: [{
        ...testIdentity,
        bid_amount: 10.00,
        currency: 'GBP',
      }],
    })
    
    const afterCount = await pool.query(
      `SELECT COUNT(*) as count FROM keyword_bid_history 
       WHERE organisation_id = $1 AND app_id = $2`,
      [testOrgId, testIdentity.app_id]
    )
    
    // Resolve current bid
    const result = await resolveKeywordBidsFromHistory({
      organisationId: testOrgId,
      keywordIdentities: [testIdentity],
    })
    
    const key = `${testIdentity.app_id}|${testIdentity.campaign_name}|${testIdentity.ad_group_name}|${testIdentity.keyword_text}`
    const bidData = result.get(key)
    
    console.log(`Observations before reimport: ${beforeCount.rows[0].count}`)
    console.log(`Observations after reimport: ${afterCount.rows[0].count}`)
    console.log('Current Bid Result:', JSON.stringify(bidData, null, 2))
    
    const testD = 
      bidData.currentBid === 30 &&
      bidData.previousBid === 10 &&
      beforeCount.rows[0].count === afterCount.rows[0].count  // No new observation added
    
    if (testD) {
      console.log('✓ TEST D PASSED - Old report reimport did not create false bid change')
    } else {
      console.log('✗ TEST D FAILED')
      console.log('  Expected: currentBid=30, previousBid=10, no new observation')
      console.log(`  Got: currentBid=${bidData.currentBid}, previousBid=${bidData.previousBid}, new observation=${afterCount.rows[0].count > beforeCount.rows[0].count}`)
      allPassed = false
    }
    
  } catch (err) {
    console.log('✗ TEST D FAILED:', err.message)
    allPassed = false
  }
  
  // ========== TEST E: Historical insertion ==========
  console.log('\n' + '='.repeat(60))
  console.log('TEST E: Historical insertion (graceful skip)')
  console.log('='.repeat(60))
  
  try {
    // Clean slate
    await pool.query(
      `DELETE FROM keyword_bid_history 
       WHERE organisation_id = $1 AND app_id = $2`,
      [testOrgId, testIdentity.app_id]
    )
    
    // Import 10 Aug report: £7
    await recordBidObservations({
      organisationId: testOrgId,
      importId: null,
      observedAt: new Date('2026-08-10T10:00:00Z'),
      reportSnapshotDate: '2026-08-10',
      keywordBids: [{
        ...testIdentity,
        bid_amount: 7.00,
        currency: 'GBP',
      }],
    })
    
    // Import 26 Aug report: £30
    await recordBidObservations({
      organisationId: testOrgId,
      importId: null,
      observedAt: new Date('2026-08-26T10:00:00Z'),
      reportSnapshotDate: '2026-08-26',
      keywordBids: [{
        ...testIdentity,
        bid_amount: 30.00,
        currency: 'GBP',
      }],
    })
    
    // Try to insert 20 Aug report with £10 (fills gap)
    // Current implementation: skips because it's older than latest (26 Aug)
    const beforeCount = await pool.query(
      `SELECT COUNT(*) as count FROM keyword_bid_history 
       WHERE organisation_id = $1 AND app_id = $2`,
      [testOrgId, testIdentity.app_id]
    )
    
    await recordBidObservations({
      organisationId: testOrgId,
      importId: null,
      observedAt: new Date('2026-08-27T10:00:00Z'),
      reportSnapshotDate: '2026-08-20',
      keywordBids: [{
        ...testIdentity,
        bid_amount: 10.00,
        currency: 'GBP',
      }],
    })
    
    const afterCount = await pool.query(
      `SELECT COUNT(*) as count FROM keyword_bid_history 
       WHERE organisation_id = $1 AND app_id = $2`,
      [testOrgId, testIdentity.app_id]
    )
    
    console.log(`Observations before: ${beforeCount.rows[0].count}`)
    console.log(`Observations after: ${afterCount.rows[0].count}`)
    
    // Current implementation: gracefully skips historical gaps
    const testE = beforeCount.rows[0].count === afterCount.rows[0].count
    
    if (testE) {
      console.log('✓ TEST E PASSED - Historical insertion gracefully skipped (as designed)')
      console.log('  Note: Safe historical insertion is not supported; import was skipped')
    } else {
      console.log('✗ TEST E FAILED')
      console.log('  Expected: historical insertion skipped')
      allPassed = false
    }
    
  } catch (err) {
    console.log('✗ TEST E FAILED:', err.message)
    allPassed = false
  }
  
  // ========== TEST F: Same bid reimport ==========
  console.log('\n' + '='.repeat(60))
  console.log('TEST F: Same bid reimport')
  console.log('='.repeat(60))
  
  try {
    // Clean slate
    await pool.query(
      `DELETE FROM keyword_bid_history 
       WHERE organisation_id = $1 AND app_id = $2`,
      [testOrgId, testIdentity.app_id]
    )
    
    // Import 20 Aug report: £10
    await recordBidObservations({
      organisationId: testOrgId,
      importId: null,
      observedAt: new Date('2026-08-20T10:00:00Z'),
      reportSnapshotDate: '2026-08-20',
      keywordBids: [{
        ...testIdentity,
        bid_amount: 10.00,
        currency: 'GBP',
      }],
    })
    
    const countAfterFirst = await pool.query(
      `SELECT COUNT(*) as count FROM keyword_bid_history 
       WHERE organisation_id = $1 AND app_id = $2`,
      [testOrgId, testIdentity.app_id]
    )
    
    // Reimport 20 Aug report again: £10 (same date, same bid)
    await recordBidObservations({
      organisationId: testOrgId,
      importId: null,
      observedAt: new Date('2026-08-21T10:00:00Z'),
      reportSnapshotDate: '2026-08-20',
      keywordBids: [{
        ...testIdentity,
        bid_amount: 10.00,
        currency: 'GBP',
      }],
    })
    
    const countAfterSecond = await pool.query(
      `SELECT COUNT(*) as count FROM keyword_bid_history 
       WHERE organisation_id = $1 AND app_id = $2`,
      [testOrgId, testIdentity.app_id]
    )
    
    console.log(`Observations after first import: ${countAfterFirst.rows[0].count}`)
    console.log(`Observations after reimport: ${countAfterSecond.rows[0].count}`)
    
    const testF = 
      parseInt(countAfterFirst.rows[0].count) === 1 &&
      parseInt(countAfterSecond.rows[0].count) === 1
    
    if (testF) {
      console.log('✓ TEST F PASSED - Same bid reimport created only one observation')
    } else {
      console.log('✗ TEST F FAILED')
      console.log(`  Expected: 1 observation after first, 1 after second`)
      console.log(`  Got: ${countAfterFirst.rows[0].count} after first, ${countAfterSecond.rows[0].count} after second`)
      allPassed = false
    }
    
  } catch (err) {
    console.log('✗ TEST F FAILED:', err.message)
    allPassed = false
  }
  
  // Cleanup
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
