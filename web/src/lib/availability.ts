import type { AvailabilityStatus } from './types'

// Vivid, distinct availability colours (the muted theme greens/tans were too
// easy to miss). Shared by the profile panel and the sidebar footer dot.
export const AVAILABILITY: { value: AvailabilityStatus; label: string; color: string }[] = [
  { value: 'available', label: 'Available', color: '#3fb950' }, // green
  { value: 'busy', label: 'Busy', color: '#e3a008' }, // amber
  { value: 'off_duty', label: 'Off duty', color: '#9aa4b2' }, // slate
]

// Shown when auto-away kicks in (idle / tab hidden). Distinct from the manual
// "Off duty" so the user can tell intent from presence.
export const AWAY = { label: 'Away', color: '#9aa4b2' }

// Shown for a peer who has no live socket connection (signed out / closed app).
// Dim so it clearly reads as "not here" vs the vivid online status colours.
export const OFFLINE = { label: 'Offline', color: '#4e4d5a' }

export function statusMeta(s: AvailabilityStatus) {
  return AVAILABILITY.find((a) => a.value === s) ?? AVAILABILITY[0]
}
