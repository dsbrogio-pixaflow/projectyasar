import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPage from './DashboardPage'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('business dashboard', () => {
  it('shows monthly metrics and highlights a negative current stock balance', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(jsonResponse({
      current_stock_balance: -2,
      months: [
        {
          month: '2026-10',
          inventory_entries: 5,
          inventory_exits: 1,
          units_sold: 2,
          expenses: '20.00',
        },
        {
          month: '2026-11',
          inventory_entries: 0,
          inventory_exits: 3,
          units_sold: 0,
          expenses: '1234.56',
        },
      ],
    }))

    render(<DashboardPage />)

    expect(await screen.findByText('Saldo atual total do estoque ativo')).toBeInTheDocument()
    expect(screen.getByText('-2')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'O saldo agregado do estoque está abaixo de zero.',
    )
    expect(screen.getByText('Unidades vendidas')).toBeInTheDocument()
    expect(screen.getByText('R$ 1.234,56')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/v1/dashboard',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('shows API errors instead of a success-shaped empty dashboard', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ detail: 'Dashboard unavailable' }, 503),
    )

    render(<DashboardPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Dashboard unavailable')
    expect(screen.queryByRole('heading', { name: 'Unidades vendidas' }))
      .not.toBeInTheDocument()
  })
})
