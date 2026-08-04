// GPS ingest rules for trip tracking.
//
// A phone's location stream is not a clean signal: providers disagree by metres
// while the truck is parked, a cold fix can land a kilometre away, a queued ping
// arrives after the one that superseded it, and a retry replays a fix that was
// already banked. Everything that decides whether a fix becomes history — and
// how many metres it is worth — lives here as pure functions so it can be
// tested without a database, and so the "kilometres driven" number has exactly
// one definition.
//
// Consumed by POST /api/driver/location (server/src/routes/driver.ts) and by the
// history reads in server/src/routes/tripTracks.ts.

/** Ground distance in metres between two positions (haversine). */
export function metersBetween(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6_371_000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

// ── Thresholds ───────────────────────────────────────────────────────────────

/**
 * Worst fix accuracy that may enter the history, in metres. A cell-tower-only
 * fix routinely reports 500–2000 m; treating that as a position would draw the
 * truck through whatever happens to lie between two tower centroids.
 */
export const MAX_ACCURACY_M = 100

/**
 * Minimum movement before a fix is worth storing. Below this the truck is
 * parked and the "movement" is provider jitter — without the gate a vehicle at a
 * loading dock banks a point per ping all afternoon and accumulates phantom
 * kilometres out of noise.
 */
export const MIN_MOVE_M = 15

/**
 * Fixes closer together in time than this are treated as the same instant. Two
 * providers reporting the same moment must not both be stored.
 */
export const MIN_INTERVAL_MS = 1_000

/**
 * Fastest ground speed a truck can plausibly sustain between two fixes, in m/s
 * (~198 km/h). Anything faster is a bad fix, not a movement, and contributes no
 * distance. Deliberately generous: it exists to catch teleports, not speeding.
 */
export const MAX_SPEED_MPS = 55

/**
 * A jump this large is rejected outright regardless of elapsed time. Over a long
 * gap the speed test alone would accept an arbitrary teleport (2 hours makes any
 * distance "plausible"), so distance gets its own ceiling.
 */
export const MAX_JUMP_M = 200_000

/**
 * Silence longer than this ends the drawn segment: the truck kept moving but we
 * do not know along which roads, so the next point starts a new line rather than
 * being joined to the last one.
 */
export const SEGMENT_GAP_MS = 4 * 60_000

/**
 * Same idea by distance: consecutive fixes further apart than this cannot be
 * honestly joined by a straight line even if they arrived close together.
 */
export const SEGMENT_GAP_M = 1_500

export type TrackFix = {
  lat: number
  lng: number
  /** Capture time, epoch ms (already server-validated for plausibility). */
  recordedAtMs: number
  accuracyM?: number
  headingDeg?: number
  speedMps?: number
}

/**
 * What we know about a (trip, driver) track so far — null before the first fix.
 *
 * Two clocks, deliberately: `recordedAtMs` belongs to the last STORED point and
 * anchors distance and speed, while `lastSeenAtMs` is the last time the phone
 * reported ANYTHING we trusted, including the stationary pings that are
 * filtered out rather than stored. Conflating them made a parked truck look like
 * it had lost signal — the gap test needs "when did we last hear from it", not
 * "when did we last write a row".
 */
export type TrackCursor = {
  lat: number
  lng: number
  recordedAtMs: number
  segment: number
  /** Defaults to `recordedAtMs` when the caller has nothing better. */
  lastSeenAtMs?: number
} | null

export type TrackRejectReason =
  | 'invalid'
  | 'accuracy'
  | 'duplicate'
  | 'out_of_order'
  | 'stationary'
  | 'impossible_speed'
  | 'impossible_jump'

export type TrackDecision =
  | {
      accept: true
      /** Validated metres to add to the running total (0 across a gap start). */
      distanceM: number
      /** Segment the point belongs to; differs from the cursor's after a gap. */
      segment: number
      /** True when this point opens a new segment (a hole precedes it). */
      gap: boolean
    }
  | { accept: false; reason: TrackRejectReason }

/**
 * Decide whether one fix joins the track, and what it is worth.
 *
 * Order matters. Cheap structural rejections come first, then accuracy (a fix we
 * do not trust at all), then the time relation to the cursor (duplicate /
 * out-of-order), and only then the movement tests — because "did it move far
 * enough" and "could it have moved that fast" are both meaningless against a
 * fix that should not have been considered in the first place.
 */
export function evaluateFix(cursor: TrackCursor, fix: TrackFix): TrackDecision {
  if (
    !Number.isFinite(fix.lat) ||
    !Number.isFinite(fix.lng) ||
    !Number.isFinite(fix.recordedAtMs) ||
    Math.abs(fix.lat) > 90 ||
    Math.abs(fix.lng) > 180
  ) {
    return { accept: false, reason: 'invalid' }
  }

  // A fix we do not trust to within MAX_ACCURACY_M is not a position.
  if (fix.accuracyM !== undefined && fix.accuracyM > MAX_ACCURACY_M) {
    return { accept: false, reason: 'accuracy' }
  }

  // First point of a track: nothing to compare against, no distance yet.
  if (!cursor) return { accept: true, distanceM: 0, segment: 0, gap: false }

  // Ordering and duplicate detection run against the last thing we PROCESSED,
  // stored or not — otherwise a filtered stationary ping would let an older fix
  // slip in behind it.
  const lastSeenMs = cursor.lastSeenAtMs ?? cursor.recordedAtMs
  const sinceSeenMs = fix.recordedAtMs - lastSeenMs
  // Exactly the stored instant → a replayed ping. The unique index would reject
  // the insert anyway; catching it here keeps the rollup untouched too.
  if (sinceSeenMs === 0) return { accept: false, reason: 'duplicate' }
  // Older than what we already have: a queued ping overtaken by a newer one.
  // Accepting it would make the path double back on itself.
  if (sinceSeenMs < 0) return { accept: false, reason: 'out_of_order' }
  if (sinceSeenMs < MIN_INTERVAL_MS) return { accept: false, reason: 'duplicate' }

  // Distance and speed are measured from the last STORED point, because that is
  // the position the metres are counted from. Using the last-seen time here
  // instead would divide a real displacement by a few seconds and read as a
  // teleport every time a truck pulls away after a long stop.
  const sinceStoredMs = fix.recordedAtMs - cursor.recordedAtMs
  const distanceM = metersBetween(cursor.lat, cursor.lng, fix.lat, fix.lng)

  // Physically impossible movement — a bad fix, not a journey. Checked before
  // the stationary gate so a teleport is never mistaken for "it moved".
  if (distanceM > MAX_JUMP_M) return { accept: false, reason: 'impossible_jump' }
  if (sinceStoredMs > 0 && distanceM / (sinceStoredMs / 1000) > MAX_SPEED_MPS) {
    return { accept: false, reason: 'impossible_speed' }
  }

  // A gap is SILENCE, not stillness. Measured from the last time the phone was
  // heard from, so a truck parked all afternoon with good reception produces one
  // continuous segment rather than a string of invented outages.
  const gap = sinceSeenMs > SEGMENT_GAP_MS || distanceM > SEGMENT_GAP_M

  // Parked. Only suppressed when the truck is also NOT crossing a gap — after a
  // long silence, a fix at the same place is genuine news ("still here"), and it
  // has to be stored or the map cannot show where the hole ends.
  if (!gap && distanceM < MIN_MOVE_M) return { accept: false, reason: 'stationary' }

  return {
    accept: true,
    // Across a gap the true path is unknown, so the straight-line chord is not
    // claimed as driven distance: a hole contributes zero rather than a made-up
    // number. Within a segment the chord is the honest measure.
    distanceM: gap ? 0 : distanceM,
    segment: gap ? cursor.segment + 1 : cursor.segment,
    gap,
  }
}

// ── History shaping ──────────────────────────────────────────────────────────

export type TrackPoint = {
  lat: number
  lng: number
  at: number
  segment: number
  speedMps?: number
  headingDeg?: number
}

/**
 * Cap how many points reach the browser without letting the shape of the path
 * collapse. Downsampling runs PER SEGMENT and always keeps each segment's first
 * and last point, so thinning can never bridge a gap or shorten the path — it
 * only drops intermediate detail from the densest stretches.
 */
export function downsampleTrack(points: TrackPoint[], maxPoints: number): TrackPoint[] {
  if (maxPoints <= 0 || points.length <= maxPoints) return points

  const bySegment = new Map<number, TrackPoint[]>()
  for (const p of points) {
    const bucket = bySegment.get(p.segment)
    if (bucket) bucket.push(p)
    else bySegment.set(p.segment, [p])
  }

  const out: TrackPoint[] = []
  for (const segment of bySegment.values()) {
    // Every segment is worth at least its endpoints; the rest of the budget is
    // shared proportionally to how much of the path the segment represents.
    const share = Math.max(2, Math.floor((segment.length / points.length) * maxPoints))
    if (segment.length <= share) {
      out.push(...segment)
      continue
    }
    const step = (segment.length - 1) / (share - 1)
    const kept: TrackPoint[] = []
    for (let i = 0; i < share; i++) kept.push(segment[Math.round(i * step)])
    // Guard the endpoints against rounding, then drop any duplicate the
    // rounding may have introduced.
    kept[0] = segment[0]
    kept[kept.length - 1] = segment[segment.length - 1]
    out.push(...kept.filter((p, i) => i === 0 || p !== kept[i - 1]))
  }
  return out.sort((a, b) => a.at - b.at)
}

/**
 * Split a flat point list into drawable runs. Consumers may join the points
 * inside one run with a line; they must never join across two runs, because the
 * boundary is exactly where we have no idea what the truck did.
 */
export function splitSegments(points: TrackPoint[]): TrackPoint[][] {
  const runs: TrackPoint[][] = []
  let current: TrackPoint[] = []
  let segment: number | null = null
  for (const p of points) {
    if (segment !== null && p.segment !== segment) {
      if (current.length) runs.push(current)
      current = []
    }
    segment = p.segment
    current.push(p)
  }
  if (current.length) runs.push(current)
  return runs
}

/**
 * The stretches with no coverage, derived from the segment boundaries — "signal
 * lost 14:02, back 14:31". Reported alongside the path so a dispatcher can tell
 * a break in the line from a truck that simply stood still.
 */
export function trackGaps(points: TrackPoint[]): Array<{ from: number; to: number }> {
  const gaps: Array<{ from: number; to: number }> = []
  const runs = splitSegments(points)
  for (let i = 1; i < runs.length; i++) {
    const previous = runs[i - 1]
    gaps.push({ from: previous[previous.length - 1].at, to: runs[i][0].at })
  }
  return gaps
}
