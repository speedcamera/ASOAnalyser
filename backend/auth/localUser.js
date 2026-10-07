const { pool } = require('../db')

const AUTH_PROVIDER = 'clerk'

function unauthorized() {
  const err = new Error('Unauthorized')
  err.status = 401
  return err
}

function mapUserRow(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    authProvider: row.auth_provider,
    authProviderUserId: row.auth_provider_user_id,
  }
}

/**
 * Trusted profile fields come only from the Clerk Backend User object.
 * Request payloads are never accepted here.
 */
function profileFromClerkUser(clerkUser, clerkUserId) {
  if (!clerkUser || clerkUser.id !== clerkUserId) {
    throw unauthorized()
  }

  const emails = Array.isArray(clerkUser.emailAddresses) ? clerkUser.emailAddresses : []
  const primary = emails.find((item) => item && item.id === clerkUser.primaryEmailAddressId)
  const email =
    primary?.emailAddress ||
    clerkUser.primaryEmailAddress?.emailAddress ||
    null

  const combinedName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ')
  const fullName = clerkUser.fullName || combinedName || clerkUser.username || null

  return {
    email: email || null,
    fullName: fullName || null,
  }
}

async function defaultFetchClerkProfile(clerkUserId) {
  const { clerkClient } = require('@clerk/express')
  const clerkUser = await clerkClient.users.getUser(clerkUserId)
  return profileFromClerkUser(clerkUser, clerkUserId)
}

async function selectByProviderIdentity(db, clerkUserId) {
  const result = await db.query(
    `SELECT id, email, full_name, auth_provider, auth_provider_user_id
     FROM users
     WHERE auth_provider = $1 AND auth_provider_user_id = $2`,
    [AUTH_PROVIDER, clerkUserId]
  )
  return result.rows
}

/**
 * Resolve the local application user for a verified Clerk user id.
 *
 * Identity is (auth_provider, auth_provider_user_id), never email.
 * First login uses INSERT ... ON CONFLICT DO NOTHING so two concurrent
 * requests cannot create duplicate rows or fail the loser.
 */
async function resolveLocalUser(clerkUserId, deps = {}) {
  if (typeof clerkUserId !== 'string' || clerkUserId.length === 0) {
    throw unauthorized()
  }

  const db = deps.pool || pool
  const fetchClerkProfile = deps.fetchClerkProfile || defaultFetchClerkProfile
  const profile = await fetchClerkProfile(clerkUserId)

  if (
    !profile ||
    (profile.email !== null && typeof profile.email !== 'string') ||
    (profile.fullName !== null && typeof profile.fullName !== 'string')
  ) {
    throw unauthorized()
  }

  try {
    await db.query(
      `INSERT INTO users (email, full_name, auth_provider, auth_provider_user_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (auth_provider, auth_provider_user_id)
         WHERE auth_provider IS NOT NULL AND auth_provider_user_id IS NOT NULL
       DO NOTHING`,
      [profile.email, profile.fullName, AUTH_PROVIDER, clerkUserId]
    )
  } catch (err) {
    // Provider conflict is handled by ON CONFLICT. A different unique
    // violation (email) must not attach this Clerk id to another row.
    if (err.code !== '23505') throw err
  }

  const rows = await selectByProviderIdentity(db, clerkUserId)
  if (rows.length !== 1) {
    throw unauthorized()
  }

  const row = rows[0]
  const emailChanged = (row.email || null) !== profile.email
  const nameChanged = (row.full_name || null) !== profile.fullName
  if (!emailChanged && !nameChanged) {
    return mapUserRow(row)
  }

  try {
    const updated = await db.query(
      `UPDATE users
       SET email = $1,
           full_name = $2,
           updated_at = NOW()
       WHERE id = $3
         AND auth_provider = $4
         AND auth_provider_user_id = $5
       RETURNING id, email, full_name, auth_provider, auth_provider_user_id`,
      [profile.email, profile.fullName, row.id, AUTH_PROVIDER, clerkUserId]
    )
    return mapUserRow(updated.rows[0] || row)
  } catch (err) {
    if (err.code !== '23505') throw err

    // Keep the same local user if the new email is already taken.
    const nameOnly = await db.query(
      `UPDATE users
       SET full_name = $1,
           updated_at = NOW()
       WHERE id = $2
         AND auth_provider = $3
         AND auth_provider_user_id = $4
       RETURNING id, email, full_name, auth_provider, auth_provider_user_id`,
      [profile.fullName, row.id, AUTH_PROVIDER, clerkUserId]
    )
    return mapUserRow(nameOnly.rows[0] || row)
  }
}

module.exports = {
  AUTH_PROVIDER,
  resolveLocalUser,
  profileFromClerkUser,
}
