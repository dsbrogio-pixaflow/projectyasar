import { apiRequest } from './auth'

export type CalendarEventType =
  | 'holiday'
  | 'commemorative'
  | 'other'
  | 'birthday'

export interface CalendarEntry {
  id: string
  event_date: string
  description: string
  event_type: CalendarEventType
  customer_id: string | null
}

export interface CalendarMonth {
  year: number
  month: number
  items: CalendarEntry[]
}

export interface CalendarEventInput {
  event_date: string
  description: string
  event_type: Exclude<CalendarEventType, 'birthday'>
}

export async function getCalendarMonth(
  year: number,
  month: number,
): Promise<CalendarMonth> {
  const response = await apiRequest(`/calendar?year=${year}&month=${month}`)
  return (await response.json()) as CalendarMonth
}

export async function createCalendarEvent(
  input: CalendarEventInput,
): Promise<CalendarEntry> {
  const response = await apiRequest('/calendar/events', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return (await response.json()) as CalendarEntry
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  await apiRequest(`/calendar/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
  })
}
