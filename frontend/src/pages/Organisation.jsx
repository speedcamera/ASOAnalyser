import { useEffect, useState } from 'react'
import { fetchAuthContext, updateOrganisationName } from '../api'

export const ORGANISATION_NAME_MAX = 200

const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  analyst: 'Analyst',
}

export function readOrganisationOverview(body) {
  const name = typeof body?.organisation?.name === 'string' ? body.organisation.name.trim() : ''
  const role = typeof body?.organisation?.role === 'string' ? body.organisation.role.trim() : ''
  const email = typeof body?.user?.email === 'string' ? body.user.email.trim() : ''
  if (!name || !ROLE_LABELS[role]) return null
  return { name, role, email }
}

export function organisationRoleLabel(role) {
  return ROLE_LABELS[role] || ''
}

export async function applyOrganisationRename(name) {
  const saved = await updateOrganisationName(name)
  try {
    return { saved, overview: readOrganisationOverview(await fetchAuthContext()) }
  } catch {
    return { saved, overview: null }
  }
}

export function OrganisationOverview({
  status,
  overview,
  error,
  editing = false,
  draftName = '',
  saving = false,
  saveError = '',
  saveMessage = '',
  onStartEdit,
  onDraftChange,
  onCancel,
  onSubmit,
}) {
  return (
    <div className="content-shell">
      <section className="panel-card" aria-busy={status === 'loading'}>
        <h1 className="panel-card__title">Organisation</h1>
        <p className="panel-card__subtitle">
          The organisation resolved for your account, and your membership in it.
        </p>

        {status === 'loading' ? <p className="analysis-empty">Loading organisation…</p> : null}
        {status === 'error' ? (
          <p className="analysis-empty">{error || 'Organisation could not be loaded'}</p>
        ) : null}
        {status === 'empty' ? (
          <p className="analysis-empty">Organisation details are not available.</p>
        ) : null}
        {status === 'ready' && overview ? (
          <>
            <h2 className="panel-card__heading">Your membership</h2>
            <dl className="organisation-overview">
              <div className="organisation-overview__item">
                <dt>Organisation</dt>
                {editing ? (
                  <form className="organisation-rename" onSubmit={onSubmit}>
                    <label className="filter-field__label" htmlFor="organisation-name">
                      Organisation name
                    </label>
                    <input
                      id="organisation-name"
                      className="filter-input organisation-rename__input"
                      value={draftName}
                      maxLength={ORGANISATION_NAME_MAX}
                      disabled={saving}
                      onChange={(event) => onDraftChange(event.target.value)}
                    />
                    <div className="organisation-rename__actions">
                      <button type="submit" className="btn btn--upload" disabled={saving}>
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={saving}
                        onClick={onCancel}
                      >
                        Cancel
                      </button>
                    </div>
                    {saveError ? <p className="analysis-empty">{saveError}</p> : null}
                  </form>
                ) : (
                  <>
                    <dd>{overview.name}</dd>
                    {overview.role === 'owner' ? (
                      <button type="button" className="btn btn--ghost" onClick={onStartEdit}>
                        Edit name
                      </button>
                    ) : null}
                  </>
                )}
              </div>
              <div className="organisation-overview__item">
                <dt>Your role</dt>
                <dd>{organisationRoleLabel(overview.role)}</dd>
              </div>
              <div className="organisation-overview__item">
                <dt>Your email</dt>
                <dd>{overview.email || 'Not available'}</dd>
              </div>
            </dl>
            {saveMessage ? (
              <p className="organisation-saved" role="status">
                {saveMessage}
              </p>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  )
}

export default function Organisation() {
  const [status, setStatus] = useState('loading')
  const [overview, setOverview] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')

  useEffect(() => {
    let cancelled = false

    fetchAuthContext()
      .then((body) => {
        if (cancelled) return
        const next = readOrganisationOverview(body)
        setOverview(next)
        setError('')
        setStatus(next ? 'ready' : 'empty')
      })
      .catch((err) => {
        if (cancelled) return
        setOverview(null)
        setError(err instanceof Error ? err.message : 'Organisation could not be loaded')
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [])

  function startEdit() {
    setDraftName(overview?.name || '')
    setSaveError('')
    setSaveMessage('')
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setDraftName('')
    setSaveError('')
  }

  async function saveEdit(event) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setSaveError('')
    setSaveMessage('')
    try {
      const result = await applyOrganisationRename(draftName)
      const refreshed = result.overview
      const savedName =
        typeof result.saved?.organisation?.name === 'string' ? result.saved.organisation.name : ''
      if (refreshed) {
        setOverview(refreshed)
      } else if (savedName) {
        setOverview((current) => (current ? { ...current, name: savedName } : current))
      }
      setEditing(false)
      setDraftName('')
      setSaveMessage('Organisation name saved.')
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Organisation name could not be saved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <OrganisationOverview
      status={status}
      overview={overview}
      error={error}
      editing={editing}
      draftName={draftName}
      saving={saving}
      saveError={saveError}
      saveMessage={saveMessage}
      onStartEdit={startEdit}
      onDraftChange={setDraftName}
      onCancel={cancelEdit}
      onSubmit={saveEdit}
    />
  )
}
