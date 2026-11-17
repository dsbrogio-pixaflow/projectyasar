import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from './services/auth'
import {
  archiveCustomer,
  createCustomer,
  listCustomers,
  restoreCustomer,
  updateCustomer,
} from './services/customers'
import type { Customer, CustomerInput } from './services/customers'

const CUSTOMER_PAGE_SIZE = 20

interface CustomerForm {
  full_name: string
  email: string
  phone: string
  delivery_address: string
  birthday: string
}

const EMPTY_FORM: CustomerForm = {
  full_name: '',
  email: '',
  phone: '',
  delivery_address: '',
  birthday: '',
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Sua sessão expirou. Entre novamente.'
    if (error.status === 422) return 'Confira os dados, especialmente o aniversário.'
    return error.message
  }
  if (error instanceof TypeError) return 'Não foi possível conectar à API.'
  if (error instanceof Error) return error.message
  return 'Não foi possível concluir a operação.'
}

function birthdayLabel(customer: Customer): string {
  if (!customer.birthday_day || !customer.birthday_month) return '—'
  return `${String(customer.birthday_day).padStart(2, '0')}/${String(customer.birthday_month).padStart(2, '0')}`
}

function formatBirthdayInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}/${digits.slice(2)}`
}

function formFromCustomer(customer: Customer): CustomerForm {
  return {
    full_name: customer.full_name,
    email: customer.email ?? '',
    phone: customer.phone ?? '',
    delivery_address: customer.delivery_address ?? '',
    birthday: customer.birthday_day && customer.birthday_month
      ? birthdayLabel(customer)
      : '',
  }
}

function inputFromForm(form: CustomerForm): CustomerInput {
  const birthday = form.birthday.trim()
  let birthdayDay: number | null = null
  let birthdayMonth: number | null = null
  if (birthday) {
    const match = /^(\d{1,2})\/(\d{1,2})$/.exec(birthday)
    if (!match) throw new Error('Informe o aniversário no formato DD/MM.')
    birthdayDay = Number(match[1])
    birthdayMonth = Number(match[2])
    const daysByMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if (
      birthdayMonth < 1
      || birthdayMonth > 12
      || birthdayDay < 1
      || birthdayDay > daysByMonth[birthdayMonth - 1]
    ) {
      throw new Error('O dia e o mês do aniversário são inválidos.')
    }
  }

  const fullName = form.full_name.trim()
  if (!fullName) throw new Error('O nome do cliente é obrigatório.')

  return {
    full_name: fullName,
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    delivery_address: form.delivery_address.trim() || null,
    birthday_day: birthdayDay,
    birthday_month: birthdayMonth,
  }
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(true)
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
    listCustomers({
      q: search || undefined,
      include_archived: includeArchived,
      limit: CUSTOMER_PAGE_SIZE,
      offset: page * CUSTOMER_PAGE_SIZE,
    })
      .then((resultPage) => {
        if (!isCurrent) return
        if (resultPage.items.length === 0 && resultPage.total > 0 && page > 0) {
          setPage(Math.max(0, Math.ceil(resultPage.total / CUSTOMER_PAGE_SIZE) - 1))
          return
        }
        setCustomers(resultPage.items)
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
    setEditingCustomer(null)
    setSelectedCustomerId(null)
    setForm(EMPTY_FORM)
    setIsFormOpen(false)
    setError(null)
  }

  function openNewForm() {
    setEditingCustomer(null)
    setSelectedCustomerId(null)
    setForm(EMPTY_FORM)
    setIsFormOpen(true)
    setError(null)
    setNotice(null)
    setTimeout(() => nameInputRef.current?.focus(), 50)
  }

  function beginEdit(customer: Customer) {
    setEditingCustomer(customer)
    setSelectedCustomerId(customer.id)
    setForm(formFromCustomer(customer))
    setIsFormOpen(true)
    setError(null)
    setNotice(null)
    setTimeout(() => nameInputRef.current?.focus(), 50)
  }

  function changeField(field: keyof CustomerForm, value: string) {
    if (field === 'birthday') {
      value = formatBirthdayInput(value)
    }
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)

    let input: CustomerInput
    try {
      input = inputFromForm(form)
    } catch (validationError: unknown) {
      setError(getErrorMessage(validationError))
      return
    }

    setIsSaving(true)
    try {
      if (editingCustomer) {
        await updateCustomer(editingCustomer.id, input)
        setNotice('Cliente atualizado.')
      } else {
        await createCustomer(input)
        setNotice('Cliente cadastrado.')
      }
      resetForm()
      setRefreshKey((key) => key + 1)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleArchive(customer: Customer) {
    if (!window.confirm(`Arquivar o cadastro de ${customer.full_name}?`)) return
    setError(null)
    setNotice(null)
    try {
      await archiveCustomer(customer.id)
      setNotice('Cliente arquivado. Você pode restaurá-lo a qualquer momento.')
      if (editingCustomer?.id === customer.id) {
        resetForm()
      }
      setRefreshKey((key) => key + 1)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError))
    }
  }

  async function handleRestore(customer: Customer) {
    setError(null)
    setNotice(null)
    try {
      await restoreCustomer(customer.id)
      setNotice('Cliente restaurado.')
      setRefreshKey((key) => key + 1)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError))
    }
  }

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId)

  return (
    <section id="customers-manager-section" className="customer-manager" aria-labelledby="customers-heading">
      <div className="customer-header">
        <div>
          <span className="eyebrow">GESTÃO DO NEGÓCIO</span>
          <h2 id="customers-heading">Clientes</h2>
          <span className="customer-subheading">Controle de Clientes</span>
          <p>Consulte e mantenha os dados de contato dos seus clientes.</p>
        </div>
        <div className="customer-header-actions">
          <button
            className="customer-primary-button"
            type="button"
            onClick={openNewForm}
          >
            Adicionar cliente
          </button>
        </div>
      </div>

      {error && <p className="customer-message customer-error" role="alert">{error}</p>}
      {notice && <p className="customer-message customer-success" role="status">{notice}</p>}

      {isFormOpen && (
        <form className="customer-java-panel" onSubmit={handleSubmit}>
          <div className="customer-panel-title">
            <span>{editingCustomer ? '✏️ Editar Cliente' : '➕ Adicionar Cliente'}</span>
            <span className="customer-hint-inline">* Campo obrigatório</span>
          </div>

          <div className="customer-fields-row">
            <div className="customer-field-item field-nome">
              <label htmlFor="customer-full-name">Nome completo *</label>
              <input
                ref={nameInputRef}
                id="customer-full-name"
                value={form.full_name}
                onChange={(event) => changeField('full_name', event.target.value)}
                maxLength={200}
                placeholder="Ex: Maria da Silva"
                autoComplete="name"
                required
                disabled={isSaving}
              />
            </div>

            <div className="customer-field-item field-email">
              <label htmlFor="customer-email">E-mail</label>
              <input
                id="customer-email"
                type="email"
                value={form.email}
                onChange={(event) => changeField('email', event.target.value)}
                maxLength={320}
                placeholder="email@exemplo.com"
                autoComplete="email"
                disabled={isSaving}
              />
            </div>

            <div className="customer-field-item field-telefone">
              <label htmlFor="customer-phone">Telefone</label>
              <input
                id="customer-phone"
                type="tel"
                value={form.phone}
                onChange={(event) => changeField('phone', event.target.value)}
                maxLength={40}
                placeholder="(00) 00000-0000"
                autoComplete="tel"
                disabled={isSaving}
              />
            </div>

            <div className="customer-field-item field-aniversario">
              <label htmlFor="customer-birthday">Aniversário (DD/MM)</label>
              <input
                id="customer-birthday"
                value={form.birthday}
                onChange={(event) => changeField('birthday', event.target.value)}
                placeholder="DD/MM"
                inputMode="numeric"
                maxLength={5}
                disabled={isSaving}
              />
            </div>

            <div className="customer-field-item field-endereco">
              <label htmlFor="customer-address">Endereço de entrega</label>
              <input
                id="customer-address"
                value={form.delivery_address}
                onChange={(event) => changeField('delivery_address', event.target.value)}
                placeholder="Rua, número, bairro, cidade"
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
                {isSaving ? 'Salvando…' : editingCustomer ? 'Salvar alterações' : 'Cadastrar'}
              </button>

              <button
                className="customer-btn-action btn-cancel"
                type="button"
                onClick={resetForm}
                disabled={isSaving}
              >
                Cancelar
              </button>
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
          <label htmlFor="customer-search">Buscar clientes</label>
          <input
            id="customer-search"
            value={searchInput}
            onChange={(event) => {
              const val = event.target.value
              setSearchInput(val)
              if (val === '') {
                setSearch('')
                setPage(0)
              }
            }}
            placeholder="Nome, e-mail ou telefone"
          />
          <button className="customer-btn-filter" type="submit">Buscar</button>
        </form>

        <div className="customer-toolbar-right">
          {selectedCustomer && !selectedCustomer.archived_at && (
            <div className="customer-selected-actions">
              <span>Selecionado: <strong>{selectedCustomer.full_name}</strong></span>
              <button
                type="button"
                className="customer-btn-action btn-edit"
                onClick={() => beginEdit(selectedCustomer)}
              >
                Editar
              </button>
              <button
                type="button"
                className="customer-btn-action btn-delete"
                onClick={() => void handleArchive(selectedCustomer)}
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
            <strong>Lista de Clientes</strong>
            <span>({total} {total === 1 ? 'cliente' : 'clientes'})</span>
            <span className="customer-table-tip">💡 Duplo clique na linha para editar</span>
          </div>

          {total > CUSTOMER_PAGE_SIZE && (
            <nav className="customer-pagination" aria-label="Paginação de clientes">
              <button
                type="button"
                className="customer-secondary-button"
                onClick={() => setPage((currentPage) => Math.max(0, currentPage - 1))}
                disabled={page === 0 || isLoading}
              >
                Anterior
              </button>
              <span aria-live="polite">
                Página {page + 1} de {Math.ceil(total / CUSTOMER_PAGE_SIZE)}
              </span>
              <button
                type="button"
                className="customer-secondary-button"
                onClick={() => setPage((currentPage) => currentPage + 1)}
                disabled={(page + 1) * CUSTOMER_PAGE_SIZE >= total || isLoading}
              >
                Próxima
              </button>
            </nav>
          )}
        </div>

        {isLoading ? (
          <p className="customer-empty" role="status">Carregando clientes…</p>
        ) : customers.length === 0 ? (
          <p className="customer-empty">
            {search
              ? 'Nenhum cliente corresponde à busca.'
              : 'Nenhum cliente cadastrado ainda.'}
          </p>
        ) : (
          <div className="customer-table-wrap">
            <table className="customer-table customer-table-centered">
              <thead>
                <tr>
                  <th scope="col" style={{ width: '55px' }}>ID</th>
                  <th scope="col">Nome</th>
                  <th scope="col">Contato</th>
                  <th scope="col" style={{ width: '110px' }}>Aniversário</th>
                  <th scope="col">Endereço de Entrega</th>
                  <th scope="col" style={{ width: '85px' }}>Status</th>
                  <th scope="col" style={{ width: '140px' }}><span className="visually-hidden">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer, index) => {
                  const isSelected = selectedCustomerId === customer.id
                  const isEditingThis = editingCustomer?.id === customer.id

                  return (
                    <tr
                      key={customer.id}
                      className={`${isSelected ? 'is-selected-row' : ''} ${isEditingThis ? 'is-editing-row' : ''}`}
                      onClick={() => setSelectedCustomerId(customer.id)}
                      onDoubleClick={() => beginEdit(customer)}
                      title="Clique para selecionar ou duplo clique para editar"
                    >
                      <td data-label="ID" className="cell-center text-muted">
                        {page * CUSTOMER_PAGE_SIZE + index + 1}
                      </td>
                      <td data-label="Nome" className="cell-left">
                        <strong>{customer.full_name}</strong>
                      </td>
                      <td data-label="Contato" className="cell-center">
                        <div>{customer.email || '—'}</div>
                        {customer.phone && <div className="customer-secondary-text">{customer.phone}</div>}
                      </td>
                      <td data-label="Aniversário" className="cell-center">
                        <span className="birthday-pill">{birthdayLabel(customer)}</span>
                      </td>
                      <td data-label="Endereço" className="cell-left">
                        {customer.delivery_address || '—'}
                      </td>
                      <td data-label="Status" className="cell-center">
                        <span className={`customer-status ${customer.archived_at ? 'is-archived' : 'is-active'}`}>
                          {customer.archived_at ? 'Arquivado' : 'Ativo'}
                        </span>
                      </td>
                      <td className="customer-actions cell-center">
                        {customer.archived_at ? (
                          <button
                            type="button"
                            className="customer-link-button"
                            aria-label={`Restaurar ${customer.full_name}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleRestore(customer)
                            }}
                          >
                            Restaurar
                          </button>
                        ) : (
                          <div className="customer-row-btns">
                            <button
                              type="button"
                              className="customer-link-button"
                              aria-label={`Editar ${customer.full_name}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                beginEdit(customer)
                              }}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="customer-link-button customer-danger-button"
                              aria-label={`Arquivar ${customer.full_name}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                void handleArchive(customer)
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
    </section>
  )
}
