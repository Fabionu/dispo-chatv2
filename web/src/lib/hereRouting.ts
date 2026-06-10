// HERE Routing API v8 — client-side truck route calculation for the route
// planner. Replaces Amazon Location GeoRoutes. Uses the same VITE_HERE_API_KEY
// as the map/search (a public, read-scoped key already in the browser), called
// over REST so it stays independent of the map SDK instance.
//
// Trucks route with `transportMode=truck` so durations/distances and road
// choices honour HGV restrictions; entered size/weight are sent as `vehicle[*]`
// parameters so the route respects height/weight limits. Geometry comes back as
// a HERE Flexible Polyline (`return=polyline`) which we decode to [lng, lat].

import { apiKey, hereConfigured } from './hereMaps'

// HERE returns/encodes coordinates we work with as [longitude, latitude] to match
// the rest of the planner (and GeoJSON ordering).
export type LngLat = [number, number]

export type RouteResult = {
  // Total drive distance in metres.
  distanceMeters: number
  // Total drive time in seconds.
  durationSeconds: number
  // Full route geometry as [lng, lat] points, ready to draw as a line.
  geometry: LngLat[]
  // Which travel mode produced this route, so the UI can label it truthfully.
  mode: 'Car' | 'Truck'
}

// Truck dimensions/weight as entered in the UI (metres / tonnes). Converted to
// HERE units (centimetres / kilograms) before the request. When any value is
// present the route is calculated in real Truck transport mode so it honours
// height/weight road restrictions.
export type TruckRouteOptions = {
  heightM?: number | null
  widthM?: number | null
  lengthM?: number | null
  grossWeightT?: number | null
  axleWeightT?: number | null
  // Hazardous-goods toggle (ADR). HERE expects specific hazardous *types*
  // (explosive/flammable/…) rather than a boolean, so — like the map overlay —
  // we deliberately do NOT translate this boolean into an arbitrary type (that
  // would misrepresent the restriction). Deferred until a typed ADR selector
  // exists. See buildVehicleSpecs() and the README in .env.example.
  hazardous?: boolean
}

// HERE `vector.normal.logistics` style vehicle specs (cm / kg). These keys are
// what the HARP decoder reads to filter which restrictions are "active" for the
// current vehicle. All optional; only set fields are sent.
export type HereVehicleSpecs = {
  heightInCentimeters?: number
  widthInCentimeters?: number
  lengthInCentimeters?: number
  grossWeightInKilograms?: number
  weightPerAxleInKilograms?: number
}

const cm = (m?: number | null) => (m && m > 0 ? Math.round(m * 100) : undefined)
const kg = (t?: number | null) => (t && t > 0 ? Math.round(t * 1000) : undefined)

// Build the HERE map-overlay vehicle specs from UI values, or null when nothing
// usable was entered. Used by the logistics layer's setVehicleSpecs() so the
// restriction overlay highlights limits that actually apply to this vehicle.
export function buildVehicleSpecs(opts: TruckRouteOptions): HereVehicleSpecs | null {
  const specs: HereVehicleSpecs = {}
  const h = cm(opts.heightM)
  const w = cm(opts.widthM)
  const l = cm(opts.lengthM)
  const gw = kg(opts.grossWeightT)
  const aw = kg(opts.axleWeightT)
  if (h !== undefined) specs.heightInCentimeters = h
  if (w !== undefined) specs.widthInCentimeters = w
  if (l !== undefined) specs.lengthInCentimeters = l
  if (gw !== undefined) specs.grossWeightInKilograms = gw
  if (aw !== undefined) specs.weightPerAxleInKilograms = aw
  return Object.keys(specs).length ? specs : null
}

// Build the HERE Routing v8 `vehicle[*]` query params from UI values. Same unit
// conversion as the overlay specs (cm / kg). Returns the param pairs to append.
function vehicleParams(opts: TruckRouteOptions): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const h = cm(opts.heightM)
  const w = cm(opts.widthM)
  const l = cm(opts.lengthM)
  const gw = kg(opts.grossWeightT)
  const aw = kg(opts.axleWeightT)
  if (h !== undefined) out.push(['vehicle[height]', String(h)])
  if (w !== undefined) out.push(['vehicle[width]', String(w)])
  if (l !== undefined) out.push(['vehicle[length]', String(l)])
  if (gw !== undefined) out.push(['vehicle[grossWeight]', String(gw)])
  if (aw !== undefined) out.push(['vehicle[weightPerAxle]', String(aw)])
  return out
}

// Any usable truck restriction present?
function hasTruckParams(opts: TruckRouteOptions): boolean {
  return vehicleParams(opts).length > 0
}

// Calculate a route through an ordered list of waypoints (origin first,
// destination last, any number of intermediate `via` stops between). Requires at
// least two points. Routes in Truck transport mode by default (so distance/
// duration reflect a truck and HGV restrictions apply); pass `mode: 'Car'` to
// override. Entered `truck` dimensions are sent as vehicle restrictions. Returns
// null when no route could be found.
export async function calculateRoute(
  waypoints: LngLat[],
  opts?: { truck?: TruckRouteOptions; mode?: 'Car' | 'Truck' },
): Promise<RouteResult | null> {
  if (waypoints.length < 2) throw new Error('Need at least an origin and destination')
  if (!apiKey) throw new Error('VITE_HERE_API_KEY is not set')

  const [origin, ...rest] = waypoints
  const destination = rest.pop() as LngLat
  const vias = rest

  // Default to Truck so durations are computed for a truck; honour an explicit
  // override (e.g. a car comparison) when given.
  const travelMode: 'Car' | 'Truck' = opts?.mode ?? 'Truck'
  const transportMode = travelMode === 'Truck' ? 'truck' : 'car'

  // HERE expects "lat,lng"; our points are [lng, lat].
  const ll = ([lng, lat]: LngLat) => `${lat},${lng}`

  const params = new URLSearchParams()
  params.set('transportMode', transportMode)
  params.set('origin', ll(origin))
  params.set('destination', ll(destination))
  // Geometry + distance/duration summary.
  params.set('return', 'polyline,summary')
  params.set('apikey', apiKey)

  // Multiple intermediate stops — `via` is a repeatable parameter in v8.
  for (const v of vias) params.append('via', ll(v))

  // Truck restrictions only apply in truck mode and only when entered.
  if (travelMode === 'Truck' && opts?.truck && hasTruckParams(opts.truck)) {
    for (const [k, val] of vehicleParams(opts.truck)) params.append(k, val)
  }

  const res = await fetch(`https://router.hereapi.com/v8/routes?${params.toString()}`)
  if (!res.ok) throw new Error(`Route calculation failed (${res.status})`)
  const data = await res.json()
  const route = data?.routes?.[0]
  if (!route) return null

  // Stitch every section's decoded polyline into one continuous geometry and sum
  // the section summaries (length in metres, duration in seconds).
  const geometry: LngLat[] = []
  let distanceMeters = 0
  let durationSeconds = 0
  for (const section of route.sections ?? []) {
    if (typeof section.polyline === 'string') {
      const pts = decodeFlexiblePolyline(section.polyline)
      for (const [lng, lat] of pts) geometry.push([lng, lat])
    }
    distanceMeters += section.summary?.length ?? 0
    durationSeconds += section.summary?.duration ?? 0
  }

  return { distanceMeters, durationSeconds, geometry, mode: travelMode }
}

// ── HERE Flexible Polyline decoder ───────────────────────────────────────────
// HERE encodes route geometry as a "Flexible Polyline" (a variable-precision,
// optionally-3D delta encoding). We decode the 2D lat/lng to [lng, lat] points.
// Algorithm per HERE's published spec (github.com/heremaps/flexible-polyline).

// Maps a char code (offset by 45, the code of '-') to its 6-bit value. Verbatim
// from HERE's reference implementation (github.com/heremaps/flexible-polyline);
// the alphabet is 'A'–'Z' → 0–25, 'a'–'z' → 26–51, '0'–'9' → 52–61, '-' → 62,
// '_' → 63. Gaps (punctuation between those ranges) are -1 (invalid).
const DECODING_TABLE = [
  62, -1, -1, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, -1, -1, -1, -1, -1, -1, -1,
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
  22, 23, 24, 25, -1, -1, -1, -1, 63, -1, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35,
  36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51,
]

function decodeFlexiblePolyline(encoded: string): LngLat[] {
  const decoder = decodeUnsignedValues(encoded)
  if (Number(decoder[0]) !== 1) throw new Error('Unsupported flexible polyline version')
  const header = Number(decoder[1])
  const precision = header & 15
  const thirdDim = (header >> 4) & 7
  const factor = 10 ** precision
  // Pairs of (lat, lng) deltas follow the two header values; when a third
  // dimension (elevation/level) is present each tuple carries an extra value we
  // skip. Routing v8 polylines are 2D, but handle 3D defensively.
  const stride = thirdDim ? 3 : 2
  let lastLat = 0n
  let lastLng = 0n
  const result: LngLat[] = []
  for (let i = 2; i + 1 < decoder.length; i += stride) {
    lastLat += toSigned(decoder[i])
    lastLng += toSigned(decoder[i + 1])
    result.push([Number(lastLng) / factor, Number(lastLat) / factor])
  }
  return result
}

// Decode the variable-length, continuation-bit encoded unsigned integers. Uses
// BigInt so large values / high bit-shifts can't overflow JS's 32-bit bitwise ops.
function decodeUnsignedValues(encoded: string): bigint[] {
  let result = 0n
  let shift = 0n
  const values: bigint[] = []
  for (const char of encoded) {
    const value = DECODING_TABLE[char.charCodeAt(0) - 45]
    if (value === undefined || value < 0) {
      throw new Error('Invalid encoding in flexible polyline')
    }
    const big = BigInt(value)
    result |= (big & 0x1fn) << shift
    if ((big & 0x20n) === 0n) {
      values.push(result)
      result = 0n
      shift = 0n
    } else {
      shift += 5n
    }
  }
  return values
}

// Reverse the zig-zag encoding used for signed deltas.
function toSigned(value: bigint): bigint {
  let result = value
  if (result & 1n) result = ~result
  return result >> 1n
}

// Human-friendly "123 km" (or "850 m" under 1 km).
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toLocaleString(undefined, { maximumFractionDigits: meters < 10000 ? 1 : 0 })} km`
}

// Human-friendly "2 h 58 min" / "45 min".
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} min`
  return `${h} h ${m} min`
}

export { hereConfigured }
