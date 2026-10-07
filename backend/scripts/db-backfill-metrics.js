require('dotenv').config()

const { pool } = require('../db')
const { backfillDailyMetricsFromImportRows } = require('../imports')

backfillDailyMetricsFromImportRows()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err && err.message ? err.message : 'Daily metric backfill failed')
    pool.end().finally(() => process.exit(1))
  })
