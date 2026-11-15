import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DeliveriesPage from './DeliveriesPage'
import type { Delivery, DeliveryPage } from './services/deliveries'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function delivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    sale_id: 'sale-1',
    customer_name: 'Maria Silva',
    delivery_address_snapshot: 'Rua das Flores, 123',
    delivery_method_name: 'Sedex',
    sold_at: '2026-11-14',
    sale_status: 'completed',
    status: 'pending',
    tracking_code: null,
    updated_at: '2026-11-14T12:00:00Z',
    ...overrides,
  }
}

function deliveryPage(items: Delivery[]): DeliveryPage {
  return { items, total: items.length, limit: 20, offset: 0 }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('delivery tracking', () => {
  it('allows direct status selection and refreshes the selected status filter', async () => {
    const fetchMock = vi.mocked(fetch)
    const current = delivery()
    const updated = delivery({ status: 'delivered' })
    fetchMock
      .mockResolvedValueOnce(jsonResponse(deliveryPage([current])))
      .mockResolvedValueOnce(jsonResponse(updated))
      .mockResolvedValueOnce(jsonResponse(deliveryPage([updated])))
    const user = userEvent.setup()

    render(<DeliveriesPage />)
    await screen.findByText('Maria Silva')
    await user.selectOptions(screen.getByLabelText('Status da entrega'), 'delivered')

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Entrega de Maria Silva atualizada para Entregue.',
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8000/api/v1/deliveries/sale-1',
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify({ status: 'delivered' }),
      }),
    )
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8000/api/v1/deliveries?limit=20&offset=0',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(screen.getByLabelText('Status da entrega')).toHaveValue('delivered')
  })

  it('saves and clears an optional tracking code', async () => {
    const fetchMock = vi.mocked(fetch)
    const current = delivery()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(deliveryPage([current])))
      .mockResolvedValueOnce(jsonResponse(delivery({
        tracking_code: 'BR123456789',
      })))
    const user = userEvent.setup()

    render(<DeliveriesPage />)
    await screen.findByText('Maria Silva')
    await user.type(screen.getByLabelText('Código de rastreio'), ' BR123456789 ')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Código de rastreio da venda de Maria Silva salvo.',
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8000/api/v1/deliveries/sale-1',
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify({ tracking_code: 'BR123456789' }),
      }),
    )
    expect(screen.getByLabelText('Código de rastreio')).toHaveValue('BR123456789')
  })

  it('keeps cancelled sales read-only in delivery tracking', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(deliveryPage([
      delivery({ sale_status: 'cancelled', status: 'cancelled' }),
    ])))

    render(<DeliveriesPage />)
    await screen.findByText('Maria Silva')

    expect(screen.getByLabelText('Status da entrega')).toBeDisabled()
    expect(screen.getByLabelText('Código de rastreio')).toBeDisabled()
  })
})
