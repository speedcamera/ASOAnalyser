const { pool } = require('./db')
const { httpError } = require('./http/clientError')
const { parseGoalThreshold, readFilterText } = require('./http/requestValidation')

/**
 * Performance Goals Service
 * 
 * Manages user-defined performance goals for campaigns and keywords.
 * Goals define thresholds that trigger alerts when breached.
 */

const VALID_ENTITY_TYPES = ['campaign', 'keyword']
const VALID_METRICS = ['spend', 'installs', 'cpa', 'cpt', 'ttr', 'cr']
const VALID_OPERATORS = ['greater_than', 'less_than']
const VALID_PERIODS = [7, 14, 30]

/**
 * Get all goals (optionally filtered by entity)
 * 
 * P4: organisationId is now required for tenant isolation
 */
async function getGoals({ organisationId, entityType = null, entityKey = null, isActive = null } = {}) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  let where = []
  let params = []
  let paramIndex = 1

  // Tenant scope MUST be first filter
  where.push(`organisation_id = $${paramIndex}`)
  params.push(organisationId)
  paramIndex++

  const entityTypeFilter = readFilterText(entityType, 'entityType', 32)
  const entityKeyFilter = readFilterText(entityKey, 'entityKey', 500)
  if (entityTypeFilter && !VALID_ENTITY_TYPES.includes(entityTypeFilter)) {
    throw httpError(400, `Invalid entity_type. Must be one of: ${VALID_ENTITY_TYPES.join(', ')}`)
  }

  if (entityTypeFilter) {
    where.push(`entity_type = $${paramIndex}`)
    params.push(entityTypeFilter)
    paramIndex++
  }

  if (entityKeyFilter) {
    where.push(`entity_key = $${paramIndex}`)
    params.push(entityKeyFilter)
    paramIndex++
  }

  if (isActive !== null) {
    where.push(`is_active = $${paramIndex}`)
    params.push(isActive)
    paramIndex++
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const result = await pool.query(
    `SELECT 
      id,
      entity_type,
      entity_key,
      metric,
      operator,
      threshold,
      period_days,
      is_active,
      created_at,
      updated_at
    FROM performance_goals
    ${whereClause}
    ORDER BY created_at DESC`,
    params
  )

  return result.rows.map(row => ({
    id: row.id,
    entityType: row.entity_type,
    entityKey: row.entity_key,
    metric: row.metric,
    operator: row.operator,
    threshold: parseFloat(row.threshold),
    periodDays: row.period_days,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }))
}

/**
 * Create a new goal
 */
async function createGoal(organisationId, { entityType, entityKey, metric, operator, threshold, periodDays = 7 } = {}) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }
  // Validation
  if (!VALID_ENTITY_TYPES.includes(entityType)) {
    throw httpError(400, `Invalid entity_type. Must be one of: ${VALID_ENTITY_TYPES.join(', ')}`)
  }
  if (!VALID_METRICS.includes(metric)) {
    throw httpError(400, `Invalid metric. Must be one of: ${VALID_METRICS.join(', ')}`)
  }
  if (!VALID_OPERATORS.includes(operator)) {
    throw httpError(400, `Invalid operator. Must be one of: ${VALID_OPERATORS.join(', ')}`)
  }
  if (!VALID_PERIODS.includes(periodDays)) {
    throw httpError(400, `Invalid period_days. Must be one of: ${VALID_PERIODS.join(', ')}`)
  }
  parseGoalThreshold(threshold)
  if (!entityKey || typeof entityKey !== 'string') {
    throw httpError(400, 'entity_key is required')
  }
  if (entityKey.length > 500) {
    throw httpError(400, 'entity_key is too long')
  }

  const result = await pool.query(
    `INSERT INTO performance_goals 
      (entity_type, entity_key, metric, operator, threshold, period_days, organisation_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING 
      id,
      entity_type,
      entity_key,
      metric,
      operator,
      threshold,
      period_days,
      is_active,
      created_at,
      updated_at`,
    [entityType, entityKey, metric, operator, threshold, periodDays, organisationId]
  )

  const row = result.rows[0]
  return {
    id: row.id,
    entityType: row.entity_type,
    entityKey: row.entity_key,
    metric: row.metric,
    operator: row.operator,
    threshold: parseFloat(row.threshold),
    periodDays: row.period_days,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

/**
 * Update a goal
 * 
 * P4: organisationId is now required for IDOR protection
 */
async function updateGoal(organisationId, id, updates) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }
  const allowedFields = ['metric', 'operator', 'threshold', 'period_days', 'is_active']
  const dbFields = {
    metric: 'metric',
    operator: 'operator',
    threshold: 'threshold',
    periodDays: 'period_days',
    isActive: 'is_active',
  }

  // Validation
  if (updates.metric && !VALID_METRICS.includes(updates.metric)) {
    throw httpError(400, `Invalid metric. Must be one of: ${VALID_METRICS.join(', ')}`)
  }
  if (updates.operator && !VALID_OPERATORS.includes(updates.operator)) {
    throw httpError(400, `Invalid operator. Must be one of: ${VALID_OPERATORS.join(', ')}`)
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'periodDays') && !VALID_PERIODS.includes(updates.periodDays)) {
    throw httpError(400, `Invalid period_days. Must be one of: ${VALID_PERIODS.join(', ')}`)
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'threshold')) {
    parseGoalThreshold(updates.threshold)
  }

  const setClauses = []
  const params = []
  let paramIndex = 1

  Object.keys(updates).forEach(key => {
    if (Object.keys(dbFields).includes(key)) {
      const dbField = dbFields[key]
      setClauses.push(`${dbField} = $${paramIndex}`)
      params.push(updates[key])
      paramIndex++
    }
  })

  if (setClauses.length === 0) {
    throw httpError(400, 'No valid fields to update')
  }

  setClauses.push(`updated_at = NOW()`)
  params.push(id)
  const idParamIndex = paramIndex
  paramIndex++
  params.push(organisationId)

  const result = await pool.query(
    `UPDATE performance_goals
    SET ${setClauses.join(', ')}
    WHERE id = $${idParamIndex} AND organisation_id = $${paramIndex}
    RETURNING 
      id,
      entity_type,
      entity_key,
      metric,
      operator,
      threshold,
      period_days,
      is_active,
      created_at,
      updated_at`,
    params
  )

  if (result.rows.length === 0) {
    throw httpError(404, 'Goal not found')
  }

  const row = result.rows[0]
  return {
    id: row.id,
    entityType: row.entity_type,
    entityKey: row.entity_key,
    metric: row.metric,
    operator: row.operator,
    threshold: parseFloat(row.threshold),
    periodDays: row.period_days,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

/**
 * Delete a goal
 * 
 * P4: organisationId is now required for IDOR protection
 */
async function deleteGoal(organisationId, id) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const result = await pool.query(
    'DELETE FROM performance_goals WHERE id = $1 AND organisation_id = $2 RETURNING id',
    [id, organisationId]
  )

  if (result.rows.length === 0) {
    throw httpError(404, 'Goal not found')
  }

  return { id: result.rows[0].id }
}

module.exports = {
  getGoals,
  createGoal,
  updateGoal,
  deleteGoal,
  VALID_ENTITY_TYPES,
  VALID_METRICS,
  VALID_OPERATORS,
  VALID_PERIODS,
}
