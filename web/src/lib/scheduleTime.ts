// Human labels for a scheduled send time. Shared by the Schedule message
// dialog and the faded pending bubble in the chat, so the two can never
// describe the same moment differently.

// h23 so these speak the same clock as TimeField, which is 24h — on an en-US
// locale the default would render "01:55 PM" beside a field reading 13:55.
const HM = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const DAY_YEAR = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
// `always` (not `auto`) so this never renders "tomorrow" — the absolute half of
// a readout already says which day; this half only ever answers "how long".
const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' })

// "today at 09:30" / "tomorrow at 08:00" / "Sat, 2 Aug at 08:00", with the year
// added only when it differs from now (messages can be scheduled a year out).
export function absoluteLabel(value: Date): string {
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  const time = HM.format(value)
  if (value.toDateString() === now.toDateString()) return `today at ${time}`
  if (value.toDateString() === tomorrow.toDateString()) return `tomorrow at ${time}`
  const day = value.getFullYear() === now.getFullYear() ? DAY.format(value) : DAY_YEAR.format(value)
  return `${day} at ${time}`
}

// Bubble-corner form: as terse as a real message's timestamp, which is all a
// row in the thread has room for. Today needs no date at all — the bubble is
// sitting at the foot of today's conversation.
export function compactLabel(value: Date): string {
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  const time = HM.format(value)
  if (value.toDateString() === now.toDateString()) return time
  if (value.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`
  const day = value.getFullYear() === now.getFullYear() ? DAY.format(value) : DAY_YEAR.format(value)
  return `${day}, ${time}`
}

export function relativeLabel(value: Date): string {
  const minutes = Math.round((value.getTime() - Date.now()) / 60_000)
  if (Math.abs(minutes) < 60) return RELATIVE.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return RELATIVE.format(hours, 'hour')
  return RELATIVE.format(Math.round(hours / 24), 'day')
}
