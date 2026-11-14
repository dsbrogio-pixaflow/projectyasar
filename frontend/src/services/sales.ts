import { apiRequest } from './auth'

export interface DeliveryMethod {
  id: string
  name: string
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface SaleItem {
  id: string
  product_id: string
  line_number: number
  product_name_snapshot: string
  quantity: number
  unit_price: string | number
  line_total: string | number
}

export interface Sale {
  id: string
  customer_id: string
  customer_name_snapshot: string
  delivery_address_snapshot: string | null
  delivery_method_id: string
  delivery_method_name_snapshot: string
  sold_at: string
  status: 'completed' | 'cancelled'
  total_amount: string | number
  cancellation_reason: string | null
  cancelled_at: string | null
  created_by_user_id: string | null
  cancelled_by_user_id: string | null
  created_at: string
  items: SaleItem[]
}

export interface SaleInputItem {
  product_id: string
  quantity: number
  unit_price: string
}

export interface SaleInput {
  customer_id: string
  delivery_method_id: string
  sold_at: string
  items: SaleInputItem[]
}

export interface SalesPage {
  items: Sale[]
  total: number
  limit: number
  offset: number
}

export interface SalesSummary {
  product_id: string
  product_name: string
  quantity_sold: number
  total_sold: string | number
}

export interface SalesListOptions {
  q?: string
  status?: 'completed' | 'cancelled'
  limit?: number
  offset?: number
}

export async function listDeliveryMethods(): Promise<DeliveryMethod[]> {
  const response = await apiRequest('/delivery-methods')
  return (await response.json()) as DeliveryMethod[]
}

export async function createDeliveryMethod(name: string): Promise<DeliveryMethod> {
  const response = await apiRequest('/delivery-methods', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  return (await response.json()) as DeliveryMethod
}

export async function listSales(
  options: SalesListOptions = {},
): Promise<SalesPage> {
  const query = new URLSearchParams()
  if (options.q) query.set('q', options.q)
  if (options.status) query.set('status', options.status)
  if (options.limit !== undefined) query.set('limit', String(options.limit))
  if (options.offset !== undefined) query.set('offset', String(options.offset))
  const suffix = query.size ? `?${query.toString()}` : ''
  const response = await apiRequest(`/sales${suffix}`)
  return (await response.json()) as SalesPage
}

export async function getSalesSummary(): Promise<SalesSummary[]> {
  const response = await apiRequest('/sales/summary')
  return (await response.json()) as SalesSummary[]
}

export async function createSale(input: SaleInput): Promise<Sale> {
  const response = await apiRequest('/sales', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return (await response.json()) as Sale
}

export async function cancelSale(saleId: string, reason: string): Promise<Sale> {
  const response = await apiRequest(
    `/sales/${encodeURIComponent(saleId)}/cancel`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  )
  return (await response.json()) as Sale
}
