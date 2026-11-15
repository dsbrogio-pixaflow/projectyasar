import { useEffect, useState } from 'react'
import { ApiError } from './services/auth'
import { getDashboardSummary } from './services/dashboard'
import type { DashboardSummary } from './services/dashboard'

const monthFormatter = new Intl.DateTimeFormat('pt-BR', {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
})
const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

function formatMonth(value: string): string {
  return monthFormatter.format(new Date(`${value}-01T00:00:00Z`))
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Sua sessão expirou. Entre novamente.'
    return error.message
  }
  if (error instanceof TypeError) return 'Não foi possível conectar à API.'
  if (error instanceof Error) return error.message
  return 'Não foi possível carregar o painel.'
}

function barWidth(value: number, maximum: number): string {
  if (value <= 0 || maximum <= 0) return '0%'
  return `${Math.max(3, (value / maximum) * 100)}%`
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isCurrent = true
    getDashboardSummary()
      .then((result) => {
        if (isCurrent) setSummary(result)
      })
      .catch((requestError: unknown) => {
        if (isCurrent) setError(getErrorMessage(requestError))
      })
    return () => {
      isCurrent = false
    }
  }, [])

  const maxEntries = Math.max(0, ...(summary?.months.map((month) => month.inventory_entries) ?? []))
  const maxExits = Math.max(0, ...(summary?.months.map((month) => month.inventory_exits) ?? []))
  const maxUnitsSold = Math.max(0, ...(summary?.months.map((month) => month.units_sold) ?? []))
  const maxExpenses = Math.max(
    0,
    ...(summary?.months.map((month) => Number(month.expenses)) ?? []),
  )

  return (
    <section className="customer-manager dashboard-manager" aria-labelledby="dashboard-heading">
      <div className="customer-header">
        <div>
          <span className="eyebrow">GESTÃO DO NEGÓCIO</span>
          <h2 id="dashboard-heading">Painel</h2>
          <p>Indicadores mensais dos últimos 12 meses.</p>
        </div>
      </div>

      {error && <p className="customer-message customer-error" role="alert">{error}</p>}
      {!summary && !error && (
        <p className="customer-empty" role="status">Carregando indicadores…</p>
      )}
      {summary && (
        <>
          <section
            className={`dashboard-stock-total${summary.current_stock_balance < 0 ? ' is-negative' : ''}`}
            aria-label="Saldo atual total do estoque"
          >
            <span>Saldo atual total do estoque ativo</span>
            <strong>{summary.current_stock_balance}</strong>
            {summary.current_stock_balance < 0 && (
              <span role="alert">O saldo agregado do estoque está abaixo de zero.</span>
            )}
          </section>

          <div className="dashboard-grid">
            <section className="dashboard-chart" aria-labelledby="dashboard-inventory-heading">
              <h3 id="dashboard-inventory-heading">Movimentação de estoque</h3>
              <ul className="dashboard-month-list">
                {summary.months.map((month) => (
                  <li className="dashboard-month-item" key={month.month}>
                    <span className="dashboard-month-label">{formatMonth(month.month)}</span>
                    <div className="dashboard-series">
                      <span>Entradas</span>
                      <div className="dashboard-bar-track" aria-hidden="true">
                        <span
                          className="dashboard-bar is-entry"
                          style={{ width: barWidth(month.inventory_entries, maxEntries) }}
                        />
                      </div>
                      <strong>{month.inventory_entries}</strong>
                    </div>
                    <div className="dashboard-series">
                      <span>Saídas</span>
                      <div className="dashboard-bar-track" aria-hidden="true">
                        <span
                          className="dashboard-bar is-exit"
                          style={{ width: barWidth(month.inventory_exits, maxExits) }}
                        />
                      </div>
                      <strong>{month.inventory_exits}</strong>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="dashboard-chart" aria-labelledby="dashboard-sales-heading">
              <h3 id="dashboard-sales-heading">Unidades vendidas</h3>
              <ul className="dashboard-month-list">
                {summary.months.map((month) => (
                  <li className="dashboard-month-item" key={month.month}>
                    <span className="dashboard-month-label">{formatMonth(month.month)}</span>
                    <div className="dashboard-series">
                      <span>Unidades</span>
                      <div className="dashboard-bar-track" aria-hidden="true">
                        <span
                          className="dashboard-bar is-sales"
                          style={{ width: barWidth(month.units_sold, maxUnitsSold) }}
                        />
                      </div>
                      <strong>{month.units_sold}</strong>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="dashboard-chart" aria-labelledby="dashboard-expenses-heading">
              <h3 id="dashboard-expenses-heading">Despesas ativas</h3>
              <ul className="dashboard-month-list">
                {summary.months.map((month) => {
                  const amount = Number(month.expenses)
                  return (
                    <li className="dashboard-month-item" key={month.month}>
                      <span className="dashboard-month-label">{formatMonth(month.month)}</span>
                      <div className="dashboard-series">
                        <span>Despesas</span>
                        <div className="dashboard-bar-track" aria-hidden="true">
                          <span
                            className="dashboard-bar is-expense"
                            style={{ width: barWidth(amount, maxExpenses) }}
                          />
                        </div>
                        <strong>{currencyFormatter.format(amount)}</strong>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          </div>
        </>
      )}
    </section>
  )
}
