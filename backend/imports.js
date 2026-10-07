const { parse } = require('csv-parse/sync')
const { pool } = require('./db')
const { httpError } = require('./http/clientError')
const { csvUploadLimits } = require('./http/csvLimits')
const {
  findColumnByAliases,
  normalizeKeyPart,
  resolveAppIdentity,
  collectAppsFromRows,
} = require('./appIdentity')

const RECORD_KEY_FIELDS = [
  { type: 'app', aliases: [] },
  { aliases: ['date'] },
  { aliases: ['campaign name', 'campaign'] },
  { aliases: ['ad group name', 'ad group'] },
  { aliases: ['keyword'] },
  { aliases: ['bid strategy'] },
]

const METRIC_ALIASES = {
  spend: ['spend', 'local spend amount', 'amount spent'],
  impressions: ['impressions'],
  taps: ['taps'],
  installs: ['installs (total)', 'installs', 'total installs'],
  avg_cpt: ['avg cpt', 'average cpt', 'avg. cpt'],
  avg_cpa: ['avg cpa (total)', 'avg cpa', 'average cpa', 'avg. cpa'],
  conversion_rate: ['cr (total)', 'conversion rate', 'cr', 'install rate'],
  ttr: ['ttr', 'tap-through rate', 'tap through rate'],
  new_downloads: ['new downloads'],
  redownloads: ['redownloads'],
}

const CAMPAIGN_NAME_ALIASES = ['campaign name', 'campaign']
const AD_GROUP_ALIASES = ['ad group name', 'ad group']
const KEYWORD_ALIASES = ['keyword']
const KEYWORD_MAX_CPT_BID_ALIASES = [
  'keyword max bid',        // Current Apple Search Ads format (Aug 2026+)
  'keyword max cpt bid',    // Legacy Apple Search Ads format
  'max cpt bid',            // Fallback
  'max bid'                 // Fallback
]

function findMetricColumn(headers, aliases) {
  return findColumnByAliases(headers, aliases)
}

function generateRecordKey(record, headers) {
  const app = resolveAppIdentity(record, headers)
  const parts = [app.app_key]

  for (const field of RECORD_KEY_FIELDS.slice(1)) {
    const column = findColumnByAliases(headers, field.aliases)
    parts.push(column ? normalizeKeyPart(record[column]) : '')
  }

  return parts.join('|')
}

const BINARY_SIGNATURES = [
  Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  Buffer.from('%PDF'),
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('GIF8'),
  Buffer.from([0x1f, 0x8b]),
  Buffer.from([0xff, 0xd8, 0xff]),
]

function assertCsvContent(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw httpError(400, 'CSV does not match a supported Apple Ads report')
  }

  let offset = 0
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    offset = 3
  }

  const sample = buffer.subarray(offset, Math.min(buffer.length, offset + 512))
  if (sample.includes(0)) {
    throw httpError(400, 'Only CSV files are allowed')
  }
  for (const signature of BINARY_SIGNATURES) {
    if (sample.subarray(0, signature.length).equals(signature)) {
      throw httpError(400, 'Only CSV files are allowed')
    }
  }

  const first = sample.toString('utf8').trimStart().slice(0, 1)
  if (first === '<' || first === '{' || first === '[') {
    throw httpError(400, 'Only CSV files are allowed')
  }
}

function assertSupportedAppleAdsReport(headers) {
  const dateColumn = findColumnByAliases(headers, ['date'])
  const campaignColumn = findColumnByAliases(headers, ['campaign name', 'campaign'])
  if (!dateColumn || !campaignColumn) {
    throw httpError(400, 'CSV is missing required Apple Ads columns')
  }
}

function parseCsv(buffer, options = {}) {
  assertCsvContent(buffer)
  const maxRows = options.maxRows ?? csvUploadLimits().maxRows
  let records
  try {
    records = parse(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      to: maxRows + 1,
    })
  } catch (err) {
    if (err && (err.name === 'CsvError' || (typeof err.code === 'string' && err.code.startsWith('CSV_')))) {
      throw err
    }
    throw httpError(400, 'The CSV file could not be parsed')
  }

  if (records.length > maxRows) {
    const err = httpError(413, 'CSV contains more rows than the maximum allowed')
    err.code = 'ROW_LIMIT'
    throw err
  }

  const headers = records.length > 0 ? Object.keys(records[0]) : []
  assertSupportedAppleAdsReport(headers)
  return { records, headers }
}

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

function sumColumn(rows, columnName) {
  let sum = 0
  let hasValue = false

  for (const row of rows) {
    const num = parseNumeric(row.data[columnName])
    if (num !== null) {
      sum += num
      hasValue = true
    }
  }

  return hasValue ? sum : null
}

function maxColumn(rows, columnName) {
  let max = null

  for (const row of rows) {
    const num = parseNumeric(row.data[columnName])
    if (num !== null && (max === null || num > max)) {
      max = num
    }
  }

  return max
}

function detectMetricColumns(headers) {
  const detectedMetricColumns = {}
  const unavailableMetricColumns = []

  for (const [metricKey, aliases] of Object.entries(METRIC_ALIASES)) {
    const column = findMetricColumn(headers, aliases)
    if (column) {
      detectedMetricColumns[metricKey] = column
    } else {
      unavailableMetricColumns.push(metricKey)
    }
  }

  return { detectedMetricColumns, unavailableMetricColumns }
}

function computeGroupMetrics(rows, detectedMetricColumns) {
  const totalSpend = detectedMetricColumns.spend
    ? sumColumn(rows, detectedMetricColumns.spend)
    : null
  const totalImpressions = detectedMetricColumns.impressions
    ? sumColumn(rows, detectedMetricColumns.impressions)
    : null
  const totalTaps = detectedMetricColumns.taps
    ? sumColumn(rows, detectedMetricColumns.taps)
    : null

  let totalInstalls = null
  if (detectedMetricColumns.installs) {
    totalInstalls = sumColumn(rows, detectedMetricColumns.installs)
  } else if (detectedMetricColumns.new_downloads || detectedMetricColumns.redownloads) {
    const newDownloads = detectedMetricColumns.new_downloads
      ? sumColumn(rows, detectedMetricColumns.new_downloads) ?? 0
      : 0
    const redownloads = detectedMetricColumns.redownloads
      ? sumColumn(rows, detectedMetricColumns.redownloads) ?? 0
      : 0
    if (detectedMetricColumns.new_downloads || detectedMetricColumns.redownloads) {
      totalInstalls = newDownloads + redownloads
    }
  }

  const averageCpt =
    totalSpend !== null && totalTaps !== null && totalTaps > 0
      ? totalSpend / totalTaps
      : null

  const averageCpa =
    totalSpend !== null && totalInstalls !== null && totalInstalls > 0
      ? totalSpend / totalInstalls
      : null

  const tapThroughRate =
    totalTaps !== null && totalImpressions !== null && totalImpressions > 0
      ? (totalTaps / totalImpressions) * 100
      : null

  const conversionRate =
    totalInstalls !== null && totalTaps !== null && totalTaps > 0
      ? (totalInstalls / totalTaps) * 100
      : null

  return {
    total_spend: totalSpend,
    total_impressions: totalImpressions,
    total_taps: totalTaps,
    total_installs: totalInstalls,
    average_cpt: averageCpt,
    average_cpa: averageCpa,
    tap_through_rate: tapThroughRate,
    conversion_rate: conversionRate,
  }
}

function requireOrganisationId(organisationId) {
  const id = typeof organisationId === 'number' ? organisationId : Number(organisationId)
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('organisationId is required')
  }
  return id
}

async function backfillRecordKeys() {
  const organisationColumn = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'import_rows'
       AND column_name = 'organisation_id'`,
  )
  const tenantScoped = organisationColumn.rows.length > 0

  const allRows = await pool.query(
    tenantScoped
      ? `SELECT ir.id, ir.data, i.column_headers
         FROM import_rows ir
         JOIN imports i ON i.id = ir.import_id
         WHERE ir.record_key IS NULL`
      : `SELECT ir.id, ir.data, i.column_headers
         FROM import_rows ir
         JOIN imports i ON i.id = ir.import_id`,
  )

  for (const row of allRows.rows) {
    const headers = Array.isArray(row.column_headers) ? row.column_headers : []
    const recordKey = generateRecordKey(row.data, headers)
    await pool.query('UPDATE import_rows SET record_key = $1 WHERE id = $2', [
      recordKey,
      row.id,
    ])
  }

  if (tenantScoped) {
    await pool.query(`
      DELETE FROM import_rows a
      USING import_rows b
      WHERE a.organisation_id = b.organisation_id
        AND a.record_key IS NOT NULL
        AND a.record_key = b.record_key
        AND a.id < b.id
    `)
  } else {
    await pool.query(`
      DELETE FROM import_rows a
      USING import_rows b
      WHERE a.record_key IS NOT NULL
        AND a.record_key = b.record_key
        AND a.id < b.id
    `)
  }

  await pool.query(`
    UPDATE import_rows
    SET source_import_id = import_id
    WHERE source_import_id IS NULL
  `)

  await pool.query('DROP INDEX IF EXISTS idx_import_rows_record_key')
  if (tenantScoped) {
    await pool.query(`
      CREATE UNIQUE INDEX idx_import_rows_record_key
      ON import_rows (organisation_id, record_key)
    `)
  } else {
    await pool.query(`
      CREATE UNIQUE INDEX idx_import_rows_record_key
      ON import_rows (record_key)
    `)
  }
}

async function createImport(originalName, headers, records, organisationId) {
  const tenantId = requireOrganisationId(organisationId)
  const client = await pool.connect()
  const uploadedRows = records.length

  try {
    await client.query('BEGIN')

    const importResult = await client.query(
      `INSERT INTO imports (original_name, row_count, column_headers, organisation_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [originalName, uploadedRows, JSON.stringify(headers), tenantId],
    )

    const importId = importResult.rows[0].id
    let insertedRows = 0
    let updatedRows = 0

    for (let i = 0; i < records.length; i++) {
      const recordKey = generateRecordKey(records[i], headers)
      const upsertResult = await client.query(
        `INSERT INTO import_rows (
           import_id, source_import_id, row_number, data, record_key, updated_at, organisation_id
         )
         VALUES ($1, $1, $2, $3, $4, NOW(), $5)
         ON CONFLICT (organisation_id, record_key) DO UPDATE SET
           data = EXCLUDED.data,
           import_id = EXCLUDED.import_id,
           source_import_id = EXCLUDED.source_import_id,
           row_number = EXCLUDED.row_number,
           updated_at = NOW(),
           organisation_id = EXCLUDED.organisation_id
         RETURNING (xmax = 0) AS inserted`,
        [importId, i + 1, JSON.stringify(records[i]), recordKey, tenantId],
      )

      if (upsertResult.rows[0].inserted) {
        insertedRows++
      } else {
        updatedRows++
      }
    }

  const totalResult = await client.query(
    'SELECT COUNT(*)::int AS total FROM import_rows WHERE organisation_id = $1',
    [tenantId],
  )

  // Daily budget history is reconstructed from daily_campaign_metrics by report
  // date. This upsert is the history write: the same campaign-day replaces its
  // budget, and an older report cannot reverse a later report date.
  await upsertDailyMetricsForImport(importId, client, tenantId)

  const importTimestamp = await client.query(
    'SELECT created_at FROM imports WHERE id = $1 AND organisation_id = $2',
    [importId, tenantId],
  )
  const observedAt = importTimestamp.rows[0]?.created_at || new Date()

  await client.query('COMMIT')

  // Record bid observations outside the import transaction
  try {
    const { recordBidObservations } = require('./keywordBidHistory')
    const { findColumnByAliases } = require('./appIdentity')
    const { resolveAppIdentity } = require('./appIdentity')
    const { parseDate } = require('./dailyMetrics')
    
    // Extract bid observations from import rows
    const importData = await pool.query(
      `SELECT ir.data, i.column_headers, i.organisation_id
       FROM import_rows ir
       JOIN imports i ON i.id = ir.import_id
       WHERE ir.import_id = $1
         AND ir.organisation_id = $2
         AND i.organisation_id = $2`,
      [importId, tenantId],
    )
    
    if (importData.rows.length > 0) {
      const headers = importData.rows[0].column_headers
      const importOrganisationId = tenantId
      
      const KEYWORD_MAX_CPT_BID_ALIASES = [
        'keyword max bid',
        'keyword max cpt bid',
        'max cpt bid',
        'max bid'
      ]
      const CAMPAIGN_NAME_ALIASES = ['campaign name', 'campaign']
      const AD_GROUP_ALIASES = ['ad group name', 'ad group']
      const KEYWORD_ALIASES = ['keyword']
      const DATE_ALIASES = ['date']
      
      const bidColumn = findColumnByAliases(headers, KEYWORD_MAX_CPT_BID_ALIASES)
      const campaignColumn = findColumnByAliases(headers, CAMPAIGN_NAME_ALIASES)
      const adGroupColumn = findColumnByAliases(headers, AD_GROUP_ALIASES)
      const keywordColumn = findColumnByAliases(headers, KEYWORD_ALIASES)
      const dateColumn = findColumnByAliases(headers, DATE_ALIASES)
      
      // Calculate report snapshot date (max report date from CSV)
      let reportSnapshotDate = null
      if (dateColumn) {
        for (const row of importData.rows) {
          const reportDate = parseDate(row.data[dateColumn])
          if (reportDate && (!reportSnapshotDate || reportDate > reportSnapshotDate)) {
            reportSnapshotDate = reportDate
          }
        }
      }
      
      if (bidColumn && campaignColumn && keywordColumn) {
        const keywordBids = []
        
        for (const row of importData.rows) {
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
        
        const bidResult = await recordBidObservations({
          organisationId: importOrganisationId,
          importId,
          observedAt,
          reportSnapshotDate,
          keywordBids,
        })
        
        console.log(
          `Bid observations for import ${importId}: recorded=${bidResult.recorded}, skipped=${bidResult.skipped}`,
        )
      }
    }
  } catch (err) {
    console.error(`Bid observation recording error for import ${importId}:`, err.message)
  }

  // Detect bid experiments outside the import transaction (idempotent, scoped).
  // P4.1: Pass organisationId to ensure tenant-scoped detection
  try {
    const { detectBidExperimentsForKeywordRecords } = require('./bidExperiments')
    // Re-read keyword records for this import to avoid holding them through the txn.
    const {
      buildDailyKeywordRecords,
    } = require('./dailyMetrics')
    const importData = await pool.query(
      `SELECT ir.data, i.column_headers, i.organisation_id
       FROM import_rows ir
       JOIN imports i ON i.id = ir.import_id
       WHERE ir.import_id = $1
         AND ir.organisation_id = $2
         AND i.organisation_id = $2`,
      [importId, tenantId],
    )
    const headers =
      importData.rows.length > 0 && Array.isArray(importData.rows[0].column_headers)
        ? importData.rows[0].column_headers
        : []
    const importOrganisationId = tenantId
    
    if (headers.length && importOrganisationId) {
      const keywordRecords = buildDailyKeywordRecords(importData.rows, headers)
      const detection = await detectBidExperimentsForKeywordRecords(importOrganisationId, keywordRecords)
      console.log(
        `Bid experiments for import ${importId}: created=${detection.created}, existing=${detection.skipped}, identities=${detection.scannedIdentities}`,
      )
    }
  } catch (err) {
    console.error(`Bid experiment detection error for import ${importId}:`, err.message)
  }

  return {
    id: importId,
    row_count: uploadedRows,
    uploadedRows,
    insertedRows,
    updatedRows,
    totalStoredRows: totalResult.rows[0].total,
  }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * List all imports
 * 
 * P4: organisationId is now required for tenant isolation
 */
async function listImports(organisationId) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const result = await pool.query(
    `SELECT id, original_name, status, row_count, column_headers, created_at
     FROM imports
     WHERE organisation_id = $1
     ORDER BY created_at DESC`,
    [organisationId]
  )
  return result.rows
}

/**
 * Get import by ID
 * 
 * P4: organisationId is now required for IDOR protection
 */
async function getImportById(organisationId, importId) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const result = await pool.query(
    `SELECT id, original_name, status, row_count, column_headers, created_at
     FROM imports
     WHERE id = $1 AND organisation_id = $2`,
    [importId, organisationId],
  )
  return result.rows[0] ?? null
}

/**
 * Get import rows
 * 
 * P4: organisationId is now required for IDOR protection
 */
async function getImportRows(organisationId, importId, limit = 100, offset = 0) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  // Verify import belongs to organisation
  const importRecord = await getImportById(organisationId, importId)
  if (!importRecord) {
    return null
  }

  const headers = Array.isArray(importRecord.column_headers)
    ? importRecord.column_headers
    : []

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM import_rows
     WHERE import_id = $1 AND organisation_id = $2`,
    [importId, organisationId],
  )

  const rowsResult = await pool.query(
    `SELECT row_number, data
     FROM import_rows
     WHERE import_id = $1 AND organisation_id = $2
     ORDER BY row_number
     LIMIT $3 OFFSET $4`,
    [importId, organisationId, limit, offset],
  )

  const rows = rowsResult.rows.map((row) => {
    const app = resolveAppIdentity(row.data, headers)
    return {
      row_number: row.row_number,
      data: row.data,
      app_key: app.app_key,
      app_id: app.app_id,
      app_name: app.app_name,
    }
  })

  return {
    rows,
    total: countResult.rows[0].total,
    limit,
    offset,
  }
}

/**
 * Get import rows data
 * 
 * P4: organisationId is now required for IDOR protection
 */
async function getImportRowsData(organisationId, importId) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const importRecord = await getImportById(organisationId, importId)
  if (!importRecord) return null

  const headers = Array.isArray(importRecord.column_headers)
    ? importRecord.column_headers
    : []

  const rowsResult = await pool.query(
    `SELECT data
     FROM import_rows
     WHERE import_id = $1 AND organisation_id = $2
     ORDER BY row_number`,
    [importId, organisationId],
  )

  return { importRecord, headers, rows: rowsResult.rows }
}

/**
 * Get import profile
 * 
 * P4: organisationId is now required for IDOR protection
 */
async function getImportProfile(organisationId, importId) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const importRecord = await getImportById(organisationId, importId)
  if (!importRecord) return null

  const headers = Array.isArray(importRecord.column_headers)
    ? importRecord.column_headers
    : []

  const rowsResult = await pool.query(
    `SELECT data
     FROM import_rows
     WHERE import_id = $1 AND organisation_id = $2
     ORDER BY row_number`,
    [importId, organisationId],
  )

  const totalRows = rowsResult.rows.length

  const columns = headers.map((columnName) => {
    const values = rowsResult.rows.map((row) => row.data[columnName])
    let nonEmpty = 0
    let empty = 0
    const uniqueValues = new Set()
    const sampleValues = []

    for (const value of values) {
      if (isEmpty(value)) {
        empty++
        uniqueValues.add('')
      } else {
        nonEmpty++
        const key = String(value)
        uniqueValues.add(key)
        if (sampleValues.length < 5 && !sampleValues.includes(value)) {
          sampleValues.push(value)
        }
      }
    }

    return {
      column_name: columnName,
      total_rows: totalRows,
      non_empty: nonEmpty,
      empty,
      unique_count: uniqueValues.size,
      sample_values: sampleValues,
    }
  })

  return { import_id: importId, columns }
}

/**
 * Get import metrics summary
 * 
 * P4: organisationId is now required for IDOR protection
 */
async function getImportMetricsSummary(organisationId, importId) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const data = await getImportRowsData(organisationId, importId)
  if (!data) return null

  const { headers, rows } = data
  const { detectedMetricColumns, unavailableMetricColumns } = detectMetricColumns(headers)

  return {
    import_id: importId,
    metrics: computeGroupMetrics(rows, detectedMetricColumns),
    detected_metric_columns: detectedMetricColumns,
    unavailable_metric_columns: unavailableMetricColumns,
    apps: collectAppsFromRows(rows, headers),
  }
}

function buildCampaignGroups(rows, headers) {
  const campaignColumn = findMetricColumn(headers, CAMPAIGN_NAME_ALIASES)
  if (!campaignColumn) return null

  const groups = new Map()

  for (const row of rows) {
    const app = resolveAppIdentity(row.data, headers)
    const rawName = row.data[campaignColumn]
    const campaignName = isEmpty(rawName) ? '(No campaign name)' : String(rawName).trim()
    const groupKey = `${app.app_key}|${campaignName}`

    if (!groups.has(groupKey)) {
      groups.set(groupKey, { app, campaignName, rows: [] })
    }
    groups.get(groupKey).rows.push(row)
  }

  return { campaignColumn, groups }
}

/**
 * Get import campaign summary
 * 
 * P4: organisationId is now required for IDOR protection
 */
async function getImportCampaignSummary(organisationId, importId) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const data = await getImportRowsData(organisationId, importId)
  if (!data) return null

  const { headers, rows } = data
  const { detectedMetricColumns, unavailableMetricColumns } = detectMetricColumns(headers)
  const grouped = buildCampaignGroups(rows, headers)

  if (!grouped) {
    return {
      import_id: importId,
      campaign_column: null,
      campaigns: [],
      detected_metric_columns: detectedMetricColumns,
      unavailable_metric_columns: [...unavailableMetricColumns, 'campaign_name'],
      apps: collectAppsFromRows(rows, headers),
    }
  }

  const campaigns = []

  for (const [, group] of grouped.groups) {
    campaigns.push({
      app_key: group.app.app_key,
      app_id: group.app.app_id,
      app_name: group.app.app_name,
      campaign_name: group.campaignName,
      row_count: group.rows.length,
      ...computeGroupMetrics(group.rows, detectedMetricColumns),
    })
  }

  campaigns.sort((a, b) => {
    const spendA = a.total_spend ?? -1
    const spendB = b.total_spend ?? -1
    return spendB - spendA
  })

  return {
    import_id: importId,
    campaign_column: grouped.campaignColumn,
    campaigns,
    detected_metric_columns: detectedMetricColumns,
    unavailable_metric_columns: unavailableMetricColumns,
    apps: collectAppsFromRows(rows, headers),
  }
}

function buildKeywordGroups(rows, headers) {
  const keywordColumn = findMetricColumn(headers, KEYWORD_ALIASES)
  const campaignColumn = findMetricColumn(headers, CAMPAIGN_NAME_ALIASES)
  const adGroupColumn = findMetricColumn(headers, AD_GROUP_ALIASES)
  const bidColumn = findMetricColumn(headers, KEYWORD_MAX_CPT_BID_ALIASES)

  if (!keywordColumn) return null

  const groups = new Map()

  for (const row of rows) {
    const app = resolveAppIdentity(row.data, headers)
    const rawKeyword = row.data[keywordColumn]
    const keyword = isEmpty(rawKeyword) ? '(blank keyword)' : String(rawKeyword).trim()
    const campaignName = campaignColumn
      ? isEmpty(row.data[campaignColumn])
        ? '(No campaign name)'
        : String(row.data[campaignColumn]).trim()
      : ''
    const adGroupName = adGroupColumn
      ? isEmpty(row.data[adGroupColumn])
        ? '(No ad group)'
        : String(row.data[adGroupColumn]).trim()
      : ''

    const groupKey = `${app.app_key}|${campaignName}|${adGroupName}|${keyword}`

    if (!groups.has(groupKey)) {
      groups.set(groupKey, { app, campaignName, adGroupName, keyword, rows: [] })
    }
    groups.get(groupKey).rows.push(row)
  }

  return { keywordColumn, campaignColumn, adGroupColumn, bidColumn, groups }
}

/**
 * Get import keyword summary
 * 
 * P4: organisationId is now required for IDOR protection
 */
async function getImportKeywordSummary(organisationId, importId) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const data = await getImportRowsData(organisationId, importId)
  if (!data) return null

  const { headers, rows } = data
  const { detectedMetricColumns, unavailableMetricColumns } = detectMetricColumns(headers)
  const grouped = buildKeywordGroups(rows, headers)

  if (!grouped) {
    return {
      import_id: importId,
      keyword_column: null,
      keywords: [],
      detected_metric_columns: detectedMetricColumns,
      unavailable_metric_columns: [...unavailableMetricColumns, 'keyword'],
      apps: collectAppsFromRows(rows, headers),
    }
  }

  // Build campaign lookup map from database to get segments
  const campaignKeys = new Set()
  for (const [, group] of grouped.groups) {
    const key = `${group.app.app_id}|${group.campaignName}`
    campaignKeys.add(key)
  }

  const campaignSegments = new Map()
  if (campaignKeys.size > 0) {
    const uniqueCampaigns = Array.from(campaignKeys).map(k => {
      const [appId, campaignName] = k.split('|')
      return { appId, campaignName }
    })

    // Query segments for all campaigns
    for (const { appId, campaignName } of uniqueCampaigns) {
      const result = await pool.query(
        `SELECT segment FROM campaigns WHERE organisation_id = $1 AND app_id = $2 AND campaign_name = $3`,
        [organisationId, appId, campaignName]
      )
      const segment = result.rows[0]?.segment || null
      campaignSegments.set(`${appId}|${campaignName}`, segment)
    }
  }

  const keywords = []

  for (const [, group] of grouped.groups) {
    const campaignKey = `${group.app.app_id}|${group.campaignName}`
    const segment = campaignSegments.get(campaignKey) || null

    keywords.push({
      app_key: group.app.app_key,
      app_id: group.app.app_id,
      app_name: group.app.app_name,
      campaign_name: group.campaignName,
      ad_group_name: group.adGroupName,
      keyword: group.keyword,
      segment: segment,
      row_count: group.rows.length,
      keyword_max_cpt_bid: grouped.bidColumn
        ? maxColumn(group.rows, grouped.bidColumn)
        : null,
      ...computeGroupMetrics(group.rows, detectedMetricColumns),
    })
  }

  keywords.sort((a, b) => {
    const spendA = a.total_spend ?? -1
    const spendB = b.total_spend ?? -1
    return spendB - spendA
  })

  return {
    import_id: importId,
    keyword_column: grouped.keywordColumn,
    keyword_max_cpt_bid_column: grouped.bidColumn,
    keywords,
    detected_metric_columns: detectedMetricColumns,
    unavailable_metric_columns: unavailableMetricColumns,
    apps: collectAppsFromRows(rows, headers),
  }
}

async function listApps(organisationId) {
  const tenantId = requireOrganisationId(organisationId)
  const rowsResult = await pool.query(
    `SELECT ir.data, i.column_headers
     FROM import_rows ir
     JOIN imports i ON i.id = ir.import_id
     WHERE ir.organisation_id = $1
       AND i.organisation_id = $1`,
    [tenantId],
  )

  const headerSet = new Set()
  const rows = rowsResult.rows

  for (const row of rows) {
    const headers = Array.isArray(row.column_headers) ? row.column_headers : []
    for (const header of headers) headerSet.add(header)
  }

  return collectAppsFromRows(rows, [...headerSet])
}

async function upsertDailyMetricsForImport(importId, client = null, organisationId) {
  const tenantId = requireOrganisationId(organisationId)
  const {
    buildDailyCampaignRecords,
    buildDailyKeywordRecords,
    upsertDailyCampaignMetrics,
    upsertDailyKeywordMetrics,
  } = require('./dailyMetrics')

  const db = client || pool

  const importData = await db.query(
    `SELECT ir.data, i.column_headers
     FROM import_rows ir
     JOIN imports i ON i.id = ir.import_id
     WHERE ir.import_id = $1
       AND ir.organisation_id = $2
       AND i.organisation_id = $2`,
    [importId, tenantId],
  )

  const headers =
    importData.rows.length > 0 && Array.isArray(importData.rows[0].column_headers)
      ? importData.rows[0].column_headers
      : []

  if (!headers.length) return

  const campaignRecords = buildDailyCampaignRecords(importData.rows, headers)
  const keywordRecords = buildDailyKeywordRecords(importData.rows, headers)

  const campaignCount = await upsertDailyCampaignMetrics(campaignRecords, client, tenantId)
  const keywordCount = await upsertDailyKeywordMetrics(keywordRecords, client, tenantId)

  console.log(
    `Upserted ${campaignCount} daily campaign records and ${keywordCount} daily keyword records for import ${importId}`,
  )

  return { campaignCount, keywordCount, keywordRecords }
}

async function backfillDailyMetricsFromImportRows() {
  console.log('Backfilling daily metrics from import_rows...')

  const allImports = await pool.query(
    `SELECT i.id AS import_id, i.organisation_id
     FROM imports i
     WHERE i.organisation_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM import_rows ir WHERE ir.import_id = i.id)
     ORDER BY i.id`,
  )

  for (const row of allImports.rows) {
    const importId = row.import_id
    const result = await upsertDailyMetricsForImport(importId, null, row.organisation_id)
    if (!result) continue

    console.log(
      `Import ${importId}: upserted ${result.campaignCount} campaign records, ${result.keywordCount} keyword records`,
    )
  }

  console.log('Backfill complete')
}

module.exports = {
  parseCsv,
  generateRecordKey,
  backfillRecordKeys,
  createImport,
  listImports,
  getImportById,
  getImportRows,
  getImportProfile,
  getImportMetricsSummary,
  getImportCampaignSummary,
  getImportKeywordSummary,
  getImportRowsData,
  listApps,
  parseNumeric,
  isEmpty,
  findMetricColumn,
  detectMetricColumns,
  computeGroupMetrics,
  buildCampaignGroups,
  buildKeywordGroups,
  resolveAppIdentity,
  maxColumn,
  backfillDailyMetricsFromImportRows,
}
