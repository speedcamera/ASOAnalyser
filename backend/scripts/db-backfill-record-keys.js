require('dotenv').config()

const { pool } = require('../db')
const { backfillRecordKeys } = require('../imports')

backfillRecordKeys()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err && err.message ? err.message : 'Record-key backfill failed')
    pool.end().finally(() => process.exit(1))
  })
