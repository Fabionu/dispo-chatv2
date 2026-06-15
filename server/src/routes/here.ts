import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth.js'
import { asyncHandler, HttpError } from '../http.js'
import { env } from '../env.js'

export const hereRouter = Router()
hereRouter.use(requireAuth)

const searchBase = 'https://discover.search.hereapi.com/v1/discover'
const revgeocodeBase = 'https://revgeocode.search.hereapi.com/v1/revgeocode'
const routeBase = 'https://router.hereapi.com/v8/routes'

type HerePosition = { lat: number; lng: number }

type HereSearchItem = {
  id?: string
  title?: string
  address?: { label?: string }
  position?: HerePosition
}

type HereSearchResponse = {
  items?: HereSearchItem[]
}

// A reverse-geocode result item. HERE returns `distance` (metres from the
// queried `at`) and, for street results, `address.street` — both of which we
// use to pick a road-snap candidate that prefers major roads when zoomed out.
type HereRevgeocodeItem = {
  title?: string
  resultType?: string
  distance?: number
  position?: HerePosition
  address?: { label?: string; street?: string }
}

type HereRevgeocodeResponse = {
  items?: HereRevgeocodeItem[]
}

type HereRoutePlace = { place?: { location?: HerePosition } }

type HereRouteResponse = {
  routes?: Array<{
    id?: string
    sections?: Array<{
      id?: string
      polyline?: string
      summary?: {
        duration?: number
        length?: number
        baseDuration?: number
      }
      notices?: Array<{ code?: string; title?: string; severity?: string }>
      // HERE returns the road-snapped coordinate of each section boundary in
      // `place.location` (vs the raw input in `place.originalLocation`). We
      // surface these so the client can place markers on the road, not the
      // raw click/geocode point.
      departure?: HereRoutePlace
      arrival?: HereRoutePlace
    }>
  }>
}

const coordinateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})

// A waypoint = a coordinate plus an optional `course` (desired travel heading,
// degrees clockwise from north). HERE uses the course to snap the waypoint to
// the correct carriageway/direction so a dragged point doesn't land on the
// oncoming road.
const waypointSchema = coordinateSchema.extend({
  course: z.number().min(0).max(359).optional(),
})

const truckRouteSchema = z.object({
  origin: waypointSchema,
  destination: waypointSchema,
  // Ordered intermediate stops (HERE `via`), between origin and destination.
  via: z.array(waypointSchema).max(8).optional(),
  truck: z
    .object({
      heightCm: z.number().int().positive().max(1000).optional(),
      widthCm: z.number().int().positive().max(500).optional(),
      lengthCm: z.number().int().positive().max(3000).optional(),
      grossWeightKg: z.number().int().positive().max(80000).optional(),
      axleCount: z.number().int().min(2).max(12).optional(),
      trailerCount: z.number().int().min(0).max(4).optional(),
    })
    .optional(),
})

function requireHereKey() {
  if (!env.HERE_API_KEY) throw new HttpError(503, 'here_not_configured')
  return env.HERE_API_KEY
}

async function hereJson<T>(url: URL): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.warn('HERE request failed', { status: res.status, body: body.slice(0, 500) })
    throw new HttpError(res.status >= 500 ? 502 : res.status, 'here_request_failed')
  }
  return (await res.json()) as T
}

hereRouter.get('/config', (_req, res) => {
  requireHereKey()
  res.json({ apiKey: env.HERE_API_KEY })
})

hereRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const apiKey = requireHereKey()
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    if (q.length < 3) return res.json({ items: [] })

    const url = new URL(searchBase)
    url.searchParams.set('apiKey', apiKey)
    url.searchParams.set('q', q)
    url.searchParams.set('limit', '6')
    url.searchParams.set('lang', 'en-US')
    url.searchParams.set('at', '50.1109,8.6821')

    const data = await hereJson<HereSearchResponse>(url)
    res.json({
      items: (data.items ?? [])
        .filter((item) => item.position)
        .map((item) => ({
          id: item.id ?? `${item.position!.lat},${item.position!.lng}:${item.title ?? item.address?.label}`,
          title: item.title ?? item.address?.label ?? 'Unknown place',
          label: item.address?.label ?? item.title ?? '',
          position: item.position!,
        })),
    })
  }),
)

// Rough metres-per-degree for short-distance haversine (good enough for the
// ~metres/sub-km scale we snap over).
function metersBetween(a: HerePosition, b: HerePosition): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Heuristic "is this a major road?" from the street name / title. HERE Reverse
// Geocode does NOT expose functional class, so we approximate road importance
// from common motorway / trunk-road naming across European + English locales
// (e.g. A5, M6, E45, B27, Autobahn, Motorway, Autostrada, Snelweg, Autoroute…).
// This is the documented limitation: a true road-class signal would need HERE
// routing spans (functionalClass), which aren't available for a single snap.
const MAJOR_ROAD_RE =
  /\b([AME]\s?\d|B\s?\d{2,}|SS\s?\d|N\s?\d{2,})\b|autobahn|autostrada|autoroute|autovía|autovia|autopista|motorway|freeway|expressway|highway|snelweg|bundesstra|trunk|ring(road)?|tangenziale|périph|peripherique/i

function isMajorRoad(item: HereRevgeocodeItem): boolean {
  const name = `${item.address?.street ?? ''} ${item.title ?? ''}`.trim()
  return name.length > 0 && MAJOR_ROAD_RE.test(name)
}

// ── GET /api/here/revgeocode?at=lat,lng[&zoom=Z] ─────────────────────────
// HERE Reverse Geocode used as a road-snap: resolve a clicked/dragged map
// coordinate to a readable label + a road-snapped position. Returns
// { place: null } when HERE has no result for the spot (e.g. open sea) so the
// caller can fall back to the raw coordinate.
//
// Zoom-aware candidate selection (req: prefer the visible major road when the
// user is zoomed out): we ask HERE for several STREET candidates and pick the
// best one, trading distance against road importance. The more zoomed out the
// map is, the larger the snap radius and the stronger the bias toward a major
// road — so drag-releasing onto a visible highway lands on that highway, not a
// hidden side street. Zoomed in, we snap to the nearest road.
hereRouter.get(
  '/revgeocode',
  asyncHandler(async (req, res) => {
    const apiKey = requireHereKey()
    const at = typeof req.query.at === 'string' ? req.query.at.trim() : ''
    if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(at)) {
      throw new HttpError(400, 'invalid_at')
    }
    const [atLat, atLng] = at.split(',').map(Number)
    const atPos: HerePosition = { lat: atLat, lng: atLng }

    // Parse zoom (HERE web map zoom is ~0–20). Absent → treat as zoomed-in
    // (precise nearest snap, single candidate) for backward-compatible behaviour.
    const zoomRaw = typeof req.query.zoom === 'string' ? Number(req.query.zoom) : NaN
    const zoom = Number.isFinite(zoomRaw) ? Math.max(0, Math.min(20, zoomRaw)) : 18

    // "Zoomed-out-ness" in [0,1]: 1 at zoom ≤8, 0 at zoom ≥14.
    const out = Math.max(0, Math.min(1, (14 - zoom) / 6))
    // Max distance we'll accept a snap from: ~60 m zoomed in → ~1500 m zoomed out.
    const maxSnapMeters = 60 + out * 1440
    // How strongly to favour a major road over a closer minor one.
    const majorBias = out * 3
    const limit = out > 0 ? 12 : 1

    const url = new URL(revgeocodeBase)
    url.searchParams.set('apiKey', apiKey)
    url.searchParams.set('at', at)
    url.searchParams.set('lang', 'en-US')
    url.searchParams.set('limit', String(limit))
    // Prefer street geometry (the road) over house/POI points for snapping.
    if (out > 0) url.searchParams.set('types', 'street')

    const data = await hereJson<HereRevgeocodeResponse>(url)
    const candidates = (data.items ?? []).filter(
      (i): i is HereRevgeocodeItem & { position: HerePosition } => Boolean(i.position),
    )
    if (candidates.length === 0) return res.json({ place: null })

    // Score each candidate: lower is better. `effective = distance / (1 + bias)`
    // so a major road can win even when slightly farther than a side street.
    // Candidates beyond the zoom-scaled radius are dropped (but we keep the raw
    // nearest as a fallback so we never return null when HERE found something).
    let best: { item: HereRevgeocodeItem & { position: HerePosition }; score: number } | null = null
    let nearest: { item: HereRevgeocodeItem & { position: HerePosition }; dist: number } | null = null
    for (const item of candidates) {
      const dist = item.distance ?? metersBetween(atPos, item.position)
      if (!nearest || dist < nearest.dist) nearest = { item, dist }
      if (dist > maxSnapMeters) continue
      const score = dist / (1 + (isMajorRoad(item) ? majorBias : 0))
      if (!best || score < best.score) best = { item, score }
    }

    const chosen = best?.item ?? nearest?.item
    if (!chosen?.position) return res.json({ place: null })
    res.json({
      place: {
        label: chosen.address?.label ?? chosen.title ?? '',
        position: chosen.position,
        major: isMajorRoad(chosen),
      },
    })
  }),
)

hereRouter.post(
  '/routes/truck',
  asyncHandler(async (req, res) => {
    const apiKey = requireHereKey()
    const body = truckRouteSchema.parse(req.body)

    // Format a waypoint for HERE: `lat,lng` plus an optional `;course=DEG` so
    // HERE matches the waypoint to a road link travelling in that direction
    // (keeps a dragged point on the correct carriageway, not the oncoming one).
    const fmtWaypoint = (wp: { lat: number; lng: number; course?: number }) =>
      `${wp.lat},${wp.lng}${wp.course !== undefined ? `;course=${wp.course}` : ''}`

    const url = new URL(routeBase)
    url.searchParams.set('apiKey', apiKey)
    url.searchParams.set('transportMode', 'truck')
    url.searchParams.set('routingMode', 'fast')
    url.searchParams.set('origin', fmtWaypoint(body.origin))
    url.searchParams.set('destination', fmtWaypoint(body.destination))
    // `via` repeats, once per stop, in order — HERE keeps origin first and
    // destination last and routes through the vias in the given sequence.
    for (const stop of body.via ?? []) {
      url.searchParams.append('via', fmtWaypoint(stop))
    }
    url.searchParams.set('return', 'polyline,summary')

    // HERE Routing v8 describes the truck via `vehicle[...]` params (the old
    // `truck[...]` dimensional form is deprecated/removed). Dimensions are in
    // CENTIMETRES, weights in KILOGRAMS, both integers. `transportMode=truck`
    // (set above) is what actually selects truck routing; these refine it.
    const truck = body.truck ?? {}
    if (truck.heightCm) url.searchParams.set('vehicle[height]', String(truck.heightCm))
    if (truck.widthCm) url.searchParams.set('vehicle[width]', String(truck.widthCm))
    if (truck.lengthCm) url.searchParams.set('vehicle[length]', String(truck.lengthCm))
    if (truck.grossWeightKg) url.searchParams.set('vehicle[grossWeight]', String(truck.grossWeightKg))
    if (truck.axleCount) url.searchParams.set('vehicle[axleCount]', String(truck.axleCount))
    if (truck.trailerCount !== undefined) {
      url.searchParams.set('vehicle[trailerCount]', String(truck.trailerCount))
    }

    const data = await hereJson<HereRouteResponse>(url)
    const route = data.routes?.[0]
    if (!route?.sections?.length) throw new HttpError(404, 'route_not_found')

    const sections = route.sections.map((section) => ({
      id: section.id,
      polyline: section.polyline,
      summary: section.summary,
      notices: section.notices ?? [],
      // Road-snapped boundary coordinates (null when HERE omits them).
      departure: section.departure?.place?.location ?? null,
      arrival: section.arrival?.place?.location ?? null,
    }))

    res.json({
      route: {
        id: route.id,
        sections,
        summary: sections.reduce(
          (acc, section) => ({
            duration: acc.duration + (section.summary?.duration ?? 0),
            length: acc.length + (section.summary?.length ?? 0),
          }),
          { duration: 0, length: 0 },
        ),
      },
    })
  }),
)
