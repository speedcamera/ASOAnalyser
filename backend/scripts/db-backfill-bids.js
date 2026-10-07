require('dotenv').config()

const { pool } = require('../db')
const { backfillBidExperiments } = require('../bidExperiments')

backfillBidExperiments()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err && err.message ? err.message : 'Bid experiment backfill failed')
    pool.end().finally(() => process.exit(1))
  })
