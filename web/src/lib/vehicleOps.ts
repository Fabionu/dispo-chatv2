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

// Route summary computed from the trip's stop coordinates (manual planning data,
// never live GPS). Stored on the trip so the Trip tab can show distance/duration
// and a future driver app can navigate the saved geometry. `status` separates a
// real route from "not enough coordinates yet" and "routing failed".
export type TripRoute = {
  status: 'ok' | 'incomplete' | 'failed'
  /** Pre-formatted total distance, e.g. "842 km". */
  distanceText?: string
  /** Pre-formatted driving time, e.g. "9 h 40 min". */
  durationText?: string
  /** HERE flexible polylines, one per section — route geometry for future nav. */
  polylines?: string[]
  /** When the route was last computed (ISO). */
  computedAt?: string
}

export type ActiveTrip = {
  reference?: string
  /** @deprecated Legacy free-text loading address. New trips derive loading from
   *  the first Loading stop; kept so older trips still display. */
  loadingAddress?: string
  /** Manual loading date/time as free text (no calendar/GPS coupling). */
  loadingAt?: string
  /** @deprecated Legacy free-text unloading address — see `loadingAddress`. */
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
  /** Route data computed from the stop coordinates (best-effort, non-blocking). */
  route?: TripRoute
}

export type VehicleStop = {
  id: string
  type: StopType
  /** Company / site name at the stop (free text). */
  company?: string
  /** Street name + number (free text). */
  street?: string
  /** Country code / initials (e.g. "DE", "IT", "FR"). */
  country?: string
  /** Postal / ZIP code. */
  postalCode?: string
  /** City / town name. */
  city?: string
  /** @deprecated Legacy combined "Country, postal code and city" line, kept so
   *  stops created before the country/postalCode/city split still display. New
   *  stops set the structured fields above instead. */
  cityLine?: string
  /** Raw coordinates exactly as the dispatcher typed them (e.g.
   *  "48.99280 N, 21.24404 E"). Kept verbatim even when it doesn't parse, so
   *  nothing entered is ever lost. */
  coordinates?: string
  /** Parsed decimal-degree coordinates, set only when `coordinates` parses
   *  cleanly — the consistent internal format. Never computed from a map/GPS. */
  lat?: number
  lng?: number
  /** Legacy single-line address from stops created before the structured fields
   *  above existed. Still rendered as a fallback; new stops don't set it. */
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

// Parse a free-text coordinate pair ("lat, lng") into decimal degrees. Accepts
// an optional N/S/E/W hemisphere suffix per component (e.g.
// "48.99280 N, 21.24404 E") as well as bare signed decimals
// ("41.65419, -4.73214"). Returns null when the text isn't a clean comma-
// separated pair or falls outside valid ranges — callers keep the raw text and
// may show a gentle hint. Pure string parsing: no geocoding, maps, or GPS.
export function parseCoordinates(raw: string): { lat: number; lng: number } | null {
  const parts = raw.trim().split(',')
  if (parts.length !== 2) return null
  const lat = parseCoordComponent(parts[0])
  const lng = parseCoordComponent(parts[1])
  if (lat === null || lng === null) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

function parseCoordComponent(part: string): number | null {
  const m = part.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*([nsew])?$/i)
  if (!m) return null
  const val = parseFloat(m[1])
  if (Number.isNaN(val)) return null
  const hemi = m[2]?.toLowerCase()
  if (hemi === 's' || hemi === 'w') return -Math.abs(val)
  if (hemi === 'n' || hemi === 'e') return Math.abs(val)
  return val
}

// Best concise single-line label for a stop's place — prefers the structured
// address fields, then the legacy freeform `location`. Used in compact summaries
// (header / sidebar / stop chips).
export function stopLocationLabel(s: VehicleStop): string {
  return (
    s.company?.trim() ||
    stopCityLine(s) ||
    s.street?.trim() ||
    s.location?.trim() ||
    ''
  )
}

// Compose the "country postal city" line from the structured fields (e.g.
// "DE 10115 Berlin"), falling back to the legacy combined `cityLine` for stops
// created before the split. Empty string when there's nothing to show.
export function stopCityLine(s: VehicleStop): string {
  const structured = [s.country, s.postalCode, s.city]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v))
    .join(' ')
  return structured || s.cityLine?.trim() || ''
}

// Stops of a given role, in dispatcher-entered order.
export function loadingStops(stops: VehicleStop[]): VehicleStop[] {
  return stops.filter((s) => s.type === 'loading')
}
export function unloadingStops(stops: VehicleStop[]): VehicleStop[] {
  return stops.filter((s) => s.type === 'unloading')
}

// Full comma-joined address for a stop (company · street · country/postal/city),
// used by the Trip tab's loading/unloading summary. Falls back to legacy fields.
export function stopFullAddress(s: VehicleStop): string {
  const parts = [s.company, s.street, stopCityLine(s)]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v))
  return parts.length ? parts.join(', ') : (s.location?.trim() ?? '')
}

// ── Country code + flag ──────────────────────────────────────────────────────
// A small name→ISO map covers the common cases where a dispatcher typed a country
// name instead of a code; a bare 2-letter token is taken as the code directly.
const COUNTRY_NAME_CODE: Record<string, string> = {
  germany: 'DE', deutschland: 'DE', france: 'FR', italy: 'IT', italia: 'IT',
  romania: 'RO', spain: 'ES', españa: 'ES', poland: 'PL', polska: 'PL',
  netherlands: 'NL', holland: 'NL', belgium: 'BE', austria: 'AT', österreich: 'AT',
  switzerland: 'CH', hungary: 'HU', czechia: 'CZ', 'czech republic': 'CZ',
  slovakia: 'SK', slovenia: 'SI', croatia: 'HR', bulgaria: 'BG', greece: 'GR',
  portugal: 'PT', denmark: 'DK', sweden: 'SE', norway: 'NO', finland: 'FI',
  ireland: 'IE', 'united kingdom': 'GB', uk: 'GB', england: 'GB', luxembourg: 'LU',
  turkey: 'TR', türkiye: 'TR', serbia: 'RS', ukraine: 'UA', lithuania: 'LT',
  latvia: 'LV', estonia: 'EE', moldova: 'MD',
}

// Best-effort 2-letter country code for a stop. Reads the structured `country`
// field first (a 2-letter code, or a known country name), then the leading token
// of the legacy combined `cityLine` ("DE, 33333 Berlin" / "Germany, …"). Returns
// null when nothing usable is present — never throws.
export function parseCountryCode(s: VehicleStop): string | null {
  const fromText = (raw: string | undefined): string | null => {
    const t = raw?.trim()
    if (!t) return null
    const first = t.split(/[,\s]+/)[0]
    if (/^[A-Za-z]{2}$/.test(first)) return first.toUpperCase()
    return COUNTRY_NAME_CODE[t.toLowerCase()] ?? COUNTRY_NAME_CODE[first.toLowerCase()] ?? null
  }
  return fromText(s.country) ?? fromText(s.cityLine)
}

// Regional-indicator emoji flag for a 2-letter ISO code ("DE" → 🇩🇪). On
// platforms without flag-emoji support the indicators fall back to the two
// letters (a clean, code-revealing fallback). Returns '' for invalid input.
export function countryFlag(code: string | null | undefined): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return ''
  const cc = code.toUpperCase()
  return String.fromCodePoint(0x1f1e6 + cc.charCodeAt(0) - 65, 0x1f1e6 + cc.charCodeAt(1) - 65)
}

// A compact place for the room header: a flag (by country code) + the postal/city
// text (the country code is conveyed by the flag, so it's dropped from `text`).
export type TripPlace = { flag: string; code: string | null; text: string }

export function stopPlace(s: VehicleStop): TripPlace {
  const code = parseCountryCode(s)
  let text = [s.postalCode, s.city].map((v) => v?.trim()).filter(Boolean).join(' ')
  if (!text) text = (s.cityLine?.trim() ?? '').replace(/^[A-Za-z]{2}[,\s]+/, '')
  if (!text) text = s.city?.trim() || s.company?.trim() || stopFullAddress(s)
  return { flag: countryFlag(code), code, text }
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
  /** Loading / unloading places (flag + postal/city), derived from the stops, for
   *  the room header. Empty arrays when there are no such stops. */
  loadingPlaces: TripPlace[]
  unloadingPlaces: TripPlace[]
  /** Route summary computed from the stop coordinates (may be undefined). */
  route?: TripRoute
}

export function tripSummary(ops: VehicleOps): TripSummary | null {
  const t = ops.trip
  if (!t) return null
  const ns = nextPlannedStop(ops.stops)
  const nextLabel = ns
    ? [labelOf(STOP_TYPES, ns.type), stopLocationLabel(ns)].filter(Boolean).join(', ') || undefined
    : undefined
  return {
    reference: t.reference,
    statusLabel: labelOf(TRIP_STATUSES, t.status) || 'Planned',
    statusTone: tripStatusTone(t.status),
    nextLabel,
    loadingPlaces: loadingStops(ops.stops).map(stopPlace),
    unloadingPlaces: unloadingStops(ops.stops).map(stopPlace),
    route: t.route,
  }
}
