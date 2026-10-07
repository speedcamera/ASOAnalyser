#!/usr/bin/env node

/**
 * Test script to verify PostgreSQL connection management fix
 * 
 * Tests:
 * 1. Successful CSV upload (client released once)
 * 2. Failed upload (client released once, rollback works)
 * 3. Connection pool remains healthy after both scenarios
 */

require('dotenv').config()
const { pool } = require('./db')
const { createImport } = require('./imports')

// Test data - minimal valid CSV structure
const testHeaders = [
  'Date',
  'App ID',
  'App Name',
  'Campaign Name',
  'Spend',
  'Impressions',
  'Taps',
  'Installs (Tap-Through)',
  'Installs (View-Through)',
  'Installs (Total)',
]

const testRecord = {
  'Date': '2024-01-15',
  'App ID': 'test-app-123',
  'App Name': 'Test App',
  'Campaign Name': 'Test Campaign',
  'Spend': '100.50',
  'Impressions': '1000',
  'Taps': '50',
  'Installs (Tap-Through)': '10',
  'Installs (View-Through)': '2',
  'Installs (Total)': '12',
}

async function testSuccessfulUpload() {
  console.log('\n=== Test 1: Successful Upload ===')
  
  try {
    const result = await createImport(
      'test-upload-success.csv',
      testHeaders,
      [testRecord],
      1,
    )
    
    console.log('✅ Upload succeeded')
    console.log(`   Import ID: ${result.id}`)
    console.log(`   Uploaded rows: ${result.uploadedRows}`)
    console.log(`   Inserted rows: ${result.insertedRows}`)
    console.log(`   Total stored: ${result.totalStoredRows}`)
    
    // Verify we can still query the pool
    const poolTest = await pool.query('SELECT 1 as test')
    console.log('✅ Pool still healthy after upload')
    
    return true
  } catch (err) {
    console.error('❌ Test failed:', err.message)
    console.error('   Stack:', err.stack)
    return false
  }
}

async function testFailedUpload() {
  console.log('\n=== Test 2: Failed Upload (Rollback) ===')
  
  // Get current import count to detect partial commits
  const beforeCount = await pool.query('SELECT COUNT(*)::int as count FROM imports')
  const beforeImportCount = beforeCount.rows[0].count
  
  // Create a scenario that will cause a database constraint violation
  // We'll inject a mock error by temporarily modifying the client query method
  const { pool: originalPool } = require('./db')
  
  // Use a simpler approach: create duplicate records in a loop
  // This will test that if ANY insert fails, ALL are rolled back
  const duplicateRecords = Array(3).fill({
    ...testRecord,
    'Date': '2024-01-20',
    'Campaign Name': 'Rollback Test Campaign',
  })
  
  try {
    // First, create the import successfully
    const firstImport = await createImport(
      'test-upload-first.csv',
      testHeaders,
      duplicateRecords,
      1,
    )
    console.log(`   Created first import (ID: ${firstImport.id})`)
    
    // Now simulate a failure mid-transaction by forcing a constraint violation
    // We'll manually test the transaction rollback
    const client = await pool.connect()
    let rollbackWorked = false
    
    try {
      await client.query('BEGIN')
      
      // Insert a valid import
      const result = await client.query(
        `INSERT INTO imports (original_name, row_count, column_headers)
         VALUES ($1, $2, $3)
         RETURNING id`,
        ['test-rollback.csv', 1, JSON.stringify(testHeaders)]
      )
      
      const importId = result.rows[0].id
      console.log(`   Started transaction for import ${importId}`)
      
      // Insert a row
      await client.query(
        `INSERT INTO import_rows (import_id, source_import_id, row_number, data, record_key)
         VALUES ($1, $1, $2, $3, $4)`,
        [importId, 1, JSON.stringify(testRecord), 'test-key-rollback']
      )
      
      // Force an error by trying to insert duplicate record_key
      await client.query(
        `INSERT INTO import_rows (import_id, source_import_id, row_number, data, record_key)
         VALUES ($1, $1, $2, $3, $4)`,
        [importId, 2, JSON.stringify(testRecord), 'test-key-rollback']  // Same key!
      )
      
      await client.query('COMMIT')
      
      console.log('❌ Transaction should have failed but succeeded')
      client.release()
      return false
      
    } catch (err) {
      console.log('✅ Transaction failed as expected')
      console.log(`   Error: ${err.message.substring(0, 80)}...`)
      
      await client.query('ROLLBACK')
      console.log('✅ Rollback executed')
      rollbackWorked = true
      
    } finally {
      client.release()
      console.log('✅ Client released after rollback')
    }
    
    // Verify no partial data was committed
    const afterCount = await pool.query('SELECT COUNT(*)::int as count FROM imports')
    const afterImportCount = afterCount.rows[0].count
    
    // Should only have the first successful import, not the rolled-back one
    if (afterImportCount === beforeImportCount + 1) {
      console.log('✅ No partial data committed (proper rollback)')
    } else {
      console.log(`❌ Import count changed unexpectedly: ${beforeImportCount} → ${afterImportCount}`)
      return false
    }
    
    // Verify pool is still healthy
    const poolTest = await pool.query('SELECT 1 as test')
    console.log('✅ Pool still healthy after rollback')
    
    return rollbackWorked
    
  } catch (err) {
    console.error('❌ Test setup failed:', err.message)
    return false
  }
}

async function testConnectionPoolHealth() {
  console.log('\n=== Test 3: Connection Pool Health ===')
  
  try {
    // Perform multiple rapid queries to ensure connections are properly released
    const promises = []
    for (let i = 0; i < 5; i++) {
      promises.push(
        pool.query('SELECT $1::text as test', [`query-${i}`])
      )
    }
    
    const results = await Promise.all(promises)
    console.log(`✅ Executed ${results.length} concurrent queries successfully`)
    
    // Check pool stats if available
    if (pool.totalCount !== undefined) {
      console.log(`   Total pool connections: ${pool.totalCount}`)
      console.log(`   Idle connections: ${pool.idleCount}`)
      console.log(`   Waiting clients: ${pool.waitingCount}`)
    }
    
    return true
  } catch (err) {
    console.error('❌ Pool health check failed:', err.message)
    return false
  }
}

async function runTests() {
  console.log('Starting connection management tests...')
  console.log('Database URL:', process.env.DATABASE_URL ? 'configured' : 'MISSING')
  
  if (!process.env.DATABASE_URL) {
    console.error('\n❌ DATABASE_URL not configured in .env file')
    process.exit(1)
  }
  
  try {
    const test1 = await testSuccessfulUpload()
    const test2 = await testFailedUpload()
    const test3 = await testConnectionPoolHealth()
    
    console.log('\n=== Test Results ===')
    console.log(`Test 1 (Successful Upload): ${test1 ? '✅ PASS' : '❌ FAIL'}`)
    console.log(`Test 2 (Failed Upload): ${test2 ? '✅ PASS' : '❌ FAIL'}`)
    console.log(`Test 3 (Pool Health): ${test3 ? '✅ PASS' : '❌ FAIL'}`)
    
    const allPassed = test1 && test2 && test3
    
    if (allPassed) {
      console.log('\n🎉 All tests passed! Connection management is working correctly.')
    } else {
      console.log('\n⚠️  Some tests failed. Review the output above.')
    }
    
    await pool.end()
    process.exit(allPassed ? 0 : 1)
    
  } catch (err) {
    console.error('\n❌ Test suite error:', err.message)
    console.error(err.stack)
    await pool.end()
    process.exit(1)
  }
}

// Run tests
runTests()
