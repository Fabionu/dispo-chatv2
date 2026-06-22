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

// Manual trip progress. The order below is the rough lifecycle order a
// dispatcher/driver walks a load through (also the <select> order). Drivers will
// later set this from their phone (see TODO in TripTab) — for now any manager can
// change it; nothing is ever computed from GPS/maps.
export type TripStatus =
  | 'planned'
  | 'to_loading'
  | 'at_loading'
  | 'loaded'
  | 'in_transit'
  | 'at_customs'
  | 'ferry'
  | 'break'
  | 'service'
  | 'to_unloading'
  | 'at_unloading'
  | 'unloaded'
  | 'completed'
  | 'cancelled'

export const TRIP_STATUSES: ReadonlyArray<{ value: TripStatus; label: string }> = [
  { value: 'planned', label: 'Planned' },
  { value: 'to_loading', label: 'Going to loading' },
  { value: 'at_loading', label: 'At loading' },
  { value: 'loaded', label: 'Loaded' },
  { value: 'in_transit', label: 'In transit' },
  { value: 'at_customs', label: 'At customs' },
  { value: 'ferry', label: 'Ferry' },
  { value: 'break', label: 'Break' },
  { value: 'service', label: 'Service' },
  { value: 'to_unloading', label: 'Going to unloading' },
  { value: 'at_unloading', label: 'At unloading' },
  { value: 'unloaded', label: 'Unloaded' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

export type StopType =
  | 'loading'
  | 'unloading'
  | 'customs'
  | 'ferry'
  | 'fuel'
  | 'service'
  | 'parking'
  | 'break'
  | 'other'

export const STOP_TYPES: ReadonlyArray<{ value: StopType; label: string }> = [
  { value: 'loading', label: 'Loading' },
  { value: 'unloading', label: 'Unloading' },
  { value: 'customs', label: 'Customs' },
  { value: 'ferry', label: 'Ferry' },
  { value: 'fuel', label: 'Fuel' },
  { value: 'service', label: 'Service' },
  { value: 'parking', label: 'Parking' },
  { value: 'break', label: 'Break' },
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

// Visual tone for a status chip. The base four reuse the app's existing semantic
// palette tokens: `done`=settled/green, `active`=in-progress/amber,
// `alert`=cancelled/coral, `muted`=idle/neutral.
export type StatusTone = 'done' | 'active' | 'alert' | 'muted'

// Extended chip palette for TRIP progress — a richer, scannable set layered on
// top of the base four so each operational state reads at a glance (see
// `tripStatusTone`). The class strings for these live in opsControls' StatusChip.
export type ChipTone =
  | StatusTone
  | 'blue'
  | 'green'
  | 'cyan'
  | 'purple'
  | 'indigo'
  | 'slate'
  | 'orange'

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

// Per-status colour for trip progress. Distinct, scannable tones (no GPS/route
// input — purely the manual status value). Loading/unloading transit legs share
// blue; "at" stops share amber; loaded/unloaded share green; Completed settles to
// the muted-green `done`; Cancelled is the coral `alert`.
export function tripStatusTone(s: TripStatus | undefined): ChipTone {
  switch (s) {
    case 'to_loading':
    case 'to_unloading':
      return 'blue'
    case 'at_loading':
    case 'at_unloading':
      return 'active' // amber
    case 'loaded':
    case 'unloaded':
      return 'green'
    case 'in_transit':
      return 'cyan'
    case 'at_customs':
      return 'purple'
    case 'ferry':
      return 'indigo'
    case 'break':
      return 'slate'
    case 'service':
      return 'orange'
    case 'completed':
      return 'done'
    case 'cancelled':
      return 'alert'
    case 'planned':
    case undefined:
    default:
      return 'muted'
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

// ── Compact summaries (header + sidebar) ─────────────────────────────────────
// The next stop a driver is heading to: the first stop still marked planned
// (stops are kept in dispatcher-entered order). Undefined when none remain.
export function nextPlannedStop(stops: VehicleStop[]): VehicleStop | undefined {
  return stops.find((s) => s.status === 'planned')
}

// One-line trip summary pieces shared by the vehicle-room header and the sidebar
// row. Returns null when there's no active trip, so callers fall back to their
// existing (non-trip) subtitle. Everything here is read straight off the manual
// ops blob — no computed routing/ETA.
export type TripSummary = {
  reference?: string
  statusLabel: string
  statusTone: ChipTone
  /** "Customs, Nadlac" — the next planned stop's type + location. */
  nextLabel?: string
}

export function tripSummary(ops: VehicleOps): TripSummary | null {
  const t = ops.trip
  if (!t) return null
  const ns = nextPlannedStop(ops.stops)
  const nextLabel = ns
    ? [labelOf(STOP_TYPES, ns.type), ns.location].filter(Boolean).join(', ') || undefined
    : undefined
  return {
    reference: t.reference,
    statusLabel: labelOf(TRIP_STATUSES, t.status) || 'Planned',
    statusTone: tripStatusTone(t.status),
    nextLabel,
  }
}
