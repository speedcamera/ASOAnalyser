require('dotenv').config()

const { prepareSchema, pool } = require('../db')

prepareSchema()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err && err.message ? err.message : 'Schema preparation failed')
    pool.end().finally(() => process.exit(1))
  })
