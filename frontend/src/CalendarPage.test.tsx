import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CalendarPage from './CalendarPage'
import type { CalendarEntry, CalendarMonth } from './services/calendar'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function calendarMonth(items: CalendarEntry[]): CalendarMonth {
  return { year: 2027, month: 3, items }
}

function birthday(): CalendarEntry {
  return {
    id: 'customer-1',
    customer_id: 'customer-1',
    event_date: '2027-03-01',
    description: 'Aniversário de Ana Costa',
    event_type: 'birthday',
  }
}

function event(): CalendarEntry {
  return {
    id: 'event-1',
    customer_id: null,
    event_date: '2027-03-15',
    description: 'Reunião da equipe',
    event_type: 'other',
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('calendar management', () => {
  it('shows birthdays as read-only and removes a single manual event', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(calendarMonth([birthday(), event()])))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse(calendarMonth([birthday()])))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()

    render(<CalendarPage />)
    expect(await screen.findByText('Aniversário de Ana Costa')).toBeInTheDocument()
    expect(screen.getByText('Reunião da equipe')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remover evento Aniversário/ }))
      .not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remover evento Reunião da equipe' }))

    expect(await screen.findByText('Evento removido do calendário.')).toBeInTheDocument()
    expect(screen.getByText('Aniversário de Ana Costa')).toBeInTheDocument()
    expect(screen.queryByText('Reunião da equipe')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8000/api/v1/calendar/events/event-1',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' }),
    )
  })

  it('creates an event and opens its month', async () => {
    const fetchMock = vi.mocked(fetch)
    const createdEvent = event()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(calendarMonth([])))
      .mockResolvedValueOnce(jsonResponse(createdEvent, 201))
      .mockResolvedValueOnce(jsonResponse(calendarMonth([createdEvent])))
    const user = userEvent.setup()

    render(<CalendarPage />)
    await screen.findByRole('heading', { name: 'Adicionar evento' })
    fireEvent.change(screen.getByLabelText('Data *'), {
      target: { value: '2027-03-15' },
    })
    await user.selectOptions(screen.getByLabelText('Tipo *'), 'other')
    await user.type(screen.getByLabelText('Descrição *'), 'Reunião da equipe')
    await user.click(screen.getByRole('button', { name: 'Adicionar evento' }))

    expect(await screen.findByText('Reunião da equipe')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8000/api/v1/calendar/events',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          event_date: '2027-03-15',
          description: 'Reunião da equipe',
          event_type: 'other',
        }),
      }),
    )
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8000/api/v1/calendar?year=2027&month=3',
      expect.objectContaining({ credentials: 'include' }),
    )
  })
})
