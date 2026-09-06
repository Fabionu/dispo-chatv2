import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { Router } from 'express'
import { z } from 'zod'
import { pool, type DbClient } from '../db/pool.js'
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
import {
  assertAssignedTrip,
  assignedDriverIds,
  isActiveStatus,
  parseOps,
  type Ops,
  type Trip,
} from './driverAuthz.js'
import {
  evaluateFix,
  metersBetween,
  type TrackCursor,
  type TrackDecision,
} from '../util/tripTrack.js'

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
// The permission boundary itself (assertAssignedTrip and friends) lives in
// ./driverAuthz.ts so it can be tested without a database.
export const driverRouter = Router()
driverRouter.use(requireAuth)

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
  // The load itself. Carried to the driver because a reference and a pallet
  // count are what a warehouse asks for at the gate, and the phone was making
  // the driver ring the dispatcher for facts the trip already held.
  cargo: string | null
  weight: string | null
  pallets: string | null
  notes: string | null
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
    cargo: trip.cargo ?? null,
    weight: trip.weight ?? null,
    pallets: trip.pallets ?? null,
    notes: trip.notes ?? null,
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

// Ground distance comes from the shared ingest rules, so the legacy meta trail
// and the durable history measure movement identically.

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

// ── Durable history ingest ───────────────────────────────────────────────────
// The trail above is the LIVE convenience copy: capped, room-scoped, and reset
// by the next trip. This is the permanent record — one validated row per fix in
// `trip_track_points`, plus an incrementally maintained rollup in `trip_tracks`
// so "kilometres driven" is a single-row read.
//
// Idempotency has two independent guards, because a driver's phone retries on
// every flaky-network ping:
//   1. the validator refuses anything not strictly newer than the stored cursor,
//      so a replay adds no distance to the rollup, and
//   2. the unique index (trip_id, driver_id, recorded_at) refuses the row itself.
// Both run inside one transaction that locks the rollup row, so two pings racing
// from the same phone cannot interleave and count the same metres twice.

type TrackTotals = { distanceM: number; pointCount: number; segment: number; gap: boolean }

async function ingestTrackPoint(
  client: DbClient,
  params: {
    groupId: string
    tripId: string
    driverId: string
    lat: number
    lng: number
    recordedAtMs: number
    accuracyM?: number
    headingDeg?: number
    speedMps?: number
  },
): Promise<{ decision: TrackDecision; totals: TrackTotals }> {
  const { rows } = await client.query<{
    last_lat: number | null
    last_lng: number | null
    last_recorded_at: Date | null
    last_seen_at: Date | null
    segment: number
    distance_m: string | number
    point_count: number
  }>(
    `select last_lat, last_lng, last_recorded_at, last_seen_at, segment, distance_m, point_count
       from trip_tracks
      where trip_id = $1 and driver_id = $2
        for update`,
    [params.tripId, params.driverId],
  )

  const existing = rows[0]
  const cursor: TrackCursor =
    existing && existing.last_lat !== null && existing.last_lng !== null && existing.last_recorded_at
      ? {
          lat: existing.last_lat,
          lng: existing.last_lng,
          recordedAtMs: existing.last_recorded_at.getTime(),
          segment: existing.segment,
          lastSeenAtMs: (existing.last_seen_at ?? existing.last_recorded_at).getTime(),
        }
      : null

  const bankedDistance = existing ? Number(existing.distance_m) : 0
  const bankedCount = existing ? existing.point_count : 0
  const decision = evaluateFix(cursor, {
    lat: params.lat,
    lng: params.lng,
    recordedAtMs: params.recordedAtMs,
    ...(params.accuracyM !== undefined ? { accuracyM: params.accuracyM } : {}),
  })

  if (!decision.accept) {
    // A stationary fix is still the phone reporting in. Record that we heard
    // from it — without moving the distance anchor or storing a point — so the
    // silence that defines a signal gap is measured correctly. Without this a
    // truck parked at a dock accrues invented "no signal" periods.
    if (decision.reason === 'stationary' && existing) {
      await client.query(
        `update trip_tracks set last_seen_at = $3, updated_at = now()
          where trip_id = $1 and driver_id = $2`,
        [params.tripId, params.driverId, new Date(params.recordedAtMs).toISOString()],
      )
    }
    return {
      decision,
      totals: {
        distanceM: bankedDistance,
        pointCount: bankedCount,
        segment: cursor?.segment ?? 0,
        gap: false,
      },
    }
  }

  const recordedAt = new Date(params.recordedAtMs).toISOString()
  const inserted = await client.query(
    `insert into trip_track_points (
       trip_id, driver_id, group_id, lat, lng, recorded_at,
       accuracy_m, heading_deg, speed_mps, distance_m, segment
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (trip_id, driver_id, recorded_at) do nothing`,
    [
      params.tripId,
      params.driverId,
      params.groupId,
      params.lat,
      params.lng,
      recordedAt,
      params.accuracyM ?? null,
      params.headingDeg ?? null,
      params.speedMps ?? null,
      decision.distanceM,
      decision.segment,
    ],
  )

  // The unique index caught a replay the cursor test could not (possible only if
  // the rollup were ever rebuilt behind the points). Bank nothing.
  if (inserted.rowCount === 0) {
    return {
      decision: { accept: false, reason: 'duplicate' },
      totals: {
        distanceM: bankedDistance,
        pointCount: bankedCount,
        segment: cursor?.segment ?? 0,
        gap: false,
      },
    }
  }

  const { rows: updated } = await client.query<{ distance_m: string | number; point_count: number }>(
    `insert into trip_tracks (
       trip_id, driver_id, group_id, distance_m, point_count,
       last_lat, last_lng, last_recorded_at, first_recorded_at, segment, last_seen_at
     ) values ($1, $2, $3, $4, 1, $5, $6, $7, $7, $8, $7)
     on conflict (trip_id, driver_id) do update
        set distance_m  = trip_tracks.distance_m + excluded.distance_m,
            point_count = trip_tracks.point_count + 1,
            last_lat    = excluded.last_lat,
            last_lng    = excluded.last_lng,
            last_recorded_at = excluded.last_recorded_at,
            first_recorded_at = least(
              coalesce(trip_tracks.first_recorded_at, excluded.first_recorded_at),
              excluded.first_recorded_at
            ),
            segment     = excluded.segment,
            last_seen_at = excluded.last_seen_at,
            updated_at  = now()
      returning distance_m, point_count`,
    [
      params.tripId,
      params.driverId,
      params.groupId,
      decision.distanceM,
      params.lat,
      params.lng,
      recordedAt,
      decision.segment,
    ],
  )

  return {
    decision,
    totals: {
      distanceM: Number(updated[0]?.distance_m ?? bankedDistance + decision.distanceM),
      pointCount: updated[0]?.point_count ?? bankedCount + 1,
      segment: decision.segment,
      gap: decision.gap,
    },
  }
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
    const canonicalId = trip.id ?? groupId
    const entry: DriverLocationEntry = {
      userId,
      // Store the CANONICAL trip id (falls back to the room id exactly like
      // buildDriverTrip), not the raw lookup key the phone sent.
      tripId: canonicalId,
      name: names.get(userId) ?? 'Driver',
      lat: body.lat,
      lng: body.lng,
      ...(body.accuracyM !== undefined ? { accuracyM: body.accuracyM } : {}),
      ...(body.headingDeg !== undefined ? { headingDeg: body.headingDeg } : {}),
      ...(body.speedMps !== undefined ? { speedMps: body.speedMps } : {}),
      recordedAt,
    }

    // Durable history first, in its own locked transaction. Its verdict also
    // decides whether the live marker may move: a fix the history refuses as
    // untrustworthy (bad accuracy, teleport, arrived out of order) must not be
    // shown as the truck's position either. A merely STATIONARY fix is trusted —
    // it is the truck genuinely parked, and the marker's "updated 30s ago" has
    // to keep ticking or a stopped truck looks like a dead phone.
    const { decision, totals } = await withTransaction((client) =>
      ingestTrackPoint(client, {
        groupId,
        tripId: canonicalId,
        driverId: userId,
        lat: body.lat,
        lng: body.lng,
        recordedAtMs: Date.parse(recordedAt),
        ...(body.accuracyM !== undefined ? { accuracyM: body.accuracyM } : {}),
        ...(body.headingDeg !== undefined ? { headingDeg: body.headingDeg } : {}),
        ...(body.speedMps !== undefined ? { speedMps: body.speedMps } : {}),
      }),
    )
    const trusted = decision.accept || decision.reason === 'stationary'
    if (!trusted) {
      return res.json({
        ok: true,
        accepted: false,
        reason: decision.reason,
        distanceM: totals.distanceM,
      })
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

    // Live fan-out to the vehicle room's members (and only them). The path is
    // NOT re-sent — every member already receives each position and extends its
    // own copy with the same rule, so re-sending it each minute would be pure
    // duplication. What IS sent alongside is the server-computed running
    // distance (the client must never re-derive kilometres from the points it
    // happens to have seen) and the segment id, which tells the map whether this
    // point continues the drawn line or starts a new one after a signal gap.
    getIOIfReady()
      ?.to(roomForGroup(groupId))
      .emit('driver:location', {
        groupId,
        ...entry,
        distanceM: totals.distanceM,
        segment: totals.segment,
        ...(totals.gap ? { gap: true } : {}),
      })

    res.json({ ok: true, accepted: decision.accept, distanceM: totals.distanceM })
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
