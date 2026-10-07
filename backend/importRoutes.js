const multer = require('multer')
const { httpError, sendRouteError } = require('./http/clientError')
const { parseBoundedInteger, parseResourceId, MAX_PAGE_OFFSET } = require('./http/requestValidation')
const { csvUploadLimits } = require('./http/csvLimits')
const { createUploadRateLimit } = require('./http/uploadRateLimit')
const {
  parseCsv,
  createImport,
  listImports,
  getImportById,
  getImportRows,
  getImportProfile,
  getImportMetricsSummary,
  getImportCampaignSummary,
  getImportKeywordSummary,
} = require('./imports')
const { getImportCompare } = require('./compare')

const ALLOWED_CSV_MIME = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'text/plain',
  'application/octet-stream',
])

function tenantGuard(requireAuthenticatedTenant) {
  return Array.isArray(requireAuthenticatedTenant)
    ? requireAuthenticatedTenant
    : [requireAuthenticatedTenant]
}

function normalizedMime(file) {
  return String(file && file.mimetype ? file.mimetype : '')
    .split(';')[0]
    .trim()
    .toLowerCase()
}

function csvFileFilter(_req, file, cb) {
  const name = String(file && file.originalname ? file.originalname : '')
  if (!name.toLowerCase().endsWith('.csv') || name.includes('\0')) {
    cb(httpError(400, 'Only CSV files are allowed'))
    return
  }
  const mime = normalizedMime(file)
  if (mime && !ALLOWED_CSV_MIME.has(mime)) {
    cb(httpError(400, 'Only CSV files are allowed'))
    return
  }
  cb(null, true)
}

function createCsvUpload(limits = csvUploadLimits()) {
  // Multer 2.3+ accepts a file that is exactly limits.fileSize and rejects a
  // larger one before parsing. Nested field names are capped because this
  // form only sends flat fields.
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: limits.maxBytes,
      files: 1,
      fields: 10,
      parts: 20,
      fieldNestingDepth: 1,
    },
    fileFilter: csvFileFilter,
  }).single('file')
}

/**
 * Apple Ads import routes.
 *
 * Organisation id comes only from req.organisationId, set by
 * requireAuthenticatedTenant. Query, body, headers, route params, and CSV
 * contents are not a tenant source. The upload limiter runs after that
 * chain and counts attempts for the authenticated local user.
 */
function registerImportRoutes(router, requireAuthenticatedTenant, options = {}) {
  const guard = tenantGuard(requireAuthenticatedTenant)
  const limits = options.csvLimits || csvUploadLimits()
  const upload = createCsvUpload(limits)
  const uploadRateLimit = createUploadRateLimit({
    max: options.uploadsPerWindow || limits.uploadsPerWindow,
    windowMs: options.windowMs || limits.windowMinutes * 60 * 1000,
  })

  router.post('/api/imports', ...guard, uploadRateLimit, upload, async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' })
        return
      }

      const { records, headers } = parseCsv(req.file.buffer, { maxRows: limits.maxRows })
      const result = await createImport(
        req.file.originalname,
        headers,
        records,
        req.organisationId,
      )
      res.status(201).json(result)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.get('/api/imports', ...guard, async (req, res) => {
    try {
      res.json(await listImports(req.organisationId))
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.get('/api/imports/:id', ...guard, async (req, res) => {
    try {
      const importId = parseResourceId(req.params.id, 'import id')
      const importRecord = await getImportById(req.organisationId, importId)
      if (!importRecord) {
        res.status(404).json({ error: 'Import not found' })
        return
      }
      res.json(importRecord)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.get('/api/imports/:id/keyword-summary', ...guard, async (req, res) => {
    try {
      const summary = await getImportKeywordSummary(
        req.organisationId,
        parseResourceId(req.params.id, 'import id'),
      )
      if (!summary) {
        res.status(404).json({ error: 'Import not found' })
        return
      }
      res.json(summary)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.get('/api/imports/:id/campaign-summary', ...guard, async (req, res) => {
    try {
      const summary = await getImportCampaignSummary(
        req.organisationId,
        parseResourceId(req.params.id, 'import id'),
      )
      if (!summary) {
        res.status(404).json({ error: 'Import not found' })
        return
      }
      res.json(summary)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.get('/api/imports/:id/metrics-summary', ...guard, async (req, res) => {
    try {
      const summary = await getImportMetricsSummary(
        req.organisationId,
        parseResourceId(req.params.id, 'import id'),
      )
      if (!summary) {
        res.status(404).json({ error: 'Import not found' })
        return
      }
      res.json(summary)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.get('/api/imports/:id/profile', ...guard, async (req, res) => {
    try {
      const profile = await getImportProfile(
        req.organisationId,
        parseResourceId(req.params.id, 'import id'),
      )
      if (!profile) {
        res.status(404).json({ error: 'Import not found' })
        return
      }
      res.json(profile)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.get('/api/imports/:id/rows', ...guard, async (req, res) => {
    try {
      const importId = parseResourceId(req.params.id, 'import id')
      const limit = parseBoundedInteger(req.query.limit, {
        name: 'limit',
        min: 1,
        max: 500,
        fallback: 100,
      })
      const offset = parseBoundedInteger(req.query.offset, {
        name: 'offset',
        min: 0,
        max: MAX_PAGE_OFFSET,
        fallback: 0,
      })
      const rows = await getImportRows(req.organisationId, importId, limit, offset)
      if (!rows) {
        res.status(404).json({ error: 'Import not found' })
        return
      }
      res.json(rows)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })

  router.get('/api/compare', ...guard, async (req, res) => {
    try {
      if (!req.query.baseImportId || !req.query.compareImportId) {
        res.status(400).json({ error: 'baseImportId and compareImportId are required' })
        return
      }
      const baseImportId = parseResourceId(req.query.baseImportId, 'import id')
      const compareImportId = parseResourceId(req.query.compareImportId, 'import id')

      const comparison = await getImportCompare(
        req.organisationId,
        baseImportId,
        compareImportId,
      )
      if (!comparison) {
        res.status(404).json({ error: 'One or both imports were not found' })
        return
      }

      res.json(comparison)
    } catch (err) {
      sendRouteError(req, res, err)
    }
  })
}

const csvUpload = createCsvUpload()

module.exports = { registerImportRoutes, csvUpload, createCsvUpload }
