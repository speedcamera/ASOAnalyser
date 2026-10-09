import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { SignOutButton, UserAvatar, useUser } from '@clerk/react'
import { useApp } from '../context/AppContext'

const LINKS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/campaigns', label: 'Campaigns' },
  { to: '/keywords', label: 'Keywords' },
  { to: '/history', label: 'History' },
]

export function accountDisplayName(user) {
  const fullName = user?.fullName?.trim()
  if (fullName) return fullName
  const givenName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
  if (givenName) return givenName
  const username = user?.username?.trim()
  if (username) return username
  return 'Account'
}

export function nextAccountMenuOpen(open, action) {
  if (action.type === 'toggle') return !open
  if (action.type === 'close') return false
  if (!open) return open
  if (action.type === 'keydown') return action.key === 'Escape' ? false : open
  if (action.type === 'pointer') {
    if (action.root?.contains(action.target)) return open
    return false
  }
  return open
}

function closeAccountMenu(setOpen) {
  setOpen((open) => nextAccountMenuOpen(open, { type: 'close' }))
}

export function bindAccountMenuListeners(target, getRoot, setOpen) {
  function onKeyDown(event) {
    setOpen((current) => nextAccountMenuOpen(current, { type: 'keydown', key: event.key }))
  }

  function onPointerDown(event) {
    setOpen((current) =>
      nextAccountMenuOpen(current, {
        type: 'pointer',
        target: event.target,
        root: getRoot(),
      }),
    )
  }

  target.addEventListener('keydown', onKeyDown)
  target.addEventListener('pointerdown', onPointerDown)
  return () => {
    target.removeEventListener('keydown', onKeyDown)
    target.removeEventListener('pointerdown', onPointerDown)
  }
}

export function AccountMenuPanel({ onClose }) {
  return (
    <div id="account-menu" className="account-menu__panel">
      <NavLink
        to="/profile"
        className={({ isActive }) =>
          `account-menu__item${isActive ? ' account-menu__item--active' : ''}`
        }
        onClick={onClose}
      >
        My Profile
      </NavLink>
      <SignOutButton>
        <button type="button" className="account-menu__item" onClick={onClose}>
          Sign out
        </button>
      </SignOutButton>
    </div>
  )
}

function AccountMenu() {
  const { user } = useUser()
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const displayName = accountDisplayName(user)

  useEffect(() => {
    if (!open) return undefined
    return bindAccountMenuListeners(document, () => rootRef.current, setOpen)
  }, [open])

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        type="button"
        className="account-menu__trigger"
        aria-expanded={open}
        aria-controls={open ? 'account-menu' : undefined}
        onClick={() => setOpen((current) => nextAccountMenuOpen(current, { type: 'toggle' }))}
      >
        <span className="account-menu__avatar">
          <UserAvatar rounded />
        </span>
        <span className="account-menu__name">{displayName}</span>
      </button>
      {open ? <AccountMenuPanel onClose={() => closeAccountMenu(setOpen)} /> : null}
    </div>
  )
}

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
          <AccountMenu />
        </div>
      </div>
    </header>
  )
}
