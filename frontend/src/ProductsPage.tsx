import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from './services/auth'
import {
  archiveProduct,
  createProduct,
  listProducts,
  restoreProduct,
  updateProduct,
} from './services/products'
import type { Product, ProductInput } from './services/products'

const PRODUCT_PAGE_SIZE = 20
const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

interface ProductForm {
  name: string
  current_price: string
  image_url: string
}

const EMPTY_FORM: ProductForm = {
  name: '',
  current_price: '',
  image_url: '',
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Sua sessão expirou. Entre novamente.'
    if (error.status === 422) {
      return 'Confira o nome, o preço (até duas casas decimais) e a URL da imagem.'
    }
    return error.message
  }
  if (error instanceof TypeError) return 'Não foi possível conectar à API.'
  if (error instanceof Error) return error.message
  return 'Não foi possível concluir a operação.'
}

function toProductInput(form: ProductForm): ProductInput {
  const name = form.name.trim()
  if (!name) throw new Error('O nome do produto é obrigatório.')

  const normalizedPrice = form.current_price.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(normalizedPrice)) {
    throw new Error('Informe um preço válido com até duas casas decimais.')
  }
  const numericPrice = Number(normalizedPrice)
  if (!Number.isFinite(numericPrice) || numericPrice > 9_999_999_999.99) {
    throw new Error('O preço deve ser menor que R$ 10 bilhões.')
  }

  return {
    name,
    current_price: numericPrice.toFixed(2),
    image_url: form.image_url.trim() || null,
  }
}

function formFromProduct(product: Product): ProductForm {
  return {
    name: product.name,
    current_price: Number(product.current_price).toFixed(2),
    image_url: product.image_url ?? '',
  }
}

function formatPrice(price: string | number): string {
  return currencyFormatter.format(Number(price))
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [loadedQueryKey, setLoadedQueryKey] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const queryKey = JSON.stringify([search, includeArchived, page, refreshKey])
  const isLoading = loadedQueryKey !== queryKey

  useEffect(() => {
    let isCurrent = true
    listProducts({
      q: search || undefined,
      include_archived: includeArchived,
      limit: PRODUCT_PAGE_SIZE,
      offset: page * PRODUCT_PAGE_SIZE,
    })
      .then((resultPage) => {
        if (!isCurrent) return
        if (resultPage.items.length === 0 && resultPage.total > 0 && page > 0) {
          setPage(Math.max(0, Math.ceil(resultPage.total / PRODUCT_PAGE_SIZE) - 1))
          return
        }
        setProducts(resultPage.items)
        setTotal(resultPage.total)
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
  }, [search, includeArchived, page, refreshKey, queryKey])

  function resetForm() {
    setEditingProduct(null)
    setForm(EMPTY_FORM)
    setIsFormOpen(false)
  }

  function beginEdit(product: Product) {
    setEditingProduct(product)
    setForm(formFromProduct(product))
    setIsFormOpen(true)
    setError(null)
    setNotice(null)
  }

  function changeField(field: keyof ProductForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)

    let input: ProductInput
    try {
      input = toProductInput(form)
    } catch (validationError: unknown) {
      setError(getErrorMessage(validationError))
      return
    }

    setIsSaving(true)
    try {
      if (editingProduct) {
        await updateProduct(editingProduct.id, input)
        setNotice('Produto atualizado.')
      } else {
        await createProduct(input)
        setNotice('Produto cadastrado.')
      }
      resetForm()
      setRefreshKey((key) => key + 1)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleArchive(product: Product) {
    if (!window.confirm(`Arquivar o produto ${product.name}?`)) return
    setError(null)
    setNotice(null)
    try {
      await archiveProduct(product.id)
      setNotice('Produto arquivado. Você pode restaurá-lo a qualquer momento.')
      setRefreshKey((key) => key + 1)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError))
    }
  }

  async function handleRestore(product: Product) {
    setError(null)
    setNotice(null)
    try {
      await restoreProduct(product.id)
      setNotice('Produto restaurado.')
      setRefreshKey((key) => key + 1)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError))
    }
  }

  return (
    <section className="customer-manager product-manager" aria-labelledby="products-heading">
      <div className="customer-header">
        <div>
          <span className="eyebrow">GESTÃO DO NEGÓCIO</span>
          <h2 id="products-heading">Produtos</h2>
          <p>Organize o catálogo e os preços atuais dos seus produtos.</p>
        </div>
        {!isFormOpen && (
          <button
            className="customer-primary-button"
            type="button"
            onClick={() => {
              setEditingProduct(null)
              setForm(EMPTY_FORM)
              setIsFormOpen(true)
              setError(null)
              setNotice(null)
            }}
          >
            Adicionar produto
          </button>
        )}
      </div>

      {error && <p className="customer-message customer-error" role="alert">{error}</p>}
      {notice && <p className="customer-message customer-success" role="status">{notice}</p>}

      {isFormOpen && (
        <form className="customer-form" onSubmit={handleSubmit}>
          <div className="customer-form-heading">
            <h3>{editingProduct ? 'Editar produto' : 'Novo produto'}</h3>
            <span>* Campo obrigatório</span>
          </div>
          <div className="customer-form-grid">
            <div className="customer-field customer-field-wide">
              <label htmlFor="product-name">Nome *</label>
              <input
                id="product-name"
                value={form.name}
                onChange={(event) => changeField('name', event.target.value)}
                maxLength={200}
                required
                disabled={isSaving}
              />
            </div>
            <div className="customer-field">
              <label htmlFor="product-price">Preço atual (R$) *</label>
              <input
                id="product-price"
                value={form.current_price}
                onChange={(event) => changeField('current_price', event.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                required
                disabled={isSaving}
              />
              <span className="customer-hint">Use vírgula ou ponto; até 2 casas decimais.</span>
            </div>
            <div className="customer-field customer-field-wide">
              <label htmlFor="product-image-url">URL da imagem</label>
              <input
                id="product-image-url"
                type="url"
                value={form.image_url}
                onChange={(event) => changeField('image_url', event.target.value)}
                maxLength={2000}
                placeholder="https://..."
                disabled={isSaving}
              />
              <span className="customer-hint">
                Use uma URL pública. A imagem não é enviada nem armazenada pela aplicação.
              </span>
            </div>
          </div>
          <div className="customer-form-actions">
            <button
              className="customer-secondary-button"
              type="button"
              onClick={resetForm}
              disabled={isSaving}
            >
              Cancelar
            </button>
            <button
              className="customer-primary-button"
              type="submit"
              disabled={isSaving}
            >
              {isSaving
                ? 'Salvando…'
                : editingProduct
                  ? 'Salvar alterações'
                  : 'Cadastrar'}
            </button>
          </div>
        </form>
      )}

      <div className="customer-tools">
        <form
          className="customer-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault()
            setError(null)
            setPage(0)
            setSearch(searchInput.trim())
          }}
        >
          <label htmlFor="product-search">Buscar produtos</label>
          <input
            id="product-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Nome do produto"
          />
          <button className="customer-secondary-button" type="submit">Buscar</button>
        </form>
        <label className="archived-toggle">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => {
              setError(null)
              setPage(0)
              setIncludeArchived(event.target.checked)
            }}
          />
          Incluir arquivados
        </label>
      </div>

      <div className="customer-list-heading">
        <h3>Lista de produtos</h3>
        <span>{total} {total === 1 ? 'produto' : 'produtos'}</span>
        {total > PRODUCT_PAGE_SIZE && (
          <nav className="customer-pagination" aria-label="Paginação de produtos">
            <button
              type="button"
              className="customer-secondary-button"
              onClick={() => setPage((currentPage) => Math.max(0, currentPage - 1))}
              disabled={page === 0 || isLoading}
            >
              Anterior
            </button>
            <span aria-live="polite">
              Página {page + 1} de {Math.ceil(total / PRODUCT_PAGE_SIZE)}
            </span>
            <button
              type="button"
              className="customer-secondary-button"
              onClick={() => setPage((currentPage) => currentPage + 1)}
              disabled={(page + 1) * PRODUCT_PAGE_SIZE >= total || isLoading}
            >
              Próxima
            </button>
          </nav>
        )}
      </div>

      {isLoading ? (
        <p className="customer-empty" role="status">Carregando produtos…</p>
      ) : products.length === 0 ? (
        <p className="customer-empty">
          {search
            ? 'Nenhum produto corresponde à busca.'
            : 'Nenhum produto cadastrado ainda.'}
        </p>
      ) : (
        <div className="customer-table-wrap">
          <table className="customer-table">
            <thead>
              <tr>
                <th scope="col">Imagem</th>
                <th scope="col">Produto</th>
                <th scope="col">Preço</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="visually-hidden">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td data-label="Imagem">
                    {product.image_url ? (
                      <img
                        className="product-image-thumbnail"
                        src={product.image_url}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="product-image-placeholder" aria-label="Sem imagem">
                        —
                      </span>
                    )}
                  </td>
                  <td data-label="Produto"><strong>{product.name}</strong></td>
                  <td data-label="Preço">{formatPrice(product.current_price)}</td>
                  <td data-label="Status">
                    <span className={`customer-status ${product.archived_at ? 'is-archived' : ''}`}>
                      {product.archived_at ? 'Arquivado' : 'Ativo'}
                    </span>
                  </td>
                  <td className="customer-actions">
                    {product.archived_at ? (
                      <button
                        type="button"
                        className="customer-link-button"
                        aria-label={`Restaurar ${product.name}`}
                        onClick={() => void handleRestore(product)}
                      >
                        Restaurar
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="customer-link-button"
                          aria-label={`Editar ${product.name}`}
                          onClick={() => beginEdit(product)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="customer-link-button customer-danger-button"
                          aria-label={`Arquivar ${product.name}`}
                          onClick={() => void handleArchive(product)}
                        >
                          Arquivar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
