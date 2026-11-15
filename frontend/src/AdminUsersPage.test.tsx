import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminUsersPage from './AdminUsersPage'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const firstUser = {
  id: 'user-1',
  full_name: 'Ana Costa',
  email: 'ana@example.com',
  role: 'user' as const,
  status: 'active' as const,
  created_at: '2025-01-01T00:00:00Z',
}

const otherUser = {
  ...firstUser,
  id: 'user-2',
  full_name: 'Beatriz Souza',
  email: 'bia@example.com',
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('admin user management', () => {
  it('searches and filters the user list', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input))
      const isSearch = url.searchParams.get('q') === 'bia'
      const items = isSearch ? [otherUser] : [firstUser, otherUser]
      return jsonResponse({
        items,
        total: items.length,
        limit: 20,
        offset: 0,
      })
    })
    const user = userEvent.setup()

    render(
      <AdminUsersPage
        currentUserId="admin-id"
        onCurrentUserUpdated={vi.fn()}
        onCurrentUserDeleted={vi.fn()}
      />,
    )
    expect(await screen.findByText('Ana Costa')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Filtrar por perfil'), 'user')
    await user.selectOptions(screen.getByLabelText('Filtrar por status'), 'active')
    await user.type(screen.getByLabelText('Buscar usuários'), 'bia')
    await user.click(screen.getByRole('button', { name: 'Buscar' }))

    expect(await screen.findByText('Beatriz Souza')).toBeInTheDocument()
    expect(screen.queryByText('Ana Costa')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8000/api/v1/admin/users?limit=20&offset=0&q=bia&role=user&status=active',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('updates users and requires email confirmation before deletion', async () => {
    const fetchMock = vi.mocked(fetch)
    let users = [firstUser]
    fetchMock.mockImplementation(async (_input, init) => {
      if (init?.method === 'PATCH') {
        users = [{ ...firstUser, full_name: 'Ana Costa Nova' }]
        return jsonResponse(users[0])
      }
      if (init?.method === 'DELETE') {
        users = []
        return new Response(null, { status: 204 })
      }
      return jsonResponse({
        items: users,
        total: users.length,
        limit: 20,
        offset: 0,
      })
    })
    const user = userEvent.setup()

    render(
      <AdminUsersPage
        currentUserId="admin-id"
        onCurrentUserUpdated={vi.fn()}
        onCurrentUserDeleted={vi.fn()}
      />,
    )
    const row = await screen.findByRole('row', { name: /Ana Costa/ })
    await user.click(within(row).getByRole('button', { name: 'Editar' }))
    await user.clear(screen.getByLabelText('Nome completo *'))
    await user.type(screen.getByLabelText('Nome completo *'), 'Ana Costa Nova')
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    expect(await screen.findByText('Usuário atualizado.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/v1/admin/users/user-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          full_name: 'Ana Costa Nova',
          email: 'ana@example.com',
          role: 'user',
          status: 'active',
        }),
      }),
    )

    const updatedRow = await screen.findByRole('row', { name: /Ana Costa Nova/ })
    await user.click(within(updatedRow).getByRole('button', { name: 'Excluir' }))
    await user.type(
      screen.getByLabelText('Digite ana@example.com para confirmar'),
      'ana@example.com',
    )
    await user.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))

    expect(await screen.findByText('Usuário excluído. Os registros do negócio foram preservados.'))
      .toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/v1/admin/users/user-1',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ confirm_email: 'ana@example.com' }),
      }),
    )
  })
})
