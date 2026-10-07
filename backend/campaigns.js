const { pool } = require('./db')
const { httpError } = require('./http/clientError')

const VALID_SEGMENTS = ['Brand', 'Generic', 'Discovery', 'Competitor', 'Other']

/**
 * Classify campaign segment based on name
 */
function classifyCampaignSegment(campaignName) {
  const name = String(campaignName || '').toLowerCase()
  if (/\bbrand\b/.test(name)) return 'Brand'
  if (/\bdiscovery\b/.test(name)) return 'Discovery'
  if (/\bcompetitor\b/.test(name)) return 'Competitor'
  if (/\bgeneric\b/.test(name)) return 'Generic'
  return 'Other'
}

/**
 * Get or create campaign record with auto-classification
 */
async function ensureCampaign(appId, campaignName, client = null, organisationId) {
  const tenantId = typeof organisationId === 'number' ? organisationId : Number(organisationId)
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error('organisationId is required')
  }

  const db = client || pool

  const existing = await db.query(
    `SELECT id, app_id, campaign_name, segment, created_at, updated_at
     FROM campaigns
     WHERE organisation_id = $1 AND app_id = $2 AND campaign_name = $3`,
    [tenantId, appId, campaignName]
  )

  if (existing.rows.length > 0) {
    return existing.rows[0]
  }

  const segment = classifyCampaignSegment(campaignName)

  const result = await db.query(
    `INSERT INTO campaigns (app_id, campaign_name, segment, organisation_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (organisation_id, app_id, campaign_name)
     DO UPDATE SET updated_at = NOW()
     RETURNING id, app_id, campaign_name, segment, created_at, updated_at`,
    [appId, campaignName, segment, tenantId]
  )

  return result.rows[0]
}

/**
 * Get campaign by ID
 */
async function getCampaignById(id) {
  const result = await pool.query(
    `SELECT id, app_id, campaign_name, segment, created_at, updated_at
     FROM campaigns
     WHERE id = $1`,
    [id]
  )
  
  return result.rows[0] || null
}

/**
 * Get campaign by app_id and campaign_name
 */
async function getCampaignByKey(appId, campaignName) {
  const result = await pool.query(
    `SELECT id, app_id, campaign_name, segment, created_at, updated_at
     FROM campaigns
     WHERE app_id = $1 AND campaign_name = $2`,
    [appId, campaignName]
  )
  
  return result.rows[0] || null
}

/**
 * Update campaign segment
 * 
 * P4: organisationId is now required for IDOR protection
 */
async function updateCampaignSegment(organisationId, id, segment) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  if (!VALID_SEGMENTS.includes(segment)) {
    throw httpError(400, `Invalid segment. Must be one of: ${VALID_SEGMENTS.join(', ')}`)
  }
  
  const result = await pool.query(
    `UPDATE campaigns
     SET segment = $1, updated_at = NOW()
     WHERE id = $2 AND organisation_id = $3
     RETURNING id, app_id, campaign_name, segment, created_at, updated_at`,
    [segment, id, organisationId]
  )
  
  if (result.rows.length === 0) {
    throw httpError(404, 'Campaign not found')
  }
  
  return result.rows[0]
}

/**
 * List all campaigns for an app
 */
async function listCampaignsByApp(appId) {
  const result = await pool.query(
    `SELECT id, app_id, campaign_name, segment, created_at, updated_at
     FROM campaigns
     WHERE app_id = $1
     ORDER BY campaign_name`,
    [appId]
  )
  
  return result.rows
}

module.exports = {
  classifyCampaignSegment,
  ensureCampaign,
  getCampaignById,
  getCampaignByKey,
  updateCampaignSegment,
  listCampaignsByApp,
  VALID_SEGMENTS,
}
