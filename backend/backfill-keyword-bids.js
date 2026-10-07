/**
 * Backfill Keyword Max Bid for imports using the new Apple Search Ads column name
 * 
 * Apple Search Ads changed their CSV export around Aug 2026:
 * - Old: "Keyword Max CPT Bid"
 * - New: "Keyword Max Bid"
 * 
 * This script re-extracts bid data from import_rows and updates daily_keyword_metrics
 * for imports that have the new column name but null keyword_max_cpt_bid.
 */

const { pool } = require('./db')
const {
  findColumnByAliases,
  resolveAppIdentity,
} = require('./appIdentity')

const KEYWORD_MAX_CPT_BID_ALIASES = [
  'keyword max bid',
  'keyword max cpt bid',
  'max cpt bid',
  'max bid'
]

const DATE_ALIASES = ['date']
const CAMPAIGN_NAME_ALIASES = ['campaign name', 'campaign']
const AD_GROUP_ALIASES = ['ad group name', 'ad group']
const KEYWORD_ALIASES = ['keyword']
const BID_STRATEGY_ALIASES = ['bid strategy']

function isEmpty(value) {
  if (value === null || value === undefined) return true
  if (typeof value === 'string' && value.trim() === '') return true
  return false
}

function parseNumeric(value) {
  if (isEmpty(value)) return null
  if (typeof value === 'number' && !Number.isNaN(value)) return value

  let str = String(value).trim()
  if (str === '' || str === '-' || str === '—') return null

  str = str.replace(/[$£€¥₹,\s]/g, '').replace(/%$/, '')
  const num = Number.parseFloat(str)
  return Number.isNaN(num) ? null : num
}

function parseDate(value) {
  if (isEmpty(value)) return null

  const str = String(value).trim()

  let match = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) {
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  }

  match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (match) {
    const part1 = Number(match[1])
    const part2 = Number(match[2])
    const year = Number(match[3])

    if (part1 > 12) {
      return new Date(Date.UTC(year, part2 - 1, part1))
    }
    if (part2 > 12) {
      return new Date(Date.UTC(year, part1 - 1, part2))
    }

    return new Date(Date.UTC(year, part2 - 1, part1))
  }

  const date = new Date(str)
  return Number.isNaN(date.getTime()) ? null : date
}

function toDateKey(date) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function findAffectedImports() {
  const result = await pool.query(`
    SELECT id, original_name, column_headers, organisation_id, created_at
    FROM imports
    WHERE column_headers::text LIKE '%Keyword Max Bid%'
      AND column_headers::text NOT LIKE '%Keyword Max CPT Bid%'
    ORDER BY id
  `)
  return result.rows
}

async function getImportRows(importId) {
  const result = await pool.query(
    'SELECT id, data FROM import_rows WHERE import_id = $1',
    [importId]
  )
  return result.rows
}

function extractBidUpdates(importRows, columnHeaders) {
  const bidColumn = findColumnByAliases(columnHeaders, KEYWORD_MAX_CPT_BID_ALIASES)
  if (!bidColumn) {
    console.log('  ⚠️  No bid column found in headers')
    return []
  }

  console.log(`  ✓ Bid column detected: "${bidColumn}"`)

  const dateColumn = findColumnByAliases(columnHeaders, DATE_ALIASES)
  const campaignColumn = findColumnByAliases(columnHeaders, CAMPAIGN_NAME_ALIASES)
  const adGroupColumn = findColumnByAliases(columnHeaders, AD_GROUP_ALIASES)
  const keywordColumn = findColumnByAliases(columnHeaders, KEYWORD_ALIASES)
  const bidStrategyColumn = findColumnByAliases(columnHeaders, BID_STRATEGY_ALIASES)

  if (!dateColumn || !campaignColumn || !keywordColumn) {
    console.log('  ⚠️  Missing required columns (date/campaign/keyword)')
    return []
  }

  const updates = []

  for (const row of importRows) {
    const data = row.data
    
    const bidValue = parseNumeric(data[bidColumn])
    if (bidValue === null) continue

    const date = parseDate(data[dateColumn])
    if (!date) continue

    const app = resolveAppIdentity(data, columnHeaders)
    const campaignName = campaignColumn && data[campaignColumn] 
      ? String(data[campaignColumn]).trim() 
      : ''
    const adGroupName = adGroupColumn && data[adGroupColumn]
      ? String(data[adGroupColumn]).trim()
      : ''
    const keywordText = keywordColumn && data[keywordColumn]
      ? String(data[keywordColumn]).trim()
      : ''
    const bidStrategy = bidStrategyColumn && data[bidStrategyColumn]
      ? String(data[bidStrategyColumn]).trim()
      : ''

    if (!app.app_id || !campaignName || !keywordText) continue

    updates.push({
      app_id: app.app_id,
      campaign_name: campaignName,
      ad_group_name: adGroupName,
      keyword_text: keywordText,
      bid_strategy: bidStrategy,
      report_date: toDateKey(date),
      keyword_max_cpt_bid: bidValue,
    })
  }

  return updates
}

async function applyBidUpdates(updates, organisationId) {
  if (updates.length === 0) return 0

  let updateCount = 0

  for (const update of updates) {
    const result = await pool.query(
      `UPDATE daily_keyword_metrics
       SET keyword_max_cpt_bid = $1,
           updated_at = NOW()
       WHERE organisation_id = $2
         AND app_id = $3
         AND campaign_name = $4
         AND ad_group_name = $5
         AND keyword_text = $6
         AND bid_strategy = $7
         AND report_date = $8
         AND keyword_max_cpt_bid IS NULL`,
      [
        update.keyword_max_cpt_bid,
        organisationId,
        update.app_id,
        update.campaign_name,
        update.ad_group_name,
        update.keyword_text,
        update.bid_strategy,
        update.report_date,
      ]
    )

    if (result.rowCount > 0) {
      updateCount += result.rowCount
    }
  }

  return updateCount
}

async function backfillKeywordBids() {
  console.log('='.repeat(60))
  console.log('Keyword Max Bid Backfill Script')
  console.log('='.repeat(60))
  console.log()

  const affectedImports = await findAffectedImports()
  console.log(`Found ${affectedImports.length} imports with "Keyword Max Bid" column\n`)

  if (affectedImports.length === 0) {
    console.log('✓ No imports need backfill')
    return
  }

  let totalUpdates = 0

  for (const imp of affectedImports) {
    console.log(`Import ${imp.id}: ${imp.original_name} (${new Date(imp.created_at).toISOString().split('T')[0]})`)
    
    const importRows = await getImportRows(imp.id)
    console.log(`  Rows: ${importRows.rows}`)
    
    const columnHeaders = imp.column_headers
    const updates = extractBidUpdates(importRows, columnHeaders)
    
    console.log(`  Extracted ${updates.length} bid values`)
    
    const updateCount = await applyBidUpdates(updates, imp.organisation_id)
    console.log(`  ✓ Updated ${updateCount} daily_keyword_metrics rows`)
    
    totalUpdates += updateCount
    console.log()
  }

  console.log('='.repeat(60))
  console.log(`COMPLETE: ${totalUpdates} daily_keyword_metrics rows updated`)
  console.log('='.repeat(60))
}

async function verifyTestCase() {
  console.log('\n' + '='.repeat(60))
  console.log('VERIFICATION: delm8 route planner')
  console.log('='.repeat(60))
  
  const result = await pool.query(`
    SELECT report_date, keyword_max_cpt_bid, spend, installs
    FROM daily_keyword_metrics
    WHERE campaign_name = 'Delm8_route_planner_Discovery'
      AND keyword_text = 'delm8 route planner'
    ORDER BY report_date DESC
    LIMIT 20
  `)

  console.log('\nLatest daily_keyword_metrics:')
  console.log('Date       | Bid  | Spend | Installs')
  console.log('-'.repeat(45))
  
  for (const row of result.rows) {
    const bid = row.keyword_max_cpt_bid !== null ? `£${row.keyword_max_cpt_bid}` : 'NULL'
    console.log(
      `${row.report_date.toISOString().split('T')[0]} | ${bid.padEnd(4)} | £${parseFloat(row.spend).toFixed(2).padStart(5)} | ${row.installs}`
    )
  }

  const latestBid = result.rows[0]?.keyword_max_cpt_bid
  if (latestBid === 6 || latestBid === '6') {
    console.log('\n✓ PASS: Latest bid is £6.00')
  } else if (latestBid === null) {
    console.log('\n⚠️  WARNING: Latest bid is still NULL')
  } else {
    console.log(`\n⚠️  WARNING: Latest bid is £${latestBid} (expected £6.00)`)
  }
}

async function main() {
  try {
    await backfillKeywordBids()
    await verifyTestCase()
    
    console.log('\n✓ Backfill complete\n')
    process.exit(0)
  } catch (error) {
    console.error('\n✗ Error during backfill:', error)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}

module.exports = { backfillKeywordBids }
