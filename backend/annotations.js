const { pool } = require('./db')
const { httpError } = require('./http/clientError')
const { MAX_ENTITY_KEY, MAX_NOTE_TEXT, parseResourceId } = require('./http/requestValidation')

const ENTITY_TYPES = new Set(['campaign', 'keyword'])
const NOTE_TYPES = new Set(['note', 'optimisation', 'observation', 'issue', 'experiment'])

function normalizeText(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function mapAnnotationRow(row) {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityKey: row.entity_key,
    noteType: row.note_type,
    noteText: row.note_text,
    isPinned: row.is_pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function validateEntity(entityType, entityKey) {
  const type = normalizeText(entityType).toLowerCase()
  const key = normalizeText(entityKey)
  if (!ENTITY_TYPES.has(type)) {
    return { error: 'entityType must be campaign or keyword' }
  }
  if (!key) {
    return { error: 'entityKey is required' }
  }
  if (key.length > MAX_ENTITY_KEY) {
    return { error: 'entityKey is too long' }
  }
  return { entityType: type, entityKey: key }
}

function validateNotePayload(body, { requireEntity = true } = {}) {
  const noteType = normalizeText(body.noteType || body.note_type || 'note').toLowerCase()
  const noteText = normalizeText(body.noteText ?? body.note_text)
  const isPinned = Boolean(body.isPinned ?? body.is_pinned ?? false)

  if (!NOTE_TYPES.has(noteType)) {
    return {
      error:
        'noteType must be one of: note, optimisation, observation, issue, experiment',
    }
  }
  if (!noteText) {
    return { error: 'noteText is required' }
  }
  if (noteText.length > MAX_NOTE_TEXT) {
    return { error: `Note text must be ${MAX_NOTE_TEXT} characters or fewer` }
  }

  if (!requireEntity) {
    return { noteType, noteText, isPinned }
  }

  const entity = validateEntity(body.entityType ?? body.entity_type, body.entityKey ?? body.entity_key)
  if (entity.error) return entity

  return {
    entityType: entity.entityType,
    entityKey: entity.entityKey,
    noteType,
    noteText,
    isPinned,
  }
}

/**
 * List annotations for an entity
 * 
 * P4: organisationId is now required for tenant isolation
 */
async function listAnnotations({ organisationId, entityType, entityKey }) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const entity = validateEntity(entityType, entityKey)
  if (entity.error) throw httpError(400, entity.error)

  const result = await pool.query(
    `
      SELECT id, entity_type, entity_key, note_type, note_text, is_pinned, created_at, updated_at
      FROM annotations
      WHERE organisation_id = $1 AND entity_type = $2 AND entity_key = $3
      ORDER BY is_pinned DESC, created_at DESC, id DESC
    `,
    [organisationId, entity.entityType, entity.entityKey],
  )

  return result.rows.map(mapAnnotationRow)
}

async function createAnnotation(organisationId, body) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const payload = validateNotePayload(body, { requireEntity: true })
  if (payload.error) throw httpError(400, payload.error)

  const result = await pool.query(
    `
      INSERT INTO annotations (entity_type, entity_key, note_type, note_text, is_pinned, organisation_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, entity_type, entity_key, note_type, note_text, is_pinned, created_at, updated_at
    `,
    [
      payload.entityType,
      payload.entityKey,
      payload.noteType,
      payload.noteText,
      payload.isPinned,
      organisationId,
    ],
  )

  return mapAnnotationRow(result.rows[0])
}

/**
 * Update annotation
 * 
 * P4: organisationId is now required for IDOR protection
 */
async function updateAnnotation(organisationId, id, body) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const annotationId = parseResourceId(id, 'annotation id')

  const existing = await pool.query(
    `SELECT id, entity_type, entity_key FROM annotations WHERE id = $1 AND organisation_id = $2`,
    [annotationId, organisationId],
  )
  if (!existing.rows.length) {
    throw httpError(404, 'Annotation not found')
  }

  const current = existing.rows[0]
  const merged = {
    entityType: body.entityType ?? body.entity_type ?? current.entity_type,
    entityKey: body.entityKey ?? body.entity_key ?? current.entity_key,
    noteType: body.noteType ?? body.note_type,
    noteText: body.noteText ?? body.note_text,
    isPinned: body.isPinned ?? body.is_pinned,
  }

  const payload = validateNotePayload(merged, { requireEntity: true })
  if (payload.error) throw httpError(400, payload.error)

  const result = await pool.query(
    `
      UPDATE annotations
      SET entity_type = $2,
          entity_key = $3,
          note_type = $4,
          note_text = $5,
          is_pinned = $6,
          updated_at = NOW()
      WHERE id = $1 AND organisation_id = $7
      RETURNING id, entity_type, entity_key, note_type, note_text, is_pinned, created_at, updated_at
    `,
    [
      annotationId,
      payload.entityType,
      payload.entityKey,
      payload.noteType,
      payload.noteText,
      payload.isPinned,
      organisationId,
    ],
  )

  return mapAnnotationRow(result.rows[0])
}

/**
 * Delete annotation
 * 
 * P4: organisationId is now required for IDOR protection
 */
async function deleteAnnotation(organisationId, id) {
  if (!organisationId) {
    throw new Error('organisationId is required')
  }

  const annotationId = parseResourceId(id, 'annotation id')

  const result = await pool.query(
    `DELETE FROM annotations WHERE id = $1 AND organisation_id = $2 RETURNING id`,
    [annotationId, organisationId],
  )
  if (!result.rows.length) {
    throw httpError(404, 'Annotation not found')
  }
  return { ok: true, id: annotationId }
}

module.exports = {
  ENTITY_TYPES,
  NOTE_TYPES,
  listAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
}
