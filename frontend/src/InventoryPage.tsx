import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from './services/auth'
import {
  createInventoryMovement,
  listInventoryMovements,
  listProductStock,
  reverseInventoryMovement,
} from './services/inventory'
import type {
  InventoryMovement,
  InventoryMovementInput,
  ProductStock,
} from './services/inventory'
import { listProducts } from './services/products'
import type { Product } from './services/products'

const STOCK_PAGE_SIZE = 50
const MOVEMENT_PAGE_SIZE = 20

interface MovementForm {
  product_id: string
  occurred_at: string
  movement_type: 'in' | 'out'
  quantity: string
  note: string
}

function todayAsLocalDate(): string {
  const today = new Date()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${today.getFullYear()}-${month}-${day}`
}

function emptyForm(productId = ''): MovementForm {
  return {
    product_id: productId,
    occurred_at: todayAsLocalDate(),
    movement_type: 'in',
    quantity: '',
    note: '',
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Sua sessão expirou. Entre novamente.'
    if (error.status === 404) return 'O produto ou a movimentação não foi encontrado.'
    if (error.status === 409) {
      return 'Não foi possível registrar a operação. O produto pode estar arquivado ou a movimentação já foi revertida.'
    }
    if (error.status === 422) {
      return 'Confira o produto, a data e a quantidade informados.'
    }
    return error.message
  }
  if (error instanceof TypeError) return 'Não foi possível conectar à API.'
  if (error instanceof Error) return error.message
  return 'Não foi possível concluir a operação.'
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  )
}

function movementLabel(movement: InventoryMovement): string {
  if (movement.movement_type === 'reversal') return 'Reversão'
  return movement.movement_type === 'in' ? 'Entrada' : 'Saída'
}

async function loadAllProducts(): Promise<Product[]> {
  const firstPage = await listProducts({ include_archived: true, limit: 100, offset: 0 })
  const allProducts = [...firstPage.items]
  for (let offset = firstPage.items.length; offset < firstPage.total; offset += 100) {
    const page = await listProducts({ include_archived: true, limit: 100, offset })
    allProducts.push(...page.items)
  }
  return allProducts
}

export default function InventoryPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [isLoadingProducts, setIsLoadingProducts] = useState(true)
  const [stock, setStock] = useState<ProductStock[]>([])
  const [selectedBalance, setSelectedBalance] = useState<{
    productId: string
    balance: number
  } | null>(null)
  const [stockTotal, setStockTotal] = useState(0)
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [movementTotal, setMovementTotal] = useState(0)
  const [stockPage, setStockPage] = useState(0)
  const [movementPage, setMovementPage] = useState(0)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [form, setForm] = useState<MovementForm>(() => emptyForm())
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [noticeIsWarning, setNoticeIsWarning] = useState(false)
  const queryKey = JSON.stringify([
    stockPage,
    movementPage,
    includeArchived,
    selectedProduct,
    refreshKey,
  ])
  const isLoading = loadedKey !== queryKey

  useEffect(() => {
    let isCurrent = true

    Promise.all([
      listProductStock({
        limit: STOCK_PAGE_SIZE,
        offset: stockPage * STOCK_PAGE_SIZE,
        include_archived: includeArchived,
      }),
      listInventoryMovements({
        limit: MOVEMENT_PAGE_SIZE,
        offset: movementPage * MOVEMENT_PAGE_SIZE,
        product_id: selectedProduct || undefined,
      }),
    ])
      .then(([stockPageResult, movementPageResult]) => {
        if (!isCurrent) return
        if (stockPageResult.items.length === 0 && stockPageResult.total > 0 && stockPage > 0) {
          setStockPage(Math.max(0, Math.ceil(stockPageResult.total / STOCK_PAGE_SIZE) - 1))
          return
        }
        if (
          movementPageResult.items.length === 0
          && movementPageResult.total > 0
          && movementPage > 0
        ) {
          setMovementPage(Math.max(0, Math.ceil(movementPageResult.total / MOVEMENT_PAGE_SIZE) - 1))
          return
        }
        setStock(stockPageResult.items)
        setStockTotal(stockPageResult.total)
        setMovements(movementPageResult.items)
        setMovementTotal(movementPageResult.total)
      })
      .catch((requestError: unknown) => {
        if (isCurrent) setError(getErrorMessage(requestError))
      })
      .finally(() => {
        if (isCurrent) setLoadedKey(queryKey)
      })

    return () => {
      isCurrent = false
    }
  }, [
    stockPage,
    movementPage,
    includeArchived,
    selectedProduct,
    refreshKey,
    queryKey,
  ])

  useEffect(() => {
    let isCurrent = true
    loadAllProducts()
      .then((productList) => {
        if (!isCurrent) return
        setProducts(productList)
        if (productList.length > 0) {
          setForm((current) => (
            current.product_id
              ? current
              : { ...current, product_id: productList.find((product) => !product.archived_at)?.id ?? '' }
          ))
        }
      })
      .catch((requestError: unknown) => {
        if (isCurrent) setError(getErrorMessage(requestError))
      })
      .finally(() => {
        if (isCurrent) setIsLoadingProducts(false)
      })
    return () => {
      isCurrent = false
    }
  }, [])

  useEffect(() => {
    let isCurrent = true
    if (!form.product_id) return () => {
      isCurrent = false
    }

    listProductStock({
      product_id: form.product_id,
      include_archived: true,
      limit: 1,
    })
      .then((result) => {
        if (isCurrent) {
          setSelectedBalance({
            productId: form.product_id,
            balance: result.items[0]?.balance ?? 0,
          })
        }
      })
      .catch((requestError: unknown) => {
        if (isCurrent) setError(getErrorMessage(requestError))
      })

    return () => {
      isCurrent = false
    }
  }, [form.product_id, refreshKey])

  function changeField(field: keyof MovementForm, value: string) {
    if (field === 'movement_type') {
      setForm((current) => ({
        ...current,
        movement_type: value === 'out' ? 'out' : 'in',
      }))
      return
    }
    setForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setNoticeIsWarning(false)

    const quantity = Number(form.quantity)
    if (!form.product_id || !form.occurred_at || !Number.isInteger(quantity) || quantity < 1) {
      setError('Selecione um produto, informe a data e uma quantidade inteira maior que zero.')
      return
    }
    if (quantity > 1_000_000) {
      setError('A quantidade máxima por movimentação é 1.000.000.')
      return
    }

    const input: InventoryMovementInput = {
      product_id: form.product_id,
      occurred_at: form.occurred_at,
      movement_type: form.movement_type,
      quantity,
      note: form.note.trim() || null,
    }
    setIsSaving(true)
    try {
      const result = await createInventoryMovement(input)
      setNotice(
        result.negative_balance_warning
          ? `Movimentação registrada. Atenção: o saldo de ${result.movement.product_name} ficou negativo (${result.balance_after}).`
          : `Movimentação de ${result.movement.product_name} registrada. Saldo atual: ${result.balance_after}.`,
      )
      setNoticeIsWarning(result.negative_balance_warning)
      setForm((current) => ({
        ...emptyForm(current.product_id),
        movement_type: current.movement_type,
      }))
      setStockPage(0)
      setMovementPage(0)
      setRefreshKey((key) => key + 1)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleReverse(movement: InventoryMovement) {
    const reason = window.prompt(
      `Informe o motivo para reverter esta movimentação de ${movement.quantity} unidade(s):`,
    )
    if (reason === null) return
    if (!reason.trim()) {
      setError('Informe um motivo para a reversão.')
      return
    }

    setError(null)
    setNotice(null)
    setNoticeIsWarning(false)
    try {
      const result = await reverseInventoryMovement(movement.id, reason.trim())
      setNotice(
        result.negative_balance_warning
          ? `Movimentação revertida. Atenção: o saldo de ${result.movement.product_name} ficou negativo (${result.balance_after}).`
          : `Movimentação revertida. Saldo de ${result.movement.product_name}: ${result.balance_after}.`,
      )
      setNoticeIsWarning(result.negative_balance_warning)
      setRefreshKey((key) => key + 1)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError))
    }
  }

  const activeProducts = products.filter((product) => !product.archived_at)
  const projectedBalance = selectedBalance?.productId === form.product_id
    ? selectedBalance.balance - Number(form.quantity)
    : null
  const willGoNegative = form.movement_type === 'out'
    && Number.isInteger(Number(form.quantity))
    && Number(form.quantity) > 0
    && Number(form.quantity) <= 1_000_000
    && projectedBalance !== null
    && projectedBalance < 0

  return (
    <section className="customer-manager inventory-manager" aria-labelledby="inventory-heading">
      <div className="customer-header">
        <div>
          <span className="eyebrow">GESTÃO DO NEGÓCIO</span>
          <h2 id="inventory-heading">Estoque</h2>
          <p>Consulte saldos e registre entradas e saídas com histórico auditável.</p>
        </div>
      </div>

      {error && <p className="customer-message customer-error" role="alert">{error}</p>}
      {notice && (
        <p
          className={`customer-message ${noticeIsWarning ? 'inventory-warning' : 'customer-success'}`}
          role={noticeIsWarning ? 'alert' : 'status'}
        >
          {notice}
        </p>
      )}

      <form className="customer-form" onSubmit={handleSubmit}>
        <div className="customer-form-heading">
          <h3>Registrar movimentação</h3>
          <span>* Campo obrigatório</span>
        </div>
        <div className="customer-form-grid">
          <div className="customer-field">
            <label htmlFor="inventory-product">Produto *</label>
            <select
              id="inventory-product"
              value={form.product_id}
              onChange={(event) => changeField('product_id', event.target.value)}
              required
              disabled={isSaving || isLoadingProducts || activeProducts.length === 0}
            >
              <option value="" disabled>Selecione um produto</option>
              {activeProducts.map((product) => (
                <option key={product.id} value={product.id}>{product.name}</option>
              ))}
            </select>
            {isLoadingProducts ? (
              <span className="customer-hint">Carregando produtos…</span>
            ) : activeProducts.length === 0 ? (
              <span className="customer-hint">Cadastre um produto antes de registrar estoque.</span>
            ) : null}
          </div>
          <div className="customer-field">
            <label htmlFor="inventory-type">Tipo *</label>
            <select
              id="inventory-type"
              value={form.movement_type}
              onChange={(event) => changeField('movement_type', event.target.value)}
              disabled={isSaving}
            >
              <option value="in">Entrada</option>
              <option value="out">Saída</option>
            </select>
          </div>
          <div className="customer-field">
            <label htmlFor="inventory-quantity">Quantidade *</label>
            <input
              id="inventory-quantity"
              type="number"
              value={form.quantity}
              onChange={(event) => changeField('quantity', event.target.value)}
              min={1}
              max={1_000_000}
              step={1}
              required
              disabled={isSaving}
            />
          </div>
          <div className="customer-field">
            <label htmlFor="inventory-date">Data *</label>
            <input
              id="inventory-date"
              type="date"
              value={form.occurred_at}
              onChange={(event) => changeField('occurred_at', event.target.value)}
              required
              disabled={isSaving}
            />
          </div>
          <div className="customer-field customer-field-wide">
            <label htmlFor="inventory-note">Observação</label>
            <textarea
              id="inventory-note"
              value={form.note}
              onChange={(event) => changeField('note', event.target.value)}
              maxLength={500}
              rows={2}
              disabled={isSaving}
            />
          </div>
        </div>
        <div className="customer-form-actions">
          <button
            className="customer-primary-button"
            type="submit"
            disabled={isSaving || isLoadingProducts || activeProducts.length === 0}
          >
            {isSaving ? 'Salvando…' : 'Registrar movimentação'}
          </button>
        </div>
        {willGoNegative && !isSaving && (
          <p className="customer-message inventory-warning" role="alert">
            Esta saída deixará o saldo de {activeProducts.find(
              (product) => product.id === form.product_id,
            )?.name ?? 'este produto'} negativo ({projectedBalance}). A saída continua permitida.
          </p>
        )}
        <p className="inventory-guidance">
          Saídas podem deixar o saldo negativo para preservar o comportamento do sistema legado.
          Saldos negativos são sinalizados; correções exigem reversão com motivo.
        </p>
      </form>

      <section className="inventory-section" aria-labelledby="stock-heading">
        <div className="customer-list-heading">
          <h3 id="stock-heading">Saldo por produto</h3>
          <span>{stockTotal} {stockTotal === 1 ? 'produto' : 'produtos'}</span>
          <label className="archived-toggle">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => {
                setError(null)
                setStockPage(0)
                setIncludeArchived(event.target.checked)
              }}
            />
            Incluir arquivados
          </label>
          {stockTotal > STOCK_PAGE_SIZE && (
            <nav className="customer-pagination" aria-label="Paginação do saldo por produto">
              <button
                type="button"
                className="customer-secondary-button"
                onClick={() => setStockPage((page) => Math.max(0, page - 1))}
                disabled={stockPage === 0 || isLoading}
              >
                Anterior
              </button>
              <span aria-live="polite">
                Página {stockPage + 1} de {Math.ceil(stockTotal / STOCK_PAGE_SIZE)}
              </span>
              <button
                type="button"
                className="customer-secondary-button"
                onClick={() => setStockPage((page) => page + 1)}
                disabled={(stockPage + 1) * STOCK_PAGE_SIZE >= stockTotal || isLoading}
              >
                Próxima
              </button>
            </nav>
          )}
        </div>
        {isLoading ? (
          <p className="customer-empty" role="status">Carregando estoque…</p>
        ) : stock.length === 0 ? (
          <p className="customer-empty">Nenhum produto encontrado.</p>
        ) : (
          <div className="customer-table-wrap">
            <table className="customer-table">
              <thead>
                <tr>
                  <th scope="col">Produto</th>
                  <th scope="col">Entradas</th>
                  <th scope="col">Saídas</th>
                  <th scope="col">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((item) => (
                  <tr key={item.product_id}>
                    <td data-label="Produto"><strong>{item.product_name}</strong></td>
                    <td data-label="Entradas">{item.total_entries}</td>
                    <td data-label="Saídas">{item.total_exits}</td>
                    <td data-label="Saldo">
                      <span className={item.balance < 0 ? 'inventory-negative' : ''}>
                        {item.balance}
                      </span>
                      {item.balance < 0 && (
                        <span className="customer-secondary-text">Saldo negativo</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="inventory-section" aria-labelledby="movements-heading">
        <div className="customer-list-heading">
          <h3 id="movements-heading">Histórico de movimentações</h3>
          <span>{movementTotal} {movementTotal === 1 ? 'movimentação' : 'movimentações'}</span>
          <label className="inventory-filter">
            Filtrar produto
            <select
              aria-label="Filtrar histórico por produto"
              value={selectedProduct}
              onChange={(event) => {
                setMovementPage(0)
                setSelectedProduct(event.target.value)
              }}
            >
              <option value="">Todos os produtos</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>{product.name}</option>
              ))}
            </select>
          </label>
          {movementTotal > MOVEMENT_PAGE_SIZE && (
            <nav className="customer-pagination" aria-label="Paginação do histórico">
              <button
                type="button"
                className="customer-secondary-button"
                onClick={() => setMovementPage((page) => Math.max(0, page - 1))}
                disabled={movementPage === 0 || isLoading}
              >
                Anterior
              </button>
              <span aria-live="polite">
                Página {movementPage + 1} de {Math.ceil(movementTotal / MOVEMENT_PAGE_SIZE)}
              </span>
              <button
                type="button"
                className="customer-secondary-button"
                onClick={() => setMovementPage((page) => page + 1)}
                disabled={(movementPage + 1) * MOVEMENT_PAGE_SIZE >= movementTotal || isLoading}
              >
                Próxima
              </button>
            </nav>
          )}
        </div>
        {isLoading ? (
          <p className="customer-empty" role="status">Carregando movimentações…</p>
        ) : movements.length === 0 ? (
          <p className="customer-empty">Nenhuma movimentação registrada.</p>
        ) : (
          <div className="customer-table-wrap">
            <table className="customer-table">
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col">Produto</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Quantidade</th>
                  <th scope="col">Observação</th>
                  <th scope="col"><span className="visually-hidden">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => (
                  <tr key={movement.id}>
                    <td data-label="Data">{formatDate(movement.occurred_at)}</td>
                    <td data-label="Produto"><strong>{movement.product_name}</strong></td>
                    <td data-label="Tipo">
                      <span className={`inventory-movement-type is-${movement.movement_type}`}>
                        {movementLabel(movement)}
                      </span>
                      {movement.is_reversed && (
                        <span className="customer-secondary-text">Revertida</span>
                      )}
                    </td>
                    <td data-label="Quantidade">{movement.quantity}</td>
                    <td data-label="Observação">{movement.note || '—'}</td>
                    <td className="customer-actions">
                      {movement.source_type === 'manual'
                        && movement.movement_type !== 'reversal'
                        && !movement.is_reversed && (
                          <button
                            type="button"
                            className="customer-link-button customer-danger-button"
                            aria-label={`Reverter ${movementLabel(movement)} de ${movement.quantity} ${movement.product_name}`}
                            onClick={() => void handleReverse(movement)}
                          >
                            Reverter
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
