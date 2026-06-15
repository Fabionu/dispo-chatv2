import type { LatLng } from './types'

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
