import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import Profile from './Profile'

vi.mock('@clerk/react', () => ({
  UserProfile: (props) =>
    createElement('div', {
      'data-user-profile': 'true',
      'data-routing': props.routing ?? '',
      'data-path': props.path ?? '',
      'data-hide-api-keys': String(Boolean(props.apiKeysProps?.hide)),
      'data-color-primary': props.appearance?.variables?.colorPrimary ?? '',
    }),
}))

vi.mock('../components/Layout', async () => {
  const { Outlet } = await import('react-router-dom')
  const { createElement: create } = await import('react')
  return {
    default: function LayoutOutlet() {
      return create(Outlet)
    },
  }
})

function renderAt(entry) {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [entry] }, createElement(App)),
  )
}

describe('My Profile page', () => {
  it('renders Clerk UserProfile with hash routing and API keys hidden', () => {
    const html = renderToStaticMarkup(createElement(Profile))

    expect(html).toContain('My Profile')
    expect(html).toContain('data-user-profile="true"')
    expect(html).toContain('data-routing="hash"')
    expect(html).toContain('data-path=""')
    expect(html).toContain('data-hide-api-keys="true"')
    expect(html).toContain('data-color-primary="#5b4fd6"')
  })

  it('keeps hash profile sections on /profile instead of the dashboard', () => {
    const html = renderAt('/profile#/security')

    expect(html).toContain('My Profile')
    expect(html).toContain('data-routing="hash"')
    expect(html).not.toContain('Dashboard')
  })

  it('registers /profile before unknown paths fall through', () => {
    const html = renderAt('/profile')

    expect(html).toContain('My Profile')
    expect(html).toContain('data-user-profile="true"')
  })
})
