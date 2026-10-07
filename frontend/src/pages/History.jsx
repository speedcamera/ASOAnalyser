import { useRef } from 'react'
import DataTable from '../components/DataTable'
import WelcomeUpload from '../components/WelcomeUpload'
import { useApp } from '../context/AppContext'
import { MAX_CSV_FILE_SIZE_MB, MAX_CSV_ROWS } from '../uploadLimits'
import { formatCurrency, formatNumber } from '../utils/format'
import { na } from '../utils/display'

export default function History() {
  const fileRef = useRef(null)
  const {
    imports,
    importsStatus,
    error,
    selectedImportId,
    selectImport,
    selectedImport,
    columnProfile,
    rows,
    rowsTotal,
    metricsSummary,
    campaignSummary,
    handleUpload,
    uploading,
    loading,
  } = useApp()

  const profileColumns = columnProfile?.columns ?? []
  const displayHeaders = (selectedImport?.column_headers ?? []).slice(0, 8)
  const apps =
    (metricsSummary?.apps ?? campaignSummary?.apps ?? [])
      .map((a) => a.app_name)
      .join(', ') || 'N/A'

  if (importsStatus === 'ready' && imports.length === 0 && !error) {
    return (
      <div className="content-shell">
        <WelcomeUpload />
      </div>
    )
  }

  return (
    <div className="content-shell">
      <section className="panel-card">
        <h1 className="panel-card__title">History</h1>
        <p className="panel-card__subtitle">Upload and review imported Apple Search Ads CSV files.</p>

        <div className="upload-block">
          <p className="upload-block__text">
            Upload an Apple Ads CSV export up to {MAX_CSV_FILE_SIZE_MB} MB and{' '}
            {MAX_CSV_ROWS.toLocaleString('en-GB')} rows. Rows are deduplicated automatically on
            import.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleUpload(file)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className="btn btn--upload"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? 'Uploading…' : 'Upload CSV'}
          </button>
        </div>
      </section>

      <div className="panel-grid">
        <section className="panel-card">
          <h2 className="panel-card__heading">Imports</h2>
          {loading ? (
            <p className="muted">Loading imports…</p>
          ) : error ? (
            <p className="muted">{error}</p>
          ) : imports.length === 0 ? (
            <p className="muted">No imports yet</p>
          ) : (
            <ul className="history-list">
              {imports.map((imp) => (
                <li key={imp.id}>
                  <button
                    type="button"
                    className={`history-list__btn ${selectedImportId === imp.id ? 'history-list__btn--active' : ''}`}
                    onClick={() => selectImport(imp.id)}
                  >
                    <span className="history-list__name">{imp.original_name}</span>
                    <span className="history-list__meta">
                      {imp.row_count} rows · {new Date(imp.created_at).toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel-card">
          <h2 className="panel-card__heading">Details</h2>
          {selectedImport ? (
            <dl className="meta-list">
              <dt>Filename</dt>
              <dd>{selectedImport.original_name}</dd>
              <dt>Imported</dt>
              <dd>{new Date(selectedImport.created_at).toLocaleString()}</dd>
              <dt>Status</dt>
              <dd>{selectedImport.status}</dd>
              <dt>Rows</dt>
              <dd>{selectedImport.row_count}</dd>
              <dt>Apps</dt>
              <dd>{apps}</dd>
            </dl>
          ) : (
            <p className="muted">Select an import</p>
          )}
        </section>
      </div>

      {loading && selectedImportId ? <p className="muted">Loading import data…</p> : null}

      {metricsSummary?.metrics ? (
        <section className="panel-card">
          <h2 className="panel-card__heading">Metrics snapshot</h2>
          <DataTable
            columns={[
              { key: 'metric', label: 'Metric' },
              {
                key: 'value',
                label: 'Value',
                align: 'right',
                sortable: true,
                render: (r) => r.format(r.value),
              },
            ]}
            defaultSortKey="value"
            rows={[
              { metric: 'Spend', value: metricsSummary.metrics.total_spend, format: formatCurrency },
              {
                metric: 'Impressions',
                value: metricsSummary.metrics.total_impressions,
                format: (v) => formatNumber(v, 0),
              },
              {
                metric: 'Installs',
                value: metricsSummary.metrics.total_installs,
                format: (v) => formatNumber(v, 0),
              },
            ]}
          />
        </section>
      ) : null}

      {profileColumns.length > 0 ? (
        <section className="panel-card">
          <h2 className="panel-card__heading">Column profile</h2>
          <DataTable
            columns={[
              { key: 'column_name', label: 'Column' },
              { key: 'non_empty', label: 'Filled', align: 'right', sortable: true },
              { key: 'unique_count', label: 'Unique', align: 'right', sortable: true },
            ]}
            defaultSortKey="non_empty"
            rows={profileColumns}
          />
        </section>
      ) : null}

      {rows.length > 0 ? (
        <section className="panel-card">
          <h2 className="panel-card__heading">
            Sample rows ({rows.length} of {rowsTotal})
          </h2>
          <div className="analysis-table-wrap">
            <table className="analysis-table">
              <thead>
                <tr>
                  <th>App</th>
                  <th>#</th>
                  {displayHeaders.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.row_number}>
                    <td>{na(row.app_name)}</td>
                    <td>{row.row_number}</td>
                    {displayHeaders.map((h) => (
                      <td key={h}>{row.data[h] != null && row.data[h] !== '' ? String(row.data[h]) : 'N/A'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}
