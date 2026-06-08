// Amazon Location Service v2 — client-side geocoding (GeoPlaces) and route
// calculation (GeoRoutes). Both use the same scoped API key as the map
// (VITE_AWS_LOCATION_API_KEY), whose policy grants geo-places:Geocode and
// geo-routes:CalculateRoutes. No AWS SDK and no server round-trip — the key is
// a public, read-scoped key already shipped to the browser for the map.
//
// When the key/region are missing, `geoConfigured` is false and callers can
// keep the UI in a neutral state instead of firing failing requests.

const apiKey = import.meta.env.VITE_AWS_LOCATION_API_KEY
const region = import.meta.env.VITE_AWS_LOCATION_REGION

export const geoConfigured = Boolean(apiKey && region)

// Amazon Location returns and expects coordinates as [longitude, latitude].
export type LngLat = [number, number]

export type GeocodeResult = {
  position: LngLat
  label: string
}

function placesUrl(path: string): string {
  return `https://places.geo.${region}.amazonaws.com/v2/${path}?key=${encodeURIComponent(apiKey ?? '')}`
}

function routesUrl(path: string): string {
  return `https://routes.geo.${region}.amazonaws.com/v2/${path}?key=${encodeURIComponent(apiKey ?? '')}`
}

// Resolve a free-text address/city to coordinates. Returns null when the query
// yields no usable result. Throws on transport/auth failures so the caller can
// surface a single "couldn't calculate" message.
export async function geocode(query: string): Promise<GeocodeResult | null> {
  const res = await fetch(placesUrl('geocode'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ QueryText: query, MaxResults: 1 }),
  })
  if (!res.ok) throw new Error(`Geocode failed (${res.status})`)
  const data = await res.json()
  const item = data?.ResultItems?.[0]
  const pos = item?.Position
  if (!Array.isArray(pos) || pos.length < 2) return null
  return {
    position: [pos[0], pos[1]],
    label: item?.Address?.Label ?? item?.Title ?? query,
  }
}

// ── Places autocomplete (GeoPlaces v2 Autocomplete + GetPlace) ───────────────

// One row in the suggestions dropdown. Autocomplete is lightweight — it returns
// rich address fields (with AdditionalFeatures: Core) but NO coordinates, so the
// position is resolved on selection via getPlace().
export type PlaceSuggestion = {
  placeId: string
  // Main row text — the most specific part (city / street / place name).
  primary: string
  // Secondary row text — postal code · region · country (when available).
  secondary: string
  // Full one-line label, used to fill the input on selection.
  label: string
  // When present, selection resolves directly to these coords (no GetPlace) —
  // used for raw coordinate entries typed into the search.
  position?: LngLat
}

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

// A selected place resolved to coordinates + structured address (via GetPlace).
export type ResolvedPlace = {
  placeId: string
  label: string
  position: LngLat
  postalCode: string | null
  country: string | null
  region: string | null
  locality: string | null
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// Address-completion suggestions for a free-text query. Pass an AbortSignal so a
// superseded keystroke's request can be cancelled. Throws on transport/auth
// failures (callers show a subtle error row). AdditionalFeatures: Core gives the
// structured address used for the secondary line.
export async function autocompletePlaces(
  query: string,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  const res = await fetch(placesUrl('autocomplete'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ QueryText: query, MaxResults: 6, AdditionalFeatures: ['Core'] }),
    signal,
  })
  if (!res.ok) throw new Error(`Autocomplete failed (${res.status})`)
  const data = await res.json()
  const items: any[] = Array.isArray(data?.ResultItems) ? data.ResultItems : []
  return items
    .filter((it) => it?.PlaceId)
    .map((it) => {
      const addr = it.Address ?? {}
      const label: string = addr.Label ?? it.Title ?? ''
      const primary = (label.split(',')[0] || addr.Locality || it.Title || '').trim()
      const secondary = [addr.PostalCode, addr.Region?.Name, addr.Country?.Name]
        .filter(Boolean)
        .join(' · ')
      return { placeId: it.PlaceId as string, primary, secondary, label }
    })
}

// Default bias for Suggest when no waypoint is selected yet: central Europe. A
// bias only RANKS nearby results first — it doesn't restrict — so distant places
// are still found, just lower. (Suggest requires a bias; this provides one.)
export const DEFAULT_BIAS: LngLat = [10.0, 51.0]

// Place/POI suggestions (GeoPlaces v2 Suggest). Unlike Autocomplete this returns
// businesses/companies and named POIs (depots, stations, airports) as well as
// addresses — so dispatchers can search a company by name. Requires a bias
// position; pass the nearest known waypoint or DEFAULT_BIAS. Resolves coords on
// selection via getPlace (Suggest, like Autocomplete, omits the position).
export async function suggestPlaces(
  query: string,
  bias: LngLat,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  const res = await fetch(placesUrl('suggest'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      QueryText: query,
      MaxResults: 6,
      BiasPosition: bias,
      AdditionalFeatures: ['Core'],
    }),
    signal,
  })
  if (!res.ok) throw new Error(`Suggest failed (${res.status})`)
  const data = await res.json()
  const items: any[] = Array.isArray(data?.ResultItems) ? data.ResultItems : []
  return items
    .filter((it) => it?.SuggestResultItemType === 'Place' && it.Place?.PlaceId)
    .map((it) => {
      const p = it.Place
      const addr = p.Address ?? {}
      const label: string = addr.Label ?? it.Title ?? ''
      const primary = (it.Title || label.split(',')[0] || '').trim()
      let secondary = label
      if (primary && secondary.startsWith(primary)) {
        secondary = secondary.slice(primary.length).replace(/^[\s,·]+/, '')
      }
      if (!secondary) {
        secondary = [addr.PostalCode, addr.Region?.Name, addr.Country?.Name]
          .filter(Boolean)
          .join(' · ')
      }
      return { placeId: p.PlaceId as string, primary, secondary, label }
    })
}

// Resolve a selected suggestion's PlaceId to coordinates + structured address.
// Autocomplete doesn't return a position, so this is called on selection.
export async function getPlace(placeId: string): Promise<ResolvedPlace | null> {
  const url = `https://places.geo.${region}.amazonaws.com/v2/place/${encodeURIComponent(
    placeId,
  )}?key=${encodeURIComponent(apiKey ?? '')}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GetPlace failed (${res.status})`)
  const data: any = await res.json()
  const pos = data?.Position
  if (!Array.isArray(pos) || pos.length < 2) return null
  const addr = data.Address ?? {}
  return {
    placeId,
    label: addr.Label ?? data.Title ?? '',
    position: [pos[0], pos[1]],
    postalCode: addr.PostalCode ?? null,
    country: addr.Country?.Name ?? null,
    region: addr.Region?.Name ?? null,
    locality: addr.Locality ?? null,
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

export type RouteResult = {
  // Total drive distance in metres.
  distanceMeters: number
  // Total drive time in seconds.
  durationSeconds: number
  // Full route geometry as [lng, lat] points, ready for a MapLibre LineString.
  geometry: LngLat[]
  // Which travel mode actually produced this route, so the UI can label it
  // truthfully (truck-restriction-aware vs car).
  mode: 'Car' | 'Truck'
}

// Truck dimensions/weight as entered in the UI (metres / tonnes). Converted to
// Amazon Location units (centimetres / kilograms) before the request. When any
// value is present, the route is calculated in real Truck travel mode so it
// honours height/weight road restrictions — NOT a car route drawn over a truck
// basemap.
export type TruckRouteOptions = {
  heightM?: number | null
  widthM?: number | null
  lengthM?: number | null
  grossWeightT?: number | null
  axleWeightT?: number | null
  // Hazardous-goods toggle. NOTE: Amazon Location's HazardousCargos expects
  // specific cargo TYPES (Explosive/Flammable/…). Until the UI offers a type
  // selector we don't send an arbitrary one (that would misrepresent the
  // restriction), so this currently does not alter the request. TODO: map a
  // hazmat type selector → Truck.HazardousCargos.
  hazardous?: boolean
}

// Build the Amazon Location `Truck` object from UI values, or null when nothing
// usable was entered (→ caller routes as a Car).
function buildTruckParams(opts: TruckRouteOptions): Record<string, number> | null {
  const cm = (m?: number | null) => (m && m > 0 ? Math.round(m * 100) : undefined)
  const kg = (t?: number | null) => (t && t > 0 ? Math.round(t * 1000) : undefined)
  const truck: Record<string, number> = {}
  const entries: Array<[string, number | undefined]> = [
    ['Height', cm(opts.heightM)],
    ['Width', cm(opts.widthM)],
    ['Length', cm(opts.lengthM)],
    ['GrossWeight', kg(opts.grossWeightT)],
    ['WeightPerAxle', kg(opts.axleWeightT)],
  ]
  for (const [k, v] of entries) if (v !== undefined) truck[k] = v
  return Object.keys(truck).length ? truck : null
}

// Calculate a route through an ordered list of waypoints (origin first,
// destination last, any number of intermediate stops between). Requires at least
// two points. Routes in Truck travel mode by default (so the duration reflects a
// truck, not a car); pass `mode: 'Car'` to override. When `truck` dimensions are
// supplied they're sent as restrictions so the route honours height/weight
// limits — otherwise it's a default truck profile. Returns null when no route
// could be found.
export async function calculateRoute(
  waypoints: LngLat[],
  opts?: { truck?: TruckRouteOptions; mode?: 'Car' | 'Truck' },
): Promise<RouteResult | null> {
  if (waypoints.length < 2) throw new Error('Need at least an origin and destination')
  const [origin, ...rest] = waypoints
  const destination = rest.pop() as LngLat
  const intermediate = rest.map((p) => ({ Position: p }))
  const truck = opts?.truck ? buildTruckParams(opts.truck) : null
  // Default to Truck so durations are computed for a truck; honour an explicit
  // override (e.g. a car comparison) when given.
  const travelMode: 'Car' | 'Truck' = opts?.mode ?? 'Truck'

  const res = await fetch(routesUrl('routes'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Origin: origin,
      Destination: destination,
      ...(intermediate.length ? { Waypoints: intermediate } : {}),
      TravelMode: travelMode,
      // Restrictions only apply to a truck route, and only when entered.
      ...(travelMode === 'Truck' && truck ? { Truck: truck } : {}),
      LegGeometryFormat: 'Simple',
    }),
  })
  if (!res.ok) throw new Error(`Route calculation failed (${res.status})`)
  const data = await res.json()
  const route = data?.Routes?.[0]
  if (!route) return null

  // Stitch every leg's LineString into one continuous geometry.
  const geometry: LngLat[] = []
  for (const leg of route.Legs ?? []) {
    const line = leg?.Geometry?.LineString
    if (Array.isArray(line)) {
      for (const pt of line) {
        if (Array.isArray(pt) && pt.length >= 2) geometry.push([pt[0], pt[1]])
      }
    }
  }

  return {
    distanceMeters: route.Summary?.Distance ?? 0,
    durationSeconds: route.Summary?.Duration ?? 0,
    geometry,
    mode: travelMode,
  }
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
