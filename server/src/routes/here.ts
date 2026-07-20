import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth.js'
import { asyncHandler, HttpError } from '../http.js'
import { env } from '../env.js'
import { TtlCache, cachedAsync } from '../util/ttlCache.js'

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

// One screen-sampled snap candidate: a geo coordinate obtained by converting a
// pixel near the cursor back to lat/lng, tagged with `px` = its screen-pixel
// distance from the release point (0 = the exact release pixel). The candidate
// snap evaluates several of these so the stop lands on the road actually rendered
// under the cursor, not merely the nearest road to the single raw coordinate.
const screenCandidateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  px: z.number().min(0).max(100000),
})

const snapCandidatesSchema = z.object({
  candidates: z.array(screenCandidateSchema).min(1).max(40),
  // Current map zoom (logging/diagnostics only — `px` already carries scale).
  zoom: z.number().min(0).max(22).optional(),
  // Route travel heading here (deg) → direction-aware carriageway refinement.
  course: z.number().min(0).max(359).optional(),
  // The neighbouring waypoints of the leg this stop slots into, for detour-aware
  // ranking (prefer the candidate that adds least to prev→here→next).
  prev: coordinateSchema.optional(),
  next: coordinateSchema.optional(),
})

// ── HERE result caches ───────────────────────────────────────────────────────
// Roads don't move, so geocode/snap answers for (almost) the same coordinate are
// stable — but every drag-release fans out dozens of billable HERE calls, and
// users routinely re-drag over the same stretch of road. Cache each upstream
// lookup keyed on the coordinate ROUNDED to ~1 metre (5 decimals — well inside
// the tolerance of a screen-pixel sample), so repeated snaps in the same area
// are served from memory. cachedAsync stores the in-flight PROMISE, which also
// dedupes the parallel per-pixel lookups of a single /snap/candidates request
// whose samples round to the same cell. Failures are never cached (see
// cachedAsync), so a HERE hiccup can't pin a bad answer for the TTL.
const GEO_TTL_MS = 6 * 60 * 60 * 1000 // street/snap geometry: very stable
const ROUTE_TTL_MS = 60 * 60 * 1000 // leg lengths: traffic-independent (routingMode base geometry), still refreshed hourly
const nearestStreetCache = new TtlCache<Promise<NearestStreetResult | null>>(10_000, GEO_TTL_MS)
const streetSnapCache = new TtlCache<Promise<SnapResult | null>>(5_000, GEO_TTL_MS)
const routeSnapCache = new TtlCache<Promise<HerePosition | null>>(10_000, GEO_TTL_MS)
const routeLengthCache = new TtlCache<Promise<number | null>>(5_000, ROUTE_TTL_MS)

// ~1.1 m grid — fine enough that snapping the rounded point is indistinguishable
// from snapping the raw one, coarse enough that re-drags over a spot hit.
const coordKey = (p: HerePosition) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`

// Courses within the same 10° bucket share a cache entry: carriageway selection
// only needs the broad direction of travel (opposite carriageways differ by
// ~180°), so a few degrees of drift must not force a fresh billable call.
const courseKey = (course: number | undefined) =>
  course === undefined ? 'x' : String(Math.round(course / 10) * 10 % 360)

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
// from common motorway / expressway / trunk-road naming across European + English
// locales. Critically this must cover CENTRAL/EASTERN Europe too — the symptom
// that motivated widening it was a Czech "D1" (Dálnice) motorway being treated as
// a minor road, so a closer local lane won the snap.
//   • Designations: A1 (DE/FR/IT/PL/HU/RO), M1 (HU/UK), E50 (Euroroute),
//     D1 (CZ/SK), S8 (PL expressway), R1 (SK expressway), B27 (DE), SS1 (IT),
//     N10 (FR/BE).
//   • Words: dálnice/diaľnica (CZ/SK), autópálya (HU), autostrada (PL/IT),
//     autobahn, autoroute, autovía, autopista, motorway, freeway, expressway,
//     highway, snelweg, bundesstraße, trunk, ring road, tangenziale, périph,
//     droga ekspresowa / szybkiego ruchu (PL).
// A true road-class signal would need HERE routing spans (functionalClass), which
// aren't available for a single reverse-geocode snap.
const MAJOR_ROAD_RE =
  /\b([AMESDR]\s?\d+|B\s?\d{2,}|SS\s?\d+|N\s?\d{2,})\b|d[aá]lnice|dia[lľ]nica|autostr|autobahn|autoroute|autov[ií]a|autopista|autop[aá]ly|motorway|freeway|expressway|highway|snelweg|bundesstra|\btrunk\b|ring\s?road|tangenziale|p[ée]riph|ekspresow|szybkiego/i

function isMajorRoad(item: HereRevgeocodeItem): boolean {
  const name = `${item.address?.street ?? ''} ${item.title ?? ''}`.trim()
  return name.length > 0 && MAJOR_ROAD_RE.test(name)
}

// Opt-in snap tracing: set ROUTE_SNAP_DEBUG=1 to log the candidate roads, their
// distance/major/score, and the chosen one for each street snap. Off by default.
const SNAP_DEBUG = process.env.ROUTE_SNAP_DEBUG === '1'

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
// the visible map — not a fixed metric distance. A touch generous so an imprecise
// zoomed-out release (where 1px can be a kilometre) still reaches the motorway it
// was aimed at.
const SNAP_PIXEL_TOLERANCE = 18

// HERE Reverse Geocode used as a road-snap: resolve a coordinate to the best
// nearby STREET. Returns many nearby street candidates and scores them by
// distance with a preference for major roads that STRENGTHENS as the map zooms
// out — because when zoomed out the release is imprecise and the user can only
// realistically be aiming at the big visible roads. Returns null when HERE has no
// street result. Cached per (coordinate cell, integer zoom) — zoom is part of
// the key because both the snap radius and the major-road preference scale with it.
async function streetSnap(apiKey: string, at: HerePosition, zoom: number): Promise<SnapResult | null> {
  return cachedAsync(streetSnapCache, `${coordKey(at)}:z${Math.round(zoom)}`, () =>
    fetchStreetSnap(apiKey, at, zoom),
  )
}

async function fetchStreetSnap(apiKey: string, at: HerePosition, zoom: number): Promise<SnapResult | null> {
  // "Zoomed-out-ness" in [0,1]: 0 at zoom ≥13 (precise), 1 at zoom ≤7 (only big
  // roads visible/aimable).
  const out = Math.max(0, Math.min(1, (13 - zoom) / 6))
  // Visible-scale radius: SNAP_PIXEL_TOLERANCE pixels of ground distance at this
  // zoom, clamped so it's never absurdly tight or wide. The wider cap (6 km) lets
  // a fully zoomed-out release still reach a motorway a few km off.
  const maxSnapMeters = Math.max(40, Math.min(metresPerPixel(at.lat, zoom) * SNAP_PIXEL_TOLERANCE, 6000))
  // Major-road score multiplier: a major road's distance counts as this fraction
  // when comparing candidates. 0.7 zoomed in (mild — distance dominates, so you
  // can still drop on a specific minor road) → ~0.22 zoomed out (a motorway up to
  // ~4.5× farther than the nearest local lane still wins). This is the lever that
  // makes a zoomed-out drag land on the visible motorway, not a closer field lane.
  const majorFactor = 0.7 - 0.48 * out

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
    const score = dist * (isMajorRoad(item) ? majorFactor : 1)
    if (!best || score < best.score) best = { item, score }
  }

  const chosen = best?.item ?? nearest?.item
  if (!chosen?.position) return null

  if (SNAP_DEBUG) {
    const rows = candidates
      .map((i) => {
        const d = i.distance ?? metersBetween(at, i.position)
        const major = isMajorRoad(i)
        return { name: i.address?.street ?? i.title ?? '?', d: Math.round(d), major, score: Math.round(d * (major ? majorFactor : 1)) }
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 8)
    console.log('[snap] streetSnap', { zoom, out: out.toFixed(2), maxSnapMeters: Math.round(maxSnapMeters), majorFactor: majorFactor.toFixed(2), chosen: chosen.address?.street ?? chosen.title, candidates: rows })
  }

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
    // The catch stays OUTSIDE the cache: a resolved null ("nothing routable
    // here") is a real, cacheable answer, while a thrown HERE failure is
    // evicted by cachedAsync so the next call retries upstream.
    return await cachedAsync(routeSnapCache, `${coordKey(at)}:c${courseKey(course)}`, () =>
      fetchRouteSnap(apiKey, at, course),
    )
  } catch {
    // Unroutable spot, HERE error, malformed response → let the caller fall back.
    return null
  }
}

async function fetchRouteSnap(apiKey: string, at: HerePosition, course?: number): Promise<HerePosition | null> {
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
}

// The single NEAREST street to a point (reverse geocode, limit 1), with its name
// (for grouping), label, snapped position, distance and major-road flag. This is
// the per-pixel probe behind the screen-space candidate snap: one call per
// sampled candidate, run in parallel. Returns null when HERE has no street there.
// THROWS on a HERE failure (unlike before, which swallowed it) so cachedAsync
// never caches a transient error as "no street" — the /snap/candidates caller
// catches per-candidate and degrades to null exactly as it used to. Caching the
// promise also dedupes the parallel samples of one request that round to the
// same ~1 m cell.
type NearestStreetResult = {
  name: string
  label: string
  pos: HerePosition
  dist: number
  major: boolean
}

async function nearestStreet(apiKey: string, at: HerePosition): Promise<NearestStreetResult | null> {
  return cachedAsync(nearestStreetCache, coordKey(at), async () => {
    const url = new URL(revgeocodeBase)
    url.searchParams.set('apiKey', apiKey)
    url.searchParams.set('at', `${at.lat},${at.lng}`)
    url.searchParams.set('lang', 'en-US')
    url.searchParams.set('limit', '1')
    url.searchParams.set('types', 'street')
    const data = await hereJson<HereRevgeocodeResponse>(url)
    const item = data?.items?.find((i) => i.position)
    if (!item?.position) return null
    return {
      name: (item.address?.street ?? item.title ?? '').trim(),
      label: item.address?.label ?? item.title ?? '',
      pos: item.position,
      dist: item.distance ?? metersBetween(at, item.position),
      major: isMajorRoad(item),
    }
  })
}

// Total length (metres) of a CAR route origin→(via)→destination, or null on
// failure. Used only as a RELATIVE detour signal when ranking snap candidates
// (how much does routing through this candidate lengthen the leg?), so car/fast
// — cheaper and more permissive than truck — is exactly right here.
async function routeLength(
  apiKey: string,
  origin: HerePosition,
  via: HerePosition[],
  destination: HerePosition,
): Promise<number | null> {
  try {
    // Same pattern as routeSnap: cache resolved lengths (keyed on the full
    // waypoint sequence), never cache a thrown HERE failure.
    const key = [origin, ...via, destination].map(coordKey).join('|')
    return await cachedAsync(routeLengthCache, key, () =>
      fetchRouteLength(apiKey, origin, via, destination),
    )
  } catch {
    return null
  }
}

async function fetchRouteLength(
  apiKey: string,
  origin: HerePosition,
  via: HerePosition[],
  destination: HerePosition,
): Promise<number | null> {
  const url = new URL(routeBase)
  url.searchParams.set('apiKey', apiKey)
  url.searchParams.set('transportMode', 'car')
  url.searchParams.set('routingMode', 'fast')
  url.searchParams.set('origin', `${origin.lat},${origin.lng}`)
  url.searchParams.set('destination', `${destination.lat},${destination.lng}`)
  for (const v of via) url.searchParams.append('via', `${v.lat},${v.lng}`)
  url.searchParams.set('return', 'summary')
  const data = await hereJson<HereRouteResponse>(url)
  const secs = data.routes?.[0]?.sections
  if (!secs?.length) return null
  return secs.reduce((acc, s) => acc + (s.summary?.length ?? 0), 0)
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

// ── Screen-space candidate scoring weights (see /snap/candidates) ────────────
// All expressed in "screen-pixel equivalents" so they trade off directly against
// each candidate road's closest sampled pixel (minPx).
//   VOTE_WEIGHT  — each EXTRA sampled pixel that landed on a road counts as this
//                  many px closer. Votes ≈ how much of the cursor's neighbourhood
//                  the road covers on screen = its visual prominence. This is the
//                  signal that makes a wide visible highway beat a thin parallel
//                  lane that happens to sit a hair nearer the exact release pixel.
//   MAJOR_BONUS  — a major/through road counts as this many px closer (a mild
//                  class preference on top of the prominence vote).
//   DETOUR_WEIGHT— score added per KM a candidate lengthens prev→here→next, so a
//                  parallel road that would force a U-turn/detour loses.
const VOTE_WEIGHT = 2
const MAJOR_BONUS = 14
const DETOUR_WEIGHT = 6

// ── POST /api/here/snap/candidates ───────────────────────────────────────────
// The screen-space road-snap. The client samples the pixels around the cursor,
// converts each to lat/lng, and posts them here (first = the exact release
// pixel). We snap EACH to its nearest road in parallel, group the results by
// road, and pick the road that is (a) closest to the cursor in screen space,
// (b) most prominent (the most sampled pixels fell on it), and (c) ideally a
// major/through road — i.e. the road the user actually SEES under the cursor,
// not just the nearest road to one raw coordinate. An optional detour check
// across the top roads (prev→here→next length) and a direction-aware routing
// refinement (correct carriageway) finish the choice. `place` is null only when
// nothing routable is near any candidate, so the client keeps the raw point.
hereRouter.post(
  '/snap/candidates',
  asyncHandler(async (req, res) => {
    const apiKey = requireHereKey()
    const body = snapCandidatesSchema.parse(req.body)
    const course = body.course
    const center = body.candidates[0]

    // 1) Snap EVERY sampled pixel to its nearest road, in parallel. Pixels that
    //    landed on the visible highway snap onto it; pixels over a field/parallel
    //    lane snap there — so the full set captures every road near the cursor.
    const snaps = (
      await Promise.all(
        body.candidates.map(async (c) => {
          // A single failed probe degrades to "no road at this pixel" rather
          // than failing the whole snap (nearestStreet throws on HERE errors
          // so they're never cached — see its comment).
          const s = await nearestStreet(apiKey, { lat: c.lat, lng: c.lng }).catch(() => null)
          return s ? { ...s, px: c.px } : null
        }),
      )
    ).filter((s): s is NonNullable<typeof s> => Boolean(s))

    // No road near ANY sample → guarantee an on-road point from the release via
    // routing, else hand back null so the client keeps the raw coordinate.
    if (snaps.length === 0) {
      const routed = await routeSnap(apiKey, { lat: center.lat, lng: center.lng }, course)
      return res.json({ place: routed ? { label: '', position: routed, major: false } : null })
    }

    // 2) Group snaps by road (street name; position-cluster fallback when a road
    //    has no name). votes = how many sampled pixels hit the road; the closest
    //    sampled pixel to the cursor gives the road's best on-road point.
    type Group = { key: string; label: string; pos: HerePosition; minPx: number; votes: number; major: boolean }
    const groups = new Map<string, Group>()
    for (const s of snaps) {
      const key = s.name
        ? s.name.toLowerCase().replace(/\s+/g, ' ')
        : `@${s.pos.lat.toFixed(3)},${s.pos.lng.toFixed(3)}`
      const g = groups.get(key)
      if (!g) {
        groups.set(key, { key, label: s.label, pos: s.pos, minPx: s.px, votes: 1, major: s.major })
      } else {
        g.votes += 1
        g.major = g.major || s.major
        if (s.px < g.minPx) {
          g.minPx = s.px
          g.pos = s.pos
          g.label = s.label
        }
      }
    }

    // 3) Score (lower = better): the closest sampled pixel dominates, then visual
    //    prominence (votes) and major-road class pull toward the big visible road.
    const scored = [...groups.values()]
      .map((g) => ({ g, score: g.minPx - VOTE_WEIGHT * (g.votes - 1) - (g.major ? MAJOR_BONUS : 0) }))
      .sort((a, b) => a.score - b.score)

    // 4) Detour-aware tiebreaker across the top roads: prefer the one that adds
    //    the least to prev→here→next (so a parallel carriageway that forces a big
    //    detour/U-turn loses). Bounded to the top 3, run in parallel, and purely
    //    additive — a routing hiccup just leaves the screen-space ranking intact.
    const prev = body.prev
    const next = body.next
    let ranked = scored
    if (prev && next && scored.length >= 2) {
      const top = scored.slice(0, 3)
      const [base, ...lens] = await Promise.all([
        routeLength(apiKey, prev, [], next),
        ...top.map((s) => routeLength(apiKey, prev, [s.g.pos], next)),
      ])
      if (base != null) {
        const withDetour = top
          .map((s, i) => {
            const added = lens[i] != null ? Math.max(0, (lens[i] as number) - base) : 0
            return { g: s.g, score: s.score + DETOUR_WEIGHT * (added / 1000) }
          })
          .sort((a, b) => a.score - b.score)
        ranked = [...withDetour, ...scored.slice(3)]
      }
    }

    const chosen = ranked[0].g

    // 5) Direction-aware refinement: pull the chosen point onto a real ROUTABLE
    //    centreline and, when a travel direction is known, the correct
    //    carriageway — but only when that stays near the chosen road (no jump).
    let position = chosen.pos
    if (course !== undefined) {
      const routed = await routeSnap(apiKey, chosen.pos, course)
      if (routed && metersBetween(routed, chosen.pos) <= DIRECTION_REFINE_METERS) position = routed
    } else {
      const routed = await routeSnap(apiKey, chosen.pos)
      if (routed && metersBetween(routed, chosen.pos) <= ROUTE_REFINE_METERS) position = routed
    }

    if (SNAP_DEBUG) {
      console.log('[snap] candidates', {
        zoom: body.zoom,
        course,
        samples: snaps.length,
        groups: scored.map((s) => ({
          road: s.g.key,
          votes: s.g.votes,
          minPx: s.g.minPx,
          major: s.g.major,
          score: Math.round(s.score),
        })),
        chosen: chosen.key,
        position,
      })
    }

    res.json({ place: { label: chosen.label, position, major: chosen.major } })
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
