import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FinancePage from './FinancePage'
import type { Expense, ExpenseCategory, ExpensePage } from './services/finance'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const category: ExpenseCategory = {
  id: 'category-1',
  name: 'Aluguel',
  created_by_user_id: 'user-1',
  created_at: '2026-11-14T12:00:00Z',
  updated_at: '2026-11-14T12:00:00Z',
}

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'expense-1',
    category_id: category.id,
    category_name_snapshot: category.name,
    expense_date: '2026-11-14',
    amount: '12.30',
    status: 'posted',
    cancellation_reason: null,
    cancelled_at: null,
    created_by_user_id: 'user-1',
    cancelled_by_user_id: null,
    created_at: '2026-11-14T12:00:00Z',
    ...overrides,
  }
}

function expensePage(items: Expense[]): ExpensePage {
  return { items, total: items.length, limit: 20, offset: 0 }
}

function financialSummary() {
  return { total_sales: '100.00', total_expenses: '12.30', net_result: '87.70' }
}

function mockInitialRequests(
  items: Expense[] = [],
  categories: ExpenseCategory[] = [category],
) {
  vi.mocked(fetch)
    .mockResolvedValueOnce(jsonResponse(categories))
    .mockResolvedValueOnce(jsonResponse(expensePage(items)))
    .mockResolvedValueOnce(jsonResponse(financialSummary()))
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('finance management', () => {
  it('displays totals and records an expense using a decimal comma', async () => {
    const fetchMock = vi.mocked(fetch)
    mockInitialRequests()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(expense()))
      .mockResolvedValueOnce(jsonResponse(expensePage([expense()])))
      .mockResolvedValueOnce(jsonResponse(financialSummary()))
    const user = userEvent.setup()

    render(<FinancePage />)
    expect(await screen.findByText('R$ 87,70')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Valor (R$) *'), '12,3')
    await user.click(screen.getByRole('button', { name: 'Registrar pagamento' }))

    expect(await screen.findByText('Lançamento financeiro registrado.')).toBeInTheDocument()
    const [url, options] = fetchMock.mock.calls[3]
    expect(url).toBe('http://127.0.0.1:8000/api/v1/expenses')
    expect(options).toEqual(expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }))
    expect(JSON.parse(String(options?.body))).toEqual({
      category_id: category.id,
      expense_date: expect.any(String),
      amount: '12.30',
    })
  })

  it('adds a category and selects it for new expenses', async () => {
    const fetchMock = vi.mocked(fetch)
    mockInitialRequests([], [])
    fetchMock
      .mockResolvedValueOnce(jsonResponse(category, 201))
    const user = userEvent.setup()

    render(<FinancePage />)
    await user.type(screen.getByLabelText('Adicionar categoria'), 'Aluguel')
    await user.click(screen.getByRole('button', { name: 'Adicionar' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Categoria adicionada.')
    expect(screen.getByLabelText('Categoria *')).toHaveValue(category.id)
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'http://127.0.0.1:8000/api/v1/expense-categories',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Aluguel' }),
      }),
    )
  })

  it('cancels an expense with a reason and shows the preserved record', async () => {
    const fetchMock = vi.mocked(fetch)
    const cancelled = expense({
      status: 'cancelled',
      cancellation_reason: 'Lançamento duplicado',
      cancelled_at: '2026-11-15T12:00:00Z',
      cancelled_by_user_id: 'user-1',
    })
    mockInitialRequests([expense()])
    fetchMock
      .mockResolvedValueOnce(jsonResponse(cancelled))
      .mockResolvedValueOnce(jsonResponse(expensePage([cancelled])))
      .mockResolvedValueOnce(jsonResponse(financialSummary()))
    vi.spyOn(window, 'prompt').mockReturnValue('Lançamento duplicado')
    const user = userEvent.setup()

    render(<FinancePage />)
    await user.click(
      await screen.findByRole('button', { name: 'Cancelar lançamento de Aluguel' }),
    )

    expect(await screen.findByText(/Motivo: Lançamento duplicado/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancelar lançamento de Aluguel' }))
      .not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'http://127.0.0.1:8000/api/v1/expenses/expense-1/cancel',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'Lançamento duplicado' }),
      }),
    )
  })
})
