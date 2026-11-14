import { useEffect, useState } from 'react'
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

function CustomerFormFields({
  value,
  onChange,
  disabled,
}: {
  value: CustomerForm
  onChange: (field: keyof CustomerForm, nextValue: string) => void
  disabled: boolean
}) {
  return (
    <>
      <div className="customer-field customer-field-wide">
        <label htmlFor="customer-full-name">Nome completo *</label>
        <input
          id="customer-full-name"
          value={value.full_name}
          onChange={(event) => onChange('full_name', event.target.value)}
          maxLength={200}
          autoComplete="name"
          required
          disabled={disabled}
        />
      </div>
      <div className="customer-field">
        <label htmlFor="customer-email">E-mail</label>
        <input
          id="customer-email"
          type="email"
          value={value.email}
          onChange={(event) => onChange('email', event.target.value)}
          maxLength={320}
          autoComplete="email"
          disabled={disabled}
        />
      </div>
      <div className="customer-field">
        <label htmlFor="customer-phone">Telefone</label>
        <input
          id="customer-phone"
          type="tel"
          value={value.phone}
          onChange={(event) => onChange('phone', event.target.value)}
          maxLength={40}
          autoComplete="tel"
          disabled={disabled}
        />
      </div>
      <div className="customer-field">
        <label htmlFor="customer-birthday">Aniversário (DD/MM)</label>
        <input
          id="customer-birthday"
          value={value.birthday}
          onChange={(event) => onChange('birthday', event.target.value)}
          placeholder="29/02"
          inputMode="numeric"
          maxLength={5}
          disabled={disabled}
        />
        <span className="customer-hint">O ano não é armazenado.</span>
      </div>
      <div className="customer-field customer-field-wide">
        <label htmlFor="customer-address">Endereço de entrega</label>
        <textarea
          id="customer-address"
          value={value.delivery_address}
          onChange={(event) => onChange('delivery_address', event.target.value)}
          rows={2}
          disabled={disabled}
        />
      </div>
    </>
  )
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
    setForm(EMPTY_FORM)
    setIsFormOpen(false)
  }

  function beginEdit(customer: Customer) {
    setEditingCustomer(customer)
    setForm(formFromCustomer(customer))
    setIsFormOpen(true)
    setError(null)
    setNotice(null)
  }

  function changeField(field: keyof CustomerForm, value: string) {
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

  return (
    <section className="customer-manager" aria-labelledby="customers-heading">
      <div className="customer-header">
        <div>
          <span className="eyebrow">GESTÃO DO NEGÓCIO</span>
          <h2 id="customers-heading">Clientes</h2>
          <p>Consulte e mantenha os dados de contato dos seus clientes.</p>
        </div>
        {!isFormOpen && (
          <button
            className="customer-primary-button"
            type="button"
            onClick={() => {
              setEditingCustomer(null)
              setForm(EMPTY_FORM)
              setIsFormOpen(true)
              setError(null)
              setNotice(null)
            }}
          >
            Adicionar cliente
          </button>
        )}
      </div>

      {error && <p className="customer-message customer-error" role="alert">{error}</p>}
      {notice && <p className="customer-message customer-success" role="status">{notice}</p>}

      {isFormOpen && (
        <form className="customer-form" onSubmit={handleSubmit}>
          <div className="customer-form-heading">
            <h3>{editingCustomer ? 'Editar cliente' : 'Novo cliente'}</h3>
            <span>* Campo obrigatório</span>
          </div>
          <div className="customer-form-grid">
            <CustomerFormFields
              value={form}
              onChange={changeField}
              disabled={isSaving}
            />
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
              {isSaving ? 'Salvando…' : editingCustomer ? 'Salvar alterações' : 'Cadastrar'}
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
          <label htmlFor="customer-search">Buscar clientes</label>
          <input
            id="customer-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Nome, e-mail ou telefone"
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
        <h3>Lista de clientes</h3>
        <span>{total} {total === 1 ? 'cliente' : 'clientes'}</span>
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
          <table className="customer-table">
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Contato</th>
                <th scope="col">Aniversário</th>
                <th scope="col">Endereço</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="visually-hidden">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td data-label="Nome">
                    <strong>{customer.full_name}</strong>
                  </td>
                  <td data-label="Contato">
                    <span>{customer.email || '—'}</span>
                    <span className="customer-secondary-text">{customer.phone || ''}</span>
                  </td>
                  <td data-label="Aniversário">{birthdayLabel(customer)}</td>
                  <td data-label="Endereço">{customer.delivery_address || '—'}</td>
                  <td data-label="Status">
                    <span className={`customer-status ${customer.archived_at ? 'is-archived' : ''}`}>
                      {customer.archived_at ? 'Arquivado' : 'Ativo'}
                    </span>
                  </td>
                  <td className="customer-actions">
                    {customer.archived_at ? (
                      <button
                        type="button"
                        className="customer-link-button"
                        aria-label={`Restaurar ${customer.full_name}`}
                        onClick={() => void handleRestore(customer)}
                      >
                        Restaurar
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="customer-link-button"
                          aria-label={`Editar ${customer.full_name}`}
                          onClick={() => beginEdit(customer)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="customer-link-button customer-danger-button"
                          aria-label={`Arquivar ${customer.full_name}`}
                          onClick={() => void handleArchive(customer)}
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
