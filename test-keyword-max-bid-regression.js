/**
 * Regression Tests for Keyword Max Bid Column Compatibility
 * 
 * Tests CSV imports with different column name variations:
 * A. "Keyword Max CPT Bid" only (legacy format)
 * B. "Keyword Max Bid" only (current format)
 * C. Neither column (should handle gracefully)
 */

const {
  findColumnByAliases,
} = require('./backend/appIdentity')

const KEYWORD_MAX_CPT_BID_ALIASES = [
  'keyword max bid',
  'keyword max cpt bid',
  'max cpt bid',
  'max bid'
]

function testColumnDetection(headers, expectedColumn) {
  const detectedColumn = findColumnByAliases(headers, KEYWORD_MAX_CPT_BID_ALIASES)
  const pass = detectedColumn === expectedColumn
  
  console.log(`  Headers: ${JSON.stringify(headers)}`)
  console.log(`  Expected: ${expectedColumn || 'null'}`)
  console.log(`  Detected: ${detectedColumn || 'null'}`)
  console.log(`  Result: ${pass ? '✓ PASS' : '✗ FAIL'}`)
  
  return pass
}

function runTests() {
  console.log('='.repeat(60))
  console.log('Keyword Max Bid Column Detection Regression Tests')
  console.log('='.repeat(60))
  console.log()

  let passCount = 0
  let totalTests = 0

  // Test A: Legacy "Keyword Max CPT Bid"
  console.log('Test A: Legacy "Keyword Max CPT Bid" column')
  totalTests++
  if (testColumnDetection(
    ['Date', 'Campaign Name', 'Keyword', 'Keyword Max CPT Bid', 'Spend'],
    'Keyword Max CPT Bid'
  )) passCount++
  console.log()

  // Test B: Current "Keyword Max Bid"
  console.log('Test B: Current "Keyword Max Bid" column')
  totalTests++
  if (testColumnDetection(
    ['Date', 'Campaign Name', 'Keyword', 'Keyword Max Bid', 'Spend'],
    'Keyword Max Bid'
  )) passCount++
  console.log()

  // Test C: Neither column
  console.log('Test C: Neither column present')
  totalTests++
  if (testColumnDetection(
    ['Date', 'Campaign Name', 'Keyword', 'Spend', 'Impressions'],
    null
  )) passCount++
  console.log()

  // Test D: Case insensitive matching
  console.log('Test D: Case variations')
  totalTests++
  if (testColumnDetection(
    ['Date', 'KEYWORD MAX BID', 'Spend'],
    'KEYWORD MAX BID'
  )) passCount++
  console.log()

  // Test E: With extra spaces
  console.log('Test E: Extra whitespace')
  totalTests++
  if (testColumnDetection(
    ['Date', 'Keyword  Max  Bid', 'Spend'],
    'Keyword  Max  Bid'
  )) passCount++
  console.log()

  // Test F: Fallback "Max Bid"
  console.log('Test F: Fallback "Max Bid"')
  totalTests++
  if (testColumnDetection(
    ['Date', 'Keyword', 'Max Bid', 'Spend'],
    'Max Bid'
  )) passCount++
  console.log()

  // Test G: Precedence - new format preferred
  console.log('Test G: Both formats (new should be preferred)')
  totalTests++
  const bothHeaders = ['Date', 'Keyword Max Bid', 'Keyword Max CPT Bid', 'Spend']
  const detected = findColumnByAliases(bothHeaders, KEYWORD_MAX_CPT_BID_ALIASES)
  const preferredNew = detected === 'Keyword Max Bid'
  console.log(`  Headers: ${JSON.stringify(bothHeaders)}`)
  console.log(`  Detected: ${detected}`)
  console.log(`  Preferred new format: ${preferredNew ? 'Yes' : 'No'}`)
  console.log(`  Result: ${preferredNew ? '✓ PASS' : '✗ FAIL'}`)
  if (preferredNew) passCount++
  console.log()

  console.log('='.repeat(60))
  console.log(`Results: ${passCount}/${totalTests} tests passed`)
  console.log('='.repeat(60))

  return passCount === totalTests
}

if (require.main === module) {
  const allPassed = runTests()
  process.exit(allPassed ? 0 : 1)
}

module.exports = { runTests }
