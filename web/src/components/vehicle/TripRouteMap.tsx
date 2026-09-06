import { useEffect, useMemo, useRef, useState } from 'react'
import { decode } from '@here/flexpolyline'
import { Check, Copy, MapPin, Pencil, Trash2, X } from 'lucide-react'
import Spinner from '../Spinner'
import HereMap from '../here/HereMap'
import { api } from '../../lib/api'
import { getSocket } from '../../lib/socket'
import {
  bestInsertionIndex,
  haversineMeters,
  nearestPointOnPath,
  routeCourseNear,
} from '../../lib/here/geo'
import { computeTripRoute, type TripRoute } from '../../lib/tripRoute'
import { parseCoordinates, stopId, type VehicleStop } from '../../lib/vehicleOps'
import {
  DRIVER_EXPIRE_MS,
  DRIVER_STALE_MS,
  driverLocationAgo,
  extendTrail,
  formatDistance,
  formatDuration,
  parseDriverLocationEvent,
  parseDriverLocations,
  parseDriverTrails,
  trackToTrailPoints,
  trailSegments,
  type DriverLocation,
  type DriverTrailPoint,
  type TripTrack,
} from '../../lib/driverLocation'
import type {
  DriverMapMarker,
  DriverMapTrail,
  LatLng,
  RouteMarker,
  RouteMarkerKind,
  ScreenGeoCandidate,
} from '../../lib/here/types'
import { MENU_CONTAINER, MENU_GLYPH, menuIconClass, menuItemClass } from '../menuStyles'

type Props = {
  // The active trip's stops — the route + markers derive from their coordinates.
  stops: VehicleStop[]
  // The trip's last-computed route (if any) — used to draw the line instantly
  // before a fresh recompute returns.
  route?: TripRoute
  // Live driver position wiring (vehicle rooms only). `groupId` subscribes the
  // map to the room's `driver:location` socket events; `tripId` scopes stored/
  // incoming positions to THIS trip (the canonical id — the room id for trips
  // created before trips had ids); `driverLocationsSeed` is the room's raw
  // `meta.driverLocations` blob, seeding "last known position" before the
  // first live ping arrives. All optional — omitted by other callers.
  groupId?: string
  tripId?: string
  driverLocationsSeed?: unknown
  // The room's raw `meta.driverTrails` blob — the path already driven, so a
  // dispatcher opening the room mid-trip sees the whole route so far rather
  // than only what arrives while they watch.
  driverTrailsSeed?: unknown
  // Whether the current user may edit the route. Gated by the caller on the same
  // "manage this group" permission the server enforces on save; false hides the
  // Edit button entirely (read-only map).
  canEdit?: boolean
  // Persist the edited stops + the freshly computed route onto the active trip.
  // Called ONLY with a valid ('ok') route (see save()). Rejects on failure — the
  // map then stays in edit mode and surfaces the error, so no changes are lost.
  onSaveRoute?: (editedStops: VehicleStop[], route: TripRoute) => Promise<void>
}

// A stop's routing coordinate: the parsed lat/lng when present, else parsed from
// the raw `coordinates` text. Mirrors routablePoints() so markers, the route
// preview, and the availability gate all read coordinates the same way.
function stopCoord(s: VehicleStop): { lat: number; lng: number } | null {
  if (typeof s.lat === 'number' && typeof s.lng === 'number') return { lat: s.lat, lng: s.lng }
  return s.coordinates ? parseCoordinates(s.coordinates) : null
}

// The routable stops (those with a usable coordinate) in order, tagged with their
// real stop id so a marker drag/click maps back to the exact stop.
function routableStops(stops: VehicleStop[]): { id: string; lat: number; lng: number }[] {
  const out: { id: string; lat: number; lng: number }[] = []
  for (const s of stops) {
    const c = stopCoord(s)
    if (c) out.push({ id: s.id, lat: c.lat, lng: c.lng })
  }
  return out
}

// Signature over the routable coordinates in order — changes exactly when the
// route geometry inputs change (a point moved, added, or removed), so it drives
// both recompute and the dirty check.
function coordSig(stops: VehicleStop[]): string {
  return routableStops(stops)
    .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
    .join('|')
}

/** How far along the grabbed leg to look when reading its travel direction.
 *  `routeCourseNear` defaults to 250 m, which the planner found is silently
 *  wrong for exactly this gesture: on a motorway the two decoded points either
 *  side of the release can be further apart than that, the lookup finds nothing,
 *  and the course comes back null on the one drag that most needs it — the one
 *  onto a divided road, where the course is what keeps the point off the
 *  oncoming carriageway. Kept identical to the planner's. */
const DRAG_COURSE_WINDOW_M = 2000

/** A ping further than this from the planned route is a genuine detour, not a
 *  sampling artefact, and must not be dragged onto a road it never used. */
const ROUTE_MATCH_MAX_M = 180

/** Two consecutive pings that cannot be road-matched may still be joined
 *  directly while they are this close — over a short hop a straight line is
 *  honest. Beyond it we have no idea which way the truck went, so the line
 *  breaks instead of cutting across country. */
const DIRECT_JOIN_MAX_M = 400

// Turn one continuous run of driver pings into drawable geometry.
//
// Three cases per consecutive pair, in order of how much we know:
//   1. both ends match the planned route and the second is further along it →
//      emit the ROAD geometry between them, so minute-spaced pings follow the
//      carriageway instead of chording across its bends;
//   2. no usable match (a detour, a service area, a road the plan never used)
//      but the two pings are close together → join them directly; over a few
//      hundred metres a straight line claims nothing untrue;
//   3. anything else → break. This is the case that matters: it is where the
//      old code drew a diagonal across fields, and where the honest answer is
//      to draw nothing at all.
function roadMatchedRun(points: DriverTrailPoint[], routePath: LatLng[]): LatLng[][] {
  if (points.length < 2) return []

  const cumulative = new Array<number>(routePath.length)
  if (routePath.length >= 2) {
    cumulative[0] = 0
    for (let i = 1; i < routePath.length; i++) {
      cumulative[i] = cumulative[i - 1] + haversineMeters(routePath[i - 1], routePath[i])
    }
  }

  const matched = points.map((point) => {
    if (routePath.length < 2) return null
    const match = nearestPointOnPath(point, routePath, cumulative)
    return match && match.meters <= ROUTE_MATCH_MAX_M ? match : null
  })

  const runs: LatLng[][] = []
  let current: LatLng[] = [positionOf(points[0], matched[0])]

  for (let i = 1; i < points.length; i++) {
    const previousMatch = matched[i - 1]
    const match = matched[i]

    // Case 1 — both on the planned route, and moving forward along it.
    if (previousMatch && match && match.along >= previousMatch.along - 50) {
      for (let v = 1; v < routePath.length; v++) {
        if (cumulative[v] > previousMatch.along && cumulative[v] < match.along) {
          current.push(routePath[v])
        }
      }
      pushDistinct(current, match.at)
      continue
    }

    // Case 2 — a short hop we can join directly.
    if (haversineMeters(points[i - 1], points[i]) <= DIRECT_JOIN_MAX_M) {
      pushDistinct(current, positionOf(points[i], match))
      continue
    }

    // Case 3 — the truck went somewhere we cannot account for. End the line.
    if (current.length >= 2) runs.push(current)
    current = [positionOf(points[i], match)]
  }

  if (current.length >= 2) runs.push(current)
  return runs
}

/** The drawn position of a ping: its road-matched point when it has one, its
 *  raw coordinate otherwise. */
function positionOf(
  point: DriverTrailPoint,
  match: { at: LatLng } | null,
): LatLng {
  return match ? match.at : { lat: point.lat, lng: point.lng }
}

function pushDistinct(path: LatLng[], point: LatLng) {
  const last = path[path.length - 1]
  if (!last || haversineMeters(last, point) >= 1) path.push(point)
}

/** Every recorded run of one driver → the polylines to draw for them. The
 *  server's own segmentation is honoured first (each run is already a stretch
 *  with continuous coverage), then each run is matched and may break further
 *  where the geometry cannot support a line. */
function roadMatchedTrail(points: DriverTrailPoint[], routePath: LatLng[]): LatLng[][] {
  return trailSegments(points).flatMap((run) => roadMatchedRun(run, routePath))
}

// A fresh intermediate stop created by dropping a point on the map. Carries only
// coordinates (+ the snapped road label as its free-text location) and the
// neutral 'other' type — it's a routing waypoint, editable in the Trip tab like
// any other stop afterwards.
function mapStop(pos: LatLng, label: string): VehicleStop {
  return {
    id: stopId(),
    type: 'other',
    status: 'planned',
    lat: pos.lat,
    lng: pos.lng,
    coordinates: `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`,
    ...(label ? { location: label } : {}),
  }
}

// A GPS bearing → the compass point a dispatcher would say out loud. 16 points
// is as fine as "which way is it facing" ever needs to be read at a glance, and
// finer would overstate what a phone's bearing is worth.
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
function compassPoint(headingDeg: number): string {
  const i = Math.round((((headingDeg % 360) + 360) % 360) / 22.5) % 16
  return COMPASS[i]
}

// Right-click context menu (add a stop) + clicked-marker popover (remove a stop),
// positioned within the map region.
type MenuState = { x: number; y: number; lat: number; lng: number; zoom: number; candidates: ScreenGeoCandidate[] }
type MarkerMenuState = { id: string; kind: RouteMarkerKind; x: number; y: number }

// Map of the active trip's route, opened from the conversation header. Derives
// waypoints from the stop coordinates (origin → stops → destination), draws the
// saved line immediately, and recomputes from the current stops so distance /
// duration stay fresh. Planning data only — no live GPS/tracking.
//
// With `canEdit`, an "Edit route" mode lets a manager shape the route directly on
// the map (reusing the shared HERE map's drag + road-snap, the same the Route
// Planner uses): drag a stop marker to move it, right-click to add an
// intermediate stop, click a stop to remove it. Save recomputes and persists the
// route + stops and the server logs a "… edited the trip route" system message;
// Cancel discards.
export default function TripRouteMap({
  stops,
  route,
  canEdit = false,
  onSaveRoute,
  groupId,
  tripId,
  driverLocationsSeed,
  driverTrailsSeed,
}: Props) {
  const [editing, setEditing] = useState(false)
  // Working copy of ALL stops while editing (so non-routable stops are preserved
  // on save); edits mutate only the affected stops.
  const [draftStops, setDraftStops] = useState<VehicleStop[]>(stops)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [markerMenu, setMarkerMenu] = useState<MarkerMenuState | null>(null)
  const regionRef = useRef<HTMLDivElement>(null)

  // Keep the draft in sync with upstream stops while NOT editing, so re-entering
  // edit mode (or a live update from another member) starts from the latest data.
  useEffect(() => {
    if (!editing) setDraftStops(stops)
  }, [stops, editing])

  // Everything downstream reads the draft while editing, the live stops otherwise.
  const activeStops = editing ? draftStops : stops
  const routable = useMemo(() => routableStops(activeStops), [activeStops])

  const sig = useMemo(() => routable.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|'), [routable])
  // The route is dirty (worth saving) once the edited stops differ from the saved
  // ones — prevents an accidental no-op save and a needless system message.
  const originalSig = useMemo(() => coordSig(stops), [stops])
  const dirty = editing && sig !== originalSig

  const [data, setData] = useState<TripRoute | null>(route?.status === 'ok' ? route : null)
  const [loading, setLoading] = useState(false)

  // Prefer freshly-computed geometry. While editing, never show the saved route
  // because it may disagree with the draft stops.
  const polylines = data?.polylines ?? (editing ? [] : route?.polylines) ?? []
  const routePath = useMemo<LatLng[]>(() => {
    const out: LatLng[] = []
    for (const encoded of polylines) {
      try {
        for (const [lat, lng] of decode(encoded).polyline) {
          const previous = out[out.length - 1]
          if (!previous || previous.lat !== lat || previous.lng !== lng) out.push({ lat, lng })
        }
      } catch {
        // One malformed saved section must not hide the other usable sections.
      }
    }
    return out
  }, [polylines])

  // Recompute whenever the coordinate signature changes (and on first open). In
  // edit mode this is the live preview as the user drags / adds / removes stops.
  useEffect(() => {
    if (routable.length < 2) {
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    computeTripRoute(activeStops).then((r) => {
      if (!cancelled) {
        setData(r)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
    // activeStops is captured via the coordinate signature; recompute on change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  // ── Live driver positions ─────────────────────────────────────────────────
  // Seeded from the room's stored `meta.driverLocations` (last known position),
  // then kept live by the group room's `driver:location` socket events. Only
  // entries for THIS trip are kept — a position from a previous trip is noise.
  const [driverLocs, setDriverLocs] = useState<Record<string, DriverLocation>>(() =>
    tripId ? parseDriverLocations(driverLocationsSeed, tripId) : {},
  )
  // The travelled path, seeded from the stored trail so a dispatcher opening the
  // room mid-trip sees everywhere the truck has been — not just from the moment
  // they looked. Live points come off the SAME socket events as the position
  // above; extendTrail applies the server's own "has it actually moved" rule and
  // returns the previous array unchanged when it hasn't, so an idle truck causes
  // no re-render.
  const [driverTrailPoints, setDriverTrailPoints] = useState<Record<string, DriverTrailPoint[]>>(
    () => (tripId ? parseDriverTrails(driverTrailsSeed, tripId) : {}),
  )
  // The durable history. The meta seeds above render instantly (no request) but
  // are capped and reset by the next trip; this is the authoritative record and
  // replaces them as soon as it arrives. It is also what makes a COMPLETED trip
  // viewable at all — its meta trail is long gone by then.
  const [track, setTrack] = useState<TripTrack | null>(null)
  useEffect(() => {
    if (!tripId) return
    let cancelled = false
    api.trips
      .track(tripId)
      .then((result) => {
        if (cancelled) return
        setTrack(result)
        // Adopt the recorded path wholesale: it carries the server's segments,
        // so the drawn line breaks exactly where coverage did.
        const recorded: Record<string, DriverTrailPoint[]> = {}
        for (const driver of result.drivers) {
          const points = trackToTrailPoints(driver)
          if (points.length) recorded[driver.driverId] = points
        }
        if (Object.keys(recorded).length) setDriverTrailPoints(recorded)
      })
      .catch(() => {
        // A trip that never recorded a point 404s — normal for a freshly planned
        // trip. Keep whatever the meta seed gave us and say nothing.
      })
    return () => {
      cancelled = true
    }
  }, [tripId])

  // Distance is SERVER-computed and arrives on each ping. The browser must not
  // derive it from the points it happens to hold: a dispatcher opening the room
  // at noon would otherwise see a shorter drive than one who left it open.
  const [liveDistanceM, setLiveDistanceM] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!groupId || !tripId) return
    const socket = getSocket()
    const onLocation = (payload: unknown) => {
      const entry = parseDriverLocationEvent(payload, groupId, tripId)
      if (!entry) return
      setDriverLocs((cur) => ({ ...cur, [entry.userId]: entry }))
      if (entry.distanceM !== undefined) {
        setLiveDistanceM((cur) =>
          cur[entry.userId] === entry.distanceM
            ? cur
            : { ...cur, [entry.userId]: entry.distanceM as number },
        )
      }
      setDriverTrailPoints((cur) => {
        const points = cur[entry.userId] ?? []
        const next = extendTrail(points, entry)
        return next === points ? cur : { ...cur, [entry.userId]: next }
      })
    }
    socket.on('driver:location', onLocation)
    return () => {
      socket.off('driver:location', onLocation)
    }
  }, [groupId, tripId])

  // Staleness is a function of time, not just data — tick every 30s so a
  // driver who stops pinging fades to "stale" without any new event.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const driverMarkers = useMemo<DriverMapMarker[]>(() => {
    const out: DriverMapMarker[] = []
    for (const loc of Object.values(driverLocs)) {
      const age = now - Date.parse(loc.recordedAt)
      if (age > DRIVER_EXPIRE_MS) continue
      const stale = age > DRIVER_STALE_MS
      const speedKmh =
        loc.speedMps !== undefined && loc.speedMps > 0.5
          ? ` · ${Math.round(loc.speedMps * 3.6)} km/h`
          : ''
      out.push({
        id: loc.userId,
        name: loc.name,
        position: { lat: loc.lat, lng: loc.lng },
        stale,
        detail: `Updated ${driverLocationAgo(loc.recordedAt, now).toLowerCase()}${stale ? ' (last known)' : ''}${speedKmh}${
          loc.headingDeg !== undefined ? ` · heading ${compassPoint(loc.headingDeg)}` : ''
        }`,
        ...(loc.headingDeg !== undefined ? { headingDeg: loc.headingDeg } : {}),
      })
    }
    return out
  }, [driverLocs, now])

  // Trails follow the marker's own visibility rules: a driver whose last
  // position has expired shows no path either, and a stale driver's path is
  // drawn muted so "this is where it went" never looks live when it isn't.
  const driverTrails = useMemo<DriverMapTrail[]>(() => {
    const out: DriverMapTrail[] = []
    for (const [userId, points] of Object.entries(driverTrailPoints)) {
      if (points.length < 2) continue
      const loc = driverLocs[userId]
      // A driver with no live position may still have a recorded path — that is
      // exactly the completed-trip case, where history must stay visible long
      // after the last ping expired.
      const age = loc ? now - Date.parse(loc.recordedAt) : Number.POSITIVE_INFINITY
      const recorded = track?.drivers.some((d) => d.driverId === userId)
      if (!recorded && age > DRIVER_EXPIRE_MS) continue
      const segments = roadMatchedTrail(points, routePath)
      if (!segments.length) continue
      out.push({
        id: userId,
        segments,
        stale: age > DRIVER_STALE_MS,
      })
    }
    return out
  }, [driverTrailPoints, driverLocs, now, routePath, track])

  // ── Distance, progress and timing ─────────────────────────────────────────
  // Driven kilometres come from the server (the recorded total, then whatever
  // later pings reported), never from measuring the drawn line — a downsampled
  // or partially-loaded path would under-report. Planned kilometres come from
  // the freshly computed route.
  const drivenM = useMemo(() => {
    const perDriver = new Map<string, number>()
    for (const driver of track?.drivers ?? []) perDriver.set(driver.driverId, driver.distanceM)
    // A live ping supersedes the snapshot for that driver — it is the same
    // running total, just newer.
    for (const [userId, meters] of Object.entries(liveDistanceM)) {
      perDriver.set(userId, Math.max(meters, perDriver.get(userId) ?? 0))
    }
    let total = 0
    for (const meters of perDriver.values()) total += meters
    return total
  }, [track, liveDistanceM])

  const plannedM = useMemo(() => {
    if (routePath.length < 2) return 0
    let total = 0
    for (let i = 1; i < routePath.length; i++) total += haversineMeters(routePath[i - 1], routePath[i])
    return total
  }, [routePath])

  // The freshest driver, which drives the "last update / speed / heading" line.
  const latestDriver = useMemo(() => {
    let best: DriverLocation | null = null
    for (const loc of Object.values(driverLocs)) {
      if (!best || Date.parse(loc.recordedAt) > Date.parse(best.recordedAt)) best = loc
    }
    return best
  }, [driverLocs])

  // Recording window: how long the trip has been tracked. Open-ended while the
  // truck is still pinging, so it keeps counting rather than freezing at the
  // last stored point.
  const trackedMs = useMemo(() => {
    const first = track?.totals.firstAt ? Date.parse(track.totals.firstAt) : null
    if (!first) return 0
    const lastRecorded = track?.totals.lastAt ? Date.parse(track.totals.lastAt) : first
    const lastLive = latestDriver ? Date.parse(latestDriver.recordedAt) : 0
    return Math.max(lastRecorded, lastLive) - first
  }, [track, latestDriver])

  const gaps = useMemo(
    () => (track?.drivers ?? []).flatMap((d) => d.gaps),
    [track],
  )

  // Only meaningful once BOTH numbers exist; a planned route of zero would make
  // any driven distance read as 100%.
  const progressPct =
    plannedM > 0 && drivenM > 0 ? Math.min(100, Math.round((drivenM / plannedM) * 100)) : null

  const hasHistory = drivenM > 0 || driverTrails.length > 0

  const markers = useMemo<RouteMarker[]>(
    () =>
      routable.map((p, i) => ({
        id: p.id,
        kind: i === 0 ? 'origin' : i === routable.length - 1 ? 'destination' : 'stop',
        position: { lat: p.lat, lng: p.lng },
        label: i > 0 && i < routable.length - 1 ? String(i) : undefined,
      })),
    [routable],
  )

  const center = !polylines.length && routable[0] ? { lat: routable[0].lat, lng: routable[0].lng } : null
  const ok = data?.status === 'ok'

  // The route's geometry split by LEG. A route drag reports which leg was
  // grabbed, and leg i runs between routable[i] and routable[i + 1] — so this is
  // both where the new stop belongs and where its travel direction is read.
  const sectionCoords = useMemo<LatLng[][]>(
    () =>
      polylines.map((line) => {
        try {
          return decode(line).polyline.map(([lat, lng]) => ({ lat, lng }))
        } catch {
          return []
        }
      }),
    [polylines],
  )

  // Snap a released point to a road, with the leg's direction and its bracketing
  // waypoints so the choice lands on the right carriageway and the least detour.
  // Falls back to the raw release: a point exactly where the user let go is
  // always better than no point at all.
  async function snapRelease(
    candidates: ScreenGeoCandidate[],
    zoom: number,
    course?: number,
    prev?: LatLng,
    next?: LatLng,
  ): Promise<{ pos: LatLng; label: string }> {
    const release = candidates[0]
    try {
      const { place } = await api.here.snapCandidates({ candidates, zoom, course, prev, next })
      if (place?.position) return { pos: place.position, label: place.label ?? '' }
    } catch {
      /* snap unavailable — keep the raw release coordinate */
    }
    return { pos: { lat: release.lat, lng: release.lng }, label: '' }
  }

  // DRAG THE ROUTE LINE ITSELF → a new stop on the leg that was grabbed, the
  // planner's gesture brought over whole (user, 2026-09-06). Right-clicking to
  // add a stop already existed here, but it has to guess which leg the point
  // belongs on (`bestInsertionIndex`); a drag does not — the leg IS the thing the
  // user grabbed, so the stop lands where they pulled from even when a nearer
  // leg passes close by.
  //
  // OPTIMISTIC, like the planner: the stop appears at the raw release point the
  // instant the ghost is dropped, and the road-snap patches that same stop by id
  // when it returns. A drag that shows nothing until a network round-trip
  // completes reads as a drag that failed.
  async function handleRouteDragEnd(section: number, candidates: ScreenGeoCandidate[], zoom: number) {
    const release = candidates[0]
    if (!release) return
    const before = routable[section + 1]
    if (!before) return

    const leg = sectionCoords[section]
    const course = leg?.length
      ? routeCourseNear(release, [leg], DRAG_COURSE_WINDOW_M) ?? undefined
      : undefined
    const from = routable[section]
    const prev = from ? { lat: from.lat, lng: from.lng } : undefined
    const next = { lat: before.lat, lng: before.lng }

    const stop = mapStop({ lat: release.lat, lng: release.lng }, '')
    setDraftStops((cur) => {
      const at = cur.findIndex((s) => s.id === before.id)
      const out = cur.slice()
      out.splice(at < 0 ? cur.length : at, 0, stop)
      return out
    })

    const snapped = await snapRelease(candidates, zoom, course, prev, next)
    setDraftStops((cur) =>
      // A no-op if the stop was removed while the snap was in flight.
      cur.map((s) =>
        s.id === stop.id
          ? {
              ...s,
              lat: snapped.pos.lat,
              lng: snapped.pos.lng,
              coordinates: `${snapped.pos.lat.toFixed(5)}, ${snapped.pos.lng.toFixed(5)}`,
              ...(snapped.label ? { location: snapped.label } : {}),
            }
          : s,
      ),
    )
  }

  // Marker drag released (edit mode only) → snap the drop to a road via the SAME
  // screen-space snap the Route Planner uses, then move that stop's coordinate in
  // the draft. The recompute effect redraws the preview through the moved point.
  async function handleMarkerDragEnd(id: string, candidates: ScreenGeoCandidate[], zoom: number) {
    const release = candidates[0]
    if (!release) return
    let pos = { lat: release.lat, lng: release.lng }
    try {
      const { place } = await api.here.snapCandidates({ candidates, zoom })
      if (place?.position) pos = place.position
    } catch {
      /* snap unavailable — keep the raw release coordinate */
    }
    setDraftStops((cur) =>
      cur.map((s) =>
        s.id === id
          ? { ...s, lat: pos.lat, lng: pos.lng, coordinates: `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}` }
          : s,
      ),
    )
  }

  // Right-click on the map → position the "Add stop" context menu, clamped inside
  // the map region.
  function openMenu(info: MenuState) {
    const region = regionRef.current
    const w = region?.clientWidth ?? 0
    const h = region?.clientHeight ?? 0
    setMarkerMenu(null)
    setMenu({
      ...info,
      x: Math.min(info.x, Math.max(0, w - 180)),
      y: Math.min(info.y, Math.max(0, h - 90)),
    })
  }

  // "Add stop" → snap the clicked point to a road, then insert it into the draft
  // on the least-detour leg between the existing waypoints (never before the
  // origin or after the destination — those stay the trip's loading/unloading).
  async function addStopFromMenu() {
    if (!menu) return
    const { candidates, zoom } = menu
    setMenu(null)
    let pos: LatLng = { lat: menu.lat, lng: menu.lng }
    let label = ''
    try {
      const { place } = await api.here.snapCandidates({ candidates, zoom })
      if (place?.position) {
        pos = place.position
        label = place.label ?? ''
      }
    } catch {
      /* snap unavailable — use the raw clicked coordinate */
    }
    setDraftStops((cur) => {
      const rt = routableStops(cur)
      const stop = mapStop(pos, label)
      if (rt.length < 2) return [...cur, stop]
      const origin = rt[0]
      const dest = rt[rt.length - 1]
      const intermediate = rt.slice(1, -1)
      // Least-detour intermediate slot, then map it to "before this waypoint" and
      // splice into the full stop array (which may interleave non-routable stops).
      const k = bestInsertionIndex(pos, origin, intermediate, dest)
      const beforeId = rt[k + 1].id
      const at = cur.findIndex((s) => s.id === beforeId)
      const next = cur.slice()
      next.splice(at < 0 ? cur.length : at, 0, stop)
      return next
    })
  }

  // Click a marker → role-aware popover (remove intermediate stops; copy any).
  function openMarkerMenu(info: { id: string; kind: RouteMarkerKind; x: number; y: number }) {
    const region = regionRef.current
    const w = region?.clientWidth ?? 0
    const h = region?.clientHeight ?? 0
    setMenu(null)
    setMarkerMenu({
      id: info.id,
      kind: info.kind,
      x: Math.min(Math.max(0, info.x + 10), Math.max(0, w - 180)),
      y: Math.min(Math.max(0, info.y), Math.max(0, h - 96)),
    })
  }

  function removeStop(id: string) {
    setMarkerMenu(null)
    setDraftStops((cur) => cur.filter((s) => s.id !== id))
  }

  async function copyStopCoord(id: string) {
    const p = routable.find((r) => r.id === id)
    setMarkerMenu(null)
    if (!p) return
    try {
      await navigator.clipboard?.writeText(`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`)
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  // Dismiss the menus on Escape or an outside click.
  useEffect(() => {
    if (!menu && !markerMenu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenu(null)
        setMarkerMenu(null)
      }
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (document.getElementById('trip-route-menu')?.contains(t)) return
      if (document.getElementById('trip-route-marker-menu')?.contains(t)) return
      setMenu(null)
      setMarkerMenu(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [menu, markerMenu])

  function startEdit() {
    setSaveError(null)
    setDraftStops(stops)
    setEditing(true)
  }
  function cancelEdit() {
    // Discard the draft and restore the saved route.
    setEditing(false)
    setDraftStops(stops)
    setSaveError(null)
    setMenu(null)
    setMarkerMenu(null)
  }
  async function save() {
    if (!onSaveRoute) return
    setMenu(null)
    setMarkerMenu(null)
    setSaving(true)
    setSaveError(null)
    try {
      // Recompute from the final draft so the persisted route matches the saved
      // stops, and persist ONLY a real ('ok') route: a failed/incomplete recompute
      // never overwrites the previous saved route, and there's no save without
      // actual route data.
      const fresh = await computeTripRoute(draftStops)
      if (fresh.status !== 'ok') {
        setSaveError('Route unavailable for these stops — adjust a point and try again.')
        return
      }
      await onSaveRoute(draftStops, fresh)
      setEditing(false)
    } catch {
      // Keep the user in edit mode with their changes intact.
      setSaveError('Couldn’t save the route. Your changes are kept — try again.')
    } finally {
      setSaving(false)
    }
  }

  const showEditButton = canEdit && Boolean(onSaveRoute) && !editing && routable.length >= 2
  // No accidental save: needs a valid computed route AND an actual change.
  const saveDisabled = saving || !ok || !dirty

  if (routable.length < 2 && !editing) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg px-6 text-center">
        <div className="text-base text-muted leading-[1.5]">
          Add coordinates to at least two stops to see the trip route.
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg relative">
      <div ref={regionRef} className="flex-1 min-h-0 relative">
        <HereMap
          className="absolute inset-0"
          markers={markers}
          driverMarkers={driverMarkers}
          driverTrails={driverTrails}
          routePolylines={polylines}
          // The planner's route drawing: a line whose width tracks the zoom
          // instead of one fixed pixel width that is a worm across a country and
          // a thread at a junction. The two maps draw the same trip; they should
          // not draw it two ways.
          scaleRouteWidthWithZoom
          routeDistanceLabel={ok ? (data?.distanceText ?? null) : null}
          truckOverlay={false}
          center={center}
          // Markers/line are grabbable — and the add/remove gestures wired — only
          // while editing.
          objectsDraggable={editing}
          onMarkerDragEnd={editing ? handleMarkerDragEnd : undefined}
          onRouteDragEnd={editing ? handleRouteDragEnd : undefined}
          onMapContextMenu={editing ? openMenu : undefined}
          onMarkerClick={editing ? openMarkerMenu : undefined}
          onMapViewChange={
            editing
              ? () => {
                  setMenu(null)
                  setMarkerMenu(null)
                }
              : undefined
          }
        />

        {/* Compact route summary overlay — distance + driving time, or a quiet
            calculating state. Gains a subtle "Editing" tag while in edit mode. */}
        <div className="absolute top-2 left-2 rounded-full bg-bg/95 backdrop-blur-md border border-line-2 px-3 py-1.5 text-sm flex items-center gap-2 shadow-raised">
          {editing && (
            <span className="flex items-center gap-1.5 text-active font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-active" />
              Editing
            </span>
          )}
          {editing && <span className="h-3 w-px bg-white/10" />}
          {loading && !ok ? (
            <>
              <Spinner size={13} /> <span className="text-muted">Calculating route…</span>
            </>
          ) : ok ? (
            <span className="text-text tabular-nums">
              {data?.distanceText} · {data?.durationText}
            </span>
          ) : (
            <span className="text-muted">Route unavailable — showing stops only.</span>
          )}
        </div>

        {/* Legend + the trip's real numbers. Bottom-left, and only outside edit
            mode — the edit helper owns that corner while editing. The legend is
            what makes the two lines readable at all, so it stays visible
            whenever a driven path is on the map. */}
        {hasHistory && !editing && (
          // Near-opaque on purpose. This floats over map tiles whose brightness
          // is not ours to control — a light basemap, snow, a motorway, satellite
          // imagery — and at 85% those tiles bleed through and wash the text out.
          // A readout of the trip's actual numbers has to stay readable over
          // anything the map happens to draw underneath it.
          <div className="absolute z-20 bottom-2 left-2 max-w-[calc(100%-1rem)] rounded-card bg-bg/95 backdrop-blur-md border border-line-2 px-3 py-2 text-xs text-text shadow-raised">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="block h-[5px] w-5 rounded-full bg-[#c89572] ring-1 ring-black/35" />
                Planned
              </span>
              <span className="flex items-center gap-1.5">
                {/* Both swatches keep the map's literal colours — they exist to
                    identify the two lines, so they must not be re-toned per
                    theme the way the readout below is. The ring is what keeps
                    them visible on a light panel. */}
                <span
                  className="block h-[5px] w-5 rounded-full ring-1 ring-black/35"
                  style={{
                    background:
                      'repeating-linear-gradient(90deg, #00b8a9 0 7px, transparent 7px 11px)',
                  }}
                />
                Driven
              </span>
            </div>

            {/* Driven vs planned, side by side — the comparison is the point, so
                neither number is shown without the other. */}
            <div className="mt-1.5 pt-1.5 border-t border-line-2 flex items-center gap-1.5 tabular-nums">
              {/* The two figures are the panel's reason to exist, so they carry
                  the weight; their units and labels stay quiet beside them. */}
              <span className="text-driven font-semibold text-sm">{formatDistance(drivenM)}</span>
              <span className="text-muted">driven</span>
              {plannedM > 0 && (
                <>
                  <span className="text-muted">/</span>
                  <span className="text-text font-semibold text-sm">{formatDistance(plannedM)}</span>
                  <span className="text-muted">planned</span>
                </>
              )}
              {progressPct !== null && (
                <span className="text-muted">· ~{progressPct}%</span>
              )}
            </div>

            {trackedMs > 0 && (
              <div className="mt-0.5 text-muted tabular-nums">
                Tracked for {formatDuration(trackedMs)}
                {track?.totals.pointCount ? ` · ${track.totals.pointCount} fixes` : ''}
              </div>
            )}

            {/* The live line: how fresh, how fast, which way. */}
            {latestDriver && (
              <div className="mt-0.5 text-muted tabular-nums">
                {driverLocationAgo(latestDriver.recordedAt, now)}
                {latestDriver.speedMps !== undefined &&
                  ` · ${Math.round(latestDriver.speedMps * 3.6)} km/h`}
                {latestDriver.headingDeg !== undefined &&
                  ` · ${compassPoint(latestDriver.headingDeg)}`}
              </div>
            )}

            {/* Named explicitly, because a break in the teal line otherwise looks
                like the truck stopped rather than the signal did. */}
            {gaps.length > 0 && (
              <div className="mt-0.5 text-muted">
                {gaps.length} {gaps.length === 1 ? 'period' : 'periods'} without signal
              </div>
            )}

            {track && track.drivers.length > 1 && (
              <div className="mt-0.5 text-muted">
                {track.drivers.map((d) => d.name).join(' · ')}
              </div>
            )}
          </div>
        )}

        {/* Edit route — compact pill matching the map's overlay chrome. */}
        {showEditButton && (
          <button
            type="button"
            onClick={startEdit}
            className="absolute z-20 top-2 right-2 flex items-center gap-1.5 h-8 px-3 rounded-full bg-bg/80 backdrop-blur-sm border border-line text-sm font-medium text-text hover:bg-bg transition-colors shadow-raised"
          >
            <Pencil size="0.8125rem" strokeWidth={2} />
            Edit route
          </button>
        )}

        {/* Edit-mode controls — Cancel (discard) + Save route (persist). */}
        {editing && (
          <div className="absolute z-20 top-2 right-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="flex items-center gap-1.5 h-8 px-3 rounded-full bg-bg/80 backdrop-blur-sm border border-line text-sm font-medium text-muted hover:text-text hover:bg-bg transition-colors shadow-raised disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <X size="0.8125rem" strokeWidth={2} />
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saveDisabled}
              title={!dirty ? 'Adjust the route first (drag, add or remove a stop)' : undefined}
              className="flex items-center gap-1.5 h-8 px-3 rounded-full bg-active text-bg text-sm font-semibold hover:bg-active/90 transition-colors shadow-raised disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? <Spinner size={13} /> : <Check size="0.8125rem" strokeWidth={2.4} />}
              Save route
            </button>
          </div>
        )}

        {/* Minimal edit helper / save error — bottom-left, never covers the map. */}
        {editing && (
          <div className="absolute z-20 bottom-2 left-2 max-w-[calc(100%-1rem)]">
            {saveError ? (
              <div className="rounded-full bg-alert/15 border border-alert/25 text-alert px-3 py-1.5 text-xs shadow-raised">
                {saveError}
              </div>
            ) : (
              <div className="rounded-full bg-bg/80 backdrop-blur-sm border border-line text-muted px-3 py-1.5 text-xs shadow-raised">
                {/* The route drag is listed FIRST because it is the gesture with
                    no other affordance — a stop is visibly a thing you can grab,
                    and a right-click is a habit, but nothing about a drawn line
                    says it can be pulled. */}
                Drag the route to add a stop · drag a stop to move it · right-click to add ·
                click a stop to remove.
              </div>
            )}
          </div>
        )}

        {/* Right-click context menu — add an intermediate stop at the click. */}
        {editing && menu && (
          <div
            id="trip-route-menu"
            className={`absolute z-30 min-w-[10rem] ${MENU_CONTAINER}`}
            style={{ left: menu.x, top: menu.y }}
          >
            <div className="px-3 py-1.5 text-2xs tabular-nums text-muted border-b border-line mb-1">
              {menu.lat.toFixed(5)}, {menu.lng.toFixed(5)}
            </div>
            <button type="button" onClick={addStopFromMenu} className={menuItemClass()}>
              <span className={menuIconClass()}>
                <MapPin {...MENU_GLYPH} />
              </span>
              Add stop
            </button>
          </div>
        )}

        {/* Marker popover — copy any point; remove intermediate stops (endpoints
            are the trip's loading/unloading and are edited in the Trip tab). */}
        {editing && markerMenu && (
          <div
            id="trip-route-marker-menu"
            className={`absolute z-30 min-w-[10rem] ${MENU_CONTAINER}`}
            style={{ left: markerMenu.x, top: markerMenu.y }}
          >
            <div className="px-3 py-1.5 text-2xs text-muted border-b border-line mb-1">
              {markerMenu.kind === 'origin'
                ? 'Start'
                : markerMenu.kind === 'destination'
                  ? 'Destination'
                  : 'Stop'}
            </div>
            <button
              type="button"
              onClick={() => copyStopCoord(markerMenu.id)}
              className={menuItemClass()}
            >
              <span className={menuIconClass()}>
                <Copy {...MENU_GLYPH} />
              </span>
              Copy coordinates
            </button>
            {markerMenu.kind === 'stop' && (
              <button
                type="button"
                onClick={() => removeStop(markerMenu.id)}
                className={menuItemClass('danger')}
              >
                <span className={menuIconClass('danger')}>
                  <Trash2 {...MENU_GLYPH} />
                </span>
                Remove stop
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
