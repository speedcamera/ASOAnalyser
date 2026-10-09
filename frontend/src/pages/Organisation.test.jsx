import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAuthContext, updateOrganisationName } from '../api'
import { clearAuthTokenGetter, setAuthTokenGetter } from '../auth/apiClient'
import App from '../App'
import {
  OrganisationOverview,
  applyOrganisationRename,
  readOrganisationOverview,
} from './Organisation'

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
    expect(html).toContain('Edit name')
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

  it('shows Edit name only for an owner, and Save and Cancel while editing', () => {
    const owner = readOrganisationOverview(contextBody)
    const admin = { ...owner, role: 'admin' }
    const analyst = { ...owner, role: 'analyst' }
    const ownerHtml = renderToStaticMarkup(
      createElement(OrganisationOverview, { status: 'ready', overview: owner, error: '' }),
    )
    const adminHtml = renderToStaticMarkup(
      createElement(OrganisationOverview, { status: 'ready', overview: admin, error: '' }),
    )
    const analystHtml = renderToStaticMarkup(
      createElement(OrganisationOverview, { status: 'ready', overview: analyst, error: '' }),
    )
    const editingHtml = renderToStaticMarkup(
      createElement(OrganisationOverview, {
        status: 'ready',
        overview: owner,
        error: '',
        editing: true,
        draftName: 'Northwind',
      }),
    )

    expect(ownerHtml).toContain('Edit name')
    expect(adminHtml).not.toContain('Edit name')
    expect(analystHtml).not.toContain('Edit name')
    expect(editingHtml).toContain('Save')
    expect(editingHtml).toContain('Cancel')
    expect(editingHtml).toContain('value="Northwind"')
    expect(editingHtml).not.toContain('Edit name')
  })

  it('shows a saved confirmation and an API error on the form', () => {
    const overview = readOrganisationOverview(contextBody)
    const saved = renderToStaticMarkup(
      createElement(OrganisationOverview, {
        status: 'ready',
        overview: { ...overview, name: 'Renamed' },
        error: '',
        saveMessage: 'Organisation name saved.',
      }),
    )
    const failed = renderToStaticMarkup(
      createElement(OrganisationOverview, {
        status: 'ready',
        overview,
        error: '',
        editing: true,
        draftName: 'Renamed',
        saveError: 'Organisation name is required',
      }),
    )

    expect(saved).toContain('Renamed')
    expect(saved).toContain('Organisation name saved.')
    expect(failed).toContain('Organisation name is required')
    expect(failed).toContain('Save')
    expect(failed).toContain('Cancel')
  })

  it('saves the name through the authenticated client and refreshes context', async () => {
    setAuthTokenGetter(async () => 'session-token')
    const savedBody = {
      organisation: { id: 14, name: 'Renamed', role: 'owner' },
    }
    const refreshed = {
      ...contextBody,
      organisation: { ...contextBody.organisation, name: 'Renamed' },
    }
    const fetchMock = vi.fn(async (url) => {
      if (url === '/api/auth/organisation') return jsonResponse(savedBody)
      return jsonResponse(refreshed)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await applyOrganisationRename('  Renamed  ')

    expect(result.overview).toEqual({
      name: 'Renamed',
      role: 'owner',
      email: 'ada@example.com',
    })
    const [patchUrl, patchOptions] = fetchMock.mock.calls[0]
    const headers = new Headers(patchOptions.headers)
    expect(patchUrl).toBe('/api/auth/organisation')
    expect(patchOptions.method).toBe('PATCH')
    expect(JSON.parse(patchOptions.body)).toEqual({ name: '  Renamed  ' })
    expect(headers.get('Authorization')).toBe('Bearer session-token')
    expect(headers.get('x-organisation-id')).toBeNull()
    expect(String(patchUrl)).not.toContain('organisationId')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/context')
  })

  it('reports validation, permission, and network failures without renaming locally', async () => {
    setAuthTokenGetter(async () => 'session-token')
    const validation = vi.fn(async () =>
      jsonResponse({ error: 'Organisation name is required' }, 400),
    )
    vi.stubGlobal('fetch', validation)
    await expect(updateOrganisationName('   ')).rejects.toMatchObject({
      message: 'Organisation name is required',
      status: 400,
    })

    const forbidden = vi.fn(async () =>
      jsonResponse({ error: 'You do not have access to this' }, 403),
    )
    vi.stubGlobal('fetch', forbidden)
    await expect(updateOrganisationName('Renamed')).rejects.toMatchObject({
      message: 'You do not have access to this',
      status: 403,
    })

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))
    await expect(updateOrganisationName('Renamed')).rejects.toThrow('Failed to fetch')
  })
})
