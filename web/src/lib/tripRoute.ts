// Trip route data, computed from the manually-entered stop coordinates via the
// existing HERE truck-routing proxy. This is PLANNING data only — there is no
// live GPS or tracking. It runs best-effort and never blocks saving a trip: too
// few coordinates → `incomplete`; a routing error → `failed`; both leave the
// trip saved. The geometry is stored so a future driver app can navigate it.

import { api } from './api'
import { parseCoordinates, type TripRoute, type VehicleOps, type VehicleStop } from './vehicleOps'

// Re-export so callers don't reach into vehicleOps for the type.
export type { TripRoute }

// Decimal-degree points for the stops that have usable coordinates, in order.
// Prefers the parsed lat/lng; falls back to parsing the raw `coordinates` text.
// Exported so the Trip tab's route-availability check and the trip-route map read
// coordinates exactly the way the route calculation does (single source of truth).
export function routablePoints(stops: VehicleStop[]): { lat: number; lng: number }[] {
  const pts: { lat: number; lng: number }[] = []
  for (const s of stops) {
    if (typeof s.lat === 'number' && typeof s.lng === 'number') {
      pts.push({ lat: s.lat, lng: s.lng })
      continue
    }
    const parsed = s.coordinates ? parseCoordinates(s.coordinates) : null
    if (parsed) pts.push(parsed)
  }
  return pts
}

// True when there are enough coordinates to attempt a route (≥ origin + dest).
export function canRouteStops(stops: VehicleStop[]): boolean {
  return routablePoints(stops).length >= 2
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${Math.round(meters / 1000)} km` : `${Math.round(meters)} m`
}
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const min = Math.round((seconds % 3600) / 60)
  return h > 0 ? `${h} h ${min} min` : `${min} min`
}

// Compute the route over the stops, in order: first coord = origin, last = dest,
// the rest = via points. Always resolves (never rejects) so callers can attach
// the result without a try/catch.
export async function computeTripRoute(stops: VehicleStop[]): Promise<TripRoute> {
  const pts = routablePoints(stops)
  const now = new Date().toISOString()
  if (pts.length < 2) return { status: 'incomplete', computedAt: now }
  try {
    const origin = pts[0]
    const destination = pts[pts.length - 1]
    const via = pts.slice(1, -1)
    const { route } = await api.here.truckRoute({ origin, destination, via })
    const polylines = route.sections
      .map((sec) => sec.polyline)
      .filter((p): p is string => Boolean(p))
    return {
      status: 'ok',
      distanceText: formatDistance(route.summary.length),
      durationText: formatDuration(route.summary.duration),
      polylines,
      computedAt: now,
    }
  } catch {
    return { status: 'failed', computedAt: now }
  }
}

// Save the ops blob, then (when it has a trip) compute its route from the stop
// coordinates and save that too — in the BACKGROUND, so the trip persists and the
// caller returns immediately regardless of routing. Route failures are captured
// on `trip.route.status` and never surface as an error to the caller.
export async function persistOpsWithRoute(
  groupId: string,
  ops: VehicleOps,
  applyMeta: (meta: Record<string, unknown>) => void,
): Promise<void> {
  const { group } = await api.groups.update(groupId, { ops })
  applyMeta(group.meta)

  const trip = ops.trip
  if (!trip) return
  // Fire-and-forget: enrich the just-saved trip with route data.
  void (async () => {
    const route = await computeTripRoute(ops.stops)
    try {
      const { group: g2 } = await api.groups.update(groupId, {
        ops: { ...ops, trip: { ...trip, route } },
      })
      applyMeta(g2.meta)
    } catch {
      /* the trip stays saved with whatever route it already had */
    }
  })()
}
