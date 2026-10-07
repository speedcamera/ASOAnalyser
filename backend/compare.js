const {
  getImportById,
  getImportRowsData,
  parseNumeric,
  isEmpty,
  findMetricColumn,
  detectMetricColumns,
  computeGroupMetrics,
  buildKeywordGroups,
} = require('./imports')
const { collectAppsFromRows } = require('./appIdentity')
const DATE_ALIASES = ['date']
const KEYWORD_MAX_CPT_BID_ALIASES = ['keyword max cpt bid', 'max cpt bid']

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

function pickLatestRow(rows, dateColumn) {
  let latestRow = rows[rows.length - 1]
  let latestDate = null

  for (const row of rows) {
    const date = row.parsed_date ?? (dateColumn ? parseDate(row.data[dateColumn]) : null)
    if (date !== null && (latestDate === null || date > latestDate)) {
      latestDate = date
      latestRow = row
    }
  }

  return latestRow
}

function calcChange(current, previous) {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return null
  }
  return current - previous
}

function flattenMetricsComparison(nameField, nameValue, previousMetrics, currentMetrics, extras = {}) {
  const previousSpend = previousMetrics?.total_spend ?? null
  const currentSpend = currentMetrics?.total_spend ?? null
  const previousInstalls = previousMetrics?.total_installs ?? null
  const currentInstalls = currentMetrics?.total_installs ?? null
  const previousCpa = previousMetrics?.average_cpa ?? null
  const currentCpa = currentMetrics?.average_cpa ?? null

  return {
    [nameField]: nameValue,
    previous_spend: previousSpend,
    current_spend: currentSpend,
    spend_change: calcChange(currentSpend, previousSpend),
    previous_impressions: previousMetrics?.total_impressions ?? null,
    current_impressions: currentMetrics?.total_impressions ?? null,
    impressions_change: calcChange(
      currentMetrics?.total_impressions,
      previousMetrics?.total_impressions,
    ),
    previous_taps: previousMetrics?.total_taps ?? null,
    current_taps: currentMetrics?.total_taps ?? null,
    taps_change: calcChange(currentMetrics?.total_taps, previousMetrics?.total_taps),
    previous_installs: previousInstalls,
    current_installs: currentInstalls,
    installs_change: calcChange(currentInstalls, previousInstalls),
    previous_average_cpt: previousMetrics?.average_cpt ?? null,
    current_average_cpt: currentMetrics?.average_cpt ?? null,
    average_cpt_change: calcChange(currentMetrics?.average_cpt, previousMetrics?.average_cpt),
    previous_cpa: previousCpa,
    current_cpa: currentCpa,
    cpa_change: calcChange(currentCpa, previousCpa),
    previous_ttr: previousMetrics?.tap_through_rate ?? null,
    current_ttr: currentMetrics?.tap_through_rate ?? null,
    ttr_change: calcChange(currentMetrics?.tap_through_rate, previousMetrics?.tap_through_rate),
    previous_cr: previousMetrics?.conversion_rate ?? null,
    current_cr: currentMetrics?.conversion_rate ?? null,
    cr_change: calcChange(currentMetrics?.conversion_rate, previousMetrics?.conversion_rate),
    ...extras,
  }
}

function buildPeriodKeywordComparison(
  previousRows,
  currentRows,
  headers,
  detectedMetricColumns,
) {
  const prevGrouped = buildKeywordGroups(previousRows, headers)
  const currGrouped = buildKeywordGroups(currentRows, headers)

  if (!prevGrouped && !currGrouped) return []

  const bidColumn =
    currGrouped?.bidColumn ?? prevGrouped?.bidColumn ?? findMetricColumn(headers, KEYWORD_MAX_CPT_BID_ALIASES)

  const allKeys = new Set([
    ...(prevGrouped ? [...prevGrouped.groups.keys()] : []),
    ...(currGrouped ? [...currGrouped.groups.keys()] : []),
  ])

  const keywords = []

  for (const groupKey of allKeys) {
    const prevGroup = prevGrouped?.groups.get(groupKey)
    const currGroup = currGrouped?.groups.get(groupKey)
    const app = currGroup?.app ?? prevGroup?.app

    const previousBid =
      bidColumn && prevGroup?.rows?.length
        ? parseNumeric(pickLatestRow(prevGroup.rows, findMetricColumn(headers, DATE_ALIASES)).data[bidColumn])
        : null
    const currentBid =
      bidColumn && currGroup?.rows?.length
        ? parseNumeric(pickLatestRow(currGroup.rows, findMetricColumn(headers, DATE_ALIASES)).data[bidColumn])
        : null

    const bidChange = calcChange(currentBid, previousBid)
    let bidChangePercent = null
    if (bidChange !== null && previousBid !== null && previousBid > 0) {
      bidChangePercent = (bidChange / previousBid) * 100
    }

    keywords.push(
      flattenMetricsComparison(
        'keyword',
        currGroup?.keyword ?? prevGroup?.keyword,
        computeGroupMetrics(prevGroup?.rows ?? [], detectedMetricColumns),
        computeGroupMetrics(currGroup?.rows ?? [], detectedMetricColumns),
        {
          app_key: app.app_key,
          app_id: app.app_id,
          app_name: app.app_name,
          campaign_name: currGroup?.campaignName ?? prevGroup?.campaignName,
          ad_group_name: currGroup?.adGroupName ?? prevGroup?.adGroupName,
          previous_bid: previousBid,
          current_bid: currentBid,
          bid_change: bidChange,
          bid_change_percent: bidChangePercent,
          group_key: groupKey,
        },
      ),
    )
  }

  keywords.sort((a, b) => (b.current_spend ?? -1) - (a.current_spend ?? -1))
  return keywords
}

async function getImportCompare(organisationId, baseImportId, compareImportId) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const previousImport = await getImportById(organisationId, baseImportId)
  const currentImport = await getImportById(organisationId, compareImportId)
  if (!previousImport || !currentImport) return null

  const previousData = await getImportRowsData(organisationId, baseImportId)
  const currentData = await getImportRowsData(organisationId, compareImportId)
  const headers = [
    ...new Set([
      ...(previousData?.headers ?? []),
      ...(currentData?.headers ?? []),
    ]),
  ]

  const { detectedMetricColumns } = detectMetricColumns(headers)
  const keywords = buildPeriodKeywordComparison(
    previousData?.rows ?? [],
    currentData?.rows ?? [],
    headers,
    detectedMetricColumns,
  )

  return {
    base_import_id: baseImportId,
    compare_import_id: compareImportId,
    previous_import: { id: previousImport.id, original_name: previousImport.original_name },
    current_import: { id: currentImport.id, original_name: currentImport.original_name },
    keywords,
    apps: collectAppsFromRows(
      [...(previousData?.rows ?? []), ...(currentData?.rows ?? [])],
      headers,
    ),
  }
}

module.exports = { getImportCompare }
