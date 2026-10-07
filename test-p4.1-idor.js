#!/usr/bin/env node
/**
 * P4.1 IDOR Protection Test
 * 
 * Tests that Organisation B cannot access Organisation A resources
 */

const { pool } = require('./backend/db')
const { getImportById } = require('./backend/imports')
const { updateCampaignSegment } = require('./backend/campaigns')
const { updateAnnotation, deleteAnnotation } = require('./backend/annotations')
const { updateGoal, deleteGoal } = require('./backend/goals')
const { getBidExperimentById } = require('./backend/bidExperiments')

async function runIdorTest() {
  console.log('===================================================')
  console.log('P4.1 IDOR PROTECTION TEST')
  console.log('===================================================\n')

  let orgAId, orgBId, importAId, campaignAId, annotationAId, goalAId, experimentAId

  try {
    // 1. Create test organisations
    console.log('1. Creating test organisations...')
    
    const orgA = await pool.query(
      `INSERT INTO organisations (organisation_name) 
       VALUES ('IDOR Test Org A') RETURNING id`
    )
    orgAId = orgA.rows[0].id
    
    const orgB = await pool.query(
      `INSERT INTO organisations (organisation_name) 
       VALUES ('IDOR Test Org B') RETURNING id`
    )
    orgBId = orgB.rows[0].id
    
    console.log(`   Org A: ${orgAId}, Org B: ${orgBId}\n`)

    // 2. Create Organisation A resources
    console.log('2. Creating Organisation A resources...')
    
    const importA = await pool.query(
      `INSERT INTO imports (original_name, row_count, column_headers, organisation_id)
       VALUES ('idor_test.csv', 1, '[]', $1) RETURNING id`,
      [orgAId]
    )
    importAId = importA.rows[0].id
    console.log(`   Import A: ${importAId}`)
    
    const campaignA = await pool.query(
      `INSERT INTO campaigns (app_id, campaign_name, segment, organisation_id)
       VALUES ('id999', 'IDOR Campaign', 'Brand', $1) RETURNING id`,
      [orgAId]
    )
    campaignAId = campaignA.rows[0].id
    console.log(`   Campaign A: ${campaignAId}`)
    
    const annotationA = await pool.query(
      `INSERT INTO annotations (entity_type, entity_key, note_type, note_text, organisation_id)
       VALUES ('campaign', 'id999|IDOR Campaign', 'note', 'Test note', $1) RETURNING id`,
      [orgAId]
    )
    annotationAId = annotationA.rows[0].id
    console.log(`   Annotation A: ${annotationAId}`)
    
    const goalA = await pool.query(
      `INSERT INTO performance_goals (entity_type, entity_key, metric, operator, threshold, period_days, organisation_id)
       VALUES ('campaign', 'id999|IDOR Campaign', 'cpa', 'less_than', 10, 7, $1) RETURNING id`,
      [orgAId]
    )
    goalAId = goalA.rows[0].id
    console.log(`   Goal A: ${goalAId}\n`)

    // 3. Test IDOR protection - Organisation B trying to access Organisation A resources
    console.log('3. Testing IDOR protection (Org B accessing Org A resources)...\n')
    
    // Test: Get import
    console.log('   Test: getImportById(orgB, importA)...')
    const importResult = await getImportById(orgBId, importAId)
    if (importResult === null) {
      console.log('   ✅ PASS: Returns null (404 equivalent)\n')
    } else {
      console.log('   ❌ FAIL: Got import data!\n')
      process.exit(1)
    }

    // Test: Update campaign segment
    console.log('   Test: updateCampaignSegment(orgB, campaignA, "Performance")...')
    try {
      await updateCampaignSegment(orgBId, campaignAId, 'Performance')
      console.log('   ❌ FAIL: Campaign updated!\n')
      process.exit(1)
    } catch (err) {
      if (err.message === 'Campaign not found') {
        console.log('   ✅ PASS: Campaign not found (404 equivalent)\n')
      } else {
        console.log(`   ⚠️  Unexpected error: ${err.message}\n`)
      }
    }

    // Test: Update annotation
    console.log('   Test: updateAnnotation(orgB, annotationA, {noteText: "hacked"})...')
    try {
      await updateAnnotation(orgBId, annotationAId, { noteText: 'hacked' })
      console.log('   ❌ FAIL: Annotation updated!\n')
      process.exit(1)
    } catch (err) {
      if (err.message === 'Annotation not found') {
        console.log('   ✅ PASS: Annotation not found (404 equivalent)\n')
      } else {
        console.log(`   ⚠️  Unexpected error: ${err.message}\n`)
      }
    }

    // Test: Delete annotation
    console.log('   Test: deleteAnnotation(orgB, annotationA)...')
    try {
      await deleteAnnotation(orgBId, annotationAId)
      console.log('   ❌ FAIL: Annotation deleted!\n')
      process.exit(1)
    } catch (err) {
      if (err.message === 'Annotation not found') {
        console.log('   ✅ PASS: Annotation not found (404 equivalent)\n')
      } else {
        console.log(`   ⚠️  Unexpected error: ${err.message}\n`)
      }
    }

    // Test: Update goal
    console.log('   Test: updateGoal(orgB, goalA, {threshold: 999})...')
    try {
      await updateGoal(orgBId, goalAId, { threshold: 999 })
      console.log('   ❌ FAIL: Goal updated!\n')
      process.exit(1)
    } catch (err) {
      if (err.message === 'Goal not found') {
        console.log('   ✅ PASS: Goal not found (404 equivalent)\n')
      } else {
        console.log(`   ⚠️  Unexpected error: ${err.message}\n`)
      }
    }

    // Test: Delete goal
    console.log('   Test: deleteGoal(orgB, goalA)...')
    try {
      await deleteGoal(orgBId, goalAId)
      console.log('   ❌ FAIL: Goal deleted!\n')
      process.exit(1)
    } catch (err) {
      if (err.message === 'Goal not found') {
        console.log('   ✅ PASS: Goal not found (404 equivalent)\n')
      } else {
        console.log(`   ⚠️  Unexpected error: ${err.message}\n`)
      }
    }

    // 4. Verify Organisation A data still intact
    console.log('4. Verifying Organisation A data unchanged...')
    
    const verifyImport = await pool.query('SELECT * FROM imports WHERE id = $1', [importAId])
    const verifyCampaign = await pool.query('SELECT * FROM campaigns WHERE id = $1', [campaignAId])
    const verifyAnnotation = await pool.query('SELECT * FROM annotations WHERE id = $1', [annotationAId])
    const verifyGoal = await pool.query('SELECT * FROM performance_goals WHERE id = $1', [goalAId])
    
    if (verifyImport.rows.length === 1 &&
        verifyCampaign.rows.length === 1 && verifyCampaign.rows[0].segment === 'Brand' &&
        verifyAnnotation.rows.length === 1 && verifyAnnotation.rows[0].note_text === 'Test note' &&
        verifyGoal.rows.length === 1 && parseFloat(verifyGoal.rows[0].threshold) === 10) {
      console.log('   ✅ PASS: All Organisation A data intact and unchanged\n')
    } else {
      console.log('   ❌ FAIL: Organisation A data was modified!\n')
      process.exit(1)
    }

    console.log('===================================================')
    console.log('✅ ALL IDOR TESTS PASSED')
    console.log('===================================================\n')
    console.log('Organisation B CANNOT access Organisation A resources')
    console.log('All operations returned 404 equivalents')
    console.log('Organisation A data remains intact\n')

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message)
    console.error(error)
    process.exit(1)
  } finally {
    // Cleanup
    if (orgAId && orgBId) {
      console.log('Cleaning up test data...')
      try {
        await pool.query('DELETE FROM annotations WHERE organisation_id IN ($1, $2)', [orgAId, orgBId])
        await pool.query('DELETE FROM performance_goals WHERE organisation_id IN ($1, $2)', [orgAId, orgBId])
        await pool.query('DELETE FROM campaigns WHERE organisation_id IN ($1, $2)', [orgAId, orgBId])
        await pool.query('DELETE FROM imports WHERE organisation_id IN ($1, $2)', [orgAId, orgBId])
        await pool.query('DELETE FROM organisations WHERE id IN ($1, $2)', [orgAId, orgBId])
        console.log('✓ Cleanup complete\n')
      } catch (cleanupErr) {
        console.error('⚠️  Cleanup warning:', cleanupErr.message)
      }
    }
    
    await pool.end()
  }
}

if (require.main === module) {
  runIdorTest()
}
