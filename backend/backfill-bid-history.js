/**
 * Backfill keyword bid history from existing imports
 * 
 * Each import's Keyword Max Bid represents a genuine observation at the time the import was created.
 * This script extracts those observations from import_rows and seeds keyword_bid_history.
 */

const { pool } = require('./db')
const { recordBidObservations } = require('./keywordBidHistory')
const { findColumnByAliases, resolveAppIdentity } = require('./appIdentity')

const KEYWORD_MAX_CPT_BID_ALIASES = [
  'keyword max bid',
  'keyword max cpt bid',
  'max cpt bid',
  'max bid'
]
const CAMPAIGN_NAME_ALIASES = ['campaign name', 'campaign']
const AD_GROUP_ALIASES = ['ad group name', 'ad group']
const KEYWORD_ALIASES = ['keyword']

async function backfillBidHistory() {
  console.log('='.repeat(60))
  console.log('Backfilling Keyword Bid History from Existing Imports')
  console.log('='.repeat(60))
  console.log()

  // Get all imports that have keyword data
  const imports = await pool.query(`
    SELECT id, original_name, created_at, column_headers, organisation_id
    FROM imports
    WHERE column_headers::text LIKE '%Keyword%'
    ORDER BY created_at ASC
  `)

  console.log(`Found ${imports.rows.length} imports with keyword data\n`)

  let totalRecorded = 0
  let totalSkipped = 0

  for (const imp of imports.rows) {
    console.log(`Import ${imp.id}: ${imp.original_name} (${new Date(imp.created_at).toISOString().split('T')[0]})`)

    const headers = imp.column_headers
    const bidColumn = findColumnByAliases(headers, KEYWORD_MAX_CPT_BID_ALIASES)
    const campaignColumn = findColumnByAliases(headers, CAMPAIGN_NAME_ALIASES)
    const adGroupColumn = findColumnByAliases(headers, AD_GROUP_ALIASES)
    const keywordColumn = findColumnByAliases(headers, KEYWORD_ALIASES)

    if (!bidColumn || !campaignColumn || !keywordColumn) {
      console.log('  ⊘ Skipped (missing required columns)\n')
      continue
    }

    // Get rows for this import
    const rows = await pool.query(
      'SELECT data FROM import_rows WHERE import_id = $1',
      [imp.id]
    )

    if (rows.rows.length === 0) {
      console.log('  ⊘ Skipped (no rows)\n')
      continue
    }

    const keywordBids = []

    for (const row of rows.rows) {
      const data = row.data
      const app = resolveAppIdentity(data, headers)
      const campaignName = campaignColumn && data[campaignColumn] 
        ? String(data[campaignColumn]).trim() 
        : ''
      const adGroupName = adGroupColumn && data[adGroupColumn]
        ? String(data[adGroupColumn]).trim()
        : ''
      const keywordText = keywordColumn && data[keywordColumn]
        ? String(data[keywordColumn]).trim()
        : ''
      const bidValue = data[bidColumn]

      if (app.app_id && campaignName && keywordText && bidValue) {
        // Parse bid value
        let bidAmount = null
        if (typeof bidValue === 'number') {
          bidAmount = bidValue
        } else if (typeof bidValue === 'string') {
          const cleanBid = bidValue.replace(/[$£€¥₹,\s]/g, '')
          bidAmount = parseFloat(cleanBid)
        }

        if (bidAmount && !isNaN(bidAmount) && bidAmount > 0) {
          keywordBids.push({
            app_id: app.app_id,
            campaign_name: campaignName,
            ad_group_name: adGroupName,
            keyword_text: keywordText,
            bid_amount: bidAmount,
            currency: 'GBP',
          })
        }
      }
    }

    if (keywordBids.length > 0) {
      const result = await recordBidObservations({
        organisationId: imp.organisation_id,
        importId: imp.id,
        observedAt: imp.created_at,
        keywordBids,
      })

      console.log(`  ✓ Recorded: ${result.recorded}, Skipped: ${result.skipped}`)
      totalRecorded += result.recorded
      totalSkipped += result.skipped
    } else {
      console.log('  ⊘ Skipped (no valid bids)')
    }
    console.log()
  }

  console.log('='.repeat(60))
  console.log(`COMPLETE: ${totalRecorded} bid observations recorded, ${totalSkipped} skipped`)
  console.log('='.repeat(60))
}

async function main() {
  try {
    await backfillBidHistory()
    process.exit(0)
  } catch (error) {
    console.error('\n✗ Error during backfill:', error)
    console.error(error.stack)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}

module.exports = { backfillBidHistory }
