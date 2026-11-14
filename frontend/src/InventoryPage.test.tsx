import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InventoryPage from './InventoryPage'
import type {
  InventoryMovement,
  InventoryMovementPage,
  InventoryMovementResult,
  ProductStockPage,
} from './services/inventory'
import type { Product, ProductPage } from './services/products'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    name: 'Camiseta Yasar',
    current_price: '89.90',
    image_url: null,
    archived_at: null,
    created_at: '2026-11-14T12:00:00Z',
    updated_at: '2026-11-14T12:00:00Z',
    ...overrides,
  }
}

function movement(overrides: Partial<InventoryMovement> = {}): InventoryMovement {
  return {
    id: 'movement-1',
    product_id: 'product-1',
    product_name: 'Camiseta Yasar',
    occurred_at: '2026-11-14',
    movement_type: 'out',
    quantity: 2,
    source_type: 'manual',
    source_id: null,
    reversal_of_id: null,
    note: null,
    created_by_user_id: 'user-1',
    created_at: '2026-11-14T12:00:00Z',
    is_reversed: false,
    ...overrides,
  }
}

function stockPage(items: ProductStockPage['items'] = []): ProductStockPage {
  return { items, total: items.length, limit: 50, offset: 0 }
}

function movementPage(items: InventoryMovement[] = []): InventoryMovementPage {
  return { items, total: items.length, limit: 20, offset: 0 }
}

function productPage(items: Product[]): ProductPage {
  return { items, total: items.length, limit: 100, offset: 0 }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('inventory management', () => {
  it('allows an outgoing movement below zero and clearly flags the resulting balance', async () => {
    const fetchMock = vi.mocked(fetch)
    const savedMovement = movement()
    const result: InventoryMovementResult = {
      movement: savedMovement,
      balance_after: -2,
      negative_balance_warning: true,
    }
    fetchMock
      .mockResolvedValueOnce(jsonResponse(stockPage()))
      .mockResolvedValueOnce(jsonResponse(movementPage()))
      .mockResolvedValueOnce(jsonResponse(productPage([product()])))
      .mockResolvedValueOnce(jsonResponse(stockPage([{
        product_id: 'product-1',
        product_name: 'Camiseta Yasar',
        total_entries: 0,
        total_exits: 0,
        balance: 0,
      }])))
      .mockResolvedValueOnce(jsonResponse(result, 201))
      .mockResolvedValueOnce(jsonResponse(stockPage([
        {
          product_id: 'product-1',
          product_name: 'Camiseta Yasar',
          total_entries: 0,
          total_exits: 2,
          balance: -2,
        },
      ])))
      .mockResolvedValueOnce(jsonResponse(movementPage([savedMovement])))
    const user = userEvent.setup()

    render(<InventoryPage />)
    await within(screen.getByLabelText('Produto *')).findByRole('option', {
      name: 'Camiseta Yasar',
    })
    await user.selectOptions(screen.getByLabelText('Tipo *'), 'out')
    await user.type(screen.getByLabelText('Quantidade *'), '2')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Esta saída deixará o saldo de Camiseta Yasar negativo (-2). A saída continua permitida.',
    )
    expect(screen.getByRole('button', { name: 'Registrar movimentação' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Registrar movimentação' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Atenção: o saldo de Camiseta Yasar ficou negativo (-2).',
    )
    const movementRequest = fetchMock.mock.calls[4]
    expect(movementRequest[0]).toBe('http://127.0.0.1:8000/api/v1/inventory/movements')
    expect(movementRequest[1]).toEqual(expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }))
    const requestBody = JSON.parse(String(movementRequest[1]?.body))
    expect(requestBody).toEqual({
      product_id: 'product-1',
      occurred_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      movement_type: 'out',
      quantity: 2,
      note: null,
    })
    expect(await screen.findByText('Saldo negativo')).toBeInTheDocument()
  })

  it('reverses a manual movement only after collecting a reason', async () => {
    const fetchMock = vi.mocked(fetch)
    const original = movement()
    const reversed = movement({
      id: 'movement-2',
      movement_type: 'reversal',
      reversal_of_id: 'movement-1',
      note: 'Contagem corrigida',
    })
    const reversalResult: InventoryMovementResult = {
      movement: reversed,
      balance_after: 0,
      negative_balance_warning: false,
    }
    fetchMock
      .mockResolvedValueOnce(jsonResponse(stockPage([
        {
          product_id: 'product-1',
          product_name: 'Camiseta Yasar',
          total_entries: 0,
          total_exits: 2,
          balance: -2,
        },
      ])))
      .mockResolvedValueOnce(jsonResponse(movementPage([original])))
      .mockResolvedValueOnce(jsonResponse(productPage([product()])))
      .mockResolvedValueOnce(jsonResponse(stockPage([
        {
          product_id: 'product-1',
          product_name: 'Camiseta Yasar',
          total_entries: 0,
          total_exits: 2,
          balance: -2,
        },
      ])))
      .mockResolvedValueOnce(jsonResponse(reversalResult))
      .mockResolvedValueOnce(jsonResponse(stockPage()))
      .mockResolvedValueOnce(jsonResponse(movementPage([reversed, {
        ...original,
        is_reversed: true,
      }])))
    vi.spyOn(window, 'prompt').mockReturnValue('Contagem corrigida')
    const user = userEvent.setup()

    render(<InventoryPage />)
    await user.click(await screen.findByRole('button', {
      name: 'Reverter Saída de 2 Camiseta Yasar',
    }))

    expect(await screen.findByText(/Movimentação revertida/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      'http://127.0.0.1:8000/api/v1/inventory/movements/movement-1/reverse',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ reason: 'Contagem corrigida' }),
      }),
    )
    expect(screen.queryByRole('button', { name: 'Reverter Saída de 2 Camiseta Yasar' }))
      .not.toBeInTheDocument()
  })
})
