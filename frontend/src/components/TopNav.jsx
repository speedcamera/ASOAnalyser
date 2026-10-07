import { NavLink } from 'react-router-dom'
import { useRef } from 'react'
import { SignOutButton } from '@clerk/react'
import { useApp } from '../context/AppContext'

const LINKS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/campaigns', label: 'Campaigns' },
  { to: '/keywords', label: 'Keywords' },
  { to: '/history', label: 'History' },
]

export default function TopNav() {
  const fileRef = useRef(null)
  const { handleUpload, uploading } = useApp()

  return (
    <header className="topbar">
      <div className="topbar__inner">
        <NavLink to="/" className="topbar__brand">
          <span className="topbar__logo" aria-hidden />
          <span className="topbar__name">Delm8 Ads Analyser</span>
        </NavLink>

        <nav className="topbar__nav" aria-label="Main">
          {LINKS.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `topbar__link ${isActive ? 'topbar__link--active' : ''}`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="topbar__actions">
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
          <SignOutButton>
            <button type="button" className="btn btn--ghost">
              Sign out
            </button>
          </SignOutButton>
        </div>
      </div>
    </header>
  )
}
