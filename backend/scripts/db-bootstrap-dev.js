require('dotenv').config()

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to create Development Organisation when NODE_ENV=production')
  process.exit(1)
}

const configured = process.env.DEVELOPMENT_ORGANISATION_BOOTSTRAP_CLERK_USER_ID
if (typeof configured !== 'string' || configured.trim().length === 0) {
  console.error('DEVELOPMENT_ORGANISATION_BOOTSTRAP_CLERK_USER_ID must be set')
  process.exit(1)
}

const { ensureDevelopmentOrganisation, pool } = require('../db')

ensureDevelopmentOrganisation()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err && err.message ? err.message : 'Development Organisation bootstrap failed')
    pool.end().finally(() => process.exit(1))
  })
