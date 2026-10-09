import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAuthContext } from '../api'
import { clearAuthTokenGetter, setAuthTokenGetter } from '../auth/apiClient'
import App from '../App'
import { OrganisationOverview, readOrganisationOverview } from './Organisation'

vi.mock('../components/Layout', async () => {
  const { Outlet } = await import('react-router-dom')
  const { createElement: create } = await import('react')
  return {
    default: function LayoutOutlet() {
      return create(Outlet)
    },
  }
})

vi.mock('@clerk/react', () => ({
  UserProfile: () => createElement('div', { 'data-user-profile': 'true' }),
}))

const contextBody = {
  user: { id: 42, email: 'ada@example.com' },
  organisation: { id: 14, name: 'Northwind', role: 'owner' },
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  clearAuthTokenGetter()
  vi.unstubAllGlobals()
})

describe('Organisation overview', () => {
  it('shows the resolved organisation, role, and the signed-in membership', () => {
    const overview = readOrganisationOverview(contextBody)
    const html = renderToStaticMarkup(
      createElement(OrganisationOverview, { status: 'ready', overview, error: '' }),
    )

    expect(overview).toEqual({
      name: 'Northwind',
      role: 'owner',
      email: 'ada@example.com',
    })
    expect(html).toContain('Northwind')
    expect(html).toContain('Owner')
    expect(html).toContain('ada@example.com')
    expect(html).toContain('Your membership')
    expect(html).not.toContain('>14<')
    expect(html).not.toContain('>42<')
    expect(html).not.toContain('only member')
  })

  it('shows loading and API error states', () => {
    const loading = renderToStaticMarkup(
      createElement(OrganisationOverview, { status: 'loading', overview: null, error: '' }),
    )
    const error = renderToStaticMarkup(
      createElement(OrganisationOverview, {
        status: 'error',
        overview: null,
        error: 'The server could not complete this request',
      }),
    )
    const empty = renderToStaticMarkup(
      createElement(OrganisationOverview, { status: 'empty', overview: null, error: '' }),
    )

    expect(loading).toContain('Loading organisation…')
    expect(loading).not.toContain('Northwind')
    expect(error).toContain('The server could not complete this request')
    expect(empty).toContain('Organisation details are not available.')
    expect(readOrganisationOverview({ organisation: { name: 'Named', role: 'guest' } })).toBeNull()
  })

  it('loads context through the authenticated client without an organisation id', async () => {
    setAuthTokenGetter(async () => 'session-token')
    const fetchMock = vi.fn(async () => jsonResponse(contextBody))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchAuthContext()).resolves.toEqual(contextBody)

    const [url, options] = fetchMock.mock.calls[0]
    const headers = new Headers(options.headers)
    expect(url).toBe('/api/auth/context')
    expect(headers.get('Authorization')).toBe('Bearer session-token')
    expect(String(url)).not.toContain('organisationId')
    expect(headers.get('x-organisation-id')).toBeNull()
  })

  it('keeps an unauthenticated context request unsigned', async () => {
    setAuthTokenGetter(async () => null)
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'Unauthorized' }, 401))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchAuthContext()).rejects.toMatchObject({
      message: 'Sign in required',
      status: 401,
    })
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBeNull()
  })

  it('registers /organisation inside the signed-in application routes', () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ['/organisation'] },
        createElement(App),
      ),
    )

    expect(html).toContain('Loading organisation…')
    expect(html).toContain('Organisation')
  })
})
