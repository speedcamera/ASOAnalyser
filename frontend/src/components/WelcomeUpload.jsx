import { useRef } from 'react'
import { useApp } from '../context/AppContext'
import { MAX_CSV_FILE_SIZE_MB, MAX_CSV_ROWS } from '../uploadLimits'

export default function WelcomeUpload() {
  const fileRef = useRef(null)
  const { handleUpload, uploading } = useApp()

  return (
    <section className="panel-card welcome-upload">
      <h1 className="panel-card__title">Welcome to Delm8 Ads Analyser</h1>
      <p className="panel-card__subtitle">
        Upload your Apple Search Ads report to start analysing your campaigns and keywords.
      </p>
      <p className="welcome-upload__limits">
        CSV files up to {MAX_CSV_FILE_SIZE_MB} MB and {MAX_CSV_ROWS.toLocaleString('en-GB')} rows.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".csv"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) handleUpload(file)
          event.target.value = ''
        }}
      />
      <button
        type="button"
        className="btn btn--upload"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
      >
        {uploading ? 'Uploading…' : 'Upload Apple Ads CSV'}
      </button>
    </section>
  )
}
