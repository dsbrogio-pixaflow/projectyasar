import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('API base URL', () => {
  it('uses a same-origin API URL in production by default', async () => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_API_BASE_URL', undefined)
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))

    const { apiRequest } = await import('./auth')
    await apiRequest('/auth/me')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/me',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('keeps the local API default outside production', async () => {
    vi.stubEnv('PROD', false)
    vi.stubEnv('VITE_API_BASE_URL', undefined)
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))

    const { apiRequest } = await import('./auth')
    await apiRequest('/auth/me')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/v1/auth/me',
      expect.objectContaining({ credentials: 'include' }),
    )
  })
})
