import type { LatLng, TruckProfile, TruckProfileForm, TruckRoute } from '../../lib/here/types'

export const EMPTY_TRUCK: TruckProfileForm = {
  heightCm: '',
  widthCm: '',
  lengthCm: '',
  grossWeightKg: '',
  axleCount: '',
  trailerCount: '',
}

export const MAX_STOPS = 8
export const ON_ROUTE_METERS = 200
// Width the expanded panel overlaps on the map's left edge (left-3 + w-[18.75rem]
// + breathing room) — fed to the map so the route frames clear of it.
export const PANEL_INSET_PX = 322

export const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

export const fmtCoord = (c: LatLng) => `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`

// A point only routes when it carries finite coordinates. Guards the route
// request so a stop without valid coordinates is never submitted as an empty
// address (the request would otherwise fail asking for it).
export const isValidCoord = (c?: LatLng | null): c is LatLng =>
  !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng)

// Opt-in drag/snap tracing (mirrors HereMap): `localStorage.routeSnapDebug = '1'`
// in the console logs the raw release coordinate, the snapped point, and how far
// the snap moved it. Silent + off by default.
export function snapDebug(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('routeSnapDebug') === '1'
  } catch {
    return false
  }
}

export function toTruckProfile(form: TruckProfileForm): TruckProfile {
  const num = (s: string) => {
    const n = Number(s)
    return s.trim() !== '' && Number.isFinite(n) ? n : undefined
  }
  const profile: TruckProfile = {}
  const height = num(form.heightCm)
  const width = num(form.widthCm)
  const length = num(form.lengthCm)
  const gross = num(form.grossWeightKg)
  const axles = num(form.axleCount)
  const trailers = num(form.trailerCount)
  if (height && height > 0) profile.heightCm = Math.round(height)
  if (width && width > 0) profile.widthCm = Math.round(width)
  if (length && length > 0) profile.lengthCm = Math.round(length)
  if (gross && gross > 0) profile.grossWeightKg = Math.round(gross)
  if (axles && axles > 0) profile.axleCount = Math.round(axles)
  if (trailers !== undefined && trailers >= 0) profile.trailerCount = Math.round(trailers)
  return profile
}

export function truckSummary(form: TruckProfileForm): string {
  const parts: string[] = []
  const gw = Number(form.grossWeightKg)
  if (form.grossWeightKg && gw > 0) parts.push(`${(gw / 1000).toFixed(gw % 1000 ? 1 : 0)}t`)
  const ln = Number(form.lengthCm)
  if (form.lengthCm && ln > 0) parts.push(`${(ln / 100).toFixed(1)}m`)
  const ht = Number(form.heightCm)
  if (form.heightCm && ht > 0) parts.push(`${(ht / 100).toFixed(1)}m`)
  return parts.length ? parts.join(' · ') : 'Not set'
}

// Google-Maps-style km formatting, shared by the side-panel stat and the on-map
// distance badge so the two always read identically: one decimal under 10 km
// (3.4 km), rounded to a whole km at/above it (12 km, 84 km, 247 km).
export function formatDistance(metres: number): string {
  const km = metres / 1000
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  return h > 0 ? `${h} h ${m} min` : `${m} min`
}

export function formatEta(seconds: number): string {
  const eta = new Date(Date.now() + seconds * 1000)
  // 24-hour clock, matching message timestamps (see messageUtils.formatTime).
  return eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

export function errorMessage(code: string): string {
  switch (code) {
    case 'here_not_configured':
      return 'HERE is not configured on the server (set HERE_API_KEY).'
    case 'route_not_found':
      return 'No truck route found between these points.'
    case 'here_request_failed':
      return 'HERE could not calculate this route. Try different points.'
    default:
      return 'Something went wrong calculating the route.'
  }
}

export function snappedFromRoute(
  route: TruckRoute | null,
  stopCount: number,
): { origin: LatLng; stops: LatLng[]; destination: LatLng } | null {
  if (!route) return null
  const secs = route.sections
  if (secs.length !== stopCount + 1) return null
  const origin = secs[0].departure
  if (!origin) return null
  const stops: LatLng[] = []
  for (let i = 0; i < stopCount; i++) {
    const p = secs[i].arrival
    if (!p) return null
    stops.push(p)
  }
  const destination = secs[secs.length - 1].arrival
  if (!destination) return null
  return { origin, stops, destination }
}
