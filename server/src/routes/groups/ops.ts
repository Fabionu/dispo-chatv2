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
      // Structured truck dimensions/weight (HERE units: cm/kg). Same caps as the
      // route proxy's `truckRouteSchema` (server/src/routes/here.ts) so a stored
      // profile always routes. Used for restriction-aware routing + the mobile
      // truck-navigation handoff.
      truckProfile: z
        .object({
          heightCm: z.number().int().positive().max(1000).optional(),
          widthCm: z.number().int().positive().max(500).optional(),
          lengthCm: z.number().int().positive().max(3000).optional(),
          grossWeightKg: z.number().int().positive().max(80000).optional(),
          axleCount: z.number().int().min(2).max(12).optional(),
          trailerCount: z.number().int().min(0).max(4).optional(),
        })
        .optional(),
      notes: opsStr(2000),
    })
    .default({}),
  trip: z
    .object({
      // Stable trip id (client-generated UUID at creation) so the mobile driver
      // API can address this trip; optional for trips created before the field.
      id: z.string().max(64).optional(),
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
      // Assigned driver user ids (real room members). Drives the mobile
      // "trips assigned to me" filter + the driver-assignment activity row.
      // Membership is re-validated server-side (see update.ts) before persisting.
      assignedDriverIds: z.array(z.string().uuid()).max(10).optional(),
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
// the full validation). Only the trip status/reference, assigned drivers, and the
// route summary participate in the diff.
export type OpsLite = {
  trip?: {
    status?: string
    reference?: string
    assignedDriverIds?: string[]
    route?: { status?: string; distanceText?: string; durationText?: string; polylines?: string[] }
  } | null
} | null

// The set of driver ids added / removed between two ops snapshots. Pure and
// order-insensitive, so a save that re-sends the same assignment yields empty
// arrays (no duplicate activity row). Used by update.ts to log
// trip_driver_assigned / trip_driver_unassigned.
export function assignedDriverDelta(
  oldOps: OpsLite | null,
  newOps: OpsLite,
): { added: string[]; removed: string[] } {
  const before = new Set((oldOps?.trip?.assignedDriverIds ?? []).filter(Boolean))
  const after = new Set((newOps?.trip?.assignedDriverIds ?? []).filter(Boolean))
  return {
    added: [...after].filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !after.has(id)),
  }
}

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
