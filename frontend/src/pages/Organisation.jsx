import { useEffect, useState } from 'react'
import { fetchAuthContext } from '../api'

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

export function OrganisationOverview({ status, overview, error }) {
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
                <dd>{overview.name}</dd>
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

  return <OrganisationOverview status={status} overview={overview} error={error} />
}
