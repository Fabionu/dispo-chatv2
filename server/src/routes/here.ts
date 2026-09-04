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

type HereMoney = {
  type?: string
  currency?: string
  value?: number
}

type HereTollFare = {
  id?: string
  name?: string
  price?: HereMoney
  convertedPrice?: HereMoney
  reason?: string
  paymentMethods?: Array<string | { type?: string }>
}

type HereToll = {
  countryCode?: string
  tollSystem?: string
  fares?: HereTollFare[]
}

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
        tolls?: { total?: HereMoney }
      }
      tolls?: HereToll[]
      // Returned only when the request asks for `spans`. A span is a stretch of
      // the section's polyline over which the requested attributes hold; with
      // `countryCode` the boundaries are border crossings.
      spans?: Array<{
        offset?: number
        length?: number
        duration?: number
        countryCode?: string
      }>
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
  // Toll data is deliberately opt-in: HERE counts a route request containing
  // `tolls` as an additional transaction, so map-drag recalculations stay on
  // the lighter geometry-only request and the explicit button enables it.
  includeTolls: z.boolean().optional(),
  currency: z.string().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()).optional(),
  departureTime: z.literal('any').optional(),
})

// One continuous stretch of the route inside a single country, in route order.
// `code` is HERE's ISO 3166-1 ALPHA-3 (ROU, HUN, ITA) — note that the rest of
// the app carries alpha-2 country codes on trip stops, so anything joining the
// two has to convert rather than compare.
type CountryLeg = { code: string; duration: number; length: number }

// Collapse HERE's country spans into one leg per country entered.
//
// Spans are per-SECTION and split on every attribute change, so a single
// country routinely arrives as several consecutive spans, and a section
// boundary (one per `via` stop) falls in the middle of a country whenever the
// stop is not itself at a border. Merging across both is the whole job: what a
// restriction calculation needs is "the truck is in Croatia for 3h29", not
// forty span rows.
//
// A country the route RE-ENTERS keeps its own leg — driving DE → AT → DE is
// three legs, not two, because the times matter separately. Only ADJACENT
// same-country spans merge.
function normalizeCountryLegs(
  sections: NonNullable<NonNullable<HereRouteResponse['routes']>[number]['sections']>,
): CountryLeg[] {
  const legs: CountryLeg[] = []
  for (const section of sections) {
    for (const span of section.spans ?? []) {
      const code = span.countryCode
      if (!code) continue
      const duration = typeof span.duration === 'number' ? span.duration : 0
      const length = typeof span.length === 'number' ? span.length : 0
      const last = legs[legs.length - 1]
      if (last && last.code === code) {
        last.duration += duration
        last.length += length
      } else {
        legs.push({ code, duration, length })
      }
    }
  }
  return legs
}

type NormalizedMoney = { currency: string; value: number }

function normalizeMoney(value: HereMoney | undefined): NormalizedMoney | null {
  if (!value?.currency || typeof value.value !== 'number' || !Number.isFinite(value.value)) return null
  return { currency: value.currency.toUpperCase(), value: value.value }
}

function normalizeTolls(
  sections: NonNullable<NonNullable<HereRouteResponse['routes']>[number]['sections']>,
  requestedCurrency: string,
) {
  // HERE may repeat a fare when a multi-leg route crosses a section boundary.
  // Fare ids are the stable dedupe key recommended by HERE for that case.
  const seenFareIds = new Set<string>()
  const seenSectionFareSets = new Set<string>()
  const details: Array<{
    countryCode?: string
    tollSystem?: string
    fares: Array<{
      id?: string
      name?: string
      price?: NormalizedMoney
      convertedPrice?: NormalizedMoney
      reason?: string
      paymentMethods: string[]
    }>
  }> = []

  let totalValue = 0
  let hasTotal = false

  for (const section of sections) {
    const sectionFareIds = (section.tolls ?? [])
      .flatMap((toll) => toll.fares ?? [])
      .map((fare) => fare.id)
      .filter((id): id is string => Boolean(id))
    const sectionSignature = [...new Set(sectionFareIds)].sort().join('|')
    const sectionTotal = normalizeMoney(section.summary?.tolls?.total)

    // If the exact same non-empty fare set is repeated on a later section, its
    // section total is repeated as well and must not be counted twice.
    const repeatedSection = Boolean(sectionSignature && seenSectionFareSets.has(sectionSignature))
    if (sectionSignature) seenSectionFareSets.add(sectionSignature)
    if (sectionTotal && !repeatedSection) {
      totalValue += sectionTotal.value
      hasTotal = true
    }

    for (const toll of section.tolls ?? []) {
      const fares = (toll.fares ?? []).flatMap((fare) => {
        if (fare.id && seenFareIds.has(fare.id)) return []
        if (fare.id) seenFareIds.add(fare.id)

        const price = normalizeMoney(fare.price)
        const convertedPrice = normalizeMoney(fare.convertedPrice)
        const paymentMethods = (fare.paymentMethods ?? [])
          .map((method) => (typeof method === 'string' ? method : method.type))
          .filter((method): method is string => Boolean(method))

        return [{
          id: fare.id,
          name: fare.name,
          ...(price ? { price } : {}),
          ...(convertedPrice ? { convertedPrice } : {}),
          reason: fare.reason,
          paymentMethods,
        }]
      })
      if (fares.length > 0) {
        details.push({ countryCode: toll.countryCode, tollSystem: toll.tollSystem, fares })
      }
    }
  }

  const unavailable = sections.some((section) =>
    (section.notices ?? []).some((notice) => {
      const code = notice.code?.toLowerCase() ?? ''
      return code.includes('tollsdataunavailable') || code.includes('currencyunsupported')
    }),
  )

  if (unavailable) return { status: 'unavailable' as const, total: null, details }
  if (!hasTotal && details.length > 0) return { status: 'available' as const, total: null, details }

  const total = {
    currency: requestedCurrency,
    value: Number(totalValue.toFixed(2)),
  }
  return {
    status: total.value > 0 ? 'available' as const : 'none' as const,
    total,
    details,
  }
}

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
const nearbyStreetsCache = new TtlCache<Promise<StreetCandidate[]>>(10_000, GEO_TTL_MS)
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

// Heuristic road importance from the street name / title. HERE Reverse Geocode
// does NOT expose functional class, so we approximate it from common motorway /
// expressway / trunk-road naming across European + English locales. Critically
// this must cover CENTRAL/EASTERN Europe too — the symptom that motivated
// widening it was a Czech "D1" (Dálnice) motorway being treated as a minor road,
// so a closer local lane won the snap.
//
// Two tiers rather than one flag, because "is this bigger than that?" is the
// question the zoomed-out snap actually has to answer: releasing beside a
// motorway that runs past a Staatsstraße must land on the MOTORWAY, and a single
// "major" bucket holding both cannot say which. A true road-class signal would
// need HERE routing spans (functionalClass), unavailable for a reverse geocode.
//   • Motorway grade: A1 (DE/FR/IT/PL/HU/RO), D1 (CZ/SK), M1 (HU/UK),
//     E50 (Euroroute); dálnice/diaľnica, autópálya, autostrada, autobahn,
//     autoroute, autovía, autopista, motorway/freeway/expressway, snelweg,
//     droga ekspresowa / szybkiego ruchu.
//   • Through road: S8 (PL), R1 (SK), N10 (FR/BE), B27 (DE), SS1 (IT),
//     Bundesstraße, trunk, ring road, tangenziale, périphérique, "… Highway".
// (A designation letter can mean different classes in different countries — a
// French D road is departmental, a Czech D road is a motorway — and a reverse
// geocode alone can't disambiguate. Ranking them together as motorway grade is
// what the old single "major" bucket already did.)
const MOTORWAY_ROAD_RE =
  /\b([ADME]\s?\d+)\b|d[aá]lnice|dia[lľ]nica|autostr|autobahn|autoroute|autov[ií]a|autopista|autop[aá]ly|motorway|freeway|expressway|snelweg|ekspresow|szybkiego/i
const THROUGH_ROAD_RE =
  /\b([SRN]\s?\d+|B\s?\d{2,}|SS\s?\d+)\b|bundesstra|\btrunk\b|ring\s?road|tangenziale|p[ée]riph|highway/i

/** 2 = motorway grade, 1 = other through road, 0 = ordinary street. */
function roadTier(item: HereRevgeocodeItem): 0 | 1 | 2 {
  const name = `${item.address?.street ?? ''} ${item.title ?? ''}`.trim()
  if (name.length === 0) return 0
  if (MOTORWAY_ROAD_RE.test(name)) return 2
  if (THROUGH_ROAD_RE.test(name)) return 1
  return 0
}

function isMajorRoad(item: HereRevgeocodeItem): boolean {
  return roadTier(item) > 0
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
  // Guarded so a near-polar latitude can't collapse the scale to zero and make
  // every pixel distance infinite.
  return Math.max(0.01, (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom)
}

// "Zoomed-out-ness" in [0,1]: 0 at zoom >= 13 (a precise release, every side
// street is drawn and aimable), 1 at zoom <= 7 (only the big through roads are
// drawn at all, so only they can be what the user pointed at).
function zoomedOutFactor(zoom: number): number {
  return Math.max(0, Math.min(1, (13 - zoom) / 6))
}

// Major-road score multiplier: a major road's distance from the cursor counts as
// this fraction when comparing candidates. 0.7 zoomed in (mild — distance
// dominates, so you can still drop on a specific minor road) → ~0.22 zoomed out
// (a motorway up to ~4.5x farther than the nearest local lane still wins). This
// is the lever that makes a zoomed-out release land on the visible motorway
// rather than a closer field lane.
function majorRoadFactor(zoom: number): number {
  return 0.7 - 0.48 * zoomedOutFactor(zoom)
}

// How many streets each reverse-geocode probe asks for. Both snap paths want the
// roads AROUND a point, not the single nearest one: zoomed out the nearest road
// to the released pixel is routinely a field lane, while the motorway the user
// was aiming at is third or tenth in the list.
const STREET_LOOKUP_LIMIT = 20

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
  const out = zoomedOutFactor(zoom)
  // Visible-scale radius: SNAP_PIXEL_TOLERANCE pixels of ground distance at this
  // zoom, clamped so it's never absurdly tight or wide. The wider cap (6 km) lets
  // a fully zoomed-out release still reach a motorway a few km off.
  const maxSnapMeters = Math.max(40, Math.min(metresPerPixel(at.lat, zoom) * SNAP_PIXEL_TOLERANCE, 6000))
  const majorFactor = majorRoadFactor(zoom)

  const url = new URL(revgeocodeBase)
  url.searchParams.set('apiKey', apiKey)
  url.searchParams.set('at', `${at.lat},${at.lng}`)
  url.searchParams.set('lang', 'en-US')
  // Ask for many nearby streets so HERE effectively samples every road around the
  // release — we then choose among them rather than trusting the single nearest.
  url.searchParams.set('limit', String(STREET_LOOKUP_LIMIT))
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

// The streets AROUND a point (reverse geocode, nearest first) — each with its
// name (for grouping), label, position and major-road flag. This is the
// per-pixel probe behind the screen-space candidate snap: one call per sampled
// candidate, run in parallel.
//
// It asks for STREET_LOOKUP_LIMIT streets rather than the single nearest one,
// which is the difference between "the road under the cursor" and "the road
// nearest one raw coordinate". Zoomed out a screen pixel spans a kilometre, so
// the release inevitably lands a few hundred metres BESIDE the motorway it was
// aimed at — with a limit of 1 every probe answered with whatever village lane
// or field track happened to be closer and the motorway never entered the
// candidate pool at all. Returns [] when HERE has no street there.
// THROWS on a HERE failure so cachedAsync never caches a transient error as
// "no street" — the /snap/candidates caller catches per-candidate and degrades
// to an empty list. Caching the promise also dedupes the parallel samples of one
// request that round to the same ~1 m cell.
type StreetCandidate = {
  name: string
  label: string
  pos: HerePosition
  tier: 0 | 1 | 2
}

async function nearbyStreets(apiKey: string, at: HerePosition): Promise<StreetCandidate[]> {
  return cachedAsync(nearbyStreetsCache, coordKey(at), async () => {
    const url = new URL(revgeocodeBase)
    url.searchParams.set('apiKey', apiKey)
    url.searchParams.set('at', `${at.lat},${at.lng}`)
    url.searchParams.set('lang', 'en-US')
    url.searchParams.set('limit', String(STREET_LOOKUP_LIMIT))
    url.searchParams.set('types', 'street')
    const data = await hereJson<HereRevgeocodeResponse>(url)
    return (data?.items ?? [])
      .filter((i): i is HereRevgeocodeItem & { position: HerePosition } => Boolean(i.position))
      .map((i) => ({
        name: (i.address?.street ?? i.title ?? '').trim(),
        label: i.address?.label ?? i.title ?? '',
        pos: i.position,
        tier: roadTier(i),
      }))
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

// ── Screen-space candidate scoring (see /snap/candidates) ────────────────────
// Scores are SCREEN PIXELS at the release zoom, because "how far from my cursor
// is this road drawn?" is the question the user is actually asking — and the
// answer changes completely with zoom. Zoomed out, a motorway 1.5 km away and a
// farm track 8 m away are BOTH under the cursor (0.01 px vs 2 px at 750 m/px):
// distance cannot separate them, and it is the drawn width of the line the user
// aimed at that decides. Zoomed in, the same 1.5 km is a kilometre off screen.
//
//   AIM_TOLERANCE_PX — the release is this many pixels of aim slop (cursor
//                  precision + the drawn width of a route line) away from what
//                  the user meant. Every road inside that window is equally
//                  "under the cursor", so the BIGGEST one there wins; only
//                  outside it does distance start deciding again. Also capped in
//                  ground distance (AIM_TOLERANCE_METERS), so a fully zoomed-out
//                  release can't reach a motorway in the next province.
//   CLASS_PENALTY_PX — a road's handicap by tier, in pixels, applied inside the
//                  aim window. Scaled down zoomed in (where a precise release
//                  really does mean the specific side street it landed on) and up
//                  zoomed out (where the roads it outranks aren't drawn at all).
//   TIE_BREAK_PX — a whisper of distance so two roads of the same tier inside the
//                  window are separated by which is nearer, never by map order.
//   MAX_SNAP_PIXELS — a road drawn further than this from the release was not the
//                  one under the cursor. Ignored when nothing is in range, so a
//                  release over open country still lands on a road.
//   DETOUR_WEIGHT/DETOUR_MAX_PX — score added per KM a candidate lengthens
//                  prev→here→next, so a parallel road that would force a U-turn
//                  loses. Deliberately small and hard-capped BELOW the smallest
//                  class gap: routing via a point costs a whole junction-to-
//                  junction round trip when HERE picks the far carriageway, which
//                  is a ~17 km penalty on a motorway and a ~0 km one on the field
//                  lane beside it. Left unbounded it doesn't rank the roads, it
//                  systematically rejects the big ones. So it may order equals —
//                  never overrule which road the user pointed at.
const AIM_TOLERANCE_PX = 6
const AIM_TOLERANCE_METERS = 5000
const CLASS_PENALTY_PX: Record<0 | 1 | 2, number> = { 0: 9, 1: 4, 2: 0 }
const TIE_BREAK_PX = 0.01
const MAX_SNAP_PIXELS = 40
const DETOUR_WEIGHT = 0.5
const DETOUR_MAX_PX = 1.5

// ── POST /api/here/snap/candidates ───────────────────────────────────────────
// The screen-space road-snap. The client samples the pixels around the cursor,
// converts each to lat/lng, and posts them here (first = the exact release
// pixel). We look up the roads around EVERY sample in parallel, pool them, and
// pick the road the user was POINTING AT: within the aim window (a few pixels of
// cursor slop) the biggest road wins, and only outside it does distance take over
// — so a motorway two pixels away beats the field lane under the cursor when the
// map is zoomed out, and a precise release still lands on the side street it was
// dropped on. An optional detour check across the top roads
// (prev→here→next length) and a direction-aware routing refinement (correct
// carriageway) finish the choice. `place` is null only when nothing routable
// is near any candidate, so the client keeps the raw point.
hereRouter.post(
  '/snap/candidates',
  asyncHandler(async (req, res) => {
    const apiKey = requireHereKey()
    const body = snapCandidatesSchema.parse(req.body)
    const course = body.course
    const release = body.candidates[0]
    // Zoom is what turns metres back into what the user SAW: the same 300 m gap
    // is half a screen zoomed in and a fifth of a pixel zoomed out.
    const zoom = body.zoom ?? 18
    const mpp = metresPerPixel(release.lat, zoom)
    // The window the release could plausibly have meant, and how hard a smaller
    // road is handicapped inside it.
    const aimPx = Math.min(AIM_TOLERANCE_PX, AIM_TOLERANCE_METERS / mpp)
    // The class handicap has to REACH ZERO when zoomed in, not floor at 0.45.
    // It used to, and the arithmetic was the bug the user hit: a tier-0 road
    // carried 9 * 0.45 = 4.05px of handicap even at zoom 18, and with a 6px aim
    // window that let a bigger road up to ~10px away beat the road exactly
    // under the cursor — about 12 metres at zoom 17. A release that precise IS
    // the answer to which road was meant, so nothing should outrank it. The
    // zoomed-out end is untouched (1.0 at zoom <= 7): out there the small roads
    // genuinely aren't drawn, which is what the preference is for.
    const classScale = 0.12 + 0.88 * zoomedOutFactor(zoom)

    // 1) Look up the roads around EVERY sampled pixel, in parallel. Each probe
    //    returns its whole neighbourhood rather than just its nearest road, so
    //    the pool holds every road near the cursor — including the motorway that
    //    is the nearest road to none of the sampled pixels.
    const probes = await Promise.all(
      body.candidates.map((c) =>
        // A single failed probe degrades to "no roads at this pixel" rather than
        // failing the whole snap (nearbyStreets throws on HERE errors so they're
        // never cached — see its comment).
        nearbyStreets(apiKey, { lat: c.lat, lng: c.lng }).catch(() => [] as StreetCandidate[]),
      ),
    )
    const streets = probes.flat()

    // No road near ANY sample → guarantee an on-road point from the release via
    // routing, else hand back null so the client keeps the raw coordinate.
    if (streets.length === 0) {
      const routed = await routeSnap(apiKey, { lat: release.lat, lng: release.lng }, course)
      return res.json({ place: routed ? { label: '', position: routed, major: false } : null })
    }

    // 2) Group by road (street name; position-cluster fallback when a road has no
    //    name). A long road is probed at several points along it, so keep the one
    //    CLOSEST TO THE RELEASE — that is the point on that road the user pointed
    //    at, and the only one worth measuring the road's distance by.
    type Group = { key: string; label: string; pos: HerePosition; meters: number; votes: number; tier: 0 | 1 | 2 }
    const groups = new Map<string, Group>()
    for (const s of streets) {
      const key = s.name
        ? s.name.toLowerCase().replace(/\s+/g, ' ')
        : `@${s.pos.lat.toFixed(3)},${s.pos.lng.toFixed(3)}`
      const meters = metersBetween(release, s.pos)
      const g = groups.get(key)
      if (!g) {
        groups.set(key, { key, label: s.label, pos: s.pos, meters, votes: 1, tier: s.tier })
      } else {
        g.votes += 1
        if (s.tier > g.tier) g.tier = s.tier
        if (meters < g.meters) {
          g.meters = meters
          g.pos = s.pos
          g.label = s.label
        }
      }
    }

    // 3) Score (lower = better) in screen pixels. Distance only counts BEYOND the
    //    aim window — inside it every road is under the cursor and the road class
    //    decides, which is the whole zoomed-out case: a motorway 2 px away beats
    //    the farm track 0.01 px away, because at 750 m/px the user was pointing at
    //    the only line of the two that is drawn. Measuring each road's OWN
    //    position (not the offset of whichever sampled pixel found it) is what
    //    makes that comparison mean anything.
    const scored = [...groups.values()]
      .map((g) => {
        const px = g.meters / mpp
        const score =
          Math.max(0, px - aimPx) + CLASS_PENALTY_PX[g.tier] * classScale + px * TIE_BREAK_PX
        return { g, px, score }
      })
      .sort((a, b) => a.score - b.score)

    // Roads drawn well outside the cursor's neighbourhood weren't aimed at; the
    // NEAREST one stays as a fallback so open country still snaps to a road.
    const inRange = scored.filter((s) => s.px <= MAX_SNAP_PIXELS)
    const nearest = scored.reduce((a, b) => (b.px < a.px ? b : a))

    // 4) Detour-aware tiebreaker across the top roads: prefer the one that adds
    //    the least to prev→here→next (so a parallel carriageway that forces a big
    //    detour/U-turn loses). Bounded to the top 3, run in parallel, and purely
    //    additive — a routing hiccup just leaves the screen-space ranking intact.
    const prev = body.prev
    const next = body.next
    let ranked = inRange.length ? inRange : [nearest]
    if (prev && next && ranked.length >= 2) {
      const top = ranked.slice(0, 3)
      const [base, ...lens] = await Promise.all([
        routeLength(apiKey, prev, [], next),
        ...top.map((s) => routeLength(apiKey, prev, [s.g.pos], next)),
      ])
      if (base != null) {
        const withDetour = top
          .map((s, i) => {
            const added = lens[i] != null ? Math.max(0, (lens[i] as number) - base) : 0
            const detour = Math.min(DETOUR_MAX_PX, DETOUR_WEIGHT * (added / 1000))
            return { ...s, score: s.score + detour }
          })
          .sort((a, b) => a.score - b.score)
        ranked = [...withDetour, ...ranked.slice(3)]
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
        zoom,
        course,
        probes: body.candidates.length,
        streets: streets.length,
        mpp: Math.round(mpp),
        aimPx: aimPx.toFixed(2),
        groups: scored.slice(0, 8).map((s) => ({
          road: s.g.key,
          votes: s.g.votes,
          meters: Math.round(s.g.meters),
          px: Number(s.px.toFixed(2)),
          tier: s.g.tier,
          score: Number(s.score.toFixed(2)),
        })),
        chosen: chosen.key,
        position,
      })
    }

    res.json({ place: { label: chosen.label, position, major: chosen.tier > 0 } })
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
    const tollCurrency = body.currency ?? 'EUR'
    url.searchParams.set('return', body.includeTolls ? 'polyline,summary,tolls' : 'polyline,summary')
    // Country spans, for the restriction calculator: they are what say WHEN the
    // truck crosses each border, which is the input a driving-ban window is
    // evaluated against. Unlike `tolls`, spans do not make this a second billed
    // transaction — they annotate the polyline the request already returns — so
    // they ride along on every route, including the light map-drag recalcs.
    // Verified against the live API (alpha-3 codes, one span per attribute run).
    url.searchParams.set('spans', 'countryCode,duration,length')
    if (body.includeTolls) {
      url.searchParams.set('currency', tollCurrency)
      url.searchParams.set('tolls[summaries]', 'total')
      url.searchParams.set('departureTime', body.departureTime ?? 'any')
    }

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
        countries: normalizeCountryLegs(route.sections),
        ...(body.includeTolls ? { tolls: normalizeTolls(route.sections, tollCurrency) } : {}),
      },
    })
  }),
)
