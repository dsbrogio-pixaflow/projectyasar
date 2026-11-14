import { apiRequest } from './auth'

export interface Customer {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  delivery_address: string | null
  birthday_day: number | null
  birthday_month: number | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface CustomerInput {
  full_name: string
  email: string | null
  phone: string | null
  delivery_address: string | null
  birthday_day: number | null
  birthday_month: number | null
}

export interface CustomerPage {
  items: Customer[]
  total: number
  limit: number
  offset: number
}

export interface CustomerListOptions {
  q?: string
  include_archived?: boolean
  limit?: number
  offset?: number
}

export async function listCustomers(
  options: CustomerListOptions = {},
): Promise<CustomerPage> {
  const query = new URLSearchParams()
  if (options.q) query.set('q', options.q)
  if (options.include_archived) query.set('include_archived', 'true')
  if (options.limit !== undefined) query.set('limit', String(options.limit))
  if (options.offset !== undefined) query.set('offset', String(options.offset))
  const suffix = query.size ? `?${query.toString()}` : ''
  const response = await apiRequest(`/customers${suffix}`)
  return (await response.json()) as CustomerPage
}

export async function createCustomer(input: CustomerInput): Promise<Customer> {
  const response = await apiRequest('/customers', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return (await response.json()) as Customer
}

export async function updateCustomer(
  id: string,
  input: CustomerInput,
): Promise<Customer> {
  const response = await apiRequest(`/customers/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return (await response.json()) as Customer
}

async function updateCustomerArchive(
  id: string,
  action: 'archive' | 'restore',
): Promise<Customer> {
  const response = await apiRequest(
    `/customers/${encodeURIComponent(id)}/${action}`,
    { method: 'POST' },
  )
  return (await response.json()) as Customer
}

export function archiveCustomer(id: string): Promise<Customer> {
  return updateCustomerArchive(id, 'archive')
}

export function restoreCustomer(id: string): Promise<Customer> {
  return updateCustomerArchive(id, 'restore')
}
