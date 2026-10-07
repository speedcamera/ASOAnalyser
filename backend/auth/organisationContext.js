const { pool } = require('../db')

const DEVELOPMENT_ORGANISATION_NAME = 'Development Organisation'
const BOOTSTRAP_CLERK_USER_ID_ENV = 'DEVELOPMENT_ORGANISATION_BOOTSTRAP_CLERK_USER_ID'
const VALID_ROLES = new Set(['owner', 'admin', 'analyst'])
const OWNER_ROLE = 'owner'

/**
 * P5B resolves the local organisation for an authenticated user.
 * Apple Ads routes take req.organisationId from this resolution.
 * Any other authenticated user with no membership receives one new
 * organisation and one owner membership. There is no email allowlist.
 * The configured bootstrap identity may join the existing Development
 * Organisation. Resolution does not fall back to that organisation for anyone else.
 * This module does not read Clerk sessions and does not fall back to the
 * Development Organisation when resolution fails.
 *
 * One active membership per user is enforced here, not with a unique
 * constraint on organisation_users.user_id. The existing
 * UNIQUE (organisation_id, user_id) stays, so a later phase can still store
 * more than one membership. Provisioning serializes on the users row:
 * BEGIN; SELECT id FROM users WHERE id = $1 FOR UPDATE; ... COMMIT.
 * A second first-request waits, then sees the membership the first request
 * committed. It does not insert another organisation.
 */

class OrganisationResolutionError extends Error {
  constructor(message, { status = 500, code = 'organisation_resolution_failed', details = null } = {}) {
    super(message)
    this.name = 'OrganisationResolutionError'
    this.status = status
    this.code = code
    this.details = details
  }
}

function bootstrapClerkUserId(env = process.env) {
  const raw = env && env[BOOTSTRAP_CLERK_USER_ID_ENV]
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isDevelopmentBootstrapUser(user, env = process.env) {
  const configured = bootstrapClerkUserId(env)
  if (!configured || !user) return false
  return user.authProvider === 'clerk' && user.authProviderUserId === configured
}

function organisationNameForUser(user) {
  const fullName = user && typeof user.fullName === 'string' ? user.fullName.trim() : ''
  if (!fullName) return "User's Organisation"
  return `${fullName}'s Organisation`
}

function asId(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return Number(value)
  return null
}

function assertLocalUser(user) {
  if (!user || asId(user.id) === null) {
    throw new OrganisationResolutionError('Authenticated user is missing a local id', {
      code: 'missing_user',
    })
  }
}

/**
 * ORDER BY is only so diagnostic logs are stable. More than one row is an
 * error. This function never chooses a row.
 */
function interpretMemberships(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null

  if (rows.length > 1) {
    throw new OrganisationResolutionError('Multiple organisation memberships', {
      code: 'multiple_memberships',
      details: {
        membershipCount: rows.length,
        organisationIds: rows.map((row) => row.organisation_id),
      },
    })
  }

  const row = rows[0]
  const organisationId = asId(row.resolved_organisation_id)
  const membershipOrganisationId = asId(row.organisation_id)
  if (
    organisationId === null ||
    membershipOrganisationId === null ||
    organisationId !== membershipOrganisationId ||
    typeof row.organisation_name !== 'string' ||
    row.organisation_name.length === 0 ||
    !VALID_ROLES.has(row.role)
  ) {
    throw new OrganisationResolutionError('Organisation membership is invalid', {
      code: 'invalid_membership',
      details: {
        membershipId: row.membership_id ?? null,
        organisationId: row.organisation_id ?? null,
      },
    })
  }

  return {
    id: organisationId,
    name: row.organisation_name,
    role: row.role,
  }
}

async function selectMemberships(db, userId) {
  const result = await db.query(
    `SELECT
       ou.id AS membership_id,
       ou.organisation_id,
       ou.role,
       o.id AS resolved_organisation_id,
       o.organisation_name
     FROM organisation_users ou
     LEFT JOIN organisations o ON o.id = ou.organisation_id
     WHERE ou.user_id = $1
     ORDER BY ou.id`,
    [userId]
  )
  return result.rows
}

async function lockUser(client, userId) {
  const locked = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId])
  if (locked.rows.length !== 1) {
    throw new OrganisationResolutionError('Local user row was not found', {
      code: 'user_not_found',
    })
  }
}

async function findDevelopmentOrganisation(client) {
  const found = await client.query(
    `SELECT id, organisation_name
     FROM organisations
     WHERE organisation_name = $1
     ORDER BY id`,
    [DEVELOPMENT_ORGANISATION_NAME]
  )
  if (found.rows.length !== 1) {
    throw new OrganisationResolutionError('Development Organisation could not be resolved', {
      code: 'development_organisation_unresolved',
      details: { matchCount: found.rows.length },
    })
  }
  return found.rows[0]
}

async function attachDevelopmentOrganisation(client, user) {
  const org = await findDevelopmentOrganisation(client)
  await client.query(
    `INSERT INTO organisation_users (organisation_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT ON CONSTRAINT uq_organisation_user DO NOTHING`,
    [org.id, user.id, OWNER_ROLE]
  )
  return {
    id: org.id,
    name: org.organisation_name,
    role: OWNER_ROLE,
  }
}

async function provisionOrganisation(client, user) {
  const inserted = await client.query(
    `INSERT INTO organisations (organisation_name)
     VALUES ($1)
     RETURNING id, organisation_name`,
    [organisationNameForUser(user)]
  )
  const org = inserted.rows[0]
  await client.query(
    `INSERT INTO organisation_users (organisation_id, user_id, role)
     VALUES ($1, $2, $3)`,
    [org.id, user.id, OWNER_ROLE]
  )
  return {
    id: org.id,
    name: org.organisation_name,
    role: OWNER_ROLE,
  }
}

async function resolveOrganisationForUser(user, deps = {}) {
  assertLocalUser(user)
  const db = deps.pool || pool
  const env = deps.env || process.env
  const readMemberships = deps.selectMemberships || selectMemberships
  const client = await db.connect()
  let committed = false

  try {
    await client.query('BEGIN')
    await lockUser(client, user.id)
    const existing = interpretMemberships(await readMemberships(client, user.id))
    if (existing) {
      await client.query('COMMIT')
      committed = true
      return existing
    }

    const created = isDevelopmentBootstrapUser(user, env)
      ? await attachDevelopmentOrganisation(client, user)
      : await provisionOrganisation(client, user)

    const confirmed = interpretMemberships(await readMemberships(client, user.id))
    if (!confirmed || confirmed.id !== created.id || confirmed.role !== created.role) {
      throw new OrganisationResolutionError('Organisation membership could not be confirmed', {
        code: 'membership_unconfirmed',
        details: { userId: user.id },
      })
    }

    await client.query('COMMIT')
    committed = true
    return confirmed
  } catch (err) {
    if (!committed) {
      try {
        await client.query('ROLLBACK')
      } catch (rollbackErr) {
        console.error('Organisation resolution rollback failed', rollbackErr.code || '')
      }
    }
    throw err
  } finally {
    client.release()
  }
}

function createRequireOrganisationContext(deps = {}) {
  const resolve = deps.resolveOrganisationForUser || resolveOrganisationForUser

  return async function requireOrganisationContext(req, res, next) {
    if (!req.user || asId(req.user.id) === null) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    try {
      const organisation = await resolve(req.user, {
        pool: deps.pool,
        env: deps.env,
        selectMemberships: deps.selectMemberships,
      })
      if (
        !organisation ||
        asId(organisation.id) === null ||
        typeof organisation.name !== 'string' ||
        !VALID_ROLES.has(organisation.role)
      ) {
        throw new OrganisationResolutionError('Organisation context was incomplete', {
          code: 'incomplete_context',
        })
      }

      req.organisationId = organisation.id
      req.organisation = {
        id: organisation.id,
        name: organisation.name,
        role: organisation.role,
      }
      next()
    } catch (err) {
      console.error('Organisation resolution failed', {
        userId: req.user.id,
        code: (err && err.code) || 'database_error',
        details: err instanceof OrganisationResolutionError ? err.details : undefined,
      })
      res.status(500).json({ error: 'Organisation could not be resolved' })
    }
  }
}

function logBootstrapConfiguration(env = process.env) {
  if (bootstrapClerkUserId(env)) {
    console.log('Development Organisation bootstrap identity is configured')
    return
  }
  console.log(
    'Development Organisation bootstrap identity is not configured. ' +
      `Set ${BOOTSTRAP_CLERK_USER_ID_ENV} to attach that Clerk user to the existing Development Organisation.`
  )
}

const requireOrganisationContext = createRequireOrganisationContext()

module.exports = {
  BOOTSTRAP_CLERK_USER_ID_ENV,
  DEVELOPMENT_ORGANISATION_NAME,
  OrganisationResolutionError,
  bootstrapClerkUserId,
  createRequireOrganisationContext,
  isDevelopmentBootstrapUser,
  logBootstrapConfiguration,
  organisationNameForUser,
  requireOrganisationContext,
  resolveOrganisationForUser,
}
