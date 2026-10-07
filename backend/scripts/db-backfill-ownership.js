require('dotenv').config()

const { backfillOrganisationOwnership, pool } = require('../db')

backfillOrganisationOwnership()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err && err.message ? err.message : 'Organisation ownership backfill failed')
    pool.end().finally(() => process.exit(1))
  })
