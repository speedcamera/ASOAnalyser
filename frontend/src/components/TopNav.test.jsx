import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import TopNav, {
  AccountMenuPanel,
  accountDisplayName,
  bindAccountMenuListeners,
  nextAccountMenuOpen,
} from './TopNav'

const clerkState = vi.hoisted(() => ({
  user: {
    fullName: null,
    firstName: 'Ada',
    lastName: 'Lovelace',
    username: 'ada',
    imageUrl: null,
    hasImage: false,
  },
}))

vi.mock('@clerk/react', () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: true, user: clerkState.user }),
  UserAvatar: () => createElement('span', { 'data-user-avatar': 'true' }),
  SignOutButton: ({ children }) => createElement('span', { 'data-sign-out': 'true' }, children),
}))

vi.mock('../context/AppContext', () => ({
  useApp: () => ({ handleUpload() {}, uploading: false }),
}))

function renderNav() {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(TopNav)),
  )
}

describe('account menu', () => {
  it('opens and closes from the trigger, Escape, outside clicks, and navigation', () => {
    expect(nextAccountMenuOpen(false, { type: 'toggle' })).toBe(true)
    expect(nextAccountMenuOpen(true, { type: 'toggle' })).toBe(false)
    expect(nextAccountMenuOpen(true, { type: 'close' })).toBe(false)

    let inside = true
    const root = {
      contains() {
        return inside
      },
    }
    let open = true
    const setOpen = (update) => {
      open = typeof update === 'function' ? update(open) : update
    }
    const events = new EventTarget()
    const release = bindAccountMenuListeners(events, () => root, setOpen)

    events.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter' }))
    expect(open).toBe(true)
    events.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }))
    expect(open).toBe(false)

    open = true
    events.dispatchEvent(new Event('pointerdown'))
    expect(open).toBe(true)
    inside = false
    events.dispatchEvent(new Event('pointerdown'))
    expect(open).toBe(false)

    release()
    open = true
    events.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }))
    expect(open).toBe(true)
  })

  it('links My Profile to /profile and signs out through Clerk', () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ['/'] },
        createElement(AccountMenuPanel, { onClose() {} }),
      ),
    )

    expect(html).toContain('href="/profile"')
    expect(html).toContain('My Profile')
    expect(html).toContain('href="/organisation"')
    expect(html).toContain('Organisation')
    expect(html).toContain('data-sign-out="true"')
    expect(html).toContain('Sign out')
    expect(html).not.toContain('Billing')
  })

  it('shows an avatar and display name when the user has no profile photo', () => {
    expect(clerkState.user.imageUrl).toBeNull()
    expect(clerkState.user.hasImage).toBe(false)
    expect(accountDisplayName(clerkState.user)).toBe('Ada Lovelace')
    expect(accountDisplayName({ imageUrl: null, hasImage: false })).toBe('Account')

    const html = renderNav()

    expect(html).toContain('data-user-avatar="true"')
    expect(html).toContain('Ada Lovelace')
    expect(html).not.toContain('<img')
    expect(html).toContain('aria-expanded="false"')
  })

  it('keeps product navigation and CSV upload beside the closed account menu', () => {
    const html = renderNav()

    expect(html).toContain('href="/"')
    expect(html).toContain('Dashboard')
    expect(html).toContain('href="/campaigns"')
    expect(html).toContain('Campaigns')
    expect(html).toContain('href="/keywords"')
    expect(html).toContain('Keywords')
    expect(html).toContain('href="/history"')
    expect(html).toContain('History')
    expect(html).toContain('Upload CSV')
    expect(html).not.toContain('Sign out')
    expect(html).not.toContain('id="account-menu"')
  })
})
