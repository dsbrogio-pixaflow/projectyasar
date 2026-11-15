import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

const currentUser = {
  id: 'user-id',
  full_name: 'Ana Costa',
  email: 'ana@example.com',
  role: 'user',
  status: 'active',
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('authentication experience', () => {
  it('logs in with cookie credentials and opens the account panel', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: 'Invalid email or password' }, 401))
      .mockResolvedValueOnce(jsonResponse(currentUser, 200))
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('heading', { name: 'Acesse sua conta' })
    await user.type(screen.getByLabelText('E-mail'), 'ana@example.com')
    await user.type(screen.getByLabelText('Senha'), 'Strong1')
    await user.click(
      within(screen.getByRole('form', { name: 'Entrar na conta' })).getByRole(
        'button',
        { name: 'Entrar' },
      ),
    )

    expect(await screen.findByRole('heading', { name: 'Olá, Ana.' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8000/api/v1/auth/login',
      expect.objectContaining({
        credentials: 'include',
        body: JSON.stringify({ email: 'ana@example.com', password: 'Strong1' }),
      }),
    )
  })

  it('creates an account and returns to the login form', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: 'Invalid email or password' }, 401))
      .mockResolvedValueOnce(jsonResponse(currentUser, 201))
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('heading', { name: 'Acesse sua conta' })
    await user.click(
      within(screen.getByRole('group', { name: 'Acesso ou cadastro' })).getByRole(
        'button',
        { name: 'Cadastre-se' },
      ),
    )

    await user.type(screen.getByLabelText('Nome completo'), 'Ana Costa')
    await user.type(screen.getByLabelText('E-mail'), 'ana@example.com')
    await user.type(screen.getByLabelText('Senha'), 'Strong1')
    await user.click(screen.getByRole('button', { name: 'Criar conta' }))

    expect(await screen.findByText('Cadastro concluído. Entre com seu e-mail e sua senha.'))
      .toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Acesse sua conta' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8000/api/v1/auth/register',
      expect.objectContaining({
        credentials: 'include',
        body: JSON.stringify({
          full_name: 'Ana Costa',
          email: 'ana@example.com',
          password: 'Strong1',
        }),
      }),
    )
  })

  it('restores a logged-in session and revokes it on logout', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(currentUser, 200))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const user = userEvent.setup()

    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Olá, Ana.' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sair da conta' }))

    expect(await screen.findByRole('heading', { name: 'Acesse sua conta' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8000/api/v1/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })

  it('opens customer management from the authenticated account', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(currentUser, 200))
      .mockResolvedValueOnce(
        jsonResponse({ items: [], total: 0, limit: 50, offset: 0 }, 200),
      )
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('heading', { name: 'Olá, Ana.' })
    expect(screen.queryByRole('button', { name: 'Administrar usuários' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Gerenciar clientes' }))

    expect(await screen.findByRole('heading', { name: 'Clientes' })).toBeInTheDocument()
    expect(await screen.findByText('Nenhum cliente cadastrado ainda.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8000/api/v1/customers?limit=20&offset=0',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('opens product management from the authenticated account', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(currentUser, 200))
      .mockResolvedValueOnce(
        jsonResponse({ items: [], total: 0, limit: 20, offset: 0 }, 200),
      )
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('heading', { name: 'Olá, Ana.' })
    await user.click(screen.getByRole('button', { name: 'Gerenciar produtos' }))

    expect(await screen.findByRole('heading', { name: 'Produtos' })).toBeInTheDocument()
    expect(await screen.findByText('Nenhum produto cadastrado ainda.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8000/api/v1/products?limit=20&offset=0',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('opens stock management from the authenticated account', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(currentUser, 200))
      .mockResolvedValueOnce(
        jsonResponse({ items: [], total: 0, limit: 50, offset: 0 }, 200),
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [], total: 0, limit: 20, offset: 0 }, 200),
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [], total: 0, limit: 100, offset: 0 }, 200),
      )
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('heading', { name: 'Olá, Ana.' })
    await user.click(screen.getByRole('button', { name: 'Gerenciar estoque' }))

    expect(await screen.findByRole('heading', { name: 'Estoque' })).toBeInTheDocument()
    expect(await screen.findByText('Nenhum produto encontrado.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8000/api/v1/products?include_archived=true&limit=100&offset=0',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('opens sales management from the authenticated account', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(currentUser, 200))
      .mockResolvedValueOnce(
        jsonResponse({ items: [], total: 0, limit: 100, offset: 0 }, 200),
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [], total: 0, limit: 100, offset: 0 }, 200),
      )
      .mockResolvedValueOnce(jsonResponse([], 200))
      .mockResolvedValueOnce(
        jsonResponse({ items: [], total: 0, limit: 20, offset: 0 }, 200),
      )
      .mockResolvedValueOnce(jsonResponse([], 200))
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('heading', { name: 'Olá, Ana.' })
    await user.click(screen.getByRole('button', { name: 'Gerenciar vendas' }))

    expect(await screen.findByRole('heading', { name: 'Vendas' })).toBeInTheDocument()
    expect(await screen.findByText('Ainda não há vendas concluídas.')).toBeInTheDocument()
    expect(await screen.findByText('Nenhuma venda registrada.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8000/api/v1/sales/summary',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('opens delivery tracking from the authenticated account', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(currentUser, 200))
      .mockResolvedValueOnce(
        jsonResponse({ items: [], total: 0, limit: 20, offset: 0 }, 200),
      )
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('heading', { name: 'Olá, Ana.' })
    await user.click(screen.getByRole('button', { name: 'Gerenciar entregas' }))

    expect(await screen.findByRole('heading', { name: 'Entregas' })).toBeInTheDocument()
    expect(await screen.findByText('Nenhuma entrega registrada.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8000/api/v1/deliveries?limit=20&offset=0',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('opens finance management from the authenticated account', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(currentUser, 200))
      .mockResolvedValueOnce(jsonResponse([], 200))
      .mockResolvedValueOnce(
        jsonResponse({ items: [], total: 0, limit: 20, offset: 0 }, 200),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          total_sales: '100.00',
          total_expenses: '25.00',
          net_result: '75.00',
        }, 200),
      )
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('heading', { name: 'Olá, Ana.' })
    await user.click(screen.getByRole('button', { name: 'Gerenciar financeiro' }))

    expect(await screen.findByRole('heading', { name: 'Financeiro' })).toBeInTheDocument()
    expect(await screen.findByText('R$ 75,00')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8000/api/v1/financial/summary',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('opens the business dashboard from the authenticated account', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(currentUser, 200))
      .mockResolvedValueOnce(jsonResponse({
        current_stock_balance: 0,
        months: [],
      }, 200))
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('heading', { name: 'Olá, Ana.' })
    await user.click(screen.getByRole('button', { name: 'Ver painel' }))

    expect(await screen.findByRole('heading', { name: 'Painel' })).toBeInTheDocument()
    expect(await screen.findByText('Saldo atual total do estoque ativo')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8000/api/v1/dashboard',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('opens the calendar from the authenticated account', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(currentUser, 200))
      .mockResolvedValueOnce(jsonResponse({ year: 2027, month: 3, items: [] }, 200))
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('heading', { name: 'Olá, Ana.' })
    await user.click(screen.getByRole('button', { name: 'Abrir calendário' }))

    expect(await screen.findByRole('heading', { name: 'Calendário' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Adicionar evento' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringMatching(/\/api\/v1\/calendar\?year=\d{4}&month=\d{1,2}$/),
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('closes the admin session after the current user loses access', async () => {
    const fetchMock = vi.mocked(fetch)
    const adminUser = {
      ...currentUser,
      role: 'admin' as const,
      created_at: '2025-01-01T00:00:00Z',
    }
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/auth/me')) return jsonResponse(adminUser, 200)
      if (url.includes('/admin/users?')) {
        return jsonResponse({
          items: [adminUser],
          total: 1,
          limit: 20,
          offset: 0,
        }, 200)
      }
      if (init?.method === 'PATCH') {
        return jsonResponse({ ...adminUser, status: 'inactive' }, 200)
      }
      return jsonResponse({ detail: 'Not found' }, 404)
    })
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('heading', { name: 'Olá, Ana.' })
    expect(screen.getByRole('button', { name: 'Administrar usuários' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Administrar usuários' }))
    const row = await screen.findByRole('row', { name: /ana@example.com/ })
    await user.click(within(row).getByRole('button', { name: 'Editar' }))
    await user.selectOptions(screen.getByLabelText('Status *'), 'inactive')
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    expect(await screen.findByRole('heading', { name: 'Acesse sua conta' }))
      .toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Seu perfil ou status foi alterado. Entre novamente para continuar.',
    )
  })

  it('shows the retry delay returned by the API rate limiter', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: 'Invalid email or password' }, 401))
      .mockResolvedValueOnce(
        jsonResponse(
          { detail: 'Too many authentication attempts; try again later' },
          429,
          { 'Retry-After': '30' },
        ),
      )
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('heading', { name: 'Acesse sua conta' })
    await user.type(screen.getByLabelText('E-mail'), 'ana@example.com')
    await user.type(screen.getByLabelText('Senha'), 'Strong1')
    await user.click(
      within(screen.getByRole('form', { name: 'Entrar na conta' })).getByRole(
        'button',
        { name: 'Entrar' },
      ),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Muitas tentativas. Aguarde 30 segundos e tente novamente.',
    )
  })
})
