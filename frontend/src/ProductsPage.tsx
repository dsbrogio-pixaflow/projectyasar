import { useEffect, useRef, useState } from 'react'
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
    current_price: Number(product.current_price).toFixed(2).replace('.', ','),
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
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(true)
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null)
  const [loadedQueryKey, setLoadedQueryKey] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [total, setTotal] = useState(0)

  const nameInputRef = useRef<HTMLInputElement>(null)
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
    setSelectedProductId(null)
    setForm(EMPTY_FORM)
    setError(null)
    nameInputRef.current?.focus()
  }

  function openNewForm() {
    setEditingProduct(null)
    setSelectedProductId(null)
    setForm(EMPTY_FORM)
    setIsFormOpen(true)
    setError(null)
    setNotice(null)
    setTimeout(() => nameInputRef.current?.focus(), 50)
  }

  function beginEdit(product: Product) {
    setEditingProduct(product)
    setSelectedProductId(product.id)
    setForm(formFromProduct(product))
    setIsFormOpen(true)
    setError(null)
    setNotice(null)
    setTimeout(() => nameInputRef.current?.focus(), 50)
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
        setNotice(`Produto "${input.name}" atualizado com sucesso!`)
      } else {
        await createProduct(input)
        setNotice(`Produto "${input.name}" cadastrado com sucesso!`)
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
    if (
      !window.confirm(
        `Tem certeza que deseja remover o produto "${product.name}"?\n` +
        'O histórico de vendas e movimentações permanecerá seguro e registrado.',
      )
    ) {
      return
    }
    setError(null)
    setNotice(null)
    try {
      await archiveProduct(product.id)
      setNotice('Produto arquivado. Você pode restaurá-lo a qualquer momento.')
      if (editingProduct?.id === product.id) {
        resetForm()
      }
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

  const selectedProduct = products.find((p) => p.id === selectedProductId)

  return (
    <section id="products-manager-section" className="customer-manager product-manager" aria-labelledby="products-heading">
      <div className="customer-header">
        <div>
          <span className="eyebrow">GESTÃO DO NEGÓCIO</span>
          <h2 id="products-heading">Produtos</h2>
          <span className="customer-subheading">Itens da Loja</span>
          <p>Cadastre, altere preços e visualize os produtos e itens disponíveis na loja.</p>
        </div>
        <div className="customer-header-actions">
          <button
            className="customer-primary-button"
            type="button"
            onClick={openNewForm}
          >
            Adicionar produto
          </button>
        </div>
      </div>

      {error && <p className="customer-message customer-error" role="alert">{error}</p>}
      {notice && <p className="customer-message customer-success" role="status">{notice}</p>}

      {isFormOpen && (
        <form className="customer-java-panel" onSubmit={handleSubmit}>
          <div className="customer-panel-title">
            <span>{editingProduct ? '✏️ Editar Produto' : '➕ Novo Produto da Loja'}</span>
            <span className="customer-hint-inline">* Campo obrigatório</span>
          </div>

          <div className="customer-fields-row">
            <div className="customer-field-item field-nome" style={{ flex: '2 1 220px' }}>
              <label htmlFor="product-name">Nome *</label>
              <input
                ref={nameInputRef}
                id="product-name"
                value={form.name}
                onChange={(event) => changeField('name', event.target.value)}
                maxLength={200}
                placeholder="Ex: Coleira, Bandana, Ração..."
                required
                disabled={isSaving}
              />
            </div>

            <div className="customer-field-item field-preco" style={{ flex: '1 1 140px', maxWidth: '180px' }}>
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
            </div>

            <div className="customer-field-item field-imagem" style={{ flex: '3 1 260px' }}>
              <label htmlFor="product-image-url">URL da imagem</label>
              <input
                id="product-image-url"
                type="url"
                value={form.image_url}
                onChange={(event) => changeField('image_url', event.target.value)}
                placeholder="https://... ou caminho da imagem"
                disabled={isSaving}
              />
            </div>
          </div>

          <div className="customer-actions-toolbar">
            <div className="customer-toolbar-buttons">
              <button
                className="customer-btn-action btn-add"
                type="submit"
                disabled={isSaving}
              >
                {isSaving ? 'Salvando…' : editingProduct ? 'Salvar alterações' : 'Cadastrar'}
              </button>

              {editingProduct && (
                <button
                  className="customer-btn-action btn-cancel"
                  type="button"
                  onClick={resetForm}
                  disabled={isSaving}
                >
                  Cancelar Edição
                </button>
              )}

              {selectedProduct && selectedProduct.image_url && (
                <button
                  className="customer-btn-action btn-preview-img"
                  type="button"
                  onClick={() => setPreviewImage({ url: selectedProduct.image_url!, name: selectedProduct.name })}
                >
                  👁️ Visualizar Imagem
                </button>
              )}
            </div>
          </div>
        </form>
      )}

      <div className="customer-filter-toolbar">
        <form
          className="customer-search-inline"
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
            onChange={(event) => {
              const val = event.target.value
              setSearchInput(val)
              if (val === '') {
                setSearch('')
                setPage(0)
              }
            }}
            placeholder="Nome do produto"
          />
          <button className="customer-btn-filter" type="submit">Buscar</button>
        </form>

        <div className="customer-toolbar-right">
          {selectedProduct && !selectedProduct.archived_at && (
            <div className="customer-selected-actions">
              <span>Selecionado: <strong>{selectedProduct.name}</strong></span>
              <button
                type="button"
                className="customer-btn-action btn-edit"
                onClick={() => beginEdit(selectedProduct)}
              >
                Editar
              </button>
              <button
                type="button"
                className="customer-btn-action btn-delete"
                onClick={() => void handleArchive(selectedProduct)}
              >
                Remover
              </button>
            </div>
          )}

          <label className="archived-toggle-inline">
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
      </div>

      <div className="customer-table-section">
        <div className="customer-table-header-info">
          <div className="customer-table-stats">
            <strong>Lista de Produtos</strong>
            <span>({total} {total === 1 ? 'produto' : 'produtos'})</span>
            <span className="customer-table-tip">💡 Duplo clique para editar ou clique na miniatura para ampliar</span>
          </div>

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
            <table className="customer-table customer-table-centered product-table-styled">
              <thead>
                <tr>
                  <th scope="col" style={{ width: '55px' }}>ID</th>
                  <th scope="col" style={{ width: '80px' }}>Thumbnail</th>
                  <th scope="col">Nome</th>
                  <th scope="col" style={{ width: '140px' }}>Preço</th>
                  <th scope="col" style={{ width: '85px' }}>Status</th>
                  <th scope="col" style={{ width: '140px' }}><span className="visually-hidden">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {products.map((product, index) => {
                  const isSelected = selectedProductId === product.id
                  const isEditingThis = editingProduct?.id === product.id

                  return (
                    <tr
                      key={product.id}
                      className={`${isSelected ? 'is-selected-row' : ''} ${isEditingThis ? 'is-editing-row' : ''}`}
                      onClick={() => setSelectedProductId(product.id)}
                      onDoubleClick={() => beginEdit(product)}
                      title="Clique para selecionar ou duplo clique para editar"
                    >
                      <td data-label="ID" className="cell-center text-muted">
                        {page * PRODUCT_PAGE_SIZE + index + 1}
                      </td>
                      <td data-label="Thumbnail" className="cell-center">
                        {product.image_url ? (
                          <button
                            type="button"
                            className="product-thumbnail-btn"
                            title="Clique para ampliar a imagem"
                            onClick={(e) => {
                              e.stopPropagation()
                              setPreviewImage({ url: product.image_url!, name: product.name })
                            }}
                          >
                            <img
                              className="product-image-thumbnail-styled"
                              src={product.image_url}
                              alt={product.name}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          </button>
                        ) : (
                          <span className="product-image-placeholder-styled" aria-label="Sem imagem">
                            Sem foto
                          </span>
                        )}
                      </td>
                      <td data-label="Produto" className="cell-left">
                        <strong className="product-name-highlight">{product.name}</strong>
                      </td>
                      <td data-label="Preço" className="cell-center">
                        <span className="product-price-blue">{formatPrice(product.current_price)}</span>
                      </td>
                      <td data-label="Status" className="cell-center">
                        <span className={`customer-status ${product.archived_at ? 'is-archived' : 'is-active'}`}>
                          {product.archived_at ? 'Arquivado' : 'Ativo'}
                        </span>
                      </td>
                      <td className="customer-actions cell-center">
                        {product.archived_at ? (
                          <button
                            type="button"
                            className="customer-link-button"
                            aria-label={`Restaurar ${product.name}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleRestore(product)
                            }}
                          >
                            Restaurar
                          </button>
                        ) : (
                          <div className="customer-row-btns">
                            <button
                              type="button"
                              className="customer-link-button"
                              aria-label={`Editar ${product.name}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                beginEdit(product)
                              }}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="customer-link-button customer-danger-button"
                              aria-label={`Arquivar ${product.name}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                void handleArchive(product)
                              }}
                            >
                              Arquivar
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {previewImage && (
        <div className="product-modal-backdrop" onClick={() => setPreviewImage(null)}>
          <div className="product-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="product-modal-header">
              <h3>Preview da Imagem: {previewImage.name}</h3>
              <button
                type="button"
                className="product-modal-close"
                onClick={() => setPreviewImage(null)}
                aria-label="Fechar preview"
              >
                ✕
              </button>
            </div>
            <div className="product-modal-body">
              <img
                src={previewImage.url}
                alt={previewImage.name}
                className="product-modal-img"
              />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
