import { apiRequest } from './auth'

export interface ExpenseCategory {
  id: string
  name: string
  created_by_user_id: string | null
  created_at: string
  updated_at: string
}

export type ExpenseStatus = 'posted' | 'cancelled'

export interface Expense {
  id: string
  category_id: string
  category_name_snapshot: string
  expense_date: string
  amount: string | number
  status: ExpenseStatus
  cancellation_reason: string | null
  cancelled_at: string | null
  created_by_user_id: string | null
  cancelled_by_user_id: string | null
  created_at: string
}

export interface ExpensePage {
  items: Expense[]
  total: number
  limit: number
  offset: number
}

export interface ExpenseInput {
  category_id: string
  expense_date: string
  amount: string
}

export interface FinancialSummary {
  total_sales: string | number
  total_expenses: string | number
  net_result: string | number
}

export interface ExpenseListOptions {
  q?: string
  status?: ExpenseStatus
  category_id?: string
  limit?: number
  offset?: number
}

export async function listExpenseCategories(): Promise<ExpenseCategory[]> {
  const response = await apiRequest('/expense-categories')
  return (await response.json()) as ExpenseCategory[]
}

export async function createExpenseCategory(name: string): Promise<ExpenseCategory> {
  const response = await apiRequest('/expense-categories', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  return (await response.json()) as ExpenseCategory
}

export async function listExpenses(
  options: ExpenseListOptions = {},
): Promise<ExpensePage> {
  const query = new URLSearchParams()
  if (options.q) query.set('q', options.q)
  if (options.status) query.set('status', options.status)
  if (options.category_id) query.set('category_id', options.category_id)
  if (options.limit !== undefined) query.set('limit', String(options.limit))
  if (options.offset !== undefined) query.set('offset', String(options.offset))
  const suffix = query.size ? `?${query.toString()}` : ''
  const response = await apiRequest(`/expenses${suffix}`)
  return (await response.json()) as ExpensePage
}

export async function createExpense(input: ExpenseInput): Promise<Expense> {
  const response = await apiRequest('/expenses', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return (await response.json()) as Expense
}

export async function cancelExpense(
  expenseId: string,
  reason: string,
): Promise<Expense> {
  const response = await apiRequest(
    `/expenses/${encodeURIComponent(expenseId)}/cancel`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  )
  return (await response.json()) as Expense
}

export async function getFinancialSummary(): Promise<FinancialSummary> {
  const response = await apiRequest('/financial/summary')
  return (await response.json()) as FinancialSummary
}
