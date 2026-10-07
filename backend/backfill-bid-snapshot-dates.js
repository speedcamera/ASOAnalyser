/**
 * Backfill report_snapshot_date for existing keyword_bid_history records
 * 
 * Calculates the max report date from each import's import_rows and updates
 * the corresponding bid history records.
 */

const { pool } = require('./db')

// Simple date parser for DD/MM/YYYY format
function parseDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null
  
  const trimmed = dateStr.trim()
  const parts = trimmed.split('/')
  
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10)
    const month = parseInt(parts[1], 10)
    const year = parseInt(parts[2], 10)
    
    if (day && month && year && day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return new Date(year, month - 1, day)
    }
  }
  
  return null
}

async function backfillBidSnapshotDates() {
  console.log('Backfilling report_snapshot_date for keyword_bid_history...\n')
  
  let updated = 0
  let skipped = 0
  
  // Get all distinct import_ids from keyword_bid_history
  const importsResult = await pool.query(
    `SELECT DISTINCT import_id 
     FROM keyword_bid_history 
     WHERE import_id IS NOT NULL 
       AND report_snapshot_date IS NULL
     ORDER BY import_id`
  )
  
  console.log(`Found ${importsResult.rows.length} imports to process\n`)
  
  for (const { import_id } of importsResult.rows) {
    try {
      // Get all import_rows for this import to find max date
      const rowsResult = await pool.query(
        `SELECT ir.data, i.column_headers
         FROM import_rows ir
         JOIN imports i ON i.id = ir.import_id
         WHERE ir.import_id = $1
         LIMIT 1`,
        [import_id]
      )
      
      if (rowsResult.rows.length === 0) {
        console.log(`Import ${import_id}: No rows found, skipping`)
        skipped++
        continue
      }
      
      const headers = rowsResult.rows[0].column_headers
      
      // Find date column
      const dateColumn = headers.find(h => 
        h.toLowerCase().trim() === 'date' || 
        h.toLowerCase().trim() === '﻿date'
      )
      
      if (!dateColumn) {
        console.log(`Import ${import_id}: No date column found, skipping`)
        skipped++
        continue
      }
      
      // Get max date from all rows
      const allRowsResult = await pool.query(
        `SELECT data
         FROM import_rows
         WHERE import_id = $1`,
        [import_id]
      )
      
      let maxDate = null
      for (const row of allRowsResult.rows) {
        const reportDate = parseDate(row.data[dateColumn])
        if (reportDate && (!maxDate || reportDate > maxDate)) {
          maxDate = reportDate
        }
      }
      
      if (!maxDate) {
        console.log(`Import ${import_id}: No valid dates found, skipping`)
        skipped++
        continue
      }
      
      // Update keyword_bid_history records for this import
      const updateResult = await pool.query(
        `UPDATE keyword_bid_history
         SET report_snapshot_date = $1
         WHERE import_id = $2
           AND report_snapshot_date IS NULL`,
        [maxDate, import_id]
      )
      
      console.log(`Import ${import_id}: Updated ${updateResult.rowCount} records with snapshot date ${maxDate.toISOString().split('T')[0]}`)
      updated += updateResult.rowCount
      
    } catch (err) {
      console.error(`Import ${import_id}: Error -`, err.message)
      skipped++
    }
  }
  
  console.log(`\n✓ Backfill complete`)
  console.log(`  Updated: ${updated}`)
  console.log(`  Skipped: ${skipped}`)
}

// Run backfill
backfillBidSnapshotDates()
  .then(() => {
    console.log('\n✓ Done')
    process.exit(0)
  })
  .catch(err => {
    console.error('\n✗ Fatal error:', err)
    process.exit(1)
  })
