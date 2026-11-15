import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ApiError,
  getCurrentUser,
  login,
  logout,
  register,
} from './services/auth'
import type { User } from './services/auth'
import CustomersPage from './CustomersPage'
import ProductsPage from './ProductsPage'
import InventoryPage from './InventoryPage'
import SalesPage from './SalesPage'
import DeliveriesPage from './DeliveriesPage'
import FinancePage from './FinancePage'
import './App.css'

type AuthMode = 'login' | 'register'
type BusinessModule =
  | 'customers'
  | 'products'
  | 'inventory'
  | 'sales'
  | 'deliveries'
  | 'finance'
  | null
type Notice = { kind: 'error' | 'success'; message: string }

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'E-mail ou senha inválidos.'
    if (error.status === 409) return 'Já existe uma conta com este e-mail.'
    if (error.status === 422) {
      return 'Revise os dados. A senha deve ter ao menos 6 caracteres e começar com uma letra maiúscula.'
    }
    if (error.status === 429) {
      const wait = error.retryAfterSeconds
      return wait
        ? `Muitas tentativas. Aguarde ${wait} ${wait === 1 ? 'segundo' : 'segundos'} e tente novamente.`
        : 'Muitas tentativas. Aguarde um pouco e tente novamente.'
    }
    if (error.status >= 500) {
      return 'O serviço de autenticação está indisponível. Tente novamente mais tarde.'
    }
    return error.message
  }

  if (error instanceof TypeError) {
    return 'Não foi possível conectar à API. Verifique se o backend está em execução.'
  }
  return 'Não foi possível concluir a solicitação. Tente novamente.'
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [activeModule, setActiveModule] = useState<BusinessModule>(null)
  const [mode, setMode] = useState<AuthMode>('login')
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  useEffect(() => {
    let isMounted = true

    getCurrentUser()
      .then((currentUser) => {
        if (isMounted) setUser(currentUser)
      })
      .catch((error: unknown) => {
        if (isMounted && !(error instanceof ApiError && error.status === 401)) {
          setNotice({ kind: 'error', message: getErrorMessage(error) })
        }
      })
      .finally(() => {
        if (isMounted) setIsCheckingSession(false)
      })

    return () => {
      isMounted = false
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setNotice(null)

    const formData = new FormData(event.currentTarget)
    const email = String(formData.get('email') ?? '').trim()
    const password = String(formData.get('password') ?? '')

    try {
      if (mode === 'register') {
        await register({
          full_name: String(formData.get('full_name') ?? '').trim(),
          email,
          password,
        })
        setMode('login')
        setNotice({
          kind: 'success',
          message: 'Cadastro concluído. Entre com seu e-mail e sua senha.',
        })
      } else {
        const authenticatedUser = await login({ email, password })
        setUser(authenticatedUser)
      }
    } catch (error: unknown) {
      setNotice({ kind: 'error', message: getErrorMessage(error) })
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleLogout() {
    setIsSubmitting(true)
    setNotice(null)
    try {
      await logout()
      setUser(null)
      setActiveModule(null)
      setMode('login')
      setNotice({ kind: 'success', message: 'Você saiu da sua conta.' })
    } catch (error: unknown) {
      setNotice({ kind: 'error', message: getErrorMessage(error) })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Yasar, página inicial">
          <span className="brand-mark" aria-hidden="true">Y</span>
          <span>yasar</span>
        </a>
        <span className="topbar-caption">Gestão simples, feita para você</span>
      </header>

      <section className="auth-layout">
        <div className="intro-panel">
          <p className="eyebrow">GESTÃO DO SEU NEGÓCIO</p>
          <h1>Mais clareza para cuidar do que você construiu.</h1>
          <p className="intro-copy">
            Clientes, produtos, vendas e entregas em um só lugar. Entre para continuar
            organizando o seu dia.
          </p>
          <ul className="feature-list" aria-label="Recursos do sistema">
            <li><span aria-hidden="true">01</span> Clientes e aniversários</li>
            <li><span aria-hidden="true">02</span> Produtos e estoque</li>
            <li><span aria-hidden="true">03</span> Vendas, entregas e financeiro</li>
          </ul>
          <div className="decorative-orbit" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>

        <section className="auth-card" aria-labelledby="auth-heading">
          {isCheckingSession ? (
            <div className="session-loading" role="status">
              Verificando sua sessão…
            </div>
          ) : user ? (
            <div className="account-panel">
              <span className="eyebrow">SESSÃO AUTENTICADA</span>
              <h2 id="auth-heading">Olá, {user.full_name.split(' ')[0]}.</h2>
              <p className="account-email">{user.email}</p>
              <span className="role-badge">
                {user.role === 'admin' ? 'Administrador' : 'Usuário'}
              </span>
              <p className="account-note">
                Sua conta está conectada. Gerencie clientes, produtos, estoque,
                vendas, entregas e financeiro do seu negócio.
              </p>
              <div className="account-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => setActiveModule((module) => (
                    module === 'customers' ? null : 'customers'
                  ))}
                >
                  {activeModule === 'customers' ? 'Voltar ao resumo' : 'Gerenciar clientes'}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setActiveModule((module) => (
                    module === 'products' ? null : 'products'
                  ))}
                >
                  {activeModule === 'products' ? 'Voltar ao resumo' : 'Gerenciar produtos'}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setActiveModule((module) => (
                    module === 'inventory' ? null : 'inventory'
                  ))}
                >
                  {activeModule === 'inventory' ? 'Voltar ao resumo' : 'Gerenciar estoque'}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setActiveModule((module) => (
                    module === 'sales' ? null : 'sales'
                  ))}
                >
                  {activeModule === 'sales' ? 'Voltar ao resumo' : 'Gerenciar vendas'}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setActiveModule((module) => (
                    module === 'deliveries' ? null : 'deliveries'
                  ))}
                >
                  {activeModule === 'deliveries' ? 'Voltar ao resumo' : 'Gerenciar entregas'}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setActiveModule((module) => (
                    module === 'finance' ? null : 'finance'
                  ))}
                >
                  {activeModule === 'finance' ? 'Voltar ao resumo' : 'Gerenciar financeiro'}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={handleLogout}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Saindo…' : 'Sair da conta'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="auth-heading">
                <span className="eyebrow">BEM-VINDO(A)</span>
                <h2 id="auth-heading">
                  {mode === 'login' ? 'Acesse sua conta' : 'Crie sua conta'}
                </h2>
                <p>
                  {mode === 'login'
                    ? 'Entre para acessar o espaço do seu negócio.'
                    : 'Preencha seus dados para começar.'}
                </p>
              </div>

              <div
                className="auth-switch"
                role="group"
                aria-label="Acesso ou cadastro"
              >
                <button
                  type="button"
                  aria-pressed={mode === 'login'}
                  onClick={() => {
                    setMode('login')
                    setNotice(null)
                  }}
                  disabled={isSubmitting}
                >
                  Entrar
                </button>
                <button
                  type="button"
                  aria-pressed={mode === 'register'}
                  onClick={() => {
                    setMode('register')
                    setNotice(null)
                  }}
                  disabled={isSubmitting}
                >
                  Cadastre-se
                </button>
              </div>

              {notice && (
                <p className={`notice notice-${notice.kind}`} role="alert">
                  {notice.message}
                </p>
              )}

              <form
                key={mode}
                className="auth-form"
                aria-label={mode === 'login' ? 'Entrar na conta' : 'Criar uma conta'}
                onSubmit={handleSubmit}
              >
                {mode === 'register' && (
                  <div className="form-field">
                    <label htmlFor="full_name">Nome completo</label>
                    <input
                      id="full_name"
                      name="full_name"
                      type="text"
                      autoComplete="name"
                      maxLength={200}
                      required
                      disabled={isSubmitting}
                    />
                  </div>
                )}
                <div className="form-field">
                  <label htmlFor="email">E-mail</label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    maxLength={320}
                    required
                    disabled={isSubmitting}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="password">Senha</label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    minLength={mode === 'register' ? 6 : 1}
                    maxLength={128}
                    required
                    disabled={isSubmitting}
                  />
                  {mode === 'register' && (
                    <span className="field-hint">
                      Mínimo de 6 caracteres; comece com uma letra maiúscula.
                    </span>
                  )}
                </div>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting
                    ? 'Aguarde…'
                    : mode === 'login'
                      ? 'Entrar'
                      : 'Criar conta'}
                </button>
              </form>

              <p className="auth-footnote">
                {mode === 'login'
                  ? 'Ainda não tem uma conta?'
                  : 'Já tem uma conta?'}{' '}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setMode(mode === 'login' ? 'register' : 'login')
                    setNotice(null)
                  }}
                  disabled={isSubmitting}
                >
                  {mode === 'login' ? 'Cadastre-se' : 'Faça login'}
                </button>
              </p>
            </>
          )}
        </section>
        {user && activeModule === 'customers' && <CustomersPage />}
        {user && activeModule === 'products' && <ProductsPage />}
        {user && activeModule === 'inventory' && <InventoryPage />}
        {user && activeModule === 'sales' && <SalesPage />}
        {user && activeModule === 'deliveries' && <DeliveriesPage />}
        {user && activeModule === 'finance' && <FinancePage />}
      </section>

      <footer className="page-footer">
        <span>Yasar · Gestão do seu negócio</span>
        <span>Seus dados protegidos em cada acesso</span>
      </footer>
    </main>
  )
}

export default App
