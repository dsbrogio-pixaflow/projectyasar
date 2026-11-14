import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from './services/auth'
import { listCustomers } from './services/customers'
import type { Customer } from './services/customers'
import { listProducts } from './services/products'
import type { Product } from './services/products'
import {
  cancelSale,
  createDeliveryMethod,
  createSale,
  getSalesSummary,
  listDeliveryMethods,
  listSales,
} from './services/sales'
import type {
  DeliveryMethod,
  Sale,
  SaleInput,
  SalesSummary,
} from './services/sales'

const SALES_PAGE_SIZE = 20
const PRICE_LIMIT_CENTS = 999_999_999_999n
const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
})
const integerFormatter = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 0,
})

interface SaleLineForm {
  key: number
  product_id: string
  quantity: string
  unit_price: string
}

interface SaleForm {
  customer_id: string
  delivery_method_id: string
  sold_at: string
  items: SaleLineForm[]
}

interface PagedResult<T> {
  items: T[]
  total: number
}

function todayAsLocalDate(): string {
  const today = new Date()
  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-')
}

function getPriceCents(value: string): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim().replace(',', '.'))
  if (!match) return null
  const whole = match[2].replace(/^0+(?=\d)/, '')
  const fraction = (match[3] ?? '').padEnd(2, '0')
  const cents = BigInt(whole) * 100n + BigInt(fraction)
  return match[1] === '-' && cents !== 0n ? -cents : cents
}

function normalizePrice(value: string): string {
  const cents = getPriceCents(value)
  if (cents === null) {
    throw new Error('Informe um preço válido com até duas casas decimais.')
  }
  if (cents > PRICE_LIMIT_CENTS || cents < -PRICE_LIMIT_CENTS) {
    throw new Error('O valor unitário deve estar entre -R$ 10 bilhões e R$ 10 bilhões.')
  }
  const negative = cents < 0n
  const absolute = negative ? -cents : cents
  const whole = String(absolute / 100n)
  const fraction = String(absolute % 100n).padStart(2, '0')
  return `${negative ? '-' : ''}${whole}.${fraction}`
}

function formatCents(cents: bigint): string {
  const negative = cents < 0n
  const absolute = negative ? -cents : cents
  const whole = integerFormatter.format(Number(absolute / 100n))
  const fraction = String(absolute % 100n).padStart(2, '0')
  return `${negative ? '-R$' : 'R$'} ${whole},${fraction}`
}

function formatCurrency(value: string | number): string {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return currencyFormatter.format(number)
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  )
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Sua sessão expirou. Entre novamente.'
    if (error.status === 404) return 'Cliente, produto ou forma de entrega não encontrado.'
    if (error.status === 409) return error.message
    if (error.status === 422) return 'Confira a data, os itens, as quantidades e os preços.'
    return error.message
  }
  if (error instanceof TypeError) return 'Não foi possível conectar à API.'
  if (error instanceof Error) return error.message
  return 'Não foi possível concluir a operação.'
}

async function loadAll<T>(
  loadPage: (offset: number) => Promise<PagedResult<T>>,
): Promise<T[]> {
  const firstPage = await loadPage(0)
  const allItems = [...firstPage.items]
  for (let offset = firstPage.items.length; offset < firstPage.total; offset += 100) {
    const page = await loadPage(offset)
    allItems.push(...page.items)
  }
  return allItems
}

export default function SalesPage() {
  const nextLineKey = useRef(1)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [deliveryMethods, setDeliveryMethods] = useState<DeliveryMethod[]>([])
  const [isLoadingOptions, setIsLoadingOptions] = useState(true)
  const [form, setForm] = useState<SaleForm>(() => ({
    customer_id: '',
    delivery_method_id: '',
    sold_at: todayAsLocalDate(),
    items: [{ key: 0, product_id: '', quantity: '1', unit_price: '' }],
  }))
  const [newDeliveryMethod, setNewDeliveryMethod] = useState('')
  const [sales, setSales] = useState<Sale[]>([])
  const [salesSummary, setSalesSummary] = useState<SalesSummary[]>([])
  const [total, setTotal] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'cancelled'>('all')
  const [page, setPage] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)
  const [loadedQueryKey, setLoadedQueryKey] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [cancellingSaleId, setCancellingSaleId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isAddingDeliveryMethod, setIsAddingDeliveryMethod] = useState(false)
  const queryKey = JSON.stringify([search, statusFilter, page, refreshKey])
  const isLoadingSales = loadedQueryKey !== queryKey
  const activeCustomers = customers.filter((customer) => !customer.archived_at)
  const activeProducts = products.filter((product) => !product.archived_at)
  const activeDeliveryMethods = deliveryMethods.filter((method) => !method.archived_at)

  useEffect(() => {
    let isCurrent = true
    Promise.all([
      loadAll((offset) => listCustomers({ limit: 100, offset })),
      loadAll((offset) => listProducts({ limit: 100, offset })),
      listDeliveryMethods(),
    ])
      .then(([customerList, productList, methodList]) => {
        if (!isCurrent) return
        setCustomers(customerList)
        setProducts(productList)
        setDeliveryMethods(methodList)
        setForm((current) => ({
          ...current,
          customer_id: current.customer_id || customerList.find(
            (customer) => !customer.archived_at,
          )?.id || '',
          delivery_method_id: current.delivery_method_id || methodList[0]?.id || '',
          items: current.items.map((item, index) => {
            if (item.product_id || index > 0) return item
            const product = productList.find((candidate) => !candidate.archived_at)
            return product
              ? {
                  ...item,
                  product_id: product.id,
                  unit_price: String(product.current_price),
                }
              : item
          }),
        }))
      })
      .catch((requestError: unknown) => {
        if (isCurrent) setError(getErrorMessage(requestError))
      })
      .finally(() => {
        if (isCurrent) setIsLoadingOptions(false)
      })
    return () => {
      isCurrent = false
    }
  }, [])

  useEffect(() => {
    let isCurrent = true
    Promise.all([
      listSales({
        q: search || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: SALES_PAGE_SIZE,
        offset: page * SALES_PAGE_SIZE,
      }),
      getSalesSummary(),
    ])
      .then(([salesPage, summary]) => {
        if (!isCurrent) return
        if (salesPage.items.length === 0 && salesPage.total > 0 && page > 0) {
          setPage(Math.max(0, Math.ceil(salesPage.total / SALES_PAGE_SIZE) - 1))
          return
        }
        setSales(salesPage.items)
        setTotal(salesPage.total)
        setSalesSummary(summary)
      })
      .catch((requestError: unknown) => {
        if (isCurrent) setError(getErrorMessage(requestError))
      })
      .finally(() => {
        if (isCurrent) setLoadedQueryKey(queryKey)
      })
    return () => {
      isCurrent = false
    }
  }, [search, statusFilter, page, refreshKey, queryKey])

  function createEmptyLine(productId = '', unitPrice = ''): SaleLineForm {
    return {
      key: nextLineKey.current++,
      product_id: productId,
      quantity: '1',
      unit_price: unitPrice,
    }
  }

  function updateLine(key: number, patch: Partial<SaleLineForm>) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => item.key === key ? { ...item, ...patch } : item),
    }))
  }

  function changeLineProduct(key: number, productId: string) {
    const product = activeProducts.find((item) => item.id === productId)
    updateLine(key, {
      product_id: productId,
      unit_price: product ? String(product.current_price) : '',
    })
  }

  function cartTotalCents(): bigint | null {
    let totalCents = 0n
    for (const item of form.items) {
      const priceCents = getPriceCents(item.unit_price)
      const quantity = Number(item.quantity)
      if (priceCents === null || !Number.isInteger(quantity) || quantity < 1) return null
      totalCents += priceCents * BigInt(quantity)
    }
    return totalCents
  }

  function buildSaleInput(): SaleInput {
    if (!form.customer_id || !form.delivery_method_id || !form.sold_at) {
      throw new Error('Selecione cliente, forma de entrega e data da venda.')
    }
    if (!form.items.length || form.items.length > 50) {
      throw new Error('A venda deve conter entre 1 e 50 produtos.')
    }

    const seenProducts = new Set<string>()
    const items = form.items.map((item) => {
      const quantity = Number(item.quantity)
      if (!item.product_id || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
        throw new Error('Cada item deve ter um produto e uma quantidade inteira entre 1 e 1.000.')
      }
      if (seenProducts.has(item.product_id)) {
        throw new Error('Cada produto pode aparecer apenas uma vez na venda.')
      }
      seenProducts.add(item.product_id)
      return {
        product_id: item.product_id,
        quantity,
        unit_price: normalizePrice(item.unit_price),
      }
    })

    return {
      customer_id: form.customer_id,
      delivery_method_id: form.delivery_method_id,
      sold_at: form.sold_at,
      items,
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    let input: SaleInput
    try {
      input = buildSaleInput()
    } catch (validationError: unknown) {
      setError(getErrorMessage(validationError))
      return
    }

    setIsSaving(true)
    try {
      const sale = await createSale(input)
      setNotice(`Venda registrada. Total: ${formatCurrency(sale.total_amount)}.`)
      const emptyLine = createEmptyLine(
        activeProducts[0]?.id ?? '',
        activeProducts[0] ? String(activeProducts[0].current_price) : '',
      )
      setForm((current) => ({
        ...current,
        sold_at: todayAsLocalDate(),
        items: [emptyLine],
      }))
      setPage(0)
      setRefreshKey((key) => key + 1)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleAddDeliveryMethod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newDeliveryMethod.trim()
    if (!name) {
      setError('Informe o nome da forma de entrega.')
      return
    }
    setError(null)
    setNotice(null)
    setIsAddingDeliveryMethod(true)
    try {
      const method = await createDeliveryMethod(name)
      setDeliveryMethods((current) => [...current, method])
      setForm((current) => ({ ...current, delivery_method_id: method.id }))
      setNewDeliveryMethod('')
      setNotice('Forma de entrega adicionada.')
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsAddingDeliveryMethod(false)
    }
  }

  async function handleCancelSale(sale: Sale) {
    const reason = window.prompt(`Informe o motivo para cancelar a venda de ${sale.customer_name_snapshot}:`)
    if (reason === null) return
    if (!reason.trim()) {
      setError('Informe um motivo para cancelar a venda.')
      return
    }
    setError(null)
    setNotice(null)
    setCancellingSaleId(sale.id)
    try {
      await cancelSale(sale.id, reason.trim())
      setNotice('Venda cancelada e estoque compensado. O histórico foi preservado.')
      setRefreshKey((key) => key + 1)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError))
    } finally {
      setCancellingSaleId(null)
    }
  }

  function formatLineTotal(item: SaleLineForm): string {
    const price = getPriceCents(item.unit_price)
    const quantity = Number(item.quantity)
    if (price === null || !Number.isInteger(quantity) || quantity < 1) return '—'
    return formatCents(price * BigInt(quantity))
  }

  const totalCents = cartTotalCents()

  return (
    <section className="customer-manager sales-manager" aria-labelledby="sales-heading">
      <div className="customer-header">
        <div>
          <span className="eyebrow">GESTÃO DO NEGÓCIO</span>
          <h2 id="sales-heading">Vendas</h2>
          <p>Registre vendas com vários produtos e mantenha o estoque sincronizado.</p>
        </div>
      </div>

      {error && <p className="customer-message customer-error" role="alert">{error}</p>}
      {notice && <p className="customer-message customer-success" role="status">{notice}</p>}

      <section className="customer-form" aria-labelledby="new-sale-heading">
        <div className="customer-form-heading">
          <h3 id="new-sale-heading">Registrar venda</h3>
          <span>* Campo obrigatório</span>
        </div>
        <form
          className="sales-delivery-create"
          onSubmit={(event) => void handleAddDeliveryMethod(event)}
        >
          <label htmlFor="new-delivery-method">Adicionar forma de entrega</label>
          <div>
            <input
              id="new-delivery-method"
              value={newDeliveryMethod}
              onChange={(event) => setNewDeliveryMethod(event.target.value)}
              maxLength={120}
              placeholder="Ex.: Entrega expressa"
              disabled={isAddingDeliveryMethod}
            />
            <button
              className="customer-secondary-button"
              type="submit"
              disabled={isAddingDeliveryMethod}
            >
              {isAddingDeliveryMethod ? 'Adicionando…' : 'Adicionar'}
            </button>
          </div>
        </form>
        <form onSubmit={handleSubmit}>
          <div className="customer-form-grid">
            <div className="customer-field">
              <label htmlFor="sale-date">Data *</label>
              <input
                id="sale-date"
                type="date"
                value={form.sold_at}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  sold_at: event.target.value,
                }))}
                required
                disabled={isSaving}
              />
            </div>
            <div className="customer-field">
              <label htmlFor="sale-customer">Cliente *</label>
              <select
                id="sale-customer"
                value={form.customer_id}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  customer_id: event.target.value,
                }))}
                required
                disabled={isSaving || isLoadingOptions || activeCustomers.length === 0}
              >
                <option value="" disabled>Selecione um cliente</option>
                {activeCustomers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.full_name}</option>
                ))}
              </select>
            </div>
            <div className="customer-field">
              <label htmlFor="sale-delivery-method">Forma de entrega *</label>
              <select
                id="sale-delivery-method"
                value={form.delivery_method_id}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  delivery_method_id: event.target.value,
                }))}
                required
                disabled={isSaving || isLoadingOptions || activeDeliveryMethods.length === 0}
              >
                <option value="" disabled>Selecione uma forma</option>
                {activeDeliveryMethods.map((method) => (
                  <option key={method.id} value={method.id}>{method.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="sales-items-heading">
            <h4>Produtos da venda</h4>
            <button
              type="button"
              className="customer-secondary-button"
              onClick={() => {
                const emptyLine = createEmptyLine()
                setForm((current) => ({
                  ...current,
                  items: [...current.items, emptyLine],
                }))
              }}
              disabled={isSaving || activeProducts.length <= form.items.length || form.items.length >= 50}
            >
              Adicionar produto
            </button>
          </div>

          <div className="sales-line-list">
            {form.items.map((item, index) => {
              const selectedIds = new Set(
                form.items.filter((line) => line.key !== item.key).map((line) => line.product_id),
              )
              return (
                <div className="sales-line" key={item.key}>
                  <div className="customer-field sales-line-product">
                    <label htmlFor={`sale-product-${item.key}`}>Produto {index + 1} *</label>
                    <select
                      id={`sale-product-${item.key}`}
                      value={item.product_id}
                      onChange={(event) => changeLineProduct(item.key, event.target.value)}
                      required
                      disabled={isSaving || isLoadingOptions || activeProducts.length === 0}
                    >
                      <option value="" disabled>Selecione um produto</option>
                      {activeProducts.map((product) => (
                        <option
                          key={product.id}
                          value={product.id}
                          disabled={selectedIds.has(product.id)}
                        >
                          {product.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="customer-field sales-line-quantity">
                    <label htmlFor={`sale-quantity-${item.key}`}>Quantidade *</label>
                    <input
                      id={`sale-quantity-${item.key}`}
                      type="number"
                      min={1}
                      max={1000}
                      step={1}
                      value={item.quantity}
                      onChange={(event) => updateLine(item.key, { quantity: event.target.value })}
                      required
                      disabled={isSaving}
                    />
                  </div>
                  <div className="customer-field sales-line-price">
                    <label htmlFor={`sale-price-${item.key}`}>Valor unitário (R$) *</label>
                    <input
                      id={`sale-price-${item.key}`}
                      value={item.unit_price}
                      onChange={(event) => updateLine(item.key, { unit_price: event.target.value })}
                      inputMode="decimal"
                      placeholder="0,00"
                      required
                      disabled={isSaving}
                    />
                    <span className="customer-hint">Editável; valores negativos são permitidos.</span>
                  </div>
                  <div className="sales-line-total">
                    <span>Total do item</span>
                    <strong>{formatLineTotal(item)}</strong>
                  </div>
                  <button
                    type="button"
                    className="customer-link-button customer-danger-button sales-remove-line"
                    aria-label={`Remover produto ${index + 1}`}
                    onClick={() => setForm((current) => ({
                      ...current,
                      items: current.items.filter((line) => line.key !== item.key),
                    }))}
                    disabled={isSaving || form.items.length === 1}
                  >
                    Remover
                  </button>
                </div>
              )
            })}
          </div>

          {activeProducts.length === 0 && !isLoadingOptions && (
            <p className="customer-hint">Cadastre produtos ativos antes de registrar vendas.</p>
          )}
          {activeCustomers.length === 0 && !isLoadingOptions && (
            <p className="customer-hint">Cadastre clientes ativos antes de registrar vendas.</p>
          )}

          <div className="sales-cart-total">
            <span>Total da venda</span>
            <strong>{totalCents === null ? 'Revise os itens' : formatCents(totalCents)}</strong>
          </div>
          <div className="customer-form-actions">
            <button
              className="customer-primary-button"
              type="submit"
              disabled={
                isSaving
                || isLoadingOptions
                || activeProducts.length === 0
                || activeCustomers.length === 0
                || activeDeliveryMethods.length === 0
              }
            >
              {isSaving ? 'Registrando…' : 'Registrar venda'}
            </button>
          </div>
          <p className="customer-hint sales-stock-guidance">
            A venda será recusada se o estoque disponível for insuficiente. O registro e as baixas
            de estoque são realizados juntos.
          </p>
        </form>
      </section>

      <section className="sales-section" aria-labelledby="sales-summary-heading">
        <div className="customer-list-heading">
          <h3 id="sales-summary-heading">Resumo por produto</h3>
        </div>
        {isLoadingSales ? (
          <p className="customer-empty" role="status">Carregando resumo…</p>
        ) : salesSummary.length === 0 ? (
          <p className="customer-empty">Ainda não há vendas concluídas.</p>
        ) : (
          <div className="customer-table-wrap">
            <table className="customer-table">
              <thead>
                <tr>
                  <th scope="col">Produto</th>
                  <th scope="col">Quantidade total</th>
                  <th scope="col">Total vendido</th>
                </tr>
              </thead>
              <tbody>
                {salesSummary.map((item) => (
                  <tr key={item.product_id}>
                    <td data-label="Produto"><strong>{item.product_name}</strong></td>
                    <td data-label="Quantidade total">{item.quantity_sold}</td>
                    <td data-label="Total vendido">
                      <span className={Number(item.total_sold) < 0 ? 'sales-negative' : ''}>
                        {formatCurrency(item.total_sold)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="sales-section" aria-labelledby="sales-history-heading">
        <div className="customer-list-heading">
          <h3 id="sales-history-heading">Histórico de vendas</h3>
          <span>{total} {total === 1 ? 'venda' : 'vendas'}</span>
        </div>
        <div className="customer-tools">
          <form
            className="customer-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault()
              setPage(0)
              setSearch(searchInput.trim())
            }}
          >
            <label htmlFor="sales-search">Buscar vendas por cliente</label>
            <input
              id="sales-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Nome do cliente"
            />
            <button className="customer-secondary-button" type="submit">Buscar</button>
          </form>
          <label className="sales-status-filter">
            Situação
            <select
              value={statusFilter}
              onChange={(event) => {
                setPage(0)
                const value = event.target.value
                if (value === 'all' || value === 'completed' || value === 'cancelled') {
                  setStatusFilter(value)
                }
              }}
            >
              <option value="all">Todas</option>
              <option value="completed">Concluídas</option>
              <option value="cancelled">Canceladas</option>
            </select>
          </label>
        </div>
        <div className="customer-list-heading">
          <span>Vendas recentes</span>
          {total > SALES_PAGE_SIZE && (
            <nav className="customer-pagination" aria-label="Paginação de vendas">
              <button
                type="button"
                className="customer-secondary-button"
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                disabled={page === 0 || isLoadingSales}
              >
                Anterior
              </button>
              <span aria-live="polite">
                Página {page + 1} de {Math.ceil(total / SALES_PAGE_SIZE)}
              </span>
              <button
                type="button"
                className="customer-secondary-button"
                onClick={() => setPage((current) => current + 1)}
                disabled={(page + 1) * SALES_PAGE_SIZE >= total || isLoadingSales}
              >
                Próxima
              </button>
            </nav>
          )}
        </div>
        {isLoadingSales ? (
          <p className="customer-empty" role="status">Carregando vendas…</p>
        ) : sales.length === 0 ? (
          <p className="customer-empty">
            {search ? 'Nenhuma venda corresponde à busca.' : 'Nenhuma venda registrada.'}
          </p>
        ) : (
          <div className="customer-table-wrap">
            <table className="customer-table">
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col">Cliente</th>
                  <th scope="col">Entrega</th>
                  <th scope="col">Itens</th>
                  <th scope="col">Total</th>
                  <th scope="col">Situação</th>
                  <th scope="col"><span className="visually-hidden">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id}>
                    <td data-label="Data">{formatDate(sale.sold_at)}</td>
                    <td data-label="Cliente"><strong>{sale.customer_name_snapshot}</strong></td>
                    <td data-label="Entrega">
                      {sale.delivery_method_name_snapshot}
                      {sale.delivery_address_snapshot && (
                        <span className="customer-secondary-text">
                          {sale.delivery_address_snapshot}
                        </span>
                      )}
                    </td>
                    <td data-label="Itens">
                      <details>
                        <summary>{sale.items.length} {sale.items.length === 1 ? 'item' : 'itens'}</summary>
                        <ul className="sales-item-details">
                          {sale.items.map((item) => (
                            <li key={item.id}>
                              {item.quantity} × {item.product_name_snapshot}
                              {' · '}{formatCurrency(item.unit_price)}
                              {' = '}{formatCurrency(item.line_total)}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </td>
                    <td data-label="Total">
                      <span className={Number(sale.total_amount) < 0 ? 'sales-negative' : ''}>
                        {formatCurrency(sale.total_amount)}
                      </span>
                    </td>
                    <td data-label="Situação">
                      <span className={`customer-status ${sale.status === 'cancelled' ? 'is-archived' : ''}`}>
                        {sale.status === 'cancelled' ? 'Cancelada' : 'Concluída'}
                      </span>
                      {sale.cancellation_reason && (
                        <span className="customer-secondary-text">
                          Motivo: {sale.cancellation_reason}
                        </span>
                      )}
                    </td>
                    <td className="customer-actions">
                      {sale.status === 'completed' && (
                        <button
                          type="button"
                          className="customer-link-button customer-danger-button"
                          aria-label={`Cancelar venda de ${sale.customer_name_snapshot}`}
                          onClick={() => void handleCancelSale(sale)}
                          disabled={cancellingSaleId === sale.id}
                        >
                          {cancellingSaleId === sale.id ? 'Cancelando…' : 'Cancelar'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  )
}
