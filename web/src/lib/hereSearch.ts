// HERE Geocoding & Search API v7 — client-side geocoding + place/POI search for
// the route planner. Replaces Amazon Location GeoPlaces. Uses the same
// VITE_HERE_API_KEY as the map/routing. Mirrors the small surface the planner
// consumed before (geocode / searchPlaces / getPlace / parseCoordinates), so the
// autocomplete field and workspace switch providers with minimal change.

import { apiKey, hereConfigured } from './hereMaps'
import type { LngLat } from './hereRouting'

export type { LngLat }

// The planner is configured when a HERE key is present (map + routing + search
// all share it).
export const geoConfigured = hereConfigured

export type GeocodeResult = {
  position: LngLat
  label: string
}

// One row in the suggestions dropdown. HERE Discover returns a coordinate inline
// with every result, so `position` is populated and selection needs no extra
// lookup (the getPlace fallback only runs for the rare result without one).
export type PlaceSuggestion = {
  placeId: string
  // Main row text — the place/POI/street name.
  primary: string
  // Secondary row text — the rest of the address.
  secondary: string
  // Full one-line label, used to fill the input on selection.
  label: string
  // Coordinates of the result (HERE Discover always provides these).
  position?: LngLat
}

// A selected place resolved to coordinates + structured address.
export type ResolvedPlace = {
  placeId: string
  label: string
  position: LngLat
  postalCode: string | null
  country: string | null
  region: string | null
  locality: string | null
}

// Default bias for search when no waypoint is selected yet: central Europe. HERE
// Discover/Autosuggest require an `at` focus point to rank nearby results first.
export const DEFAULT_BIAS: LngLat = [10.0, 51.0]

// Parse a free-text "lat, lng" / "lat lng" entry into [lng, lat], or null. Lets
// dispatchers paste coordinates straight into the route fields.
export function parseCoordinates(text: string): LngLat | null {
  const m = text
    .trim()
    .match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/)
  if (!m) return null
  const lat = Number.parseFloat(m[1])
  const lng = Number.parseFloat(m[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return [lng, lat]
}

// Compact "50.11090, 8.68210" label for a coordinate point.
export function formatCoords(lng: number, lat: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function key(): string {
  return encodeURIComponent(apiKey ?? '')
}

// HERE position objects are { lat, lng }; the planner uses [lng, lat].
function toLngLat(pos: any): LngLat | null {
  if (!pos || typeof pos.lat !== 'number' || typeof pos.lng !== 'number') return null
  return [pos.lng, pos.lat]
}

// Derive the primary/secondary split from a HERE search item: the title is the
// most specific part; the secondary line is the rest of the address label with
// the (already-shown) title stripped off the front.
function splitLabel(item: any): { primary: string; secondary: string; label: string } {
  const label: string = item?.address?.label ?? item?.title ?? ''
  const primary: string = (item?.title || label.split(',')[0] || '').trim()
  let secondary = label
  if (primary && secondary.startsWith(primary)) {
    secondary = secondary.slice(primary.length).replace(/^[\s,]+/, '')
  }
  return { primary, secondary, label }
}

// Resolve a free-text address/city to coordinates (HERE Geocode). Returns null
// when the query yields no usable result. Throws on transport/auth failures.
export async function geocode(query: string): Promise<GeocodeResult | null> {
  const url =
    `https://geocode.search.hereapi.com/v1/geocode` +
    `?q=${encodeURIComponent(query)}&limit=1&apikey=${key()}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Geocode failed (${res.status})`)
  const data = await res.json()
  const item = data?.items?.[0]
  const pos = toLngLat(item?.position)
  if (!pos) return null
  return { position: pos, label: item?.address?.label ?? item?.title ?? query }
}

// Full-text place search (HERE Discover). Resolves a free-text query to concrete
// places — businesses/POIs (depots, stores, a company by name), addresses,
// streets and cities — all with a coordinate inline, so "search a company and
// route to it" works and selection skips any extra lookup. `bias` ([lng, lat])
// focuses results near the route. Pass an AbortSignal so a superseded keystroke's
// request can be cancelled. Throws on transport/auth failures.
export async function searchPlaces(
  query: string,
  bias: LngLat,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  const [lng, lat] = bias
  const url =
    `https://discover.search.hereapi.com/v1/discover` +
    `?q=${encodeURIComponent(query)}&at=${lat},${lng}&limit=6&apikey=${key()}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  const data = await res.json()
  const items: any[] = Array.isArray(data?.items) ? data.items : []
  return items
    .map((it): PlaceSuggestion | null => {
      const position = toLngLat(it.position)
      // Only results we can route to (must carry a coordinate).
      if (!position) return null
      const { primary, secondary, label } = splitLabel(it)
      const placeId: string = it.id ?? `pos:${position[0]},${position[1]}`
      return { placeId, primary, secondary, label, position }
    })
    .filter((s): s is PlaceSuggestion => s !== null)
}

// Address/POI autocomplete (HERE Autosuggest). Like searchPlaces but optimised
// for partial input; most results carry a position inline (resolved on select,
// with a getPlace fallback for the rare one that doesn't). `bias` focuses nearby
// results. Kept for parity with the previous provider's autocomplete entry point.
export async function autocompletePlaces(
  query: string,
  bias: LngLat,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  const [lng, lat] = bias
  const url =
    `https://autosuggest.search.hereapi.com/v1/autosuggest` +
    `?q=${encodeURIComponent(query)}&at=${lat},${lng}&limit=6&apikey=${key()}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Autocomplete failed (${res.status})`)
  const data = await res.json()
  const items: any[] = Array.isArray(data?.items) ? data.items : []
  return items
    .filter((it) => it?.id && (it.resultType === 'place' || it.resultType === 'street' || it.position))
    .map((it): PlaceSuggestion => {
      const { primary, secondary, label } = splitLabel(it)
      return { placeId: it.id as string, primary, secondary, label, position: toLngLat(it.position) ?? undefined }
    })
}

// HERE Autosuggest/Discover both return businesses/POIs as well as addresses, so
// a single Discover-backed entry point covers the planner's "company or address"
// search. Exposed under the previous provider's name for call-site parity.
export const suggestPlaces = searchPlaces

// Resolve a selected suggestion's id to coordinates + structured address (HERE
// Lookup). Discover/Autosuggest already return a position, so this is only a
// fallback for the rare result without one.
export async function getPlace(placeId: string): Promise<ResolvedPlace | null> {
  const url =
    `https://lookup.search.hereapi.com/v1/lookup` +
    `?id=${encodeURIComponent(placeId)}&apikey=${key()}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Lookup failed (${res.status})`)
  const data: any = await res.json()
  const pos = toLngLat(data?.position)
  if (!pos) return null
  const addr = data.address ?? {}
  return {
    placeId,
    label: addr.label ?? data.title ?? '',
    position: pos,
    postalCode: addr.postalCode ?? null,
    country: addr.countryName ?? null,
    region: addr.state ?? null,
    locality: addr.city ?? null,
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Snap-to-road / route alignment ───────────────────────────────────────────
// HERE Routing v8 already matches origin/destination/`via` waypoints onto the
// road network when it calculates a route, so the *returned route polyline* is an
// authoritative on-road geometry. Rather than calling a separate snapping service,
// we align a coordinate to that geometry: the nearest point on the returned route
// polyline is, by construction, a real point on a routable road. This is the
// "reliable local fallback" the planner uses to make markers sit exactly on the
// route line (and to give dropped/clicked points an on-route coordinate).

// Project [lng, lat] to a local planar frame around `latRef` so distances along
// the (short) snapping range aren't distorted by longitude convergence. Returns
// metres-ish units (scaled degrees); only relative magnitudes matter here.
function projector(latRef: number) {
  const kx = Math.cos((latRef * Math.PI) / 180)
  return ([lng, lat]: LngLat): [number, number] => [lng * kx, lat]
}

// Nearest point to `p` on the segment a→b (all in projected space), returned in
// the same projected space, plus the squared distance from `p`.
function nearestOnSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): { point: [number, number]; d2: number } {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const len2 = abx * abx + aby * aby
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2
  t = Math.max(0, Math.min(1, t))
  const point: [number, number] = [a[0] + t * abx, a[1] + t * aby]
  const dx = p[0] - point[0]
  const dy = p[1] - point[1]
  return { point, d2: dx * dx + dy * dy }
}

// Snap a coordinate to the nearest point on a route polyline ([lng, lat] points
// from HERE Routing). Returns the on-route coordinate, or null when there's no
// usable geometry to snap to (the caller then keeps the raw point). Because the
// polyline is HERE's road-matched route geometry, the result lies on a real road.
export function snapToRoad(point: LngLat, polyline?: LngLat[] | null): LngLat | null {
  if (!polyline || polyline.length === 0) return null
  if (polyline.length === 1) return polyline[0]
  const project = projector(point[1])
  const pp = project(point)
  let best: [number, number] = project(polyline[0])
  let bestD2 = Infinity
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = project(polyline[i])
    const b = project(polyline[i + 1])
    const { point: q, d2 } = nearestOnSegment(pp, a, b)
    if (d2 < bestD2) {
      bestD2 = d2
      best = q
    }
  }
  // Unproject back to [lng, lat].
  const kx = Math.cos((point[1] * Math.PI) / 180) || 1
  return [best[0] / kx, best[1]]
}
