import { apiRequest } from './auth'

export interface DashboardMonth {
  month: string
  inventory_entries: number
  inventory_exits: number
  units_sold: number
  expenses: string | number
}

export interface DashboardSummary {
  current_stock_balance: number
  months: DashboardMonth[]
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const response = await apiRequest('/dashboard')
  return (await response.json()) as DashboardSummary
}
