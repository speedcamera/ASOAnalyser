const { pool } = require('../db')
const { httpError } = require('../http/clientError')

/**
 * Rename the organisation already resolved for this request.
 * organisationId is req.organisationId. Callers must not pass a client id.
 */
async function renameOrganisation(organisationId, name, db = pool) {
  const result = await db.query(
    `UPDATE organisations
     SET organisation_name = $1,
         updated_at = NOW()
     WHERE id = $2
     RETURNING id, organisation_name`,
    [name, organisationId]
  )
  if (result.rows.length !== 1) {
    throw httpError(404, 'Organisation not found')
  }
  return {
    id: result.rows[0].id,
    name: result.rows[0].organisation_name,
  }
}

module.exports = { renameOrganisation }
