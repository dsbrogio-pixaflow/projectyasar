import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from './services/auth'
import {
  listDeliveries,
  updateDelivery,
} from './services/deliveries'
import type { Delivery, DeliveryStatus } from './services/deliveries'

const PAGE_SIZE = 20
const deliveryStatuses: DeliveryStatus[] = [
  'pending',
  'out_for_delivery',
  'delivered',
  'cancelled',
]
const statusLabels: Record<DeliveryStatus, string> = {
  pending: 'Pendente',
  out_for_delivery: 'Saiu para entrega',
  delivered: 'Entregue',
  cancelled: 'Cancelada',
}

function isDeliveryStatus(value: string): value is DeliveryStatus {
  return deliveryStatuses.some((status) => status === value)
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  )
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Sua sessão expirou. Entre novamente.'
    if (error.status === 404) return 'A entrega não foi encontrada.'
    if (error.status === 409) return error.message
    if (error.status === 422) return 'Confira o status e o código de rastreio.'
    return error.message
  }
  if (error instanceof TypeError) return 'Não foi possível conectar à API.'
  if (error instanceof Error) return error.message
  return 'Não foi possível concluir a operação.'
}

export default function DeliveriesPage() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [total, setTotal] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | DeliveryStatus>('all')
  const [trackingCodes, setTrackingCodes] = useState<Record<string, string>>({})
  const [page, setPage] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)
  const [loadedQueryKey, setLoadedQueryKey] = useState<string | null>(null)
  const [updatingStatusSaleId, setUpdatingStatusSaleId] = useState<string | null>(null)
  const [savingTrackingSaleId, setSavingTrackingSaleId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const queryKey = JSON.stringify([search, statusFilter, page, refreshKey])
  const isLoading = loadedQueryKey !== queryKey

  useEffect(() => {
    let isCurrent = true
    listDeliveries({
      q: search || undefined,
      status: statusFilter === 'all' ? undefined : statusFilter,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    })
      .then((result) => {
        if (!isCurrent) return
        if (result.items.length === 0 && result.total > 0 && page > 0) {
          setPage(Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1))
          return
        }
        setDeliveries(result.items)
        setTotal(result.total)
        setTrackingCodes((current) => {
          const next = { ...current }
          for (const delivery of result.items) {
            if (!(delivery.sale_id in next)) {
              next[delivery.sale_id] = delivery.tracking_code ?? ''
            }
          }
          return next
        })
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

  async function handleStatusChange(delivery: Delivery, nextStatus: DeliveryStatus) {
    setError(null)
    setNotice(null)
    setUpdatingStatusSaleId(delivery.sale_id)
    try {
      const updated = await updateDelivery(delivery.sale_id, { status: nextStatus })
      setDeliveries((current) => current.map((item) => (
        item.sale_id === updated.sale_id ? updated : item
      )))
      setNotice(
        `Entrega de ${updated.customer_name} atualizada para ${statusLabels[updated.status]}.`,
      )
      setRefreshKey((key) => key + 1)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError))
    } finally {
      setUpdatingStatusSaleId(null)
    }
  }

  async function handleSaveTrackingCode(event: FormEvent<HTMLFormElement>, delivery: Delivery) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setSavingTrackingSaleId(delivery.sale_id)
    const trackingCode = trackingCodes[delivery.sale_id]?.trim() || null
    try {
      const updated = await updateDelivery(delivery.sale_id, {
        tracking_code: trackingCode,
      })
      setDeliveries((current) => current.map((item) => (
        item.sale_id === updated.sale_id ? updated : item
      )))
      setTrackingCodes((current) => ({
        ...current,
        [updated.sale_id]: updated.tracking_code ?? '',
      }))
      setNotice(`Código de rastreio da venda de ${updated.customer_name} salvo.`)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError))
    } finally {
      setSavingTrackingSaleId(null)
    }
  }

  return (
    <section className="customer-manager deliveries-manager" aria-labelledby="deliveries-heading">
      <div className="customer-header">
        <div>
          <span className="eyebrow">GESTÃO DO NEGÓCIO</span>
          <h2 id="deliveries-heading">Entregas</h2>
          <p>Acompanhe o status e o código de rastreio de cada venda.</p>
        </div>
      </div>

      {error && <p className="customer-message customer-error" role="alert">{error}</p>}
      {notice && <p className="customer-message customer-success" role="status">{notice}</p>}

      <p className="customer-hint deliveries-guidance">
        Cancelar uma entrega não cancela a venda. Vendas canceladas mantêm suas entregas
        canceladas para preservar o histórico.
      </p>

      <section className="deliveries-section" aria-labelledby="delivery-list-heading">
        <div className="customer-list-heading">
          <h3 id="delivery-list-heading">Acompanhamento de entregas</h3>
          <span>{total} {total === 1 ? 'entrega' : 'entregas'}</span>
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
            <label htmlFor="deliveries-search">Buscar por cliente</label>
            <input
              id="deliveries-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Nome do cliente"
            />
            <button className="customer-secondary-button" type="submit">Buscar</button>
          </form>

          <label className="delivery-status-filter">
            Status
            <select
              aria-label="Filtrar status das entregas"
              value={statusFilter}
              onChange={(event) => {
                setPage(0)
                const value = event.target.value
                if (value === 'all') setStatusFilter('all')
                else if (isDeliveryStatus(value)) setStatusFilter(value)
              }}
            >
              <option value="all">Todos</option>
              {deliveryStatuses.map((status) => (
                <option key={status} value={status}>{statusLabels[status]}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="customer-list-heading">
          <span>Vendas recentes</span>
          {total > PAGE_SIZE && (
            <nav className="customer-pagination" aria-label="Paginação de entregas">
              <button
                type="button"
                className="customer-secondary-button"
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                disabled={page === 0 || isLoading}
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
                disabled={(page + 1) * PAGE_SIZE >= total || isLoading}
              >
                Próxima
              </button>
            </nav>
          )}
        </div>

        {isLoading ? (
          <p className="customer-empty" role="status">Carregando entregas…</p>
        ) : deliveries.length === 0 ? (
          <p className="customer-empty">
            {search ? 'Nenhuma entrega corresponde à busca.' : 'Nenhuma entrega registrada.'}
          </p>
        ) : (
          <div className="customer-table-wrap">
            <table className="customer-table deliveries-table">
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col">Cliente</th>
                  <th scope="col">Endereço</th>
                  <th scope="col">Forma de entrega</th>
                  <th scope="col">Venda</th>
                  <th scope="col">Status da entrega</th>
                  <th scope="col">Rastreio</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((delivery) => {
                  const trackingCode = trackingCodes[delivery.sale_id] ?? ''
                  const isSaleCancelled = delivery.sale_status === 'cancelled'
                  return (
                    <tr key={delivery.sale_id}>
                      <td data-label="Data">{formatDate(delivery.sold_at)}</td>
                      <td data-label="Cliente"><strong>{delivery.customer_name}</strong></td>
                      <td data-label="Endereço">
                        {delivery.delivery_address_snapshot || 'Não informado'}
                      </td>
                      <td data-label="Forma de entrega">{delivery.delivery_method_name}</td>
                      <td data-label="Venda">
                        <span className={`customer-status${isSaleCancelled ? ' is-archived' : ''}`}>
                          {isSaleCancelled ? 'Cancelada' : 'Ativa'}
                        </span>
                      </td>
                      <td data-label="Status da entrega">
                        <label className="visually-hidden" htmlFor={`delivery-status-${delivery.sale_id}`}>
                          Status da entrega
                        </label>
                        <select
                          id={`delivery-status-${delivery.sale_id}`}
                          className={`delivery-status-select is-${delivery.status}`}
                          value={delivery.status}
                          onChange={(event) => {
                            const value = event.target.value
                            if (isDeliveryStatus(value)) {
                              void handleStatusChange(delivery, value)
                            }
                          }}
                          disabled={
                            isSaleCancelled
                            || updatingStatusSaleId === delivery.sale_id
                            || savingTrackingSaleId === delivery.sale_id
                          }
                        >
                          {deliveryStatuses.map((status) => (
                            <option key={status} value={status}>{statusLabels[status]}</option>
                          ))}
                        </select>
                      </td>
                      <td data-label="Rastreio">
                        <form
                          className="delivery-tracking-form"
                          onSubmit={(event) => void handleSaveTrackingCode(event, delivery)}
                        >
                          <label
                            className="visually-hidden"
                            htmlFor={`delivery-tracking-${delivery.sale_id}`}
                          >
                            Código de rastreio
                          </label>
                          <input
                            id={`delivery-tracking-${delivery.sale_id}`}
                            value={trackingCode}
                            onChange={(event) => setTrackingCodes((current) => ({
                              ...current,
                              [delivery.sale_id]: event.target.value,
                            }))}
                            maxLength={200}
                            placeholder="Opcional"
                            disabled={
                              isSaleCancelled
                              || savingTrackingSaleId === delivery.sale_id
                              || updatingStatusSaleId === delivery.sale_id
                            }
                          />
                          <button
                            className="customer-secondary-button"
                            type="submit"
                            disabled={
                              isSaleCancelled
                              || savingTrackingSaleId === delivery.sale_id
                              || updatingStatusSaleId === delivery.sale_id
                              || trackingCode.trim() === (delivery.tracking_code ?? '')
                            }
                          >
                            {savingTrackingSaleId === delivery.sale_id ? 'Salvando…' : 'Salvar'}
                          </button>
                        </form>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  )
}
