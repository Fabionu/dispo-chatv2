import type { ScreenGeoCandidate } from '../../lib/here/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

// Default view: central Europe, so an empty planner shows a sensible map.
export const DEFAULT_CENTER = { lat: 50.11, lng: 8.68 }
export const DEFAULT_ZOOM = 5

// How close (in screen pixels) the cursor must be to the drawn route line for
// the hover-distance readout to appear. Converted to metres at the current
// zoom/latitude at hover time so the feel is consistent when zoomed in or out.
export const HOVER_THRESHOLD_PX = 12

// Google-Maps-style distance for the hover readout: metres under ~1 km (rounded
// to the nearest 10 m, e.g. "850 m"), otherwise kilometres — one decimal only
// when it adds information ("12.4 km", but "3 km"/"348 km" without a trailing .0).
export function formatHoverDistance(meters: number): string {
  if (meters < 1000) {
    const m = Math.round(meters / 10) * 10
    if (m < 1000) return `${m} m`
    return '1 km' // rounded up to a full kilometre
  }
  const km = meters / 1000
  if (km < 100) {
    const r = Math.round(km * 10) / 10
    return Number.isInteger(r) ? `${r} km` : `${r.toFixed(1)} km`
  }
  return `${Math.round(km)} km`
}

// Opt-in drag/snap tracing: run `localStorage.routeSnapDebug = '1'` in the
// console to log raw release pixels, the converted geo, and (in RoutePlanner)
// the snapped point + distance moved. Off (and silent) by default.
export function snapDebug(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('routeSnapDebug') === '1'
  } catch {
    return false
  }
}

// Convert the release pixel — and a ring of nearby pixels — back to geo
// coordinates, so the snap can weigh the roads actually rendered AROUND the
// cursor instead of only the single release point. The user aims at a road drawn
// on screen; zoomed out, one pixel can span a kilometre, so the exact release
// pixel may sit just BESIDE the highway while a pixel a few px toward it lands ON
// it. Sampling a small ring recovers that intent. `vx,vy` are viewport (map-
// container) pixels — exactly what `screenToGeo` expects, so no offset math here.
// The first entry is always the exact release pixel (px 0). Near-duplicate geos
// (common when zoomed in, where the ring is sub-metre) are de-duplicated.
export function sampleScreenCandidates(map: any, vx: number, vy: number, zoom: number): ScreenGeoCandidate[] {
  // 8 compass directions; diagonals unit-normalised so every sample on a ring is
  // the same pixel distance from the cursor.
  const D = 0.7071
  const dirs: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [D, D],
    [D, -D],
    [-D, D],
    [-D, -D],
  ]
  // Zoomed in the release is already precise → one tight ring. Zoomed out it's
  // imprecise and the visible roads are far apart → sample wider, on two rings.
  const radii = zoom >= 13 ? [10] : [12, 24]
  const offsets: [number, number][] = [[0, 0]]
  for (const r of radii) for (const [ux, uy] of dirs) offsets.push([ux * r, uy * r])

  const out: ScreenGeoCandidate[] = []
  const seen = new Set<string>()
  for (const [ox, oy] of offsets) {
    const g = map.screenToGeo(vx + ox, vy + oy)
    if (!g || typeof g.lat !== 'number' || typeof g.lng !== 'number') continue
    const key = `${g.lat.toFixed(6)},${g.lng.toFixed(6)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ lat: g.lat, lng: g.lng, px: Math.round(Math.hypot(ox, oy)) })
  }
  return out
}
