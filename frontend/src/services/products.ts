import { apiRequest } from './auth'

export interface Product {
  id: string
  name: string
  current_price: string | number
  image_url: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface ProductInput {
  name: string
  current_price: string
  image_url: string | null
}

export interface ProductPage {
  items: Product[]
  total: number
  limit: number
  offset: number
}

export interface ProductListOptions {
  q?: string
  include_archived?: boolean
  limit?: number
  offset?: number
}

export async function listProducts(
  options: ProductListOptions = {},
): Promise<ProductPage> {
  const query = new URLSearchParams()
  if (options.q) query.set('q', options.q)
  if (options.include_archived) query.set('include_archived', 'true')
  if (options.limit !== undefined) query.set('limit', String(options.limit))
  if (options.offset !== undefined) query.set('offset', String(options.offset))
  const suffix = query.size ? `?${query.toString()}` : ''
  const response = await apiRequest(`/products${suffix}`)
  return (await response.json()) as ProductPage
}

export async function createProduct(input: ProductInput): Promise<Product> {
  const response = await apiRequest('/products', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return (await response.json()) as Product
}

export async function updateProduct(
  id: string,
  input: ProductInput,
): Promise<Product> {
  const response = await apiRequest(`/products/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return (await response.json()) as Product
}

async function updateProductArchive(
  id: string,
  action: 'archive' | 'restore',
): Promise<Product> {
  const response = await apiRequest(
    `/products/${encodeURIComponent(id)}/${action}`,
    { method: 'POST' },
  )
  return (await response.json()) as Product
}

export function archiveProduct(id: string): Promise<Product> {
  return updateProductArchive(id, 'archive')
}

export function restoreProduct(id: string): Promise<Product> {
  return updateProductArchive(id, 'restore')
}
