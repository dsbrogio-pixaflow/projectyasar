import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CustomersPage from './CustomersPage'
import type { Customer, CustomerPage } from './services/customers'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'customer-1',
    full_name: 'Ana Costa',
    email: 'ana@example.com',
    phone: '(11) 99999-0000',
    delivery_address: 'Rua Um, 10',
    birthday_day: 29,
    birthday_month: 2,
    archived_at: null,
    created_at: '2026-11-14T12:00:00Z',
    updated_at: '2026-11-14T12:00:00Z',
    ...overrides,
  }
}

function customerPage(items: Customer[]): CustomerPage {
  return { items, total: items.length, limit: 50, offset: 0 }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('customer management', () => {
  it('creates a customer and reloads the list', async () => {
    const fetchMock = vi.mocked(fetch)
    const savedCustomer = customer({
      full_name: 'Bruna Lima',
      email: 'bruna@example.com',
      phone: null,
      delivery_address: null,
      birthday_day: 12,
      birthday_month: 3,
    })
    fetchMock
      .mockResolvedValueOnce(jsonResponse(customerPage([])))
      .mockResolvedValueOnce(jsonResponse(savedCustomer, 201))
      .mockResolvedValueOnce(jsonResponse(customerPage([savedCustomer])))
    const user = userEvent.setup()

    render(<CustomersPage />)
    await screen.findByText('Nenhum cliente cadastrado ainda.')
    await user.click(screen.getByRole('button', { name: 'Adicionar cliente' }))
    await user.type(screen.getByLabelText('Nome completo *'), 'Bruna Lima')
    await user.type(screen.getByLabelText('E-mail'), 'bruna@example.com')
    await user.type(screen.getByLabelText('Aniversário (DD/MM)'), '12/03')
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }))

    expect(await screen.findByText('Bruna Lima')).toBeInTheDocument()
    expect(screen.getByText('12/03')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8000/api/v1/customers',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          full_name: 'Bruna Lima',
          email: 'bruna@example.com',
          phone: null,
          delivery_address: null,
          birthday_day: 12,
          birthday_month: 3,
        }),
      }),
    )
  })

  it('rejects invalid birthday input without sending a request', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(jsonResponse(customerPage([])))
    const user = userEvent.setup()

    render(<CustomersPage />)
    await screen.findByText('Nenhum cliente cadastrado ainda.')
    await user.click(screen.getByRole('button', { name: 'Adicionar cliente' }))
    await user.type(screen.getByLabelText('Nome completo *'), 'Bruna Lima')
    await user.type(screen.getByLabelText('Aniversário (DD/MM)'), '30/02')
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O dia e o mês do aniversário são inválidos.',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('archives and restores a customer without deleting the record', async () => {
    const fetchMock = vi.mocked(fetch)
    const activeCustomer = customer()
    const archivedCustomer = customer({ archived_at: '2026-11-14T13:00:00Z' })
    fetchMock
      .mockResolvedValueOnce(jsonResponse(customerPage([activeCustomer])))
      .mockResolvedValueOnce(jsonResponse(archivedCustomer))
      .mockResolvedValueOnce(jsonResponse(customerPage([])))
      .mockResolvedValueOnce(jsonResponse(customerPage([archivedCustomer])))
      .mockResolvedValueOnce(jsonResponse(activeCustomer))
      .mockResolvedValueOnce(jsonResponse(customerPage([activeCustomer])))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()

    render(<CustomersPage />)
    const activeRow = await screen.findByRole('row', { name: /Ana Costa/ })
    await user.click(within(activeRow).getByRole('button', { name: 'Arquivar Ana Costa' }))
    expect(await screen.findByText('Cliente arquivado. Você pode restaurá-lo a qualquer momento.'))
      .toBeInTheDocument()

    await user.click(screen.getByLabelText('Incluir arquivados'))
    const archivedRow = await screen.findByRole('row', { name: /Arquivado/ })
    await user.click(within(archivedRow).getByRole('button', { name: 'Restaurar Ana Costa' }))

    expect(await screen.findByText('Cliente restaurado.')).toBeInTheDocument()
    expect(await screen.findByRole('row', { name: /Ana Costa/ })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8000/api/v1/customers/customer-1/archive',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      'http://127.0.0.1:8000/api/v1/customers/customer-1/restore',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })

  it('loads the next server page when the user requests it', async () => {
    const fetchMock = vi.mocked(fetch)
    const firstPage = Array.from({ length: 20 }, (_, index) =>
      customer({
        id: `customer-${index + 1}`,
        full_name: `Customer ${String(index + 1).padStart(2, '0')}`,
      }),
    )
    const lastCustomer = customer({
      id: 'customer-21',
      full_name: 'Customer 21',
    })
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ items: firstPage, total: 21, limit: 20, offset: 0 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [lastCustomer], total: 21, limit: 20, offset: 20 }),
      )
    const user = userEvent.setup()

    render(<CustomersPage />)
    expect(await screen.findByText('Customer 01')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Próxima' }))

    expect(await screen.findByText('Customer 21')).toBeInTheDocument()
    expect(screen.queryByText('Customer 01')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8000/api/v1/customers?limit=20&offset=20',
      expect.objectContaining({ credentials: 'include' }),
    )
  })
})
