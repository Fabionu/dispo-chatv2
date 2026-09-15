import type { LatLng } from './types'

// ── Typed coordinates ───────────────────────────────────────────────────────
// The search fields take coordinates in the forms a maps app takes them (user,
// 2026-09-15: "49.278854N, 16.209515E ... pe google merg"):
//
//   49.278854, 16.209515          decimal degrees, the app's own fmtCoord form
//   49.278854N, 16.209515E        hemisphere letter after (or before) a value
//   N 49.278854 E 16.209515
//   49°16'43.9"N 16°12'34.3"E     degrees, minutes, seconds
//   49 16 43.9 N, 16 12 34.3 E    the same without the marks
//   49 16.7309, 16 12.5709        degrees and decimal minutes
//   -33.8688, 151.2093            signs, as before
//
// Two values, separated by a comma and/or whitespace. Minutes and seconds are
// only read after an INTEGER degrees value — "49.27 16.20" is two decimal
// degrees, never 49.27° and 16.20′ — which is what keeps the plain form
// unambiguous without a comma. Order is lat-first, as everywhere in the UI,
// unless the hemisphere letters say otherwise (E 16.2, N 49.2 is not a guess).

// What a coordinate pair can be made of, and nothing else: digits, sign,
// decimal point, the separators, the degree/minute/second marks (ASCII and
// typographic) and the four hemisphere letters.
const COORD_CHARS_RE = /^[\s\d.,+\-°º'′’"″”NSEWnsew]+$/
const NUMBER_RE = /\d+(?:\.\d+)?/g
// Two hemisphere letters in a row are a WORD — Essen, Sens, Wesen are all
// spelt from N/S/E/W — and "Essen 4, 5" is an address, not a bad coordinate.
const LETTER_RUN_RE = /[NSEWnsew]{2}/

// True when a string looks like coordinates being typed rather than an
// address: only coordinate characters, letters standing alone, and at least
// two numbers. Used to route the input to direct parsing instead of place
// search, and to show the "Go to coordinates" / "invalid" row while the pair
// is still being typed.
export function looksLikeCoordPair(input: string): boolean {
  const t = input.trim()
  return (
    t.length > 0 &&
    COORD_CHARS_RE.test(t) &&
    !LETTER_RUN_RE.test(t) &&
    (t.match(NUMBER_RE)?.length ?? 0) >= 2
  )
}

type Hemisphere = 'N' | 'S' | 'E' | 'W'
type Component = { value: number; hemi: Hemisphere | null }

// One coordinate — a hemisphere letter before or after (not both), an
// optional sign, then DD / DMM / DMS. Null when it is none of those.
function parseComponent(raw: string): Component | null {
  let t = raw.trim().toUpperCase()
  let hemi: Hemisphere | null = null
  const lead = t.match(/^([NSEW])\s*(.*)$/)
  if (lead) {
    hemi = lead[1] as Hemisphere
    t = lead[2]
  }
  const trail = t.match(/^(.*?)\s*([NSEW])$/)
  if (trail) {
    if (hemi) return null
    hemi = trail[2] as Hemisphere
    t = trail[1]
  }
  let sign = 1
  const signed = t.match(/^([-+])\s*(.*)$/)
  if (signed) {
    sign = signed[1] === '-' ? -1 : 1
    t = signed[2]
  }
  // A sign AND a letter contradict each other ("-49N"): refuse rather than pick.
  if (sign < 0 && hemi) return null

  // Degrees, minutes and seconds are SEPARATED — by their mark or by
  // whitespace — never run together: without that, "49.278854" would read as
  // 4° 9.278854′ (a digit for the degrees and the rest for the minutes).
  const dms = t.match(/^(\d+)(?:\s*°\s*|\s+)(\d+)(?:\s*'\s*|\s+)(\d+(?:\.\d+)?)\s*"?$/)
  const dmm = t.match(/^(\d+)(?:\s*°\s*|\s+)(\d+(?:\.\d+)?)\s*'?$/)
  const dd = t.match(/^(\d+(?:\.\d+)?)\s*°?$/)
  let value: number
  if (dms) {
    const [, d, m, s] = dms
    if (Number(m) >= 60 || Number(s) >= 60) return null
    value = Number(d) + Number(m) / 60 + Number(s) / 3600
  } else if (dmm) {
    const [, d, m] = dmm
    if (Number(m) >= 60) return null
    value = Number(d) + Number(m) / 60
  } else if (dd) {
    value = Number(dd[1])
  } else {
    return null
  }
  if (!Number.isFinite(value)) return null
  if (hemi === 'S' || hemi === 'W') value = -value
  return { value: sign * value, hemi }
}

function pairFrom(a: Component, b: Component): LatLng | null {
  const isLatHemi = (h: Hemisphere | null) => h === 'N' || h === 'S'
  const isLngHemi = (h: Hemisphere | null) => h === 'E' || h === 'W'
  // Letters fix the axes; without any, the UI's lat-first order stands.
  const swapped = isLngHemi(a.hemi) || isLatHemi(b.hemi)
  const [lat, lng] = swapped ? [b, a] : [a, b]
  if (isLngHemi(lat.hemi) || isLatHemi(lng.hemi)) return null
  if (lat.value < -90 || lat.value > 90 || lng.value < -180 || lng.value > 180) return null
  return { lat: lat.value, lng: lng.value }
}

// Parse manually-entered coordinates (any of the forms above) into a validated
// { lat, lng }. Returns null when the text isn't a coordinate pair OR when a
// value is out of range (lat −90..90, lng −180..180) — callers treat null as
// "not a valid coordinate" and must NOT move the map. Without hemisphere
// letters the order is NOT auto-swapped: the UI is explicitly lat-first, so a
// bare value with lat > 90 is reported invalid rather than reinterpreted.
export function parseLatLng(input: string): LatLng | null {
  if (!looksLikeCoordPair(input)) return null
  const text = input
    .trim()
    .replace(/[′’]/g, "'")
    .replace(/[″”]/g, '"')
    .replace(/º/g, '°')
    // A letter run straight into the next value ("49.27N16.2E", "N49E16")
    // gets the space the splitter needs.
    .replace(/([NSEWnsew])(?=[\d+\-NSEWnsew])/g, '$1 ')
    .replace(/\s+/g, ' ')

  // A comma is the pair's separator when there is one; otherwise every gap
  // between tokens is tried, and the first split that reads as two valid
  // coordinates wins ("49 16 43.9 N 16 12 34.3 E" splits after the N).
  if (text.includes(',')) {
    const parts = text.split(',')
    if (parts.length !== 2) return null
    const a = parseComponent(parts[0])
    const b = parseComponent(parts[1])
    return a && b ? pairFrom(a, b) : null
  }
  const tokens = text.split(' ')
  for (let i = 1; i < tokens.length; i++) {
    const a = parseComponent(tokens.slice(0, i).join(' '))
    if (!a) continue
    const b = parseComponent(tokens.slice(i).join(' '))
    if (!b) continue
    const pair = pairFrom(a, b)
    if (pair) return pair
  }
  return null
}

// Small planar geometry helpers for "is this click near the route, and which
// segment?" — used to insert a right-clicked stop into the logical position on
// the route. Distances are approximate (equirectangular projection around the
// query point), which is plenty accurate at the ~metres scale we threshold on.

const EARTH_RADIUS_M = 6371000
const toRad = (deg: number) => (deg * Math.PI) / 180

// Distance in metres from point `p` to the segment `a`–`b`.
export function distancePointToSegmentMeters(p: LatLng, a: LatLng, b: LatLng): number {
  const cos = Math.cos(toRad(p.lat))
  const px = toRad(p.lng) * cos
  const py = toRad(p.lat)
  const ax = toRad(a.lng) * cos
  const ay = toRad(a.lat)
  const bx = toRad(b.lng) * cos
  const by = toRad(b.lat)

  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))

  const cx = ax + t * dx
  const cy = ay + t * dy
  const ex = px - cx
  const ey = py - cy
  return Math.sqrt(ex * ex + ey * ey) * EARTH_RADIUS_M
}

// Douglas-Peucker simplification in metres. Visible route rendering keeps the
// original HERE geometry; this reduced copy is for invisible hit targets and
// hover lookup, where sub-pixel detail only adds transform/scan work. Endpoints
// are always preserved and short paths are returned unchanged.
export function simplifyPath(path: LatLng[], toleranceMeters: number): LatLng[] {
  if (path.length <= 2 || toleranceMeters <= 0) return path

  const keep = new Uint8Array(path.length)
  keep[0] = 1
  keep[path.length - 1] = 1
  const ranges: Array<[number, number]> = [[0, path.length - 1]]

  while (ranges.length) {
    const [from, to] = ranges.pop()!
    let farthest = -1
    let farthestMeters = toleranceMeters
    for (let i = from + 1; i < to; i++) {
      const meters = distancePointToSegmentMeters(path[i], path[from], path[to])
      if (meters > farthestMeters) {
        farthestMeters = meters
        farthest = i
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1
      ranges.push([from, farthest], [farthest, to])
    }
  }

  return path.filter((_, i) => keep[i] === 1)
}

// Given the decoded coordinates of each route SECTION (one per leg between
// consecutive waypoints), find the section nearest to `point`. The returned
// `index` maps directly to a stop-insertion position: inserting a stop at
// stops-index `index` places it on that leg (section i joins waypoint i and
// i+1, so the new stop becomes waypoint i+1). Returns null when there are no
// sections.
export function nearestRouteSection(
  point: LatLng,
  sections: LatLng[][],
): { index: number; meters: number } | null {
  let best: { index: number; meters: number } | null = null
  sections.forEach((coords, index) => {
    for (let i = 0; i + 1 < coords.length; i++) {
      const d = distancePointToSegmentMeters(point, coords[i], coords[i + 1])
      if (!best || d < best.meters) best = { index, meters: d }
    }
  })
  return best
}

// Nearest point on a polyline `path` to `point`, computed in the same planar
// (equirectangular) approximation as distancePointToSegmentMeters — pure maths,
// no map projection, so it's cheap enough to run on pointermove. Returns:
//   • meters — the perpendicular distance from `point` to the line (for the
//     "is the cursor close enough to the route?" hit-test), and
//   • along  — the distance travelled ALONG the path from its start to that
//     nearest point, interpolated within the straddling segment using the
//     precomputed per-vertex cumulative distances `cum` (cum[i] = metres from the
//     path start to vertex i). This gives the cumulative multi-leg distance for
//     free, since `path` is the whole route concatenated in travel order.
// Returns null for a degenerate path (<2 points) or a mismatched `cum`.
export function nearestPointOnPath(
  point: LatLng,
  path: LatLng[],
  cum: number[],
): { meters: number; along: number; at: LatLng } | null {
  if (path.length < 2 || cum.length !== path.length) return null
  const cos = Math.cos(toRad(point.lat))
  const px = toRad(point.lng) * cos
  const py = toRad(point.lat)
  let best: { meters: number; along: number; at: LatLng } | null = null
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]
    const b = path[i + 1]
    const ax = toRad(a.lng) * cos
    const ay = toRad(a.lat)
    const bx = toRad(b.lng) * cos
    const by = toRad(b.lat)
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    // t = clamped projection of the point onto segment a→b, in [0,1].
    let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    const cx = ax + t * dx
    const cy = ay + t * dy
    const ex = px - cx
    const ey = py - cy
    const meters = Math.sqrt(ex * ex + ey * ey) * EARTH_RADIUS_M
    if (!best || meters < best.meters) {
      best = {
        meters,
        along: cum[i] + t * (cum[i + 1] - cum[i]),
        at: { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t },
      }
    }
  }
  return best
}

// Great-circle distance in metres between two coordinates (haversine). Used as a
// FALLBACK ordering signal when no real route geometry is available yet (see
// bestInsertionIndex) — once a route exists, callers prefer nearestRouteSection,
// which works off the actual road path.
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Choose where to insert `p` among the ordered intermediate `stops`, keeping the
// route's `start` first and `destination` last, so it adds the LEAST extra
// straight-line distance to the sequence start → stops → destination. Returns an
// index in [0, stops.length] (the stops-array position the new stop should take).
//
// This is the geometric fallback for the "logical stop ordering" feature: for a
// new stop we test every gap between consecutive waypoints and pick the one where
// inserting it grows the path the least (added = |prev→p| + |p→next| − |prev→next|).
// Straight-line is only used when there's no drawn route to measure against;
// when a route exists the caller uses nearestRouteSection (actual road geometry).
export function bestInsertionIndex(
  p: LatLng,
  start: LatLng,
  stops: LatLng[],
  destination: LatLng,
): number {
  const seq = [start, ...stops, destination]
  let bestIdx = stops.length
  let bestAdded = Infinity
  for (let k = 0; k + 1 < seq.length; k++) {
    const prev = seq[k]
    const next = seq[k + 1]
    const added =
      haversineMeters(prev, p) + haversineMeters(p, next) - haversineMeters(prev, next)
    if (added < bestAdded) {
      bestAdded = added
      // Inserting between seq[k] and seq[k+1] == stops-array index k.
      bestIdx = k
    }
  }
  return bestIdx
}

// The point HALFWAY ALONG a path by travelled distance (not the mean of the
// coordinates) — i.e. walk the polyline until half its total length is covered
// and interpolate within the straddling segment. Used to anchor the route's
// distance badge near the visual middle of the line. Returns null for an empty
// path; the single point for a one-point path.
export function pathMidpoint(path: LatLng[]): LatLng | null {
  if (path.length === 0) return null
  if (path.length === 1) return path[0]
  const segs: number[] = []
  let total = 0
  for (let i = 0; i + 1 < path.length; i++) {
    const d = haversineMeters(path[i], path[i + 1])
    segs.push(d)
    total += d
  }
  if (total === 0) return path[0]
  let half = total / 2
  for (let i = 0; i < segs.length; i++) {
    if (half <= segs[i]) {
      const t = segs[i] === 0 ? 0 : half / segs[i]
      return {
        lat: path[i].lat + (path[i + 1].lat - path[i].lat) * t,
        lng: path[i].lng + (path[i + 1].lng - path[i].lng) * t,
      }
    }
    half -= segs[i]
  }
  return path[path.length - 1]
}

// Compass bearing (degrees, 0–359, clockwise from north) of travel from a→b.
export function bearing(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.lat)
  const φ2 = toRad(b.lat)
  const Δλ = toRad(b.lng - a.lng)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360
}

// The route's direction of travel near `point`: the bearing of the route
// segment closest to it, across all sections. Used to bias a dragged waypoint
// onto the correct carriageway/direction (HERE `course`) so the recalculated
// route doesn't flip onto the oncoming road. Returns null when there's no
// usable segment within `maxMeters` (default 250 m) of the point.
export function routeCourseNear(
  point: LatLng,
  sections: LatLng[][],
  maxMeters = 250,
): number | null {
  let best: { meters: number; a: LatLng; b: LatLng } | null = null
  for (const coords of sections) {
    for (let i = 0; i + 1 < coords.length; i++) {
      const d = distancePointToSegmentMeters(point, coords[i], coords[i + 1])
      if (!best || d < best.meters) best = { meters: d, a: coords[i], b: coords[i + 1] }
    }
  }
  if (!best || best.meters > maxMeters) return null
  return Math.round(bearing(best.a, best.b))
}
