import { apiRequest } from './auth'

export interface ProductStock {
  product_id: string
  product_name: string
  total_entries: number
  total_exits: number
  balance: number
}

export interface ProductStockPage {
  items: ProductStock[]
  total: number
  limit: number
  offset: number
}

export interface InventoryMovement {
  id: string
  product_id: string
  product_name: string
  occurred_at: string
  movement_type: 'in' | 'out' | 'reversal'
  quantity: number
  source_type: 'manual' | 'sale'
  source_id: string | null
  reversal_of_id: string | null
  note: string | null
  created_by_user_id: string | null
  created_at: string
  is_reversed: boolean
}

export interface InventoryMovementPage {
  items: InventoryMovement[]
  total: number
  limit: number
  offset: number
}

export interface InventoryMovementResult {
  movement: InventoryMovement
  balance_after: number
  negative_balance_warning: boolean
}

export interface InventoryMovementInput {
  product_id: string
  occurred_at: string
  movement_type: 'in' | 'out'
  quantity: number
  note: string | null
}

export interface InventoryListOptions {
  limit?: number
  offset?: number
  product_id?: string
  include_archived?: boolean
}

function queryString(options: InventoryListOptions): string {
  const query = new URLSearchParams()
  if (options.limit !== undefined) query.set('limit', String(options.limit))
  if (options.offset !== undefined) query.set('offset', String(options.offset))
  if (options.product_id) query.set('product_id', options.product_id)
  if (options.include_archived) query.set('include_archived', 'true')
  return query.size ? `?${query.toString()}` : ''
}

export async function listProductStock(
  options: Omit<InventoryListOptions, 'product_id'> = {},
): Promise<ProductStockPage> {
  const response = await apiRequest(`/inventory/summary${queryString(options)}`)
  return (await response.json()) as ProductStockPage
}

export async function listInventoryMovements(
  options: InventoryListOptions = {},
): Promise<InventoryMovementPage> {
  const response = await apiRequest(`/inventory/movements${queryString(options)}`)
  return (await response.json()) as InventoryMovementPage
}

export async function createInventoryMovement(
  input: InventoryMovementInput,
): Promise<InventoryMovementResult> {
  const response = await apiRequest('/inventory/movements', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return (await response.json()) as InventoryMovementResult
}

export async function reverseInventoryMovement(
  movementId: string,
  reason: string,
): Promise<InventoryMovementResult> {
  const response = await apiRequest(
    `/inventory/movements/${encodeURIComponent(movementId)}/reverse`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  )
  return (await response.json()) as InventoryMovementResult
}
