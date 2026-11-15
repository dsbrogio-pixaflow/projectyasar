import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from './services/auth'
import {
  cancelExpense,
  createExpense,
  createExpenseCategory,
  getFinancialSummary,
  listExpenseCategories,
  listExpenses,
} from './services/finance'
import type {
  Expense,
  ExpenseCategory,
  ExpenseStatus,
  FinancialSummary,
} from './services/finance'

const PAGE_SIZE = 20
const MAX_AMOUNT_CENTS = 999_999_999_999n
const statusLabels: Record<ExpenseStatus, string> = {
  posted: 'Registrada',
  cancelled: 'Cancelada',
}
const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 0,
})

function todayAsLocalDate(): string {
  const today = new Date()
  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-')
}

function parseAmountCents(value: string): bigint | null {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(value.trim())
  if (!match) return null
  const whole = match[1].replace(/^0+(?=\d)/, '')
  const fraction = (match[2] ?? '').padEnd(2, '0')
  return BigInt(whole) * 100n + BigInt(fraction)
}

function normalizeAmount(value: string): string {
  const cents = parseAmountCents(value)
  if (cents === null || cents <= 0n) {
    throw new Error('Informe um valor maior que zero com até duas casas decimais.')
  }
  if (cents > MAX_AMOUNT_CENTS) {
    throw new Error('O valor não pode exceder R$ 9.999.999.999,99.')
  }
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
}

function formatCurrency(value: string | number): string {
  const match = /^(-?)(\d+)(?:[.,](\d{1,2}))?$/.exec(String(value))
  if (!match) return '—'
  const whole = currencyFormatter.format(Number(match[2]))
  const fraction = (match[3] ?? '').padEnd(2, '0')
  return `${match[1] ? '-R$' : 'R$'} ${whole},${fraction}`
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  )
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Sua sessão expirou. Entre novamente.'
    if (error.status === 404) return 'A categoria ou o lançamento não foi encontrado.'
    if (error.status === 409) return error.message
    if (error.status === 422) return 'Confira a data, a categoria e o valor maior que zero.'
    return error.message
  }
  if (error instanceof TypeError) return 'Não foi possível conectar à API.'
  if (error instanceof Error) return error.message
  return 'Não foi possível concluir a operação.'
}

export default function FinancePage() {
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [isLoadingCategories, setIsLoadingCategories] = useState(true)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [expenseDate, setExpenseDate] = useState(todayAsLocalDate())
  const [categoryId, setCategoryId] = useState('')
  const [amount, setAmount] = useState('')
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [summary, setSummary] = useState<FinancialSummary | null>(null)
  const [total, setTotal] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | ExpenseStatus>('all')
  const [page, setPage] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)
  const [loadedQueryKey, setLoadedQueryKey] = useState<string | null>(null)
  const [isSavingExpense, setIsSavingExpense] = useState(false)
  const [isAddingCategory, setIsAddingCategory] = useState(false)
  const [cancellingExpenseId, setCancellingExpenseId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const queryKey = JSON.stringify([search, statusFilter, page, refreshKey])
  const isLoadingExpenses = loadedQueryKey !== queryKey

  useEffect(() => {
    let isCurrent = true
    listExpenseCategories()
      .then((result) => {
        if (!isCurrent) return
        setCategories(result)
        setCategoryId((current) => current || result[0]?.id || '')
      })
      .catch((requestError: unknown) => {
        if (isCurrent) setError(getErrorMessage(requestError))
      })
      .finally(() => {
        if (isCurrent) setIsLoadingCategories(false)
      })
    return () => {
      isCurrent = false
    }
  }, [])

  useEffect(() => {
    let isCurrent = true
    Promise.all([
      listExpenses({
        q: search || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
      getFinancialSummary(),
    ])
      .then(([expensePage, financialSummary]) => {
        if (!isCurrent) return
        if (expensePage.items.length === 0 && expensePage.total > 0 && page > 0) {
          setPage(Math.max(0, Math.ceil(expensePage.total / PAGE_SIZE) - 1))
          return
        }
        setExpenses(expensePage.items)
        setTotal(expensePage.total)
        setSummary(financialSummary)
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

  async function handleAddCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newCategoryName.trim()
    if (!name) {
      setError('Informe o nome da categoria.')
      return
    }
    setError(null)
    setNotice(null)
    setIsAddingCategory(true)
    try {
      const category = await createExpenseCategory(name)
      setCategories((current) => [...current, category])
      setCategoryId(category.id)
      setNewCategoryName('')
      setNotice('Categoria adicionada.')
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsAddingCategory(false)
    }
  }

  async function handleSubmitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    let normalizedAmount: string
    try {
      if (!categoryId || !expenseDate) {
        throw new Error('Selecione uma categoria e informe a data do lançamento.')
      }
      normalizedAmount = normalizeAmount(amount)
    } catch (validationError: unknown) {
      setError(getErrorMessage(validationError))
      return
    }

    setIsSavingExpense(true)
    try {
      await createExpense({
        category_id: categoryId,
        expense_date: expenseDate,
        amount: normalizedAmount,
      })
      setNotice('Lançamento financeiro registrado.')
      setAmount('')
      setExpenseDate(todayAsLocalDate())
      setPage(0)
      setRefreshKey((key) => key + 1)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsSavingExpense(false)
    }
  }

  async function handleCancelExpense(expense: Expense) {
    const reason = window.prompt(
      `Informe o motivo para cancelar a despesa de ${expense.category_name_snapshot}:`,
    )
    if (reason === null) return
    if (!reason.trim()) {
      setError('Informe um motivo para cancelar o lançamento.')
      return
    }
    setError(null)
    setNotice(null)
    setCancellingExpenseId(expense.id)
    try {
      await cancelExpense(expense.id, reason.trim())
      setNotice('Lançamento cancelado. O histórico foi preservado.')
      setRefreshKey((key) => key + 1)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError))
    } finally {
      setCancellingExpenseId(null)
    }
  }

  return (
    <section className="customer-manager finance-manager" aria-labelledby="finance-heading">
      <div className="customer-header">
        <div>
          <span className="eyebrow">GESTÃO DO NEGÓCIO</span>
          <h2 id="finance-heading">Financeiro</h2>
          <p>Registre despesas e acompanhe o resultado das vendas concluídas.</p>
        </div>
      </div>

      {error && <p className="customer-message customer-error" role="alert">{error}</p>}
      {notice && <p className="customer-message customer-success" role="status">{notice}</p>}

      {summary && (
        <section className="finance-summary" aria-label="Resumo financeiro">
          <article>
            <span>Total de vendas</span>
            <strong>{formatCurrency(summary.total_sales)}</strong>
          </article>
          <article>
            <span>Despesas registradas</span>
            <strong>{formatCurrency(summary.total_expenses)}</strong>
          </article>
          <article>
            <span>Resultado</span>
            <strong className={Number(summary.net_result) < 0 ? 'finance-negative' : ''}>
              {formatCurrency(summary.net_result)}
            </strong>
          </article>
        </section>
      )}

      <section className="customer-form" aria-labelledby="new-expense-heading">
        <div className="customer-form-heading">
          <h3 id="new-expense-heading">Registrar despesa</h3>
          <span>* Campo obrigatório</span>
        </div>

        <form className="finance-category-form" onSubmit={(event) => void handleAddCategory(event)}>
          <label htmlFor="new-expense-category">Adicionar categoria</label>
          <div>
            <input
              id="new-expense-category"
              value={newCategoryName}
              onChange={(event) => setNewCategoryName(event.target.value)}
              maxLength={120}
              placeholder="Ex.: Transporte"
              disabled={isAddingCategory}
            />
            <button
              className="customer-secondary-button"
              type="submit"
              disabled={isAddingCategory}
            >
              {isAddingCategory ? 'Adicionando…' : 'Adicionar'}
            </button>
          </div>
        </form>

        <form onSubmit={(event) => void handleSubmitExpense(event)}>
          <div className="customer-form-grid">
            <div className="customer-field">
              <label htmlFor="expense-date">Data *</label>
              <input
                id="expense-date"
                type="date"
                value={expenseDate}
                onChange={(event) => setExpenseDate(event.target.value)}
                required
                disabled={isSavingExpense}
              />
            </div>
            <div className="customer-field">
              <label htmlFor="expense-category">Categoria *</label>
              <select
                id="expense-category"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                required
                disabled={isLoadingCategories || isSavingExpense || categories.length === 0}
              >
                <option value="" disabled>Selecione uma categoria</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </div>
            <div className="customer-field">
              <label htmlFor="expense-amount">Valor (R$) *</label>
              <input
                id="expense-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                required
                disabled={isSavingExpense}
              />
              <span className="customer-hint">O valor deve ser maior que zero.</span>
            </div>
          </div>
          {categories.length === 0 && !isLoadingCategories && (
            <p className="customer-hint">Adicione uma categoria para registrar despesas.</p>
          )}
          <div className="customer-form-actions">
            <button
              className="customer-primary-button"
              type="submit"
              disabled={isSavingExpense || isLoadingCategories || categories.length === 0}
            >
              {isSavingExpense ? 'Registrando…' : 'Registrar pagamento'}
            </button>
          </div>
        </form>
      </section>

      <section className="finance-expenses" aria-labelledby="expenses-heading">
        <div className="customer-list-heading">
          <h3 id="expenses-heading">Lançamentos financeiros</h3>
          <span>{total} {total === 1 ? 'lançamento' : 'lançamentos'}</span>
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
            <label htmlFor="expenses-search">Buscar por categoria</label>
            <input
              id="expenses-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Nome da categoria"
            />
            <button className="customer-secondary-button" type="submit">Buscar</button>
          </form>
          <label className="finance-status-filter">
            Situação
            <select
              value={statusFilter}
              onChange={(event) => {
                setPage(0)
                if (event.target.value === 'all') setStatusFilter('all')
                else if (event.target.value === 'posted' || event.target.value === 'cancelled') {
                  setStatusFilter(event.target.value)
                }
              }}
            >
              <option value="all">Todas</option>
              <option value="posted">Registradas</option>
              <option value="cancelled">Canceladas</option>
            </select>
          </label>
        </div>

        <div className="customer-list-heading">
          <span>Mais recentes</span>
          {total > PAGE_SIZE && (
            <nav className="customer-pagination" aria-label="Paginação de lançamentos">
              <button
                type="button"
                className="customer-secondary-button"
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                disabled={page === 0 || isLoadingExpenses}
              >
                Anterior
              </button>
              <span aria-live="polite">
                Página {page + 1} de {Math.ceil(total / PAGE_SIZE)}
              </span>
              <button
                type="button"
                className="customer-secondary-button"
                onClick={() => setPage((current) => current + 1)}
                disabled={(page + 1) * PAGE_SIZE >= total || isLoadingExpenses}
              >
                Próxima
              </button>
            </nav>
          )}
        </div>

        {isLoadingExpenses ? (
          <p className="customer-empty" role="status">Carregando lançamentos…</p>
        ) : expenses.length === 0 ? (
          <p className="customer-empty">
            {search ? 'Nenhum lançamento corresponde à busca.' : 'Nenhum lançamento registrado.'}
          </p>
        ) : (
          <div className="customer-table-wrap">
            <table className="customer-table">
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col">Categoria</th>
                  <th scope="col">Valor</th>
                  <th scope="col">Situação</th>
                  <th scope="col"><span className="visually-hidden">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td data-label="Data">{formatDate(expense.expense_date)}</td>
                    <td data-label="Categoria"><strong>{expense.category_name_snapshot}</strong></td>
                    <td data-label="Valor">{formatCurrency(expense.amount)}</td>
                    <td data-label="Situação">
                      <span className={`customer-status${expense.status === 'cancelled' ? ' is-archived' : ''}`}>
                        {statusLabels[expense.status]}
                      </span>
                      {expense.cancellation_reason && (
                        <span className="customer-secondary-text">
                          Motivo: {expense.cancellation_reason}
                        </span>
                      )}
                    </td>
                    <td className="customer-actions">
                      {expense.status === 'posted' && (
                        <button
                          type="button"
                          className="customer-link-button customer-danger-button"
                          aria-label={`Cancelar lançamento de ${expense.category_name_snapshot}`}
                          onClick={() => void handleCancelExpense(expense)}
                          disabled={cancellingExpenseId === expense.id}
                        >
                          {cancellingExpenseId === expense.id ? 'Cancelando…' : 'Cancelar'}
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
