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

// A resolved road-snap: a readable label, the snapped coordinate, and whether
// the chosen road looks like a major/through road.
type SnapResult = { label: string; position: HerePosition; major: boolean }

const AT_RE = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/

function parseAt(raw: unknown): HerePosition {
  const at = typeof raw === 'string' ? raw.trim() : ''
  if (!AT_RE.test(at)) throw new HttpError(400, 'invalid_at')
  const [lat, lng] = at.split(',').map(Number)
  return { lat, lng }
}

function parseZoom(raw: unknown): number {
  const z = typeof raw === 'string' ? Number(raw) : NaN
  // Absent → treat as zoomed-in (precise nearest snap) for back-compat.
  return Number.isFinite(z) ? Math.max(0, Math.min(20, z)) : 18
}

// Optional travel heading (deg, clockwise from north) the route runs at this
// point, normalised to [0,360). Absent → undefined (non-directional snap).
function parseCourse(raw: unknown): number | undefined {
  const c = typeof raw === 'string' ? Number(raw) : NaN
  return Number.isFinite(c) ? ((c % 360) + 360) % 360 : undefined
}

// Ground metres covered by ONE screen pixel at a Web-Mercator zoom level and
// latitude. Lets the snap radius track what the user can actually SEE: the road
// under the cursor sits within a few pixels of the release, which is a small
// distance zoomed in and a large one zoomed out.
function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
}

// Pixel radius around the release we treat as "the user was aiming here". The
// snap radius is this many pixels' worth of ground distance, so it scales with
// the visible map — not a fixed metric distance.
const SNAP_PIXEL_TOLERANCE = 16
// A major road counts as this fraction of its distance when scoring, so it wins
// ties and small gaps but NOT a far jump: a major must be within ~1/0.6 ≈ 1.67×
// the nearest road's distance to be chosen. Distance stays dominant — this is
// what stops a release from leaping onto a different, far-away highway.
const MAJOR_ROAD_DISCOUNT = 0.6

// HERE Reverse Geocode used as a road-snap: resolve a coordinate to the best
// nearby STREET. Returns several street candidates and picks the one closest to
// the release *on screen*, with only a mild preference for major roads — so the
// snap lands on the visible road under the cursor, upgrading to a highway only
// when one is right there. Returns null when HERE has no street result.
async function streetSnap(apiKey: string, at: HerePosition, zoom: number): Promise<SnapResult | null> {
  // Visible-scale radius: SNAP_PIXEL_TOLERANCE pixels of ground distance at this
  // zoom, clamped so it's never absurdly tight or wide.
  const maxSnapMeters = Math.max(40, Math.min(metresPerPixel(at.lat, zoom) * SNAP_PIXEL_TOLERANCE, 3500))

  const url = new URL(revgeocodeBase)
  url.searchParams.set('apiKey', apiKey)
  url.searchParams.set('at', `${at.lat},${at.lng}`)
  url.searchParams.set('lang', 'en-US')
  // Ask for many nearby streets so HERE effectively samples every road around the
  // release — we then choose among them rather than trusting the single nearest.
  url.searchParams.set('limit', '20')
  // Always snap to STREET geometry (the road centreline) rather than a house
  // number or POI entrance — a route waypoint belongs on the road.
  url.searchParams.set('types', 'street')

  const data = await hereJson<HereRevgeocodeResponse>(url)
  const candidates = (data.items ?? []).filter(
    (i): i is HereRevgeocodeItem & { position: HerePosition } => Boolean(i.position),
  )
  if (candidates.length === 0) return null

  // Score each candidate: lower is better, DISTANCE-DOMINANT. `effective =
  // distance × (major ? 0.6 : 1)` keeps the nearest road unless a major road is
  // only modestly farther. Candidates beyond the visible radius are dropped (but
  // we keep the raw nearest as a fallback so we never return null when HERE found
  // a road — better an on-road point than the raw field coordinate).
  let best: { item: HereRevgeocodeItem & { position: HerePosition }; score: number } | null = null
  let nearest: { item: HereRevgeocodeItem & { position: HerePosition }; dist: number } | null = null
  for (const item of candidates) {
    const dist = item.distance ?? metersBetween(at, item.position)
    if (!nearest || dist < nearest.dist) nearest = { item, dist }
    if (dist > maxSnapMeters) continue
    const score = dist * (isMajorRoad(item) ? MAJOR_ROAD_DISCOUNT : 1)
    if (!best || score < best.score) best = { item, score }
  }

  const chosen = best?.item ?? nearest?.item
  if (!chosen?.position) return null
  return {
    label: chosen.address?.label ?? chosen.title ?? '',
    position: chosen.position,
    major: isMajorRoad(chosen),
  }
}

// Move a coordinate `meters` along a compass `bearingDeg` (great-circle). Used
// to head the routeSnap probe in the route's travel direction so HERE matches
// the correct carriageway.
function offsetAlong(at: HerePosition, bearingDeg: number, meters: number): HerePosition {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const toDeg = (r: number) => (r * 180) / Math.PI
  const d = meters / R
  const t = toRad(bearingDeg)
  const lat1 = toRad(at.lat)
  const lng1 = toRad(at.lng)
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(t))
  const lng2 = lng1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
  return { lat: toDeg(lat2), lng: toDeg(lng2) }
}

// Routing-based snap: ask HERE Routing for a route that STARTS at the clicked
// point and use the road-snapped origin it returns (section[0].departure.place
// .location is the on-road coordinate; place.originalLocation is the raw input).
// This is the robust "is this even on a road?" check — it guarantees the point
// lands on a routable road rather than a field/yard. We route by car (the most
// permissive mode, so the snap succeeds widely) over a tiny offset so origin and
// destination differ; only the snapped ORIGIN is used. Returns null on any
// failure so callers can fall back. The subsequent truck-route recalc re-snaps
// every waypoint onto the actual truck route anyway.
//
// DIRECTION-AWARE: when `course` (the route's A→B heading here) is given, we tag
// the origin with `;course=` and aim the trivial route THAT way, so HERE matches
// the origin to the road link travelling in that direction — i.e. the correct
// carriageway of a divided road, not the opposite/contraflow side.
async function routeSnap(apiKey: string, at: HerePosition, course?: number): Promise<HerePosition | null> {
  try {
    const url = new URL(routeBase)
    url.searchParams.set('apiKey', apiKey)
    url.searchParams.set('transportMode', 'car')
    url.searchParams.set('routingMode', 'fast')
    const origin =
      course !== undefined ? `${at.lat},${at.lng};course=${Math.round(course)}` : `${at.lat},${at.lng}`
    // Destination: ~150 m ahead ALONG the course when known (reinforces the
    // direction), else the old fixed ~100 m NE offset. Only the snapped ORIGIN
    // is used; the destination just makes the pair a valid trivial route.
    const dest =
      course !== undefined ? offsetAlong(at, course, 150) : { lat: at.lat + 0.0009, lng: at.lng + 0.0009 }
    url.searchParams.set('origin', origin)
    url.searchParams.set('destination', `${dest.lat},${dest.lng}`)
    url.searchParams.set('return', 'summary')
    const data = await hereJson<HereRouteResponse>(url)
    const loc = data.routes?.[0]?.sections?.[0]?.departure?.place?.location
    return loc ?? null
  } catch {
    // Unroutable spot, HERE error, malformed response → let the caller fall back.
    return null
  }
}

// ── GET /api/here/revgeocode?at=lat,lng[&zoom=Z] ─────────────────────────
// Street-only reverse geocode (kept for label/lookup use). Returns
// { place: null } when HERE has no street result for the spot.
hereRouter.get(
  '/revgeocode',
  asyncHandler(async (req, res) => {
    const apiKey = requireHereKey()
    const at = parseAt(req.query.at)
    const zoom = parseZoom(req.query.zoom)
    const place = await streetSnap(apiKey, at, zoom)
    res.json({ place })
  }),
)

// Max metres a routing refinement may move a chosen STREET snap. routeSnap()
// snaps to the nearest routable road from a point; we only trust it to nudge a
// street snap onto its routable centreline, NOT to drag it onto a different
// (usually smaller) road — that guard is what stops a zoomed-out release from
// jumping off the intended main road onto a closer field track.
const ROUTE_REFINE_METERS = 70

// Max metres a DIRECTION-AWARE snap may move the point. Larger than the plain
// refinement so it can cross a divided road's median to the correct carriageway,
// but still bounded so it can't fly onto a different road entirely.
const DIRECTION_REFINE_METERS = 160

// ── GET /api/here/snap?at=lat,lng[&zoom=Z][&course=DEG] ──────────────────
// The CENTRAL road-snap every add/drag/release path uses. The STREET snap finds
// the road NEAREST the release within a zoom-scaled (visible-pixel) radius, with
// a mild major-road preference — so the point lands on the road the user sees
// under the cursor. Routing then keeps it on a real, ROUTABLE road AND, when a
// travel direction is known, on the correct carriageway:
//   • course given → routeSnap(at, course) matches the road link heading that
//     way (the route's A→B direction here). If that on-road point is within
//     DIRECTION_REFINE_METERS of the visible road, use it — this is what stops a
//     point landing on the opposite/contraflow carriageway of a divided road.
//   • otherwise → streetSnap refined by routeSnap(streetPos) within
//     ROUTE_REFINE_METERS (nearest routable road, no direction).
//   • no street → routeSnap(raw) on-road fallback; nothing routable → {place:null}
//     so the client keeps the raw coordinate.
hereRouter.get(
  '/snap',
  asyncHandler(async (req, res) => {
    const apiKey = requireHereKey()
    const at = parseAt(req.query.at)
    const zoom = parseZoom(req.query.zoom)
    const course = parseCourse(req.query.course)

    const street = await streetSnap(apiKey, at, zoom)

    // Direction-aware first: snap onto the carriageway travelling along `course`.
    // Accept it only when it stays near the visible road (same road, correct
    // side) rather than jumping to a different one.
    if (course !== undefined) {
      const routed = await routeSnap(apiKey, at, course)
      if (routed) {
        const ref = street?.position ?? at
        if (metersBetween(routed, ref) <= DIRECTION_REFINE_METERS) {
          return res.json({
            place: { label: street?.label ?? '', position: routed, major: street?.major ?? false },
          })
        }
      }
    }

    if (street) {
      // Refine the street snap onto its routable centreline, but only accept the
      // routed point when it stays close (don't jump roads).
      const routed = await routeSnap(apiKey, street.position)
      const position =
        routed && metersBetween(routed, street.position) <= ROUTE_REFINE_METERS
          ? routed
          : street.position
      return res.json({ place: { label: street.label, position, major: street.major } })
    }

    // No street found near the click — guarantee an on-road coordinate from the
    // raw point so a stop still lands on a road rather than in a field.
    const routed = await routeSnap(apiKey, at, course)
    if (routed) return res.json({ place: { label: '', position: routed, major: false } })

    // Nothing routable nearby — let the client keep the raw coordinate.
    res.json({ place: null })
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
