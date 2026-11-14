import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SalesPage from './SalesPage'
import type { Customer, CustomerPage } from './services/customers'
import type { Product, ProductPage } from './services/products'
import type {
  DeliveryMethod,
  Sale,
  SalesPage as SalesPageResponse,
  SalesSummary,
} from './services/sales'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'customer-1',
    full_name: 'Maria Silva',
    email: 'maria@example.com',
    phone: null,
    delivery_address: 'Rua das Flores, 123',
    birthday_day: null,
    birthday_month: null,
    archived_at: null,
    created_at: '2026-11-14T12:00:00Z',
    updated_at: '2026-11-14T12:00:00Z',
    ...overrides,
  }
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    name: 'Blusa Azul',
    current_price: '10.00',
    image_url: null,
    archived_at: null,
    created_at: '2026-11-14T12:00:00Z',
    updated_at: '2026-11-14T12:00:00Z',
    ...overrides,
  }
}

function deliveryMethod(overrides: Partial<DeliveryMethod> = {}): DeliveryMethod {
  return {
    id: 'delivery-1',
    name: 'Sedex',
    archived_at: null,
    created_at: '2026-11-14T12:00:00Z',
    updated_at: '2026-11-14T12:00:00Z',
    ...overrides,
  }
}

function sale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: 'sale-1',
    customer_id: 'customer-1',
    customer_name_snapshot: 'Maria Silva',
    delivery_address_snapshot: 'Rua das Flores, 123',
    delivery_method_id: 'delivery-1',
    delivery_method_name_snapshot: 'Sedex',
    sold_at: '2026-11-14',
    status: 'completed',
    total_amount: '18.00',
    cancellation_reason: null,
    cancelled_at: null,
    created_by_user_id: 'user-1',
    cancelled_by_user_id: null,
    created_at: '2026-11-14T12:00:00Z',
    items: [
      {
        id: 'item-1',
        product_id: 'product-1',
        line_number: 1,
        product_name_snapshot: 'Blusa Azul',
        quantity: 2,
        unit_price: '10.00',
        line_total: '20.00',
      },
      {
        id: 'item-2',
        product_id: 'product-2',
        line_number: 2,
        product_name_snapshot: 'Calça Preta',
        quantity: 1,
        unit_price: '-2.00',
        line_total: '-2.00',
      },
    ],
    ...overrides,
  }
}

function customerPage(items: Customer[]): CustomerPage {
  return { items, total: items.length, limit: 100, offset: 0 }
}

function productPage(items: Product[]): ProductPage {
  return { items, total: items.length, limit: 100, offset: 0 }
}

function salesPage(items: Sale[]): SalesPageResponse {
  return { items, total: items.length, limit: 20, offset: 0 }
}

function mockInitialSalesPage(
  sales: Sale[],
  customers: Customer[],
  products: Product[],
  methods: DeliveryMethod[],
  summary: SalesSummary[] = [],
) {
  vi.mocked(fetch)
    .mockResolvedValueOnce(jsonResponse(customerPage(customers)))
    .mockResolvedValueOnce(jsonResponse(productPage(products)))
    .mockResolvedValueOnce(jsonResponse(methods))
    .mockResolvedValueOnce(jsonResponse(salesPage(sales)))
    .mockResolvedValueOnce(jsonResponse(summary))
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('sales management', () => {
  it('creates a multi-item sale with editable negative unit prices', async () => {
    const fetchMock = vi.mocked(fetch)
    const savedSale = sale()
    mockInitialSalesPage(
      [],
      [customer()],
      [product(), product({ id: 'product-2', name: 'Calça Preta', current_price: '5.00' })],
      [deliveryMethod()],
    )
    fetchMock
      .mockResolvedValueOnce(jsonResponse(savedSale, 201))
      .mockResolvedValueOnce(jsonResponse(salesPage([savedSale])))
      .mockResolvedValueOnce(jsonResponse([]))
    const user = userEvent.setup()

    render(<SalesPage />)
    await screen.findByRole('option', { name: 'Maria Silva' })
    await user.clear(screen.getByLabelText('Quantidade *'))
    await user.type(screen.getByLabelText('Quantidade *'), '2')
    await user.click(screen.getByRole('button', { name: 'Adicionar produto' }))
    await user.selectOptions(screen.getByLabelText('Produto 2 *'), 'product-2')
    const priceFields = screen.getAllByLabelText('Valor unitário (R$) *')
    await user.clear(priceFields[1])
    await user.type(priceFields[1], '-2,00')

    expect(await screen.findByText('R$ 18,00')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Registrar venda' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Venda registrada. Total: R$ 18,00.')
    const request = fetchMock.mock.calls[5]
    expect(request[0]).toBe('http://127.0.0.1:8000/api/v1/sales')
    expect(request[1]).toEqual(expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }))
    expect(JSON.parse(String(request[1]?.body))).toEqual({
      customer_id: 'customer-1',
      delivery_method_id: 'delivery-1',
      sold_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      items: [
        { product_id: 'product-1', quantity: 2, unit_price: '10.00' },
        { product_id: 'product-2', quantity: 1, unit_price: '-2.00' },
      ],
    })
  })

  it('cancels a completed sale with a reason and refreshes the ledger', async () => {
    const fetchMock = vi.mocked(fetch)
    const completedSale = sale()
    const cancelledSale = sale({
      status: 'cancelled',
      cancellation_reason: 'Pedido cancelado pelo cliente',
      cancelled_at: '2026-11-14T13:00:00Z',
    })
    mockInitialSalesPage(
      [completedSale],
      [customer()],
      [product()],
      [deliveryMethod()],
      [{ product_id: 'product-1', product_name: 'Blusa Azul', quantity_sold: 2, total_sold: '20.00' }],
    )
    fetchMock
      .mockResolvedValueOnce(jsonResponse(cancelledSale))
      .mockResolvedValueOnce(jsonResponse(salesPage([cancelledSale])))
      .mockResolvedValueOnce(jsonResponse([]))
    vi.spyOn(window, 'prompt').mockReturnValue('Pedido cancelado pelo cliente')
    const user = userEvent.setup()

    render(<SalesPage />)
    await user.click(await screen.findByRole('button', {
      name: 'Cancelar venda de Maria Silva',
    }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Venda cancelada e estoque compensado. O histórico foi preservado.',
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      'http://127.0.0.1:8000/api/v1/sales/sale-1/cancel',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ reason: 'Pedido cancelado pelo cliente' }),
      }),
    )
    expect(screen.queryByRole('button', { name: 'Cancelar venda de Maria Silva' }))
      .not.toBeInTheDocument()
    expect(await screen.findByText('Cancelada')).toBeInTheDocument()
  })

  it('adds a new delivery method without allowing a duplicate submission to create it twice', async () => {
    const fetchMock = vi.mocked(fetch)
    mockInitialSalesPage([], [customer()], [product()], [deliveryMethod()])
    fetchMock
      .mockResolvedValueOnce(jsonResponse(deliveryMethod({
        id: 'delivery-2',
        name: 'Entrega expressa',
      }), 201))
      .mockResolvedValueOnce(jsonResponse({ detail: 'A delivery method with this name already exists' }, 409))
    const user = userEvent.setup()

    render(<SalesPage />)
    await screen.findByRole('option', { name: 'Sedex' })
    await user.type(screen.getByLabelText('Adicionar forma de entrega'), 'Entrega expressa')
    await user.click(screen.getByRole('button', { name: 'Adicionar' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Forma de entrega adicionada.')
    expect(screen.getByRole('combobox', { name: 'Forma de entrega *' }))
      .toHaveValue('delivery-2')
    await user.type(screen.getByLabelText('Adicionar forma de entrega'), 'entrega expressa')
    await user.click(screen.getByRole('button', { name: 'Adicionar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A delivery method with this name already exists',
    )
  })
})
