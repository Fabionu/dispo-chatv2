// Vehicle-room operational data — the structured, MANUALLY-managed transport
// information that lives alongside a vehicle group's chat (vehicle details, one
// active trip, and its stops). It is persisted inside the existing group
// `meta` JSONB under a single `ops` key (see server PATCH /api/groups/:id), so
// no new tables/migrations are needed and the chat/group model is untouched.
//
// Everything here is manual: there is intentionally NO map, GPS, live location,
// or computed ETA — the company has no mobile driver app yet, so a dispatcher
// edits these fields by hand. (Future map/live-tracking integration points are
// marked with TODOs in the components, never wired here.)

// ── Option enums + English labels ───────────────────────────────────────────
// Each option list is the single source of truth for both the <select> controls
// and the read-only label lookups, so the UI and stored values never drift.

export type VehicleStatus =
  | 'available'
  | 'driving'
  | 'loading'
  | 'unloading'
  | 'waiting'
  | 'break'
  | 'service'
  | 'completed'

export const VEHICLE_STATUSES: ReadonlyArray<{ value: VehicleStatus; label: string }> = [
  { value: 'available', label: 'Available' },
  { value: 'driving', label: 'Driving' },
  { value: 'loading', label: 'Loading' },
  { value: 'unloading', label: 'Unloading' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'break', label: 'Break' },
  { value: 'service', label: 'Service' },
  { value: 'completed', label: 'Completed' },
]

export type TripStatus =
  | 'planned'
  | 'to_loading'
  | 'at_loading'
  | 'loaded'
  | 'to_unloading'
  | 'at_unloading'
  | 'unloaded'
  | 'completed'
  | 'cancelled'

export const TRIP_STATUSES: ReadonlyArray<{ value: TripStatus; label: string }> = [
  { value: 'planned', label: 'Planned' },
  { value: 'to_loading', label: 'On the way to loading' },
  { value: 'at_loading', label: 'At loading' },
  { value: 'loaded', label: 'Loaded' },
  { value: 'to_unloading', label: 'On the way to unloading' },
  { value: 'at_unloading', label: 'At unloading' },
  { value: 'unloaded', label: 'Unloaded' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

export type StopType = 'fuel' | 'break' | 'service' | 'customs' | 'parking' | 'other'

export const STOP_TYPES: ReadonlyArray<{ value: StopType; label: string }> = [
  { value: 'fuel', label: 'Fuel' },
  { value: 'break', label: 'Break' },
  { value: 'service', label: 'Service' },
  { value: 'customs', label: 'Customs' },
  { value: 'parking', label: 'Parking' },
  { value: 'other', label: 'Other' },
]

export type StopStatus = 'planned' | 'done' | 'cancelled'

export const STOP_STATUSES: ReadonlyArray<{ value: StopStatus; label: string }> = [
  { value: 'planned', label: 'Planned' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
]

// Document types a vehicle room is expected to hold. Used by the Documents tab's
// placeholder structure today; upload is not wired yet (see DocumentsTab TODO).
export const DOCUMENT_TYPES = [
  'Transport Order',
  'CMR',
  'POD',
  'Delivery Note',
  'Invoice',
  'Other',
] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

// Generic label lookup over any of the option lists above.
export function labelOf<T extends string>(
  options: ReadonlyArray<{ value: T; label: string }>,
  value: T | undefined | null,
): string {
  return options.find((o) => o.value === value)?.label ?? ''
}

// Visual tone for a status chip — maps a status to one of the app's existing
// semantic colours (no new palette). `done`=settled/green, `active`=in-progress
// /amber, `alert`=cancelled/coral, `muted`=idle/neutral.
export type StatusTone = 'done' | 'active' | 'alert' | 'muted'

export function vehicleStatusTone(s: VehicleStatus | undefined): StatusTone {
  switch (s) {
    case 'available':
      return 'muted'
    case 'completed':
      return 'done'
    case 'service':
      return 'alert'
    case undefined:
      return 'muted'
    default:
      return 'active' // driving / loading / unloading / waiting / break
  }
}

export function tripStatusTone(s: TripStatus | undefined): StatusTone {
  switch (s) {
    case 'completed':
    case 'unloaded':
      return 'done'
    case 'cancelled':
      return 'alert'
    case 'planned':
    case undefined:
      return 'muted'
    default:
      return 'active'
  }
}

export function stopStatusTone(s: StopStatus): StatusTone {
  return s === 'done' ? 'done' : s === 'cancelled' ? 'alert' : 'muted'
}

// ── Data shapes ──────────────────────────────────────────────────────────────
// All fields are optional/manual. Free-text fields (addresses, dates, weight,
// ETA…) are plain strings on purpose: they are typed by a human and we make no
// attempt to parse or compute them.

export type VehicleInfo = {
  vehicleType?: string
  trailerType?: string
  /** Manually-entered assigned driver(s) — free text (the Members tab lists the
   *  actual room participants and their roles). */
  assignedDrivers?: string
  status?: VehicleStatus
  notes?: string
}

export type ActiveTrip = {
  reference?: string
  loadingAddress?: string
  /** Manual loading date/time as free text (no calendar/GPS coupling). */
  loadingAt?: string
  unloadingAddress?: string
  unloadingAt?: string
  client?: string
  cargo?: string
  weight?: string
  pallets?: string
  status?: TripStatus
  /** Manual ETA — typed by the dispatcher, never computed from a map/route. */
  eta?: string
  notes?: string
}

export type VehicleStop = {
  id: string
  type: StopType
  location?: string
  /** Manual planned time as free text. */
  plannedAt?: string
  notes?: string
  status: StopStatus
}

// The whole operational blob stored at `group.meta.ops`.
export type VehicleOps = {
  vehicle: VehicleInfo
  trip: ActiveTrip | null
  stops: VehicleStop[]
}

export function emptyOps(): VehicleOps {
  return { vehicle: {}, trip: null, stops: [] }
}

// Read + normalise the ops blob off a group's meta, tolerating absent/partial/
// legacy data (older groups have no `ops` key at all). Structurally typed so it
// doesn't need to import Group (avoids a type cycle with lib/types).
export function getOps(group: { meta?: Record<string, unknown> }): VehicleOps {
  const raw = group.meta?.ops as Partial<VehicleOps> | undefined
  if (!raw || typeof raw !== 'object') return emptyOps()
  return {
    vehicle: raw.vehicle && typeof raw.vehicle === 'object' ? raw.vehicle : {},
    trip: raw.trip && typeof raw.trip === 'object' ? raw.trip : null,
    stops: Array.isArray(raw.stops)
      ? raw.stops.filter((s): s is VehicleStop => Boolean(s) && typeof s === 'object' && 'id' in s)
      : [],
  }
}

// Stable id for a new stop (crypto.randomUUID when available; cheap fallback).
export function stopId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `stop_${Math.random().toString(36).slice(2)}`
}
