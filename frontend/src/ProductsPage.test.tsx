import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProductsPage from './ProductsPage'
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
    image_url: 'https://cdn.example.com/camiseta.png',
    archived_at: null,
    created_at: '2026-11-14T12:00:00Z',
    updated_at: '2026-11-14T12:00:00Z',
    ...overrides,
  }
}

function productPage(items: Product[]): ProductPage {
  return { items, total: items.length, limit: 20, offset: 0 }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('product management', () => {
  it('creates a product with a localized price and optional image URL', async () => {
    const fetchMock = vi.mocked(fetch)
    const savedProduct = product({ name: 'Blusa Azul' })
    fetchMock
      .mockResolvedValueOnce(jsonResponse(productPage([])))
      .mockResolvedValueOnce(jsonResponse(savedProduct, 201))
      .mockResolvedValueOnce(jsonResponse(productPage([savedProduct])))
    const user = userEvent.setup()

    render(<ProductsPage />)
    await screen.findByText('Nenhum produto cadastrado ainda.')
    await user.click(screen.getByRole('button', { name: 'Adicionar produto' }))
    await user.type(screen.getByLabelText('Nome *'), 'Blusa Azul')
    await user.type(screen.getByLabelText('Preço atual (R$) *'), '89,90')
    await user.type(
      screen.getByLabelText('URL da imagem'),
      'https://cdn.example.com/blusa.png',
    )
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }))

    expect(await screen.findByText('Blusa Azul')).toBeInTheDocument()
    expect(screen.getByText('R$ 89,90')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8000/api/v1/products',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          name: 'Blusa Azul',
          current_price: '89.90',
          image_url: 'https://cdn.example.com/blusa.png',
        }),
      }),
    )
  })

  it('rejects invalid prices without sending a mutation request', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(jsonResponse(productPage([])))
    const user = userEvent.setup()

    render(<ProductsPage />)
    await screen.findByText('Nenhum produto cadastrado ainda.')
    await user.click(screen.getByRole('button', { name: 'Adicionar produto' }))
    await user.type(screen.getByLabelText('Nome *'), 'Blusa Azul')
    await user.type(screen.getByLabelText('Preço atual (R$) *'), '10,999')
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Informe um preço válido com até duas casas decimais.',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('archives and restores a product instead of deleting it', async () => {
    const fetchMock = vi.mocked(fetch)
    const activeProduct = product()
    const archivedProduct = product({ archived_at: '2026-11-14T13:00:00Z' })
    fetchMock
      .mockResolvedValueOnce(jsonResponse(productPage([activeProduct])))
      .mockResolvedValueOnce(jsonResponse(archivedProduct))
      .mockResolvedValueOnce(jsonResponse(productPage([])))
      .mockResolvedValueOnce(jsonResponse(productPage([archivedProduct])))
      .mockResolvedValueOnce(jsonResponse(activeProduct))
      .mockResolvedValueOnce(jsonResponse(productPage([activeProduct])))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()

    render(<ProductsPage />)
    const activeRow = await screen.findByRole('row', { name: /Camiseta Yasar/ })
    await user.click(
      within(activeRow).getByRole('button', { name: 'Arquivar Camiseta Yasar' }),
    )
    expect(await screen.findByText('Produto arquivado. Você pode restaurá-lo a qualquer momento.'))
      .toBeInTheDocument()

    await user.click(screen.getByLabelText('Incluir arquivados'))
    const archivedRow = await screen.findByRole('row', { name: /Arquivado/ })
    await user.click(
      within(archivedRow).getByRole('button', { name: 'Restaurar Camiseta Yasar' }),
    )

    expect(await screen.findByText('Produto restaurado.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8000/api/v1/products/product-1/archive',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      'http://127.0.0.1:8000/api/v1/products/product-1/restore',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })
})
