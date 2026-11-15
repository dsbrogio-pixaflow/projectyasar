import { apiRequest } from './auth'

export type AdminUserRole = 'admin' | 'user'
export type AdminUserStatus = 'active' | 'inactive'

export interface AdminUser {
  id: string
  full_name: string
  email: string
  role: AdminUserRole
  status: AdminUserStatus
  created_at: string
}

export interface AdminUserPage {
  items: AdminUser[]
  total: number
  limit: number
  offset: number
}

export interface AdminUserFilters {
  q?: string
  role?: AdminUserRole
  status?: AdminUserStatus
  limit: number
  offset: number
}

export interface AdminUserUpdate {
  full_name?: string
  email?: string
  role?: AdminUserRole
  status?: AdminUserStatus
}

export async function listAdminUsers(
  filters: AdminUserFilters,
): Promise<AdminUserPage> {
  const params = new URLSearchParams({
    limit: String(filters.limit),
    offset: String(filters.offset),
  })
  if (filters.q) params.set('q', filters.q)
  if (filters.role) params.set('role', filters.role)
  if (filters.status) params.set('status', filters.status)
  const response = await apiRequest(`/admin/users?${params.toString()}`)
  return (await response.json()) as AdminUserPage
}

export async function updateAdminUser(
  userId: string,
  input: AdminUserUpdate,
): Promise<AdminUser> {
  const response = await apiRequest(`/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
  return (await response.json()) as AdminUser
}

export async function deleteAdminUser(
  userId: string,
  confirmEmail: string,
): Promise<void> {
  await apiRequest(`/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ confirm_email: confirmEmail }),
  })
}
