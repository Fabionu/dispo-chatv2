import { z } from 'zod'
import { type SystemEvent } from '../../util/messages.js'

// Manual vehicle-room operational data (vehicle details, one active trip, its
// stops). Stored wholesale under `meta.ops` — the client owns the full object
// and sends it on every change, so we validate shape/enums/caps but otherwise
// replace the key as-is. Strictly manual: no coordinates/GPS/computed ETA.
const opsStr = (max: number) => z.string().trim().max(max).optional()

export const opsSchema = z.object({
  vehicle: z
    .object({
      vehicleType: opsStr(80),
      trailerType: opsStr(80),
      assignedDrivers: opsStr(200),
      status: z
        .enum(['available', 'driving', 'loading', 'unloading', 'waiting', 'break', 'service', 'completed'])
        .optional(),
      notes: opsStr(2000),
    })
    .default({}),
  trip: z
    .object({
      reference: opsStr(120),
      loadingAddress: opsStr(300),
      loadingAt: opsStr(80),
      unloadingAddress: opsStr(300),
      unloadingAt: opsStr(80),
      client: opsStr(160),
      cargo: opsStr(500),
      weight: opsStr(60),
      pallets: opsStr(60),
      status: z
        .enum([
          'planned',
          'to_loading',
          'at_loading',
          'loaded',
          'in_transit',
          'at_customs',
          'ferry',
          'break',
          'service',
          'to_unloading',
          'at_unloading',
          'unloaded',
          'completed',
          'cancelled',
        ])
        .optional(),
      eta: opsStr(80),
      notes: opsStr(2000),
      // Route summary computed from the stop coordinates (manual planning data,
      // never live GPS). Geometry polylines are stored for a future driver app.
      // A single HERE flexible polyline for a long-haul leg can run to tens of
      // thousands of characters (a ~670 km route is ~33k), so the per-string cap
      // is generous — the old 8k limit silently rejected real routes, which is
      // why trips never persisted their geometry. Widening only accepts more, so
      // it's backward compatible. The 1mb JSON body limit remains the backstop.
      route: z
        .object({
          status: z.enum(['ok', 'incomplete', 'failed']).optional(),
          distanceText: opsStr(40),
          durationText: opsStr(40),
          polylines: z.array(z.string().max(60000)).max(100).optional(),
          computedAt: opsStr(40),
        })
        .optional(),
    })
    .nullable()
    .default(null),
  stops: z
    .array(
      z.object({
        id: z.string().max(64),
        type: z.enum([
          'loading',
          'unloading',
          'customs',
          'ferry',
          'fuel',
          'service',
          'parking',
          'break',
          'other',
        ]),
        // Structured address: company/site, street, and the split
        // country/postal/city fields. `cityLine` is the legacy combined
        // "country, postal code and city" line, kept so old stops still load.
        company: opsStr(160),
        street: opsStr(300),
        cityLine: opsStr(300),
        country: opsStr(8),
        postalCode: opsStr(20),
        city: opsStr(160),
        coordinates: opsStr(160),
        lat: z.number().optional(),
        lng: z.number().optional(),
        // Legacy single-line address from before the structured fields existed.
        location: opsStr(300),
        plannedAt: opsStr(80),
        notes: opsStr(1000),
        status: z.enum(['planned', 'done', 'cancelled']),
      }),
    )
    .max(50)
    .default([]),
})

// Minimal shape of the ops blob we diff for activity rows (the zod schema owns
// the full validation). Only the trip status/reference and the route summary
// participate in the diff.
export type OpsLite = {
  trip?: {
    status?: string
    reference?: string
    route?: { status?: string; distanceText?: string; durationText?: string; polylines?: string[] }
  } | null
} | null

type TripActivity = { event: SystemEvent; payload: Record<string, unknown> | null }

// Build the activity rows implied by an ops change: a trip being added, its
// status changing, and/or its route being edited. Pure and side-effect free, so
// it naturally dedupes — an unchanged save yields []. trip_added and a status
// change are mutually exclusive; a route edit can accompany either.
export function tripActivityEvents(
  oldOps: OpsLite | null,
  newOps: OpsLite,
  routeEdited: boolean,
): TripActivity[] {
  const out: TripActivity[] = []
  const oldTrip = oldOps?.trip ?? null
  const newTrip = newOps?.trip ?? null

  if (!oldTrip && newTrip) {
    out.push({ event: 'trip_added', payload: { tripLabel: newTrip.reference ?? null } })
  } else if (oldTrip && newTrip && (oldTrip.status ?? null) !== (newTrip.status ?? null)) {
    out.push({
      event: 'trip_status_changed',
      payload: { from: oldTrip.status ?? null, to: newTrip.status ?? null },
    })
  }

  // Route edit: only when the client flagged a deliberate edit AND the resulting
  // route actually differs from what was stored (re-saving an identical route is
  // silent).
  if (routeEdited && newTrip?.route) {
    const a = oldTrip?.route
    const b = newTrip.route
    const changed =
      a?.status !== b.status ||
      a?.distanceText !== b.distanceText ||
      a?.durationText !== b.durationText ||
      JSON.stringify(a?.polylines ?? []) !== JSON.stringify(b.polylines ?? [])
    if (changed) out.push({ event: 'route_edited', payload: null })
  }

  return out
}
