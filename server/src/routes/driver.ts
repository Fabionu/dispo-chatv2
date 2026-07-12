import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { requireAuth } from '../auth.js'
import { asyncHandler, withTransaction, HttpError } from '../http.js'
import { getIOIfReady, roomForGroup } from '../realtime.js'
import { opsSchema } from './groups/ops.js'

// ── Driver-facing trip API ────────────────────────────────────────────────
// Read-only-ish surface the FUTURE mobile driver app calls to fetch and progress
// the trip(s) assigned to the signed-in driver. Nothing here does live GPS,
// tracking, or turn-by-turn navigation — it only exposes the manually-managed
// trip data (stops + coordinates + truck profile + any precomputed route) that
// dispatchers already build on desktop, so the phone can render the trip and hand
// the coordinates to a navigation provider (HERE / Google / Waze).
//
// Permission model: a caller only ever sees a trip when they are BOTH a member of
// the vehicle room AND listed in the trip's `assignedDriverIds`. Membership is a
// join (a non-member gets 404 — existence isn't revealed); a member who isn't the
// assigned driver gets 403. Nothing else is exposed.
//
// The trip lives inside `groups.meta.ops` (see server/src/routes/groups/ops.ts),
// so we reuse `opsSchema` to parse + normalise the stored blob into a typed shape.
export const driverRouter = Router()
driverRouter.use(requireAuth)

type Ops = z.infer<typeof opsSchema>
type Trip = NonNullable<Ops['trip']>

// A trip is drivable ("active") for the mobile list unless it's finished. A
// missing status means a freshly-planned trip, which is active.
function isActiveStatus(status: Trip['status']): boolean {
  return status !== 'completed' && status !== 'cancelled'
}

// Parse the stored ops blob for a group. Returns null when the group has never
// stored ops or the blob doesn't validate (the driver API then treats it as
// "no trip" rather than erroring the whole request).
function parseOps(meta: Record<string, unknown> | null): Ops | null {
  const parsed = opsSchema.safeParse(meta?.ops ?? {})
  return parsed.success ? parsed.data : null
}

// Resolve assigned-driver ids → display names in one query, for the payload's
// `assignedDrivers`. Order-independent (callers map back by id).
async function driverNameMap(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return new Map()
  const { rows } = await pool.query<{ id: string; display_name: string }>(
    'select id, display_name from users where id = any($1::uuid[])',
    [unique],
  )
  return new Map(rows.map((r) => [r.id, r.display_name]))
}

// The full trip payload the mobile app consumes. Flat, typed, and provider-
// agnostic: stops carry coordinates in order, the truck profile carries the
// dimensions truck navigation needs, and `route` carries any precomputed HERE
// geometry/summary. `tripId` falls back to the room id for trips created before
// trips had their own id.
type DriverTripPayload = {
  tripId: string
  vehicleRoomId: string
  reference: string | null
  client: string | null
  status: string
  assignedDrivers: Array<{ id: string; name: string }>
  truckProfile: Ops['vehicle']['truckProfile'] | null
  stops: Array<{
    id: string
    type: string
    status: string
    company?: string
    street?: string
    country?: string
    postalCode?: string
    city?: string
    cityLine?: string
    location?: string
    coordinates?: string
    lat?: number
    lng?: number
    plannedAt?: string
    notes?: string
  }>
  route: {
    status: string
    summary: { distanceText: string | null; durationText: string | null }
    polylines: string[]
    computedAt: string | null
  } | null
}

function buildDriverTrip(
  groupId: string,
  ops: Ops,
  trip: Trip,
  names: Map<string, string>,
): DriverTripPayload {
  const assignedIds = trip.assignedDriverIds ?? []
  const route = trip.route
  return {
    tripId: trip.id ?? groupId,
    vehicleRoomId: groupId,
    reference: trip.reference ?? null,
    client: trip.client ?? null,
    status: trip.status ?? 'planned',
    assignedDrivers: assignedIds.map((id) => ({ id, name: names.get(id) ?? 'Driver' })),
    truckProfile: ops.vehicle.truckProfile ?? null,
    // Stop order is the array order (the dispatcher-entered sequence) — preserved
    // verbatim so the phone can show "next stop" and route in the right order.
    stops: ops.stops.map((s) => ({
      id: s.id,
      type: s.type,
      status: s.status,
      company: s.company,
      street: s.street,
      country: s.country,
      postalCode: s.postalCode,
      city: s.city,
      cityLine: s.cityLine,
      location: s.location,
      coordinates: s.coordinates,
      lat: s.lat,
      lng: s.lng,
      plannedAt: s.plannedAt,
      notes: s.notes,
    })),
    route:
      route && route.status
        ? {
            status: route.status,
            summary: {
              distanceText: route.distanceText ?? null,
              durationText: route.durationText ?? null,
            },
            polylines: route.polylines ?? [],
            computedAt: route.computedAt ?? null,
          }
        : null,
  }
}

// Apply the full permission boundary to a fetched room row: parse its ops, assert
// there's a trip and the caller is one of its assigned drivers. Throws 404 when
// there's no trip (never reveal a room the caller can't see) and 403 when the
// caller is a member but not the assigned driver. Shared by the reads and the
// locking write so the rule lives in exactly one place.
function assertAssignedTrip(
  userId: string,
  row: { id: string; meta: Record<string, unknown> | null } | undefined,
): { groupId: string; ops: Ops; trip: Trip } {
  if (!row) throw new HttpError(404, 'trip_not_found')
  const ops = parseOps(row.meta)
  if (!ops?.trip) throw new HttpError(404, 'trip_not_found')
  const trip = ops.trip
  if (!(trip.assignedDriverIds ?? []).includes(userId)) throw new HttpError(403, 'forbidden')
  return { groupId: row.id, ops, trip }
}

// The SQL that finds a room the caller belongs to by trip id OR room id. The
// membership join means a non-member simply gets no row (→ 404), so a room the
// caller isn't in is never revealed. Kept as a constant so the read and the
// `for update` write share the exact same lookup shape.
const TRIP_LOOKUP_SQL = `
  select g.id, g.meta
    from groups g
    join group_members gm on gm.group_id = g.id and gm.user_id = $1
   where g.type = 'vehicle'
     and (g.meta->'ops'->'trip'->>'id' = $2 or g.id::text = $2)
   limit 1`

// Resolve a trip the caller is entitled to (non-locking read via the pool).
async function resolveAssignedTrip(
  userId: string,
  tripId: string,
): Promise<{ groupId: string; ops: Ops; trip: Trip }> {
  const { rows } = await pool.query<{ id: string; meta: Record<string, unknown> | null }>(
    TRIP_LOOKUP_SQL,
    [userId, tripId],
  )
  return assertAssignedTrip(userId, rows[0])
}

// ── GET /api/driver/trips/active ──────────────────────────────────────────
// Every active trip assigned to the caller. The SQL narrows to rooms the caller
// belongs to whose trip's `assignedDriverIds` contains them (jsonb containment);
// we then drop terminal (completed/cancelled) trips in JS.
driverRouter.get(
  '/trips/active',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const { rows } = await pool.query<{ id: string; meta: Record<string, unknown> | null }>(
      `select g.id, g.meta
         from groups g
         join group_members gm on gm.group_id = g.id and gm.user_id = $1
        where g.type = 'vehicle'
          and g.archived_at is null
          and coalesce(g.meta->'ops'->'trip'->'assignedDriverIds' @> to_jsonb($1::text), false)
        order by g.created_at desc`,
      [userId],
    )

    const active: Array<{ groupId: string; ops: Ops; trip: Trip }> = []
    for (const r of rows) {
      const ops = parseOps(r.meta)
      const trip = ops?.trip
      if (!ops || !trip) continue
      // Re-check assignment + activeness against the parsed value (defensive).
      if (!(trip.assignedDriverIds ?? []).includes(userId)) continue
      if (!isActiveStatus(trip.status)) continue
      active.push({ groupId: r.id, ops, trip })
    }

    const names = await driverNameMap(active.flatMap((a) => a.trip.assignedDriverIds ?? []))
    res.json({ trips: active.map((a) => buildDriverTrip(a.groupId, a.ops, a.trip, names)) })
  }),
)

// ── GET /api/driver/trips/:tripId ─────────────────────────────────────────
driverRouter.get(
  '/trips/:tripId',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const { groupId, ops, trip } = await resolveAssignedTrip(userId, req.params.tripId)
    const names = await driverNameMap(trip.assignedDriverIds ?? [])
    res.json({ trip: buildDriverTrip(groupId, ops, trip, names) })
  }),
)

// ── GET /api/driver/trips/:tripId/route ───────────────────────────────────
// The precomputed route geometry + summary + the truck profile it was computed
// for, so mobile can draw/hand off navigation. 404 when no usable route exists
// yet (too few coordinates, or a failed calculation).
driverRouter.get(
  '/trips/:tripId/route',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const { ops, trip } = await resolveAssignedTrip(userId, req.params.tripId)
    const route = trip.route
    if (!route || route.status !== 'ok') throw new HttpError(404, 'route_not_available')
    res.json({
      route: {
        status: route.status,
        summary: {
          distanceText: route.distanceText ?? null,
          durationText: route.durationText ?? null,
        },
        polylines: route.polylines ?? [],
        computedAt: route.computedAt ?? null,
        // Truck profile the route respects — mobile truck navigation needs it.
        truckProfile: ops.vehicle.truckProfile ?? null,
      },
    })
  }),
)

// ── POST /api/driver/location ─────────────────────────────────────────────
// A live location ping from the assigned driver's phone while they have the
// trip's navigation view open. Strictly permission-gated: the SAME assigned-
// driver boundary as every other driver read (member + assignedDriverIds, via
// resolveAssignedTrip → 404/403), PLUS the trip must still be active — a
// completed/cancelled trip accepts no further pings. Storage is deliberately
// minimal (latest-only, no history): one entry per driver under the room's
// `meta.driverLocations`, written with jsonb_set so concurrent drivers (and
// the dispatcher's wholesale `meta.ops` saves, which merge top-level keys)
// never clobber each other. The realtime fan-out goes to the GROUP room only,
// so exactly the room's members — the people entitled to see the trip — can
// see the driver's position.
const locationSchema = z.object({
  tripId: z.string().min(1).max(64),
  groupId: z.string().uuid(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  // Optional GPS extras (SI units): metres, degrees clockwise from north, m/s.
  accuracyM: z.number().min(0).max(100_000).optional(),
  headingDeg: z.number().min(0).max(360).optional(),
  speedMps: z.number().min(0).max(150).optional(),
  // Device capture time (ISO-8601). Validated below; the server clock wins
  // when it's absent, unparsable, or implausibly far from now.
  recordedAt: z.string().max(40).optional(),
})

// The stored/broadcast shape of one driver's latest position.
type DriverLocationEntry = {
  userId: string
  tripId: string
  name: string
  lat: number
  lng: number
  accuracyM?: number
  headingDeg?: number
  speedMps?: number
  recordedAt: string
}

driverRouter.post(
  '/location',
  asyncHandler(async (req, res) => {
    const parsed = locationSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })
    const body = parsed.data
    const { userId } = req.session!

    // Full permission boundary (membership + assignment) — 404/403 on failure.
    const { groupId, trip } = await resolveAssignedTrip(userId, body.tripId)
    // The payload's room must be the room the trip actually lives in.
    if (groupId !== body.groupId) throw new HttpError(400, 'group_mismatch')
    // No tracking outside an active trip.
    if (!isActiveStatus(trip.status)) throw new HttpError(409, 'trip_not_active')

    // Trust the device timestamp only when it parses and sits within ±10
    // minutes of now (phone clocks drift; a stale queued ping shouldn't
    // masquerade as fresh).
    const now = Date.now()
    let recordedAt = new Date(now).toISOString()
    if (body.recordedAt) {
      const t = Date.parse(body.recordedAt)
      if (Number.isFinite(t) && Math.abs(now - t) <= 10 * 60_000) {
        recordedAt = new Date(t).toISOString()
      }
    }

    const names = await driverNameMap([userId])
    const entry: DriverLocationEntry = {
      userId,
      // Store the CANONICAL trip id (falls back to the room id exactly like
      // buildDriverTrip), not the raw lookup key the phone sent.
      tripId: trip.id ?? groupId,
      name: names.get(userId) ?? 'Driver',
      lat: body.lat,
      lng: body.lng,
      ...(body.accuracyM !== undefined ? { accuracyM: body.accuracyM } : {}),
      ...(body.headingDeg !== undefined ? { headingDeg: body.headingDeg } : {}),
      ...(body.speedMps !== undefined ? { speedMps: body.speedMps } : {}),
      recordedAt,
    }

    // Latest-only upsert of THIS driver's entry: ensure `driverLocations`
    // exists (preserving other drivers' entries), then set ours — a single
    // atomic UPDATE, no read-modify-write race between concurrent drivers.
    await pool.query(
      `update groups
          set meta = jsonb_set(
            coalesce(meta, '{}'::jsonb)
              || jsonb_build_object(
                   'driverLocations',
                   coalesce(meta->'driverLocations', '{}'::jsonb)
                 ),
            array['driverLocations', $2],
            $3::jsonb,
            true
          )
        where id = $1`,
      [groupId, userId, JSON.stringify(entry)],
    )

    // Live fan-out to the vehicle room's members (and only them).
    getIOIfReady()
      ?.to(roomForGroup(groupId))
      .emit('driver:location', { groupId, ...entry })

    res.json({ ok: true })
  }),
)

// ── POST /api/driver/trips/:tripId/stops/:stopId/status ───────────────────
// A driver marks a stop planned/done/cancelled from the phone. Locks the room row,
// re-checks entitlement inside the transaction, flips the stop's status in the ops
// blob, and returns the refreshed trip. No system message / no route recompute —
// this is a quiet manual progress update (a clear hook for later if desired).
const stopStatusSchema = z.object({ status: z.enum(['planned', 'done', 'cancelled']) })

driverRouter.post(
  '/trips/:tripId/stops/:stopId/status',
  asyncHandler(async (req, res) => {
    const parsed = stopStatusSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })
    const { userId } = req.session!
    const { tripId, stopId } = req.params
    const status = parsed.data.status

    const { groupId, ops, trip } = await withTransaction(async (client) => {
      // Same lookup as the reads, but locking the room row so a concurrent write
      // (dispatcher edit or another stop update) can't clobber this change.
      const { rows } = await client.query<{ id: string; meta: Record<string, unknown> | null }>(
        `${TRIP_LOOKUP_SQL} for update of g`,
        [userId, tripId],
      )
      const resolved = assertAssignedTrip(userId, rows[0])
      const stop = resolved.ops.stops.find((s) => s.id === stopId)
      if (!stop) throw new HttpError(404, 'stop_not_found')
      stop.status = status
      // Write the ops blob back the same way the dispatcher's PATCH does — merge
      // the `ops` key into meta so unrelated meta (plates) is preserved.
      await client.query('update groups set meta = meta || $2::jsonb where id = $1', [
        resolved.groupId,
        JSON.stringify({ ops: resolved.ops }),
      ])
      return resolved
    })

    const names = await driverNameMap(trip.assignedDriverIds ?? [])
    res.json({ trip: buildDriverTrip(groupId, ops, trip, names) })
  }),
)
