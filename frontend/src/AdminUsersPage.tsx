import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from './services/auth'
import {
  deleteAdminUser,
  listAdminUsers,
  updateAdminUser,
} from './services/adminUsers'
import type {
  AdminUser,
  AdminUserRole,
  AdminUserStatus,
} from './services/adminUsers'

const USER_PAGE_SIZE = 20
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' })

interface AdminUsersPageProps {
  currentUserId: string
  onCurrentUserUpdated: (user: AdminUser, accessChanged: boolean) => void
  onCurrentUserDeleted: () => void
}

interface AdminUserForm {
  full_name: string
  email: string
  role: AdminUserRole
  status: AdminUserStatus
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Sua sessão expirou. Entre novamente.'
    if (error.status === 403) return 'Apenas administradores podem gerenciar usuários.'
    if (error.status === 404) return 'Este usuário não foi encontrado. Atualize a lista.'
    if (error.status === 409) {
      return 'O e-mail já está em uso ou a operação deixaria o sistema sem administrador ativo.'
    }
    if (error.status === 422) return error.message
    return error.message
  }
  if (error instanceof TypeError) return 'Não foi possível conectar à API.'
  if (error instanceof Error) return error.message
  return 'Não foi possível concluir a operação.'
}

function formFromUser(user: AdminUser): AdminUserForm {
  return {
    full_name: user.full_name,
    email: user.email,
    role: user.role,
    status: user.status,
  }
}

function roleLabel(role: AdminUserRole): string {
  return role === 'admin' ? 'Administrador' : 'Usuário'
}

function statusLabel(userStatus: AdminUserStatus): string {
  return userStatus === 'active' ? 'Ativo' : 'Inativo'
}

export default function AdminUsersPage({
  currentUserId,
  onCurrentUserUpdated,
  onCurrentUserDeleted,
}: AdminUsersPageProps) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<AdminUserRole | ''>('')
  const [statusFilter, setStatusFilter] = useState<AdminUserStatus | ''>('')
  const [page, setPage] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)
  const [loadedQueryKey, setLoadedQueryKey] = useState<string | null>(null)
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [form, setForm] = useState<AdminUserForm | null>(null)
  const [deletingUser, setDeletingUser] = useState<AdminUser | null>(null)
  const [confirmationEmail, setConfirmationEmail] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const queryKey = JSON.stringify([
    search,
    roleFilter,
    statusFilter,
    page,
    refreshKey,
  ])
  const isLoading = loadedQueryKey !== queryKey

  useEffect(() => {
    let isCurrent = true
    listAdminUsers({
      q: search || undefined,
      role: roleFilter || undefined,
      status: statusFilter || undefined,
      limit: USER_PAGE_SIZE,
      offset: page * USER_PAGE_SIZE,
    })
      .then((resultPage) => {
        if (!isCurrent) return
        if (resultPage.items.length === 0 && resultPage.total > 0 && page > 0) {
          setPage(Math.max(0, Math.ceil(resultPage.total / USER_PAGE_SIZE) - 1))
          return
        }
        setUsers(resultPage.items)
        setTotal(resultPage.total)
      })
      .catch((requestError: unknown) => {
        if (isCurrent) {
          setUsers([])
          setTotal(0)
          setError(getErrorMessage(requestError))
        }
      })
      .finally(() => {
        if (isCurrent) setLoadedQueryKey(queryKey)
      })

    return () => {
      isCurrent = false
    }
  }, [search, roleFilter, statusFilter, page, refreshKey, queryKey])

  function closeForms() {
    setEditingUser(null)
    setForm(null)
    setDeletingUser(null)
    setConfirmationEmail('')
  }

  function beginEdit(user: AdminUser) {
    setEditingUser(user)
    setForm(formFromUser(user))
    setDeletingUser(null)
    setConfirmationEmail('')
    setError(null)
    setNotice(null)
  }

  function changeField<K extends keyof AdminUserForm>(
    field: K,
    value: AdminUserForm[K],
  ) {
    setForm((current) => current ? { ...current, [field]: value } : current)
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingUser || !form) return
    const fullName = form.full_name.trim()
    const email = form.email.trim()
    if (!fullName || !email) {
      setError('Nome e e-mail são obrigatórios.')
      return
    }
    setError(null)
    setNotice(null)
    setIsSaving(true)
    try {
      const savedUser = await updateAdminUser(editingUser.id, {
        full_name: fullName,
        email,
        role: form.role,
        status: form.status,
      })
      const accessChanged = (
        savedUser.role !== editingUser.role
        || savedUser.status !== editingUser.status
      )
      if (savedUser.id === currentUserId) {
        onCurrentUserUpdated(savedUser, accessChanged)
        if (accessChanged) return
      }
      setNotice('Usuário atualizado.')
      closeForms()
      setRefreshKey((key) => key + 1)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!deletingUser) return
    if (confirmationEmail.trim().toLowerCase() !== deletingUser.email.toLowerCase()) {
      setError('Digite o e-mail correspondente à conta para confirmar a exclusão.')
      return
    }
    setError(null)
    setNotice(null)
    setIsDeleting(true)
    try {
      await deleteAdminUser(deletingUser.id, confirmationEmail.trim())
      if (deletingUser.id === currentUserId) {
        onCurrentUserDeleted()
        return
      }
      setNotice('Usuário excluído. Os registros do negócio foram preservados.')
      closeForms()
      setRefreshKey((key) => key + 1)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsDeleting(false)
    }
  }

  function beginDelete(user: AdminUser) {
    setDeletingUser(user)
    setEditingUser(null)
    setForm(null)
    setConfirmationEmail('')
    setError(null)
    setNotice(null)
  }

  return (
    <section className="customer-manager admin-users-manager" aria-labelledby="admin-users-heading">
      <div className="customer-header">
        <div>
          <span className="eyebrow">ACESSO RESTRITO</span>
          <h2 id="admin-users-heading">Administração de usuários</h2>
          <p>Gerencie contas, perfis e acessos do sistema.</p>
        </div>
      </div>

      {error && <p className="customer-message customer-error" role="alert">{error}</p>}
      {notice && <p className="customer-message customer-success" role="status">{notice}</p>}

      {form && editingUser && (
        <form className="customer-form" onSubmit={(event) => void handleSave(event)}>
          <div className="customer-form-heading">
            <h3>Editar {editingUser.full_name}</h3>
            <span>Alterações de perfil ou status encerram as sessões do usuário.</span>
          </div>
          <div className="customer-form-grid">
            <div className="customer-field">
              <label htmlFor="admin-user-name">Nome completo *</label>
              <input
                id="admin-user-name"
                value={form.full_name}
                onChange={(event) => changeField('full_name', event.target.value)}
                maxLength={200}
                required
                disabled={isSaving}
              />
            </div>
            <div className="customer-field">
              <label htmlFor="admin-user-email">E-mail *</label>
              <input
                id="admin-user-email"
                type="email"
                value={form.email}
                onChange={(event) => changeField('email', event.target.value)}
                maxLength={320}
                required
                disabled={isSaving}
              />
            </div>
            <div className="customer-field">
              <label htmlFor="admin-user-role">Perfil *</label>
              <select
                id="admin-user-role"
                value={form.role}
                onChange={(event) => {
                  if (event.target.value === 'admin' || event.target.value === 'user') {
                    changeField('role', event.target.value)
                  }
                }}
                disabled={isSaving}
              >
                <option value="user">Usuário</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
            <div className="customer-field">
              <label htmlFor="admin-user-status">Status *</label>
              <select
                id="admin-user-status"
                value={form.status}
                onChange={(event) => {
                  if (event.target.value === 'active' || event.target.value === 'inactive') {
                    changeField('status', event.target.value)
                  }
                }}
                disabled={isSaving}
              >
                <option value="active">Ativo</option>
                <option value="inactive">Inativo</option>
              </select>
            </div>
          </div>
          <div className="customer-form-actions">
            <button
              className="customer-secondary-button"
              type="button"
              onClick={closeForms}
              disabled={isSaving}
            >
              Cancelar
            </button>
            <button className="customer-primary-button" type="submit" disabled={isSaving}>
              {isSaving ? 'Salvando…' : 'Salvar alterações'}
            </button>
          </div>
        </form>
      )}

      {deletingUser && (
        <form
          className="customer-form admin-delete-confirmation"
          aria-label={`Confirmar exclusão de ${deletingUser.full_name}`}
          onSubmit={(event) => void handleDelete(event)}
        >
          <div className="customer-form-heading">
            <h3>Excluir {deletingUser.full_name}</h3>
            <span>Esta ação é permanente.</span>
          </div>
          <p>
            A conta e suas sessões serão removidas. Vendas, despesas, estoque e demais
            registros do negócio serão preservados, sem vínculo com este usuário.
          </p>
          <div className="customer-field">
            <label htmlFor="admin-delete-confirm-email">
              Digite {deletingUser.email} para confirmar
            </label>
            <input
              id="admin-delete-confirm-email"
              type="email"
              value={confirmationEmail}
              onChange={(event) => setConfirmationEmail(event.target.value)}
              autoComplete="off"
              required
              disabled={isDeleting}
            />
          </div>
          <div className="customer-form-actions">
            <button
              className="customer-secondary-button"
              type="button"
              onClick={closeForms}
              disabled={isDeleting}
            >
              Cancelar
            </button>
            <button
              className="customer-danger-action"
              type="submit"
              disabled={isDeleting}
            >
              {isDeleting ? 'Excluindo…' : 'Confirmar exclusão'}
            </button>
          </div>
        </form>
      )}

      <div className="customer-tools admin-user-tools">
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
          <label htmlFor="admin-user-search">Buscar usuários</label>
          <input
            id="admin-user-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Nome ou e-mail"
          />
          <button className="customer-secondary-button" type="submit">Buscar</button>
        </form>
        <div className="admin-user-filters">
          <label>
            Perfil
            <select
              aria-label="Filtrar por perfil"
              value={roleFilter}
              onChange={(event) => {
                setError(null)
                setPage(0)
                if (event.target.value === 'admin' || event.target.value === 'user') {
                  setRoleFilter(event.target.value)
                } else {
                  setRoleFilter('')
                }
              }}
            >
              <option value="">Todos</option>
              <option value="admin">Administradores</option>
              <option value="user">Usuários</option>
            </select>
          </label>
          <label>
            Status
            <select
              aria-label="Filtrar por status"
              value={statusFilter}
              onChange={(event) => {
                setError(null)
                setPage(0)
                if (event.target.value === 'active' || event.target.value === 'inactive') {
                  setStatusFilter(event.target.value)
                } else {
                  setStatusFilter('')
                }
              }}
            >
              <option value="">Todos</option>
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
            </select>
          </label>
        </div>
      </div>

      <div className="customer-list-heading">
        <h3>Usuários</h3>
        <span>{total} {total === 1 ? 'usuário' : 'usuários'}</span>
        {total > USER_PAGE_SIZE && (
          <nav className="customer-pagination" aria-label="Paginação de usuários">
            <button
              type="button"
              className="customer-secondary-button"
              onClick={() => setPage((currentPage) => Math.max(0, currentPage - 1))}
              disabled={page === 0 || isLoading}
            >
              Anterior
            </button>
            <span aria-live="polite">
              Página {page + 1} de {Math.ceil(total / USER_PAGE_SIZE)}
            </span>
            <button
              type="button"
              className="customer-secondary-button"
              onClick={() => setPage((currentPage) => currentPage + 1)}
              disabled={(page + 1) * USER_PAGE_SIZE >= total || isLoading}
            >
              Próxima
            </button>
          </nav>
        )}
      </div>

      {isLoading ? (
        <p className="customer-empty" role="status">Carregando usuários…</p>
      ) : users.length === 0 ? (
        <p className="customer-empty">
          {search || roleFilter || statusFilter
            ? 'Nenhum usuário corresponde aos filtros.'
            : 'Nenhum usuário cadastrado.'}
        </p>
      ) : (
        <div className="customer-table-wrap">
          <table className="customer-table">
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">E-mail</th>
                <th scope="col">Perfil</th>
                <th scope="col">Status</th>
                <th scope="col">Cadastro</th>
                <th scope="col"><span className="visually-hidden">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td data-label="Nome"><strong>{user.full_name}</strong></td>
                  <td data-label="E-mail">{user.email}</td>
                  <td data-label="Perfil">{roleLabel(user.role)}</td>
                  <td data-label="Status">
                    <span className={`customer-status${user.status === 'inactive' ? ' is-archived' : ''}`}>
                      {statusLabel(user.status)}
                    </span>
                  </td>
                  <td data-label="Cadastro">
                    {dateFormatter.format(new Date(user.created_at))}
                  </td>
                  <td data-label="Ações" className="customer-actions admin-user-actions">
                    <button
                      type="button"
                      className="customer-link-button"
                      onClick={() => beginEdit(user)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="customer-link-button customer-danger-button"
                      onClick={() => beginDelete(user)}
                    >
                      Excluir
                    </button>
                    {user.id === currentUserId && (
                      <span className="customer-secondary-text">Você</span>
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
