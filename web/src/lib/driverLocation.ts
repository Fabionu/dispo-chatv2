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

/** "Just now" / "3 min ago" / "2 h ago" — the marker tooltip's age line. */
export function driverLocationAgo(recordedAt: string, now: number): string {
  const ms = Math.max(0, now - Date.parse(recordedAt))
  if (ms < 60_000) return 'Just now'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  return `${h} h ago`
}
