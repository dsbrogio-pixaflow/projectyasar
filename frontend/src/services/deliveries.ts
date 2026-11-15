import { apiRequest } from './auth'

export type DeliveryStatus =
  | 'pending'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'

export interface Delivery {
  sale_id: string
  customer_name: string
  delivery_address_snapshot: string | null
  delivery_method_name: string
  sold_at: string
  sale_status: 'completed' | 'cancelled'
  status: DeliveryStatus
  tracking_code: string | null
  updated_at: string
}

export interface DeliveryPage {
  items: Delivery[]
  total: number
  limit: number
  offset: number
}

export interface DeliveryListOptions {
  q?: string
  status?: DeliveryStatus
  limit?: number
  offset?: number
}

export interface DeliveryUpdate {
  status?: DeliveryStatus
  tracking_code?: string | null
}

export async function listDeliveries(
  options: DeliveryListOptions = {},
): Promise<DeliveryPage> {
  const query = new URLSearchParams()
  if (options.q) query.set('q', options.q)
  if (options.status) query.set('status', options.status)
  if (options.limit !== undefined) query.set('limit', String(options.limit))
  if (options.offset !== undefined) query.set('offset', String(options.offset))
  const suffix = query.size ? `?${query.toString()}` : ''
  const response = await apiRequest(`/deliveries${suffix}`)
  return (await response.json()) as DeliveryPage
}

export async function updateDelivery(
  saleId: string,
  input: DeliveryUpdate,
): Promise<Delivery> {
  const response = await apiRequest(
    `/deliveries/${encodeURIComponent(saleId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  )
  return (await response.json()) as Delivery
}
