import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from './services/auth'
import {
  createCalendarEvent,
  deleteCalendarEvent,
  getCalendarMonth,
} from './services/calendar'
import type {
  CalendarEntry,
  CalendarEventType,
  CalendarMonth,
} from './services/calendar'

const weekdayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const eventTypeLabels: Record<CalendarEventType, string> = {
  holiday: 'Feriado',
  commemorative: 'Comemorativo',
  other: 'Outro',
  birthday: 'Aniversário',
}
const monthFormatter = new Intl.DateTimeFormat('pt-BR', {
  month: 'long',
  year: 'numeric',
})
const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'full',
  timeZone: 'UTC',
})

function localDateValue(): string {
  const today = new Date()
  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-')
}

function formatMonth(year: number, month: number): string {
  return monthFormatter.format(new Date(Date.UTC(year, month - 1, 1)))
}

function formatFullDate(value: string): string {
  return dateFormatter.format(new Date(`${value}T00:00:00Z`))
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Sua sessão expirou. Entre novamente.'
    if (error.status === 404) return 'O evento não foi encontrado.'
    if (error.status === 422) return 'Confira a data, o tipo e a descrição do evento.'
    return error.message
  }
  if (error instanceof TypeError) return 'Não foi possível conectar à API.'
  if (error instanceof Error) return error.message
  return 'Não foi possível concluir a operação no calendário.'
}

function monthDays(year: number, month: number): Array<number | null> {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ]
  const trailingEmptyCells = (7 - (cells.length % 7)) % 7
  return [...cells, ...Array.from({ length: trailingEmptyCells }, () => null)]
}

export default function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const today = new Date()
    return new Date(today.getFullYear(), today.getMonth(), 1)
  })
  const [calendar, setCalendar] = useState<CalendarMonth | null>(null)
  const [loadedMonthKey, setLoadedMonthKey] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [eventDate, setEventDate] = useState(localDateValue())
  const [description, setDescription] = useState('')
  const [eventType, setEventType] = useState<'holiday' | 'commemorative' | 'other'>('other')
  const [isSaving, setIsSaving] = useState(false)
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<{ monthKey: string; message: string } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth() + 1
  const monthKey = `${year}-${String(month).padStart(2, '0')}-${refreshKey}`
  const isLoading = loadedMonthKey !== monthKey
  const error = actionError
    ?? (loadError?.monthKey === monthKey ? loadError.message : null)

  useEffect(() => {
    let isCurrent = true
    getCalendarMonth(year, month)
      .then((result) => {
        if (isCurrent) {
          setCalendar(result)
          setLoadError(null)
        }
      })
      .catch((requestError: unknown) => {
        if (isCurrent) {
          setLoadError({ monthKey, message: getErrorMessage(requestError) })
        }
      })
      .finally(() => {
        if (isCurrent) setLoadedMonthKey(monthKey)
      })
    return () => {
      isCurrent = false
    }
  }, [year, month, monthKey])

  async function handleCreateEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setActionError(null)
    setNotice(null)
    setIsSaving(true)
    try {
      await createCalendarEvent({
        event_date: eventDate,
        description: description.trim(),
        event_type: eventType,
      })
      const selectedDate = new Date(`${eventDate}T00:00:00`)
      setCurrentMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1))
      setDescription('')
      setNotice('Evento adicionado ao calendário.')
      setRefreshKey((key) => key + 1)
    } catch (requestError: unknown) {
      setActionError(getErrorMessage(requestError))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDeleteEvent(entry: CalendarEntry) {
    if (!window.confirm(`Remover o evento "${entry.description}"?`)) return
    setActionError(null)
    setNotice(null)
    setDeletingEventId(entry.id)
    try {
      await deleteCalendarEvent(entry.id)
      setNotice('Evento removido do calendário.')
      setRefreshKey((key) => key + 1)
    } catch (requestError: unknown) {
      setActionError(getErrorMessage(requestError))
    } finally {
      setDeletingEventId(null)
    }
  }

  const entriesByDay = new Map<number, CalendarEntry[]>()
  for (const entry of calendar?.items ?? []) {
    const day = Number(entry.event_date.slice(-2))
    const entries = entriesByDay.get(day) ?? []
    entries.push(entry)
    entriesByDay.set(day, entries)
  }
  const cells = monthDays(year, month)

  return (
    <section className="customer-manager calendar-manager" aria-labelledby="calendar-heading">
      <div className="customer-header">
        <div>
          <span className="eyebrow">GESTÃO DO NEGÓCIO</span>
          <h2 id="calendar-heading">Calendário</h2>
          <p>Eventos e aniversários dos clientes ativos.</p>
        </div>
      </div>

      {error && <p className="customer-message customer-error" role="alert">{error}</p>}
      {notice && <p className="customer-message customer-success" role="status">{notice}</p>}

      <section className="customer-form" aria-labelledby="new-calendar-event-heading">
        <div className="customer-form-heading">
          <h3 id="new-calendar-event-heading">Adicionar evento</h3>
          <span>* Campo obrigatório</span>
        </div>
        <form onSubmit={(event) => void handleCreateEvent(event)}>
          <div className="customer-form-grid">
            <div className="customer-field">
              <label htmlFor="calendar-event-date">Data *</label>
              <input
                id="calendar-event-date"
                type="date"
                value={eventDate}
                onChange={(event) => setEventDate(event.target.value)}
                required
                disabled={isSaving}
              />
            </div>
            <div className="customer-field">
              <label htmlFor="calendar-event-type">Tipo *</label>
              <select
                id="calendar-event-type"
                value={eventType}
                onChange={(event) => {
                  if (
                    event.target.value === 'holiday'
                    || event.target.value === 'commemorative'
                    || event.target.value === 'other'
                  ) {
                    setEventType(event.target.value)
                  }
                }}
                disabled={isSaving}
              >
                <option value="holiday">Feriado</option>
                <option value="commemorative">Comemorativo</option>
                <option value="other">Outro</option>
              </select>
            </div>
            <div className="customer-field customer-field-wide">
              <label htmlFor="calendar-event-description">Descrição *</label>
              <input
                id="calendar-event-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={500}
                required
                disabled={isSaving}
              />
            </div>
          </div>
          <div className="customer-form-actions">
            <button className="customer-primary-button" type="submit" disabled={isSaving}>
              {isSaving ? 'Adicionando…' : 'Adicionar evento'}
            </button>
          </div>
        </form>
      </section>

      <section className="calendar-view" aria-label="Visualização mensal do calendário">
        <div className="calendar-navigation">
          <button
            type="button"
            className="customer-secondary-button"
            aria-label="Mês anterior"
            onClick={() => {
              setActionError(null)
              setNotice(null)
              setCurrentMonth((current) => (
                new Date(current.getFullYear(), current.getMonth() - 1, 1)
              ))
            }}
          >
            ‹
          </button>
          <h3 aria-live="polite">{formatMonth(year, month)}</h3>
          <button
            type="button"
            className="customer-secondary-button"
            aria-label="Próximo mês"
            onClick={() => {
              setActionError(null)
              setNotice(null)
              setCurrentMonth((current) => (
                new Date(current.getFullYear(), current.getMonth() + 1, 1)
              ))
            }}
          >
            ›
          </button>
        </div>

        {isLoading ? (
          <p className="customer-empty" role="status">Carregando calendário…</p>
        ) : !error && (
          <div className="calendar-grid" role="group" aria-label={formatMonth(year, month)}>
            {weekdayNames.map((day) => (
              <div className="calendar-weekday" key={day}>{day}</div>
            ))}
            {cells.map((day, index) => {
              if (day === null) {
                return <div className="calendar-day-empty" aria-hidden="true" key={`empty-${index}`} />
              }
              const dateValue = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const entries = entriesByDay.get(day) ?? []
              return (
                <div
                  className="calendar-day"
                  role="group"
                  aria-label={formatFullDate(dateValue)}
                  key={dateValue}
                >
                  <span className="calendar-day-number">{day}</span>
                  <ul className="calendar-entry-list">
                    {entries.map((entry) => (
                      <li
                        className={`calendar-entry is-${entry.event_type}`}
                        key={`${entry.event_type}-${entry.id}`}
                      >
                        <span className="calendar-entry-type">
                          {eventTypeLabels[entry.event_type]}
                        </span>
                        <span className="calendar-entry-description" title={entry.description}>
                          {entry.description}
                        </span>
                        {entry.event_type !== 'birthday' && (
                          <button
                            type="button"
                            aria-label={`Remover evento ${entry.description}`}
                            onClick={() => void handleDeleteEvent(entry)}
                            disabled={deletingEventId === entry.id}
                          >
                            {deletingEventId === entry.id ? 'Removendo…' : 'Remover'}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </section>
  )
}
