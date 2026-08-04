import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { requireAuth } from '../auth.js'
import { asyncHandler, HttpError } from '../http.js'
import {
  downsampleTrack,
  splitSegments,
  trackGaps,
  type TrackPoint,
} from '../util/tripTrack.js'

// ── Trip history (dispatcher-facing) ─────────────────────────────────────────
// Where a truck HAS BEEN, for any trip the caller's room has recorded — active
// or long finished. Deliberately separate from /api/driver/*, which is gated to
// the ASSIGNED DRIVER of an ACTIVE trip: history is a room-wide fact that every
// member of the vehicle room may read, including after the trip completed and
// after the vehicle moved on to its next job.
//
// Permission model: the caller must be a member of the group that owns the trip.
// Membership is resolved as a join, so a trip belonging to a room the caller is
// not in returns 404 rather than revealing that the trip exists at all.
export const tripTracksRouter = Router()
tripTracksRouter.use(requireAuth)

/**
 * Resolve the room a trip belongs to AND assert the caller belongs to it.
 *
 * Two lookups, in this order, because neither alone covers the lifetime of a
 * trip: `trip_tracks` knows the owning room for every trip that ever recorded a
 * point (including ones long replaced in `meta.ops`), while the `groups` lookup
 * covers a trip that exists but has not been driven yet. Both are joined
 * against `group_members`, so a non-member gets nothing from either.
 */
async function resolveTripGroup(userId: string, tripId: string): Promise<string> {
  const { rows } = await pool.query<{ group_id: string }>(
    `select t.group_id
       from trip_tracks t
       join group_members gm on gm.group_id = t.group_id and gm.user_id = $1
      where t.trip_id = $2
      limit 1`,
    [userId, tripId],
  )
  if (rows[0]) return rows[0].group_id

  const { rows: live } = await pool.query<{ id: string }>(
    `select g.id
       from groups g
       join group_members gm on gm.group_id = g.id and gm.user_id = $1
      where g.type = 'vehicle'
        and (g.meta->'ops'->'trip'->>'id' = $2 or g.id::text = $2)
      limit 1`,
    [userId, tripId],
  )
  if (live[0]) return live[0].id
  throw new HttpError(404, 'trip_not_found')
}

/** How many points one history response may carry. Beyond this the path is
 *  downsampled per segment (never bridging a gap) — a month-long track must not
 *  ship a hundred thousand coordinates to a browser. */
const DEFAULT_MAX_POINTS = 1_500
const HARD_MAX_POINTS = 5_000

const querySchema = z.object({
  max: z.coerce.number().int().min(2).max(HARD_MAX_POINTS).optional(),
  driverId: z.string().uuid().optional(),
})

type TrackRow = {
  driver_id: string
  lat: number
  lng: number
  recorded_at: Date
  speed_mps: number | null
  heading_deg: number | null
  segment: number
}

// ── GET /api/trips/:tripId/track ─────────────────────────────────────────────
// The full recorded path of one trip, split into drawable runs. Each run is a
// stretch we actually observed; the boundary between two runs is a hole, and the
// response names those holes explicitly under `gaps` so the map can leave them
// empty instead of drawing a straight line across country.
tripTracksRouter.get(
  '/:tripId/track',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) throw new HttpError(400, 'invalid_input')
    const maxPoints = parsed.data.max ?? DEFAULT_MAX_POINTS
    const groupId = await resolveTripGroup(userId, req.params.tripId)

    const { rows } = await pool.query<TrackRow>(
      `select driver_id, lat, lng, recorded_at, speed_mps, heading_deg, segment
         from trip_track_points
        where trip_id = $1
          and ($2::uuid is null or driver_id = $2)
        order by driver_id, recorded_at`,
      [req.params.tripId, parsed.data.driverId ?? null],
    )

    const { rows: totals } = await pool.query<{
      driver_id: string
      distance_m: string | number
      point_count: number
      first_recorded_at: Date | null
      last_recorded_at: Date | null
      display_name: string | null
    }>(
      `select t.driver_id, t.distance_m, t.point_count,
              t.first_recorded_at, t.last_recorded_at, u.display_name
         from trip_tracks t
         left join users u on u.id = t.driver_id
        where t.trip_id = $1
          and ($2::uuid is null or t.driver_id = $2)`,
      [req.params.tripId, parsed.data.driverId ?? null],
    )

    // Group by driver: two drivers swapping mid-trip are two distinct paths and
    // must never be joined into one line.
    const byDriver = new Map<string, TrackPoint[]>()
    for (const row of rows) {
      const point: TrackPoint = {
        lat: row.lat,
        lng: row.lng,
        at: row.recorded_at.getTime(),
        segment: row.segment,
        ...(row.speed_mps !== null ? { speedMps: row.speed_mps } : {}),
        ...(row.heading_deg !== null ? { headingDeg: row.heading_deg } : {}),
      }
      const bucket = byDriver.get(row.driver_id)
      if (bucket) bucket.push(point)
      else byDriver.set(row.driver_id, [point])
    }

    // The point budget is shared between the drivers present, so one long path
    // cannot starve another of detail.
    const perDriverMax = Math.max(2, Math.floor(maxPoints / Math.max(1, byDriver.size)))

    const drivers = totals.map((t) => {
      const points = byDriver.get(t.driver_id) ?? []
      const sampled = downsampleTrack(points, perDriverMax)
      return {
        driverId: t.driver_id,
        name: t.display_name ?? 'Driver',
        distanceM: Number(t.distance_m),
        pointCount: t.point_count,
        firstAt: t.first_recorded_at?.toISOString() ?? null,
        lastAt: t.last_recorded_at?.toISOString() ?? null,
        // Runs of points that may be joined by a line. Computed from the FULL
        // path then sampled, so thinning can never merge two runs.
        segments: splitSegments(sampled).map((run) => run.map(toWire)),
        gaps: trackGaps(points).map((g) => ({
          from: new Date(g.from).toISOString(),
          to: new Date(g.to).toISOString(),
        })),
        // True when the response is thinner than the stored path, so the UI can
        // say "simplified" rather than implying this is every recorded fix.
        downsampled: sampled.length < points.length,
      }
    })

    const firstAt = drivers.reduce<string | null>(
      (min, d) => (d.firstAt && (!min || d.firstAt < min) ? d.firstAt : min),
      null,
    )
    const lastAt = drivers.reduce<string | null>(
      (max, d) => (d.lastAt && (!max || d.lastAt > max) ? d.lastAt : max),
      null,
    )

    res.json({
      tripId: req.params.tripId,
      groupId,
      totals: {
        distanceM: drivers.reduce((sum, d) => sum + d.distanceM, 0),
        pointCount: drivers.reduce((sum, d) => sum + d.pointCount, 0),
        firstAt,
        lastAt,
        // The wall-clock span of the recording, which is NOT the same as time
        // spent driving — it includes every stop and every gap.
        durationMs: firstAt && lastAt ? Date.parse(lastAt) - Date.parse(firstAt) : 0,
      },
      drivers,
    })
  }),
)

function toWire(p: TrackPoint) {
  return {
    lat: p.lat,
    lng: p.lng,
    at: new Date(p.at).toISOString(),
    ...(p.speedMps !== undefined ? { speedMps: p.speedMps } : {}),
    ...(p.headingDeg !== undefined ? { headingDeg: p.headingDeg } : {}),
  }
}

// ── GET /api/trips/:tripId/summary ───────────────────────────────────────────
// Just the numbers — distance, point count, time window, who drove. Cheap enough
// to poll and to render beside a trip that the user has not opened on a map.
tripTracksRouter.get(
  '/:tripId/summary',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const groupId = await resolveTripGroup(userId, req.params.tripId)
    const { rows } = await pool.query<{
      driver_id: string
      distance_m: string | number
      point_count: number
      first_recorded_at: Date | null
      last_recorded_at: Date | null
      display_name: string | null
    }>(
      `select t.driver_id, t.distance_m, t.point_count,
              t.first_recorded_at, t.last_recorded_at, u.display_name
         from trip_tracks t
         left join users u on u.id = t.driver_id
        where t.trip_id = $1
        order by t.first_recorded_at`,
      [req.params.tripId],
    )

    const firstAt = rows.reduce<Date | null>(
      (min, r) =>
        r.first_recorded_at && (!min || r.first_recorded_at < min) ? r.first_recorded_at : min,
      null,
    )
    const lastAt = rows.reduce<Date | null>(
      (max, r) =>
        r.last_recorded_at && (!max || r.last_recorded_at > max) ? r.last_recorded_at : max,
      null,
    )

    res.json({
      tripId: req.params.tripId,
      groupId,
      distanceM: rows.reduce((sum, r) => sum + Number(r.distance_m), 0),
      pointCount: rows.reduce((sum, r) => sum + r.point_count, 0),
      firstAt: firstAt?.toISOString() ?? null,
      lastAt: lastAt?.toISOString() ?? null,
      durationMs: firstAt && lastAt ? lastAt.getTime() - firstAt.getTime() : 0,
      drivers: rows.map((r) => ({
        driverId: r.driver_id,
        name: r.display_name ?? 'Driver',
        distanceM: Number(r.distance_m),
        firstAt: r.first_recorded_at?.toISOString() ?? null,
        lastAt: r.last_recorded_at?.toISOString() ?? null,
      })),
    })
  }),
)

// ── GET /api/trips?groupId= ──────────────────────────────────────────────────
// Every trip this room has ever recorded a path for, newest first — the index
// behind the history picker. Scoped by membership on the room, so it can only
// ever list trips the caller is already entitled to open.
const listSchema = z.object({
  groupId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

tripTracksRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const parsed = listSchema.safeParse(req.query)
    if (!parsed.success) throw new HttpError(400, 'invalid_input')

    const { rows: member } = await pool.query(
      'select 1 from group_members where group_id = $1 and user_id = $2',
      [parsed.data.groupId, userId],
    )
    if (member.length === 0) throw new HttpError(404, 'group_not_found')

    const { rows } = await pool.query<{
      trip_id: string
      distance_m: string | number
      point_count: string | number
      first_recorded_at: Date | null
      last_recorded_at: Date | null
      drivers: string[]
    }>(
      `select trip_id,
              sum(distance_m)          as distance_m,
              sum(point_count)         as point_count,
              min(first_recorded_at)   as first_recorded_at,
              max(last_recorded_at)    as last_recorded_at,
              array_agg(distinct driver_id::text) as drivers
         from trip_tracks
        where group_id = $1
        group by trip_id
        order by max(last_recorded_at) desc nulls last
        limit $2`,
      [parsed.data.groupId, parsed.data.limit ?? 50],
    )

    res.json({
      trips: rows.map((r) => ({
        tripId: r.trip_id,
        distanceM: Number(r.distance_m),
        pointCount: Number(r.point_count),
        firstAt: r.first_recorded_at?.toISOString() ?? null,
        lastAt: r.last_recorded_at?.toISOString() ?? null,
        driverIds: r.drivers,
      })),
    })
  }),
)
