// Mirrors the server's DELETE_WINDOW_MINUTES — keep them in sync.
export const DELETE_WINDOW_MS = 5 * 60 * 1000

export function formatTime(iso: string): string {
  // 24-hour clock regardless of the browser locale — operational tools read
  // dispatch times as 00–23 (hourCycle 'h23' never yields the h24 "24:00").
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}

// Truncate to the minute (UTC ms / 60000) so two messages with different
// seconds within the same calendar minute compare equal. Used to collapse
// timestamps inside bursts.
export function minuteKey(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 60000)
}

export function formatDay(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0] ?? '').join('').toUpperCase() || '?'
}
