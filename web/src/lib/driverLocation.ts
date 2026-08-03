// Live driver location for a vehicle room's active trip — the desktop half of
// the mobile driver app's 60-second location pings (server: POST /api/driver/
// location). The server stores ONLY the latest entry per driver under the
// room's `meta.driverLocations` and fans updates out on the group socket room
// as `driver:location`, so exactly the room's members can see the position.
// This module owns the shared shape + the parsing/staleness rules so the map
// and any future surface (sidebar, trip tab) agree on them.

/** One driver's latest known position, as stored/broadcast by the server. */
export type DriverLocation = {
  userId: string
  tripId: string
  name: string
  lat: number
  lng: number
  accuracyM?: number
  headingDeg?: number
  speedMps?: number
  /** ISO-8601 capture time (server-validated). */
  recordedAt: string
}

/** Older than this → the marker renders muted/stale ("last known location"). */
export const DRIVER_STALE_MS = 5 * 60_000
/** Older than this → don't render at all (a position from a past shift is
 *  noise, not information). */
export const DRIVER_EXPIRE_MS = 12 * 60 * 60_000

// One raw entry off `meta.driverLocations` → a typed DriverLocation, or null
// when the blob is malformed or belongs to a different trip. Defensive: the
// meta blob is JSONB the client must never trust blindly.
function parseEntry(raw: unknown, tripId: string): DriverLocation | null {
  if (typeof raw !== 'object' || raw === null) return null
  const e = raw as Record<string, unknown>
  if (
    typeof e.userId !== 'string' ||
    typeof e.tripId !== 'string' ||
    typeof e.lat !== 'number' ||
    typeof e.lng !== 'number' ||
    typeof e.recordedAt !== 'string'
  ) {
    return null
  }
  if (e.tripId !== tripId) return null
  if (!Number.isFinite(Date.parse(e.recordedAt))) return null
  return {
    userId: e.userId,
    tripId: e.tripId,
    name: typeof e.name === 'string' && e.name ? e.name : 'Driver',
    lat: e.lat,
    lng: e.lng,
    ...(typeof e.accuracyM === 'number' ? { accuracyM: e.accuracyM } : {}),
    ...(typeof e.headingDeg === 'number' ? { headingDeg: e.headingDeg } : {}),
    ...(typeof e.speedMps === 'number' ? { speedMps: e.speedMps } : {}),
    recordedAt: e.recordedAt,
  }
}

/** The stored `meta.driverLocations` blob → last-known positions for THIS trip,
 *  keyed by driver user id. Entries from other/older trips are dropped. */
export function parseDriverLocations(
  raw: unknown,
  tripId: string,
): Record<string, DriverLocation> {
  if (typeof raw !== 'object' || raw === null) return {}
  const out: Record<string, DriverLocation> = {}
  for (const value of Object.values(raw as Record<string, unknown>)) {
    const entry = parseEntry(value, tripId)
    if (entry) out[entry.userId] = entry
  }
  return out
}

/** A `driver:location` socket payload → a typed entry (null when malformed or
 *  for another group/trip). Same defensive rules as the stored blob. */
export function parseDriverLocationEvent(
  raw: unknown,
  groupId: string,
  tripId: string,
): DriverLocation | null {
  if (typeof raw !== 'object' || raw === null) return null
  const e = raw as Record<string, unknown>
  if (e.groupId !== groupId) return null
  return parseEntry(raw, tripId)
}

// ── Breadcrumb trail ─────────────────────────────────────────────────────────
// Where the truck HAS BEEN, as opposed to where it is. The server appends each
// ping to `groups.meta.driverTrails[userId]` (compact [lat, lng, epochMs,
// heading?] tuples, scoped to a trip); the map seeds from that blob and then
// extends its copy from the same `driver:location` events it already receives,
// so the live path costs no extra traffic.

export type DriverTrailPoint = { lat: number; lng: number; at: number; headingDeg?: number }

/**
 * Minimum movement before a point joins the trail. MUST match
 * TRAIL_MIN_MOVE_M in server/src/routes/driver.ts — the server applies it when
 * storing and the client when extending live, and if they disagree a dispatcher
 * who reloads mid-trip sees a different path from one who stayed on the page.
 */
export const TRAIL_MIN_MOVE_M = 25

/** Matches the server's TRAIL_MAX_POINTS so a long trip trims identically. */
export const TRAIL_MAX_POINTS = 1500

/** Ground distance in metres between two positions (haversine). */
export function metersBetween(a: DriverTrailPoint | DriverLocation, b: DriverTrailPoint | DriverLocation): number {
  const R = 6_371_000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** One stored trail blob → this trip's points. Trails from an earlier trip are
 *  dropped, exactly as the server drops them on write. */
function parseTrailEntry(raw: unknown, tripId: string): DriverTrailPoint[] {
  if (typeof raw !== 'object' || raw === null) return []
  const t = raw as Record<string, unknown>
  if (t.tripId !== tripId || !Array.isArray(t.points)) return []
  const out: DriverTrailPoint[] = []
  for (const p of t.points) {
    if (!Array.isArray(p) || p.length < 3) continue
    const [lat, lng, at, heading] = p as unknown[]
    if (typeof lat !== 'number' || typeof lng !== 'number' || typeof at !== 'number') continue
    out.push({ lat, lng, at, ...(typeof heading === 'number' ? { headingDeg: heading } : {}) })
  }
  return out
}

/** The stored `meta.driverTrails` blob → this trip's paths, keyed by driver. */
export function parseDriverTrails(raw: unknown, tripId: string): Record<string, DriverTrailPoint[]> {
  if (typeof raw !== 'object' || raw === null) return {}
  const out: Record<string, DriverTrailPoint[]> = {}
  for (const [userId, value] of Object.entries(raw as Record<string, unknown>)) {
    const points = parseTrailEntry(value, tripId)
    if (points.length) out[userId] = points
  }
  return out
}

/** Extend a trail with a freshly received position, applying the server's rule.
 *  Returns the SAME array when the point is skipped, so React can bail out of a
 *  re-render instead of redrawing an unchanged polyline every minute. */
export function extendTrail(points: DriverTrailPoint[], loc: DriverLocation): DriverTrailPoint[] {
  const at = Date.parse(loc.recordedAt)
  if (!Number.isFinite(at)) return points
  const last = points[points.length - 1]
  if (last && metersBetween(last, loc) < TRAIL_MIN_MOVE_M) return points
  // A ping can arrive out of order after a reconnect; keep the path monotonic.
  if (last && at < last.at) return points
  const next = [
    ...points,
    { lat: loc.lat, lng: loc.lng, at, ...(loc.headingDeg !== undefined ? { headingDeg: loc.headingDeg } : {}) },
  ]
  return next.length > TRAIL_MAX_POINTS ? next.slice(-TRAIL_MAX_POINTS) : next
}

/** "Just now" / "3 min ago" / "2 h ago" — the marker tooltip's age line. */
export function driverLocationAgo(recordedAt: string, now: number): string {
  const ms = Math.max(0, now - Date.parse(recordedAt))
  if (ms < 60_000) return 'Just now'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  return `${h} h ago`
}
