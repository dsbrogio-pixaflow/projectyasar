export interface User {
  id: string
  full_name: string
  email: string
  role: 'admin' | 'user'
  status: 'active' | 'inactive'
}

export interface Credentials {
  email: string
  password: string
}

export interface RegistrationDetails extends Credentials {
  full_name: string
}

export class ApiError extends Error {
  readonly status: number
  readonly retryAfterSeconds: number | null

  constructor(
    message: string,
    status: number,
    retryAfterSeconds: number | null,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
).replace(/\/+$/, '')
const API_ROOT = `${API_BASE_URL}/api/v1`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getApiErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload) || !('detail' in payload)) return undefined

  const detail = payload.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (isRecord(item) ? item.msg : undefined))
      .filter((message): message is string => typeof message === 'string')
    return messages.length ? messages.join('. ') : undefined
  }
  return undefined
}

export async function apiRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (!response.ok) {
    const payload: unknown = await response.json()
    const retryAfterHeader = response.headers.get('Retry-After')
    const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : NaN
    throw new ApiError(
      getApiErrorMessage(payload) ?? `A solicitação falhou (${response.status}).`,
      response.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    )
  }

  return response
}

export async function register(details: RegistrationDetails): Promise<User> {
  const response = await apiRequest('/auth/register', {
    method: 'POST',
    body: JSON.stringify(details),
  })
  return (await response.json()) as User
}

export async function login(credentials: Credentials): Promise<User> {
  const response = await apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  })
  return (await response.json()) as User
}

export async function getCurrentUser(): Promise<User> {
  const response = await apiRequest('/auth/me')
  return (await response.json()) as User
}

export async function logout(): Promise<void> {
  await apiRequest('/auth/logout', { method: 'POST' })
}
