import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { requireAuth } from '../auth.js'
import { asyncHandler, withTransaction, HttpError } from '../http.js'
import { getIOIfReady, roomForGroup } from '../realtime.js'
import {
  MAX_DOC_BYTES,
  MAX_IMAGE_BYTES,
  isImage,
  uploadAttachment,
} from '../middleware/upload.js'
import { deleteFile, saveStream } from '../storage.js'
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

function assignedDriverIds(ops: Ops, trip: Trip): string[] {
  return ops.vehicle.assignedDriverIds ?? trip.assignedDriverIds ?? []
}

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
  const assignedIds = assignedDriverIds(ops, trip)
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
  if (!assignedDriverIds(ops, trip).includes(userId)) throw new HttpError(403, 'forbidden')
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
// belongs to whose persistent vehicle assignment contains them (with a legacy
// trip-level fallback for rooms not edited since the model change);
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
          and coalesce(
                coalesce(
                  g.meta->'ops'->'vehicle'->'assignedDriverIds',
                  g.meta->'ops'->'trip'->'assignedDriverIds'
                ) @> to_jsonb($1::text),
                false
              )
        order by g.created_at desc`,
      [userId],
    )

    const active: Array<{ groupId: string; ops: Ops; trip: Trip }> = []
    for (const r of rows) {
      const ops = parseOps(r.meta)
      const trip = ops?.trip
      if (!ops || !trip) continue
      // Re-check assignment + activeness against the parsed value (defensive).
      if (!assignedDriverIds(ops, trip).includes(userId)) continue
      if (!isActiveStatus(trip.status)) continue
      active.push({ groupId: r.id, ops, trip })
    }

    const names = await driverNameMap(
      active.flatMap((a) => assignedDriverIds(a.ops, a.trip)),
    )
    res.json({ trips: active.map((a) => buildDriverTrip(a.groupId, a.ops, a.trip, names)) })
  }),
)

// ── GET /api/driver/trips/:tripId ─────────────────────────────────────────
driverRouter.get(
  '/trips/:tripId',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const { groupId, ops, trip } = await resolveAssignedTrip(userId, req.params.tripId)
    const names = await driverNameMap(assignedDriverIds(ops, trip))
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

// ── Breadcrumb trail ─────────────────────────────────────────────────────────
// `driverLocations` answers "where is the truck now"; this answers "where has it
// been". Stored beside it under `meta.driverTrails[userId]`, scoped to a trip so
// a new trip starts a clean path.
//
// Points are compact tuples rather than objects — [lat, lng, epochMs, heading?]
// — because this is the one structure in `meta` that grows all day.

type TrailPoint = [number, number, number, number?]
type DriverTrail = { tripId: string; points: TrailPoint[] }

/**
 * Minimum ground distance from the last kept point before a new one is stored.
 *
 * Without it a truck parked at a loading dock for three hours would bank ~180
 * identical points. 25 m is below one minute of movement at any speed that
 * counts as driving (1.5 km/h), so nothing real is dropped — it only absorbs
 * GPS jitter and standing still. The client applies the same rule when it
 * appends live points (web/src/lib/driverLocation.ts — keep the two in step).
 */
const TRAIL_MIN_MOVE_M = 25

/** Hard cap. At 1/min with the filter above this is over a day of driving. */
const TRAIL_MAX_POINTS = 1500

function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** The stored blob → a trail for THIS trip, or a fresh one. Defensive: `meta` is
 *  JSONB and nothing downstream should trust its shape. */
function parseTrail(raw: unknown, tripId: string): DriverTrail {
  if (typeof raw !== 'object' || raw === null) return { tripId, points: [] }
  const t = raw as Record<string, unknown>
  // A trail from a previous trip is not this trip's path — start over.
  if (t.tripId !== tripId || !Array.isArray(t.points)) return { tripId, points: [] }
  const points: TrailPoint[] = []
  for (const p of t.points) {
    if (!Array.isArray(p) || p.length < 3) continue
    const [lat, lng, at, heading] = p as unknown[]
    if (typeof lat !== 'number' || typeof lng !== 'number' || typeof at !== 'number') continue
    points.push(typeof heading === 'number' ? [lat, lng, at, heading] : [lat, lng, at])
  }
  return { tripId, points }
}

/** Append unless the truck hasn't meaningfully moved, then trim to the cap. */
function extendTrail(trail: DriverTrail, entry: DriverLocationEntry): DriverTrail {
  const last = trail.points[trail.points.length - 1]
  if (last && metersBetween(last[0], last[1], entry.lat, entry.lng) < TRAIL_MIN_MOVE_M) {
    return trail
  }
  const at = Date.parse(entry.recordedAt)
  const point: TrailPoint =
    entry.headingDeg !== undefined
      ? [entry.lat, entry.lng, at, entry.headingDeg]
      : [entry.lat, entry.lng, at]
  const points = [...trail.points, point]
  return {
    tripId: trail.tripId,
    points: points.length > TRAIL_MAX_POINTS ? points.slice(-TRAIL_MAX_POINTS) : points,
  }
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

    // Read THIS driver's trail to extend it. Reading only our own key keeps the
    // write below safe: the UPDATE jsonb_sets exactly two leaf paths, both
    // namespaced by userId, so a concurrent driver's ping cannot be clobbered
    // and neither can the dispatcher's wholesale `meta.ops` saves.
    const trailRow = await pool.query<{ trail: unknown }>(
      `select meta->'driverTrails'->$2 as trail from groups where id = $1`,
      [groupId, userId],
    )
    const trail = extendTrail(parseTrail(trailRow.rows[0]?.trail, entry.tripId), entry)

    // Latest position + breadcrumb trail in one atomic UPDATE: ensure both
    // containers exist (preserving other drivers' entries), then set ours.
    await pool.query(
      `update groups
          set meta = jsonb_set(
            jsonb_set(
              coalesce(meta, '{}'::jsonb)
                || jsonb_build_object(
                     'driverLocations',
                     coalesce(meta->'driverLocations', '{}'::jsonb),
                     'driverTrails',
                     coalesce(meta->'driverTrails', '{}'::jsonb)
                   ),
              array['driverLocations', $2],
              $3::jsonb,
              true
            ),
            array['driverTrails', $2],
            $4::jsonb,
            true
          )
        where id = $1`,
      [groupId, userId, JSON.stringify(entry), JSON.stringify(trail)],
    )

    // Live fan-out to the vehicle room's members (and only them). The trail is
    // NOT sent — every member already receives each position and extends its
    // own copy with the same rule, so re-sending the whole path each minute
    // would be pure duplication. The stored trail is what a late joiner seeds
    // from.
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
const driverActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept') }),
  z.object({ action: z.literal('start') }),
  z.object({
    action: z.literal('manual_arrival'),
    stopId: z.string().min(1).max(64),
  }),
])

// Explicit driver lifecycle actions. Acceptance and starting are intentionally
// separate acknowledgements; manual_arrival is the safe geofence fallback and
// can only advance to the arrival state of the next planned loading/unloading
// stop. Document-gated departure/completion still goes through /proofs.
driverRouter.post(
  '/trips/:tripId/actions',
  asyncHandler(async (req, res) => {
    const parsed = driverActionSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })
    const { userId } = req.session!
    const { tripId } = req.params
    const body = parsed.data

    const { groupId, ops, trip, changed, stopId } = await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string; meta: Record<string, unknown> | null }>(
        `${TRIP_LOOKUP_SQL} for update of g`,
        [userId, tripId],
      )
      const resolved = assertAssignedTrip(userId, rows[0])
      if (!isActiveStatus(resolved.trip.status)) throw new HttpError(409, 'trip_not_active')
      const current = resolved.trip.status ?? 'planned'
      const nextStop = resolved.ops.stops.find((candidate) => candidate.status === 'planned')
      let target: Trip['status']
      let stopId: string | null = null

      if (body.action === 'accept') {
        if (current !== 'planned' && current !== 'accepted') {
          throw new HttpError(409, 'invalid_trip_transition')
        }
        target = 'accepted'
      } else if (body.action === 'start') {
        if (current !== 'accepted' && current !== 'to_loading') {
          throw new HttpError(409, 'trip_must_be_accepted')
        }
        if (!nextStop || nextStop.type !== 'loading') {
          throw new HttpError(409, 'loading_stop_required')
        }
        target = 'to_loading'
        stopId = nextStop.id
      } else {
        if (!nextStop || nextStop.id !== body.stopId) {
          throw new HttpError(409, 'stop_out_of_sequence')
        }
        stopId = nextStop.id
        if (nextStop.type === 'loading') {
          if (current !== 'to_loading' && current !== 'at_loading') {
            throw new HttpError(409, 'invalid_trip_transition')
          }
          target = 'at_loading'
        } else if (nextStop.type === 'unloading') {
          if (
            current !== 'in_transit' &&
            current !== 'to_unloading' &&
            current !== 'at_unloading'
          ) {
            throw new HttpError(409, 'invalid_trip_transition')
          }
          target = 'at_unloading'
        } else {
          throw new HttpError(409, 'stop_not_geofenced')
        }
      }

      const changed = current !== target
      if (changed) {
        resolved.trip.status = target
        await client.query('update groups set meta = meta || $2::jsonb where id = $1', [
          resolved.groupId,
          JSON.stringify({ ops: resolved.ops }),
        ])
      }
      return { ...resolved, changed, stopId }
    })

    const names = await driverNameMap(assignedDriverIds(ops, trip))
    const payload = buildDriverTrip(groupId, ops, trip, names)
    if (changed) {
      const event = {
        groupId,
        tripId: payload.tripId,
        status: payload.status,
        stopId,
        source: body.action,
      }
      getIOIfReady()?.to(roomForGroup(groupId)).emit('trip:status', event)
    }
    res.json({ trip: payload })
  }),
)

const geofenceSchema = z.object({
  stopId: z.string().min(1).max(64),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(200),
})

const proofSchema = z.object({
  stopId: z.string().min(1).max(64),
  kind: z.enum(['loading', 'unloading']),
})

function distanceMetres(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const radius = 6_371_000
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = radians(to.lat - from.lat)
  const dLng = radians(to.lng - from.lng)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.lat)) *
      Math.cos(radians(to.lat)) *
      Math.sin(dLng / 2) ** 2
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function canonicalTripId(groupId: string, trip: Trip): string {
  return trip.id ?? groupId
}

// Arrival is automatic, but only for the next planned loading/unloading stop.
// The phone performs a short foreground dwell first; the server independently
// validates GPS accuracy and distance so a forged/stale client state cannot
// advance the trip.
driverRouter.post(
  '/trips/:tripId/geofence',
  asyncHandler(async (req, res) => {
    const parsed = geofenceSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })
    const { userId } = req.session!
    const { tripId } = req.params
    const body = parsed.data

    const { groupId, ops, trip, changed } = await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string; meta: Record<string, unknown> | null }>(
        `${TRIP_LOOKUP_SQL} for update of g`,
        [userId, tripId],
      )
      const resolved = assertAssignedTrip(userId, rows[0])
      if (!isActiveStatus(resolved.trip.status)) throw new HttpError(409, 'trip_not_active')

      const stop = resolved.ops.stops.find((candidate) => candidate.id === body.stopId)
      if (!stop) throw new HttpError(404, 'stop_not_found')
      if (stop.status !== 'planned') throw new HttpError(409, 'stop_not_planned')
      if (stop.type !== 'loading' && stop.type !== 'unloading') {
        throw new HttpError(409, 'stop_not_geofenced')
      }
      const nextStop = resolved.ops.stops.find((candidate) => candidate.status === 'planned')
      if (nextStop?.id !== stop.id) throw new HttpError(409, 'stop_out_of_sequence')
      if (stop.lat === undefined || stop.lng === undefined) {
        throw new HttpError(409, 'stop_has_no_coordinates')
      }

      // 120m is the normal fence; the radius expands modestly for a less precise
      // fix, but never beyond 250m. accuracyM itself is capped at 200 by zod.
      const radiusM = Math.min(250, Math.max(120, body.accuracyM + 70))
      const distanceM = distanceMetres(body, { lat: stop.lat, lng: stop.lng })
      if (distanceM > radiusM) throw new HttpError(409, 'outside_geofence')

      const current = resolved.trip.status ?? 'planned'
      const target: Trip['status'] = stop.type === 'loading' ? 'at_loading' : 'at_unloading'
      const allowed =
        stop.type === 'loading'
          ? current === 'to_loading'
          : current === 'in_transit' || current === 'to_unloading'
      if (!allowed && current !== target) throw new HttpError(409, 'invalid_trip_transition')
      const changed = current !== target

      if (changed) {
        resolved.trip.status = target
        await client.query('update groups set meta = meta || $2::jsonb where id = $1', [
          resolved.groupId,
          JSON.stringify({ ops: resolved.ops }),
        ])
      }
      return { ...resolved, changed }
    })

    const names = await driverNameMap(assignedDriverIds(ops, trip))
    const payload = buildDriverTrip(groupId, ops, trip, names)
    if (changed) {
      getIOIfReady()?.to(roomForGroup(groupId)).emit('trip:status', {
        groupId,
        tripId: payload.tripId,
        status: payload.status,
        stopId: body.stopId,
        source: 'geofence',
      })
    }
    res.json({ trip: payload })
  }),
)

// Loading/unloading progression is deliberately coupled to an immutable proof
// row plus its stored scan. The storage object is uploaded before the DB
// transaction, then deleted if the locked re-check or atomic DB write fails.
driverRouter.post(
  '/trips/:tripId/proofs',
  uploadAttachment,
  asyncHandler(async (req, res) => {
    const file = req.file
    if (file?.path) {
      const tempPath = file.path
      res.on('close', () => void unlink(tempPath).catch(() => {}))
    }
    const parsed = proofSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })
    if (!file) return res.status(400).json({ error: 'proof_required' })
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.mimetype)) {
      return res.status(415).json({ error: 'unsupported_proof_type' })
    }
    if (isImage(file.mimetype) && file.size > MAX_IMAGE_BYTES) {
      return res.status(413).json({ error: 'image_too_large' })
    }
    if (!isImage(file.mimetype) && file.size > MAX_DOC_BYTES) {
      return res.status(413).json({ error: 'file_too_large' })
    }

    const { userId } = req.session!
    const { tripId } = req.params
    const body = parsed.data

    // Cheap authorization/state check before streaming a potentially large scan.
    const preflight = await resolveAssignedTrip(userId, tripId)
    const preflightStop = preflight.ops.stops.find((stop) => stop.id === body.stopId)
    if (!preflightStop) throw new HttpError(404, 'stop_not_found')
    if (preflightStop.type !== body.kind) throw new HttpError(409, 'proof_kind_mismatch')
    const requiredStatus = body.kind === 'loading' ? 'at_loading' : 'at_unloading'
    if (preflight.trip.status !== requiredStatus) {
      throw new HttpError(409, 'proof_not_expected')
    }

    const proofId = randomUUID()
    let storagePath: string | null = null
    try {
      storagePath = await saveStream(
        proofId,
        file.originalname,
        createReadStream(file.path),
        file.mimetype,
      )

      const result = await withTransaction(async (client) => {
        const { rows } = await client.query<{ id: string; meta: Record<string, unknown> | null }>(
          `${TRIP_LOOKUP_SQL} for update of g`,
          [userId, tripId],
        )
        const resolved = assertAssignedTrip(userId, rows[0])
        const stop = resolved.ops.stops.find((candidate) => candidate.id === body.stopId)
        if (!stop) throw new HttpError(404, 'stop_not_found')
        if (stop.type !== body.kind) throw new HttpError(409, 'proof_kind_mismatch')
        if (stop.status !== 'planned') throw new HttpError(409, 'stop_not_planned')
        const nextStop = resolved.ops.stops.find((candidate) => candidate.status === 'planned')
        if (nextStop?.id !== stop.id) throw new HttpError(409, 'stop_out_of_sequence')
        if (resolved.trip.status !== requiredStatus) {
          throw new HttpError(409, 'proof_not_expected')
        }

        stop.status = 'done'
        const nextSameKind = resolved.ops.stops.find(
          (candidate) => candidate.status === 'planned' && candidate.type === body.kind,
        )
        const nextStatus: Trip['status'] =
          body.kind === 'loading'
            ? nextSameKind
              ? 'to_loading'
              : 'in_transit'
            : nextSameKind
              ? 'to_unloading'
              : 'completed'
        resolved.trip.status = nextStatus

        await client.query(
          `insert into trip_proofs (
             id, group_id, trip_id, stop_id, uploaded_by, kind,
             original_name, mime_type, byte_size, storage_path
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            proofId,
            resolved.groupId,
            canonicalTripId(resolved.groupId, resolved.trip),
            stop.id,
            userId,
            body.kind,
            file.originalname,
            file.mimetype,
            file.size,
            storagePath,
          ],
        )
        await client.query('update groups set meta = meta || $2::jsonb where id = $1', [
          resolved.groupId,
          JSON.stringify({ ops: resolved.ops }),
        ])
        return resolved
      })

      const names = await driverNameMap(assignedDriverIds(result.ops, result.trip))
      const payload = buildDriverTrip(result.groupId, result.ops, result.trip, names)
      getIOIfReady()?.to(roomForGroup(result.groupId)).emit('trip:status', {
        groupId: result.groupId,
        tripId: payload.tripId,
        status: payload.status,
        stopId: body.stopId,
        source: 'proof',
      })
      res.status(201).json({ proofId, trip: payload })
    } catch (error) {
      if (storagePath) await deleteFile(storagePath)
      throw error
    }
  }),
)

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
      // Loading and unloading completion must always go through /proofs so the
      // document and status transition are committed together.
      if (status === 'done' && (stop.type === 'loading' || stop.type === 'unloading')) {
        throw new HttpError(409, 'proof_required')
      }
      stop.status = status
      // Write the ops blob back the same way the dispatcher's PATCH does — merge
      // the `ops` key into meta so unrelated meta (plates) is preserved.
      await client.query('update groups set meta = meta || $2::jsonb where id = $1', [
        resolved.groupId,
        JSON.stringify({ ops: resolved.ops }),
      ])
      return resolved
    })

    const names = await driverNameMap(assignedDriverIds(ops, trip))
    res.json({ trip: buildDriverTrip(groupId, ops, trip, names) })
  }),
)
