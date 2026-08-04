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
  /**
   * Metres driven so far on this trip by this driver, as computed by the SERVER
   * from validated fixes. Never re-derive this on the client: a browser only
   * ever sees the points that arrived while it was watching, so a page opened
   * mid-trip would report a shorter drive than one left open all day. Absent on
   * entries stored before tracking existed.
   */
  distanceM?: number
  /**
   * Which drawn run this position belongs to. A change of segment means a signal
   * gap preceded this fix, so the live path must start a new line here instead
   * of joining back to the previous point.
   */
  segment?: number
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
    ...(typeof e.distanceM === 'number' ? { distanceM: e.distanceM } : {}),
    ...(typeof e.segment === 'number' ? { segment: e.segment } : {}),
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

export type DriverTrailPoint = {
  lat: number
  lng: number
  at: number
  headingDeg?: number
  speedMps?: number
  /** Run this point belongs to. Points sharing a segment may be joined by a
   *  line; a change of segment marks a stretch with no coverage. */
  segment?: number
}

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
    // No segment id: these tuples predate tracking. trailSegments() infers the
    // breaks from time and distance instead.
    out.push({ lat, lng, at, ...(typeof heading === 'number' ? { headingDeg: heading } : {}) })
  }
  return out
}

// ── Recorded history (server-side track) ─────────────────────────────────────
// The durable record behind GET /api/trips/:tripId/track. Unlike the meta trail
// above, this survives trip completion and the vehicle starting its next job,
// and it carries the server's own distance total rather than anything the
// browser derived from the points it happened to receive.

export type TripTrackDriver = {
  driverId: string
  name: string
  distanceM: number
  pointCount: number
  firstAt: string | null
  lastAt: string | null
  /** Drawable runs; the boundary between two is a stretch with no coverage. */
  segments: Array<Array<{ lat: number; lng: number; at: string; speedMps?: number; headingDeg?: number }>>
  /** Periods with no signal, derived from the run boundaries. */
  gaps: Array<{ from: string; to: string }>
  downsampled: boolean
}

export type TripTrack = {
  tripId: string
  groupId: string
  totals: {
    distanceM: number
    pointCount: number
    firstAt: string | null
    lastAt: string | null
    durationMs: number
  }
  drivers: TripTrackDriver[]
}

/** One recorded driver's runs → the flat point list the map state uses. */
export function trackToTrailPoints(driver: TripTrackDriver): DriverTrailPoint[] {
  const out: DriverTrailPoint[] = []
  driver.segments.forEach((segment, index) => {
    for (const p of segment) {
      const at = Date.parse(p.at)
      if (!Number.isFinite(at)) continue
      out.push({
        lat: p.lat,
        lng: p.lng,
        at,
        segment: index,
        ...(p.headingDeg !== undefined ? { headingDeg: p.headingDeg } : {}),
        ...(p.speedMps !== undefined ? { speedMps: p.speedMps } : {}),
      })
    }
  })
  return out
}

/** "142 km" / "840 m" — the driven/planned readouts. */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '—'
  if (meters < 1_000) return `${Math.round(meters)} m`
  return `${(meters / 1_000).toFixed(meters < 10_000 ? 1 : 0)} km`
}

/** "4 h 12 min" / "38 min" — trip duration and gap lengths. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
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
  // The server's segment id is authoritative. When it advances, the truck was
  // out of contact in between, so the point must join the path even if it landed
  // near the last one — and it must NOT be joined to it by a line.
  const segment = loc.segment ?? last?.segment ?? 0
  const continues = !last || segment === (last.segment ?? 0)
  if (last && continues && metersBetween(last, loc) < TRAIL_MIN_MOVE_M) return points
  // A ping can arrive out of order after a reconnect; keep the path monotonic.
  if (last && at < last.at) return points
  const next = [
    ...points,
    {
      lat: loc.lat,
      lng: loc.lng,
      at,
      segment,
      ...(loc.headingDeg !== undefined ? { headingDeg: loc.headingDeg } : {}),
      ...(loc.speedMps !== undefined ? { speedMps: loc.speedMps } : {}),
    },
  ]
  return next.length > TRAIL_MAX_POINTS ? next.slice(-TRAIL_MAX_POINTS) : next
}

/**
 * Split a flat point list into drawable runs.
 *
 * Points carrying a server segment id are grouped by it. Legacy points from
 * `meta.driverTrails` (stored before tracking had segments) carry none, so the
 * gap is inferred from the same time/distance rules the server applies —
 * otherwise a trail seeded from the old blob would still draw one long line
 * across every hole in it.
 */
export const TRAIL_GAP_MS = 4 * 60_000
export const TRAIL_GAP_M = 1_500

export function trailSegments(points: DriverTrailPoint[]): DriverTrailPoint[][] {
  const runs: DriverTrailPoint[][] = []
  let current: DriverTrailPoint[] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const previous = points[i - 1]
    if (previous) {
      const broke =
        p.segment !== undefined && previous.segment !== undefined
          ? p.segment !== previous.segment
          : p.at - previous.at > TRAIL_GAP_MS || metersBetween(previous, p) > TRAIL_GAP_M
      if (broke) {
        if (current.length) runs.push(current)
        current = []
      }
    }
    current.push(p)
  }
  if (current.length) runs.push(current)
  return runs
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
