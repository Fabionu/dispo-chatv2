import { useEffect, useMemo, useRef, useState } from 'react'
import { decode } from '@here/flexpolyline'
import {
  ArrowLeft,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Flag,
  MapPin,
  Navigation,
  Plus,
  Route as RouteIcon,
  Trash2,
  Truck,
  TriangleAlert,
  X,
} from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { bestInsertionIndex, haversineMeters, nearestRouteSection, routeCourseNear } from '../../lib/here/geo'
import { builtInPresets, deleteUserPreset, loadUserPresets, saveUserPreset } from '../../lib/here/truckPresets'
import type { TruckPreset } from '../../lib/here/truckPresets'
import HereMap from '../here/HereMap'
import PlaceSearchField from '../here/PlaceSearchField'
import Spinner from '../Spinner'
import { ICON_ACTION_BASE, ICON_ACTION_IDLE } from '../HeaderIconButton'
import type {
  HerePlace,
  LatLng,
  RouteMarker,
  RoutePoint,
  RoutePointRole,
  ScreenGeoCandidate,
  TruckProfileForm,
  TruckRoute,
} from '../../lib/here/types'
import PointRow from './RoutePointRow'
import { CopyCoordButton, NumberField, PresetSelect, Stat } from './RoutePlannerFields'
import {
  EMPTY_TRUCK,
  MAX_STOPS,
  ON_ROUTE_METERS,
  PANEL_INSET_PX,
  errorMessage,
  fmtCoord,
  formatDistance,
  formatDuration,
  formatEta,
  isValidCoord,
  snapDebug,
  snappedFromRoute,
  toTruckProfile,
  truckSummary,
  uid,
} from './routePlannerUtils'
import { MENU_CONTAINER, MENU_GLYPH, menuIconClass, menuItemClass } from '../menuStyles'

type Props = {
  onBack: () => void
}

type MenuState = { x: number; y: number; lat: number; lng: number; zoom: number; candidates: ScreenGeoCandidate[] }
// Popover anchored to a clicked waypoint marker (remove / copy / clear).
type MarkerMenuState = { id: string; role: RoutePointRole; x: number; y: number }

// "Route planner" workspace tool (HERE only). One shared RoutePoint[] models the
// whole route (start → stops → destination); points come from HERE search, a
// right-click map menu (reverse-geocoded + snapped), or dragging a marker. A
// compact, left-collapsing floating panel holds the point list + a collapsible
// truck profile with saveable presets. Field/text edits draw via the explicit
// Create/Update button; direct map manipulation (marker drag, route-line drag,
// removing a stop from a marker popover) recalculates immediately so the route
// follows the user's gesture. The HERE Routing v8 truck route frames clear of
// the panel.
export default function RoutePlanner({ onBack }: Props) {
  const [points, setPoints] = useState<RoutePoint[]>([])
  const [truck, setTruck] = useState<TruckProfileForm>(EMPTY_TRUCK)
  const [route, setRoute] = useState<TruckRoute | null>(null)
  // The routeSig the drawn route was calculated from — lets us tell when the
  // route is "outdated" relative to the current inputs.
  const [calculatedSig, setCalculatedSig] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [snapNote, setSnapNote] = useState<string | null>(null)

  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [truckOpen, setTruckOpen] = useState(false)
  const [addingStop, setAddingStop] = useState(false)
  // Id of the point (start/stop/destination) whose address is being edited inline
  // — the row swaps to a pre-populated search field until the user picks a new
  // place or cancels (keeping the old address/coordinates).
  const [editingId, setEditingId] = useState<string | null>(null)
  // Id of the stop currently being dragged in the list (for reorder + ghosting).
  const [dragId, setDragId] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [markerMenu, setMarkerMenu] = useState<MarkerMenuState | null>(null)
  const [truckOverlay, setTruckOverlay] = useState(false)
  const [overlayAvailable, setOverlayAvailable] = useState(false)

  // Presets (built-in + user/localStorage). `activePresetId` is cleared on any
  // manual field edit so the summary never claims a preset that no longer matches.
  const [userPresets, setUserPresets] = useState<TruckPreset[]>([])
  const [activePresetId, setActivePresetId] = useState<string | null>(null)
  const [savingPreset, setSavingPreset] = useState(false)
  const [presetName, setPresetName] = useState('')

  const regionRef = useRef<HTMLDivElement>(null)
  const reqIdRef = useRef(0)

  useEffect(() => setUserPresets(loadUserPresets()), [])

  const presets = useMemo(() => [...builtInPresets(), ...userPresets], [userPresets])
  const activePreset = presets.find((p) => p.id === activePresetId) ?? null

  // ── Derived, ordered views of the single points array ─────────────────────
  const start = useMemo(() => points.find((p) => p.role === 'start') ?? null, [points])
  const destination = useMemo(() => points.find((p) => p.role === 'destination') ?? null, [points])
  const stops = useMemo(() => points.filter((p) => p.role === 'stop'), [points])
  // Drag-to-reorder is offered once there are ≥2 committed points — including the
  // start and finish, so the user can reorder the full route (not just the
  // intermediate stops). With a single point there is nothing to reorder.
  const canReorder = points.length >= 2

  // ── Auto-recalculate (debounced) on any routing-relevant change ───────────
  const routeSig = useMemo(() => {
    if (!start || !destination) return ''
    const coords = [start, ...stops, destination]
      .map((p) => `${p.coordinates.lat.toFixed(6)},${p.coordinates.lng.toFixed(6)}`)
      .join('|')
    return `${coords}#${JSON.stringify(toTruckProfile(truck))}`
  }, [start, destination, stops, truck])

  // A drawn route is only meaningful with both endpoints — drop it if one goes
  // away. Otherwise the route persists until the user presses Create/Update.
  useEffect(() => {
    if (!start || !destination) {
      setRoute(null)
      setCalculatedSig('')
      setError(null)
    }
  }, [start, destination])

  // Explicit route creation/update. No auto-recalc: the user drives it via the
  // Create/Update route button, so the drawn route never vanishes on an edit.
  async function calculate() {
    if (!start || !destination || loading) return
    const id = ++reqIdRef.current
    const sig = routeSig
    setLoading(true)
    setError(null)
    try {
      const res = await api.here.truckRoute({
        // `course` (when a point was dragged near the route) keeps HERE on the
        // correct carriageway/direction instead of snapping to the oncoming road.
        origin: { ...start.coordinates, course: start.course },
        destination: { ...destination.coordinates, course: destination.course },
        // Only stops with valid coordinates become via points — a removed/empty
        // stop is filtered out, never submitted as a blank address.
        via: stops
          .filter((s) => isValidCoord(s.coordinates))
          .map((s) => ({ ...s.coordinates, course: s.course })),
        truck: toTruckProfile(truck),
      })
      if (id === reqIdRef.current) {
        setRoute(res.route)
        setCalculatedSig(sig)
        if (snapDebug())
          // eslint-disable-next-line no-console
          console.log('[routeSnap] route result', {
            // HERE's road-snapped section boundaries — where the recalc actually
            // placed each waypoint. Compare with the chosen stop coordinate logged
            // on release to confirm the route landed on the intended road.
            sections: res.route.sections.map((s) => ({ departure: s.departure, arrival: s.arrival })),
            lengthMeters: res.route.summary.length,
          })
      }
    } catch (err) {
      if (id === reqIdRef.current) {
        // Non-destructive: keep the previously drawn route (if any) so a failed
        // recalc never silently wipes the map — just surface the error. The
        // route stays "outdated" until a successful calculation.
        setError(err instanceof ApiError ? errorMessage(err.code) : errorMessage('unknown'))
      }
    } finally {
      if (id === reqIdRef.current) setLoading(false)
    }
  }

  // When a route-line drag adds a stop we recalc immediately (drag-route feel),
  // unlike normal edits which wait for the button. This ref flags that intent so
  // the effect below fires calculate() once, after the new stop is in state.
  const recalcAfterDragRef = useRef(false)
  // Bumped to force the recalc effect when the flag is set but routeSig may not
  // have changed — the optimistic drag-stop path patches a stop's coordinates
  // AFTER inserting it, and when the snap falls back to the raw release point
  // that patch leaves the signature identical, so [routeSig] alone would never
  // fire and the route would silently stay uncalculated through the new stop.
  const [recalcNonce, setRecalcNonce] = useState(0)
  useEffect(() => {
    if (recalcAfterDragRef.current && start && destination) {
      recalcAfterDragRef.current = false
      calculate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSig, recalcNonce])

  // Route-line drag released → insert a snapped stop into the grabbed segment,
  // then recalc. `section` maps to the stops-array insertion index (section i
  // joins waypoint i and i+1, so the new stop becomes waypoint i+1). The snap
  // weighs the SCREEN-space candidates sampled around the release so the stop
  // lands on the road actually rendered under the cursor.
  async function handleRouteDragEnd(section: number, candidates: ScreenGeoCandidate[], zoom: number) {
    const release = candidates[0]
    if (!release) return
    // Heading of the grabbed section at the release point → drives BOTH the
    // direction-aware snap (correct carriageway, not the oncoming road) and the
    // recalc waypoint course. Computed before the snap so the snap can use it.
    const seg = sectionCoords[section]
    const course = seg ? routeCourseNear(release, [seg]) ?? undefined : undefined
    // The grabbed leg's endpoints bracket the new stop → detour-aware ranking.
    const { prev, next } = neighborsForStopIndex(section)
    // OPTIMISTIC: the stop appears at the raw release point the instant the
    // ghost is dropped — the snap round-trip must never leave dead air between
    // release and feedback. The road-snap then patches the SAME stop (by id)
    // in place, and only that single post-snap recalc talks to routing, so the
    // total HERE cost is identical to the old await-then-insert flow.
    const id = uid()
    addStop(
      {
        id,
        label: fmtCoord(release),
        coordinates: { lat: release.lat, lng: release.lng },
        source: 'drag',
        snapped: false,
        course,
      },
      section,
    )
    const s = await snapCandidatesToRoad(candidates, zoom, course, prev, next)
    // No-op if the user already removed the stop while the snap was in flight.
    setPoints((cur) =>
      cur.map((p) =>
        p.id === id
          ? { ...p, coordinates: s.coordinates, label: s.label, snapped: s.snapped }
          : p,
      ),
    )
    // The nonce (not just routeSig) triggers the recalc: a snap that fell back
    // to the raw release point leaves the signature unchanged from the
    // optimistic insert, and the recalc must still run through the new stop.
    recalcAfterDragRef.current = true
    setRecalcNonce((n) => n + 1)
  }

  // Whether the inputs have changed since the drawn route was calculated.
  const dirty = useMemo(() => routeSig !== '' && routeSig !== calculatedSig, [routeSig, calculatedSig])

  // Once the inputs match the drawn route again (e.g. the user removed a stop
  // whose recalc had failed), drop any stale error.
  useEffect(() => {
    if (!dirty) setError(null)
  }, [dirty])

  // ── Map inputs (memoised so unrelated re-renders don't redraw/refit) ───────
  // Only trust the route's road-snapped coordinates while the route still
  // matches the inputs; once dirty, fall back to each point's own coordinate so
  // a dragged/edited marker shows where the user put it, not the stale snap.
  const snapped = useMemo(() => snappedFromRoute(route, stops.length), [route, stops.length])
  const activeSnap = dirty ? null : snapped

  const polylines = useMemo(
    () => route?.sections.map((s) => s.polyline).filter((p): p is string => Boolean(p)) ?? [],
    [route],
  )

  const sectionCoords = useMemo<LatLng[][]>(() => {
    if (!route) return []
    return route.sections.map((s) => {
      try {
        return decode(s.polyline ?? '').polyline.map(([lat, lng]) => ({ lat, lng }))
      } catch {
        return []
      }
    })
  }, [route])

  // The route's waypoints in travel order [start, ...stops, destination]. Route
  // section i runs between orderedWaypoints[i] and [i+1], so this also gives the
  // neighbours bracketing any leg — used for detour-aware snap ranking.
  const orderedWaypoints = useMemo<RoutePoint[]>(() => {
    const out: RoutePoint[] = []
    if (start) out.push(start)
    out.push(...stops)
    if (destination) out.push(destination)
    return out
  }, [start, stops, destination])

  // The coordinates bracketing a NEW stop inserted at stops-index `k`, passed to
  // the snap as detour context (prefer the candidate that adds least to
  // prev→here→next). A stop at stops-index k sits between orderedWaypoints[k] and
  // [k+1] (since orderedWaypoints[0] is the start).
  function neighborsForStopIndex(k: number): { prev?: LatLng; next?: LatLng } {
    return { prev: orderedWaypoints[k]?.coordinates, next: orderedWaypoints[k + 1]?.coordinates }
  }

  const displayCoord = (p: RoutePoint): LatLng => {
    if (!activeSnap) return p.coordinates
    if (p.role === 'start') return activeSnap.origin
    if (p.role === 'destination') return activeSnap.destination
    const i = stops.findIndex((s) => s.id === p.id)
    return i >= 0 ? activeSnap.stops[i] : p.coordinates
  }

  const markers = useMemo<RouteMarker[]>(() => {
    const out: RouteMarker[] = []
    if (start) out.push({ id: start.id, kind: 'origin', position: activeSnap?.origin ?? start.coordinates })
    stops.forEach((s, i) =>
      out.push({ id: s.id, kind: 'stop', position: activeSnap?.stops[i] ?? s.coordinates, label: String(i + 1) }),
    )
    if (destination)
      out.push({ id: destination.id, kind: 'destination', position: activeSnap?.destination ?? destination.coordinates })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, destination, stops, activeSnap])

  const notices = route?.sections.flatMap((s) => s.notices) ?? []

  // ── Point mutation (keeps start first, destination last, stops between) ────
  function setStart(point: Omit<RoutePoint, 'role'>) {
    setPoints((prev) => [{ ...point, role: 'start' }, ...prev.filter((p) => p.role !== 'start')])
  }
  function setDestinationPoint(point: Omit<RoutePoint, 'role'>) {
    setPoints((prev) => [...prev.filter((p) => p.role !== 'destination'), { ...point, role: 'destination' }])
  }
  // Add an intermediate stop at `atIndex` (clamped into the stop list), always
  // keeping the start first and the finish last. With no `atIndex` it appends
  // before the destination. Two intentionally different insertion policies:
  //   • Panel "Add stop" → NO index → appends in the destination slot (pushing
  //     the destination down). No auto-sort: the list keeps the order the user
  //     built, reorderable by hand. This is the predictable, Google-Maps rule.
  //   • Map "Add stop" → bestStopIndexFor(): the most LOGICAL leg for the click.
  //   • Map "Add stop on route" / route-line drag → the exact leg grabbed.
  // Setting start/finish is a separate action (setStart / setDestinationPoint).
  function addStop(point: Omit<RoutePoint, 'role'>, atIndex?: number) {
    setPoints((prev) => {
      const s = prev.filter((p) => p.role === 'start')
      const stps = prev.filter((p) => p.role === 'stop')
      const d = prev.filter((p) => p.role === 'destination')
      if (stps.length >= MAX_STOPS) return prev
      const idx = Math.max(0, Math.min(atIndex ?? stps.length, stps.length))
      stps.splice(idx, 0, { ...point, role: 'stop' })
      return [...s, ...stps, ...d]
    })
  }
  // Most logical insertion slot for a NEW intermediate stop, keeping the start
  // first and the finish last. Prefers the actual drawn route's geometry (drop
  // the stop onto the road leg it sits nearest to — real path, not a straight
  // line); falls back to least-added straight-line distance when there's no
  // current route to measure against. Returns undefined ("just append") until
  // both endpoints exist, since there's no start→finish span to order within.
  //
  // Auto-ordering runs ONLY when a stop is ADDED: existing stops keep their
  // relative order and manual list/marker drags are never auto-reshuffled. This
  // is the simpler, predictable rule — adding inserts logically, manual moves
  // stick until the next add.
  function bestStopIndexFor(coord: LatLng): number | undefined {
    if (route && !dirty && sectionCoords.length) {
      const near = nearestRouteSection(coord, sectionCoords)
      if (near) return near.index
    }
    if (start && destination) {
      return bestInsertionIndex(
        coord,
        start.coordinates,
        stops.map((s) => s.coordinates),
        destination.coordinates,
      )
    }
    return undefined
  }
  // Remove ANY point (start, stop, or finish) and RE-DERIVE every role from the
  // resulting order, so a deletion never leaves an empty required slot behind:
  //   • ≥2 points remain → first = start, last = finish, the rest = stops. So
  //     deleting the start PROMOTES the next point to start, deleting the finish
  //     promotes the previous point to finish, and an intermediate just drops out
  //     while the stops renumber.
  //   • <2 points remain → keep the lone point's role as-is so a proper empty
  //     start/finish state shows and no route is calculated (the endpoints effect
  //     drops the drawn route).
  // Course hints are cleared (the travel direction through the points may have
  // changed); when a route is already drawn and ≥2 points remain it recalcs
  // through the new ordering (no stale leg, markers/badges follow the roles).
  function removePoint(id: string) {
    const remaining = points.length - 1
    setPoints((prev) => {
      const next = prev.filter((p) => p.id !== id)
      if (next.length < 2) return next
      return next.map((p, i) => {
        const role: RoutePointRole =
          i === 0 ? 'start' : i === next.length - 1 ? 'destination' : 'stop'
        if (p.role === role && p.course === undefined) return p
        return { ...p, role, course: undefined }
      })
    })
    if (route && remaining >= 2) recalcAfterDragRef.current = true
  }
  // Drag-and-drop reorder across the WHOLE route (start → stops → destination,
  // which is exactly the order `points` is kept in). Moves the dragged point to
  // the hovered point's slot, then RE-DERIVES every role from the resulting
  // POSITION: first = start, last = destination, the rest = stops. So dragging a
  // stop to the top makes it the new start, dragging the finish upward demotes it
  // to a stop, swapping the two endpoints swaps start/finish — and the badges
  // follow because they read off the derived role. Course hints are cleared (the
  // travel direction through a point may have changed); the route goes "outdated"
  // and recalcs on the next Create/Update, same as the old stop-only reorder.
  function reorder(dragId: string, targetId: string) {
    if (dragId === targetId) return
    setPoints((prev) => {
      const from = prev.findIndex((p) => p.id === dragId)
      const to = prev.findIndex((p) => p.id === targetId)
      if (from < 0 || to < 0 || from === to) return prev
      const next = prev.slice()
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next.map((p, i) => {
        // A single point keeps whatever role it had (start or destination); with
        // two or more, position dictates the role.
        const role: RoutePointRole =
          next.length === 1
            ? p.role
            : i === 0
              ? 'start'
              : i === next.length - 1
                ? 'destination'
                : 'stop'
        if (p.role === role && p.course === undefined) return p
        return { ...p, role, course: undefined }
      })
    })
  }
  function clearRoute() {
    setPoints([])
    setError(null)
    setSnapNote(null)
    setAddingStop(false)
  }

  const fromSearch = (place: HerePlace): Omit<RoutePoint, 'role'> => ({
    id: uid(),
    label: place.label || place.title,
    coordinates: place.position,
    source: 'search',
  })

  // Edit an existing point's address in place: keep its id, role and order, just
  // swap in the newly geocoded coordinates/label. Any prior road-snap/course hint
  // is cleared (the new address is a fresh geocode). When a route is already drawn
  // it recalcs through the moved point immediately (same feel as a marker drag);
  // with no route yet the user still drives the first draw via Create/Update.
  function replacePoint(id: string, place: HerePlace) {
    setPoints((cur) =>
      cur.map((p) =>
        p.id === id
          ? {
              ...p,
              label: place.label || place.title,
              coordinates: place.position,
              source: 'search',
              snapped: undefined,
              course: undefined,
            }
          : p,
      ),
    )
    if (route) recalcAfterDragRef.current = true
  }

  // ── Central road-snap (screen-space candidates) ─────────────────────────────
  // The ONE place every add/drag/release path snaps to a road. It posts the
  // screen-sampled candidates (pixels around the cursor → geo; first = the exact
  // release pixel) to /snap/candidates, which returns the best on-road point: the
  // road visually under the cursor, major/through-road preferred, on the correct
  // carriageway when a `course` is known, and rejecting a candidate that would
  // force a detour through `prev`/`next`. Debug-safe: any failure/empty result
  // falls back to the exact release pixel so adding a stop is never blocked.
  async function snapCandidatesToRoad(
    candidates: ScreenGeoCandidate[],
    zoom?: number,
    course?: number,
    prev?: LatLng,
    next?: LatLng,
  ): Promise<{ label: string; coordinates: LatLng; snapped: boolean }> {
    const release: LatLng = candidates[0] ?? { lat: 0, lng: 0 }
    try {
      const { place } = await api.here.snapCandidates({ candidates, zoom, course, prev, next })
      if (place?.position) {
        setSnapNote(null)
        if (snapDebug())
          // eslint-disable-next-line no-console
          console.log('[routeSnap] chosen', {
            release,
            chosen: place.position,
            movedMeters: Math.round(haversineMeters(release, place.position)),
            major: place.major,
            label: place.label,
            course,
            zoom,
            candidates: candidates.length,
          })
        return { label: place.label || fmtCoord(place.position), coordinates: place.position, snapped: true }
      }
    } catch {
      /* fall through to the raw release coordinate below */
    }
    if (snapDebug())
      // eslint-disable-next-line no-console
      console.log('[routeSnap] candidate snap failed — using raw release', { release, zoom, course })
    setSnapNote('Could not snap the point to a road — using the exact location.')
    return { label: fmtCoord(release), coordinates: release, snapped: false }
  }

  // Resolve screen-space candidates into a fresh route point (new id), road-
  // snapped and (when `course` is known) on the correct carriageway. The course
  // is kept on the point so the truck recalc routes through it the same way.
  async function resolveClickedFromCandidates(
    candidates: ScreenGeoCandidate[],
    zoom?: number,
    course?: number,
    prev?: LatLng,
    next?: LatLng,
  ): Promise<Omit<RoutePoint, 'role'>> {
    const s = await snapCandidatesToRoad(candidates, zoom, course, prev, next)
    return { id: uid(), label: s.label, coordinates: s.coordinates, source: 'map', snapped: s.snapped, course }
  }

  // ── Marker drag → snap to road + recalc ───────────────────────────────────
  // Updates the dragged point in place (keeping its id, role + order) via the
  // SAME central screen-space snap, then recalcs immediately (like a route-line
  // drag) so the route redraws through the moved point.
  async function handleMarkerDragEnd(id: string, candidates: ScreenGeoCandidate[], zoom: number) {
    const release = candidates[0]
    if (!release) return
    // Travel direction of the route nearest the drop — computed BEFORE the snap
    // so the snap itself lands on the correct carriageway (not just the recalc).
    const course = sectionCoords.length ? routeCourseNear(release, sectionCoords) ?? undefined : undefined
    // The dragged point's neighbours in the ordered route → detour-aware ranking.
    const idx = orderedWaypoints.findIndex((p) => p.id === id)
    const prev = idx > 0 ? orderedWaypoints[idx - 1]?.coordinates : undefined
    const next =
      idx >= 0 && idx < orderedWaypoints.length - 1 ? orderedWaypoints[idx + 1]?.coordinates : undefined
    const s = await snapCandidatesToRoad(candidates, zoom, course, prev, next)
    setPoints((cur) =>
      cur.map((p) =>
        p.id === id
          ? { ...p, coordinates: s.coordinates, label: s.label, source: 'drag', snapped: s.snapped, course }
          : p,
      ),
    )
    // Recalc through the moved point (only fires when both endpoints exist).
    recalcAfterDragRef.current = true
  }

  const nearOnRoute = useMemo(() => {
    if (!menu || !sectionCoords.length) return null
    const near = nearestRouteSection({ lat: menu.lat, lng: menu.lng }, sectionCoords)
    return near && near.meters <= ON_ROUTE_METERS ? near.index : null
  }, [menu, sectionCoords])

  type MenuAction = 'start' | 'destination' | 'add' | 'add-on-route'

  async function applyMenuAction(action: MenuAction) {
    if (!menu) return
    const { lat, lng, zoom, candidates } = menu
    const insertIndex = nearOnRoute
    setMenu(null)
    const isAdd = action === 'add' || action === 'add-on-route'
    // Direction-aware snap for intermediate stops added against an existing route
    // (use the route's travel heading near the click so it lands on the correct
    // carriageway). Endpoints have no inbound route direction yet → no course.
    const course =
      isAdd && sectionCoords.length ? routeCourseNear({ lat, lng }, sectionCoords) ?? undefined : undefined
    // Detour-aware context: the leg the new stop will slot into. The raw-click
    // slot is a fine approximation for ranking; the final insert index is
    // recomputed from the snapped coordinate below.
    let prev: LatLng | undefined
    let next: LatLng | undefined
    if (isAdd) {
      const k =
        action === 'add-on-route'
          ? insertIndex ?? stops.length
          : bestStopIndexFor({ lat, lng }) ?? stops.length
      const n = neighborsForStopIndex(k)
      prev = n.prev
      next = n.next
    }
    const point = await resolveClickedFromCandidates(candidates, zoom, course, prev, next)
    if (action === 'start') setStart(point)
    else if (action === 'destination') setDestinationPoint(point)
    // Plain "Add stop": slot it into the most logical position. "Add stop on
    // route" keeps using the exact leg the user clicked near.
    else if (action === 'add') addStop(point, bestStopIndexFor(point.coordinates))
    else if (action === 'add-on-route') addStop(point, insertIndex ?? undefined)
    if (panelCollapsed) setPanelCollapsed(false)
  }

  useEffect(() => {
    if (!menu && !markerMenu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenu(null)
        setMarkerMenu(null)
      }
    }
    const onDown = (e: MouseEvent) => {
      const ctx = document.getElementById('route-context-menu')
      const mk = document.getElementById('route-marker-menu')
      const target = e.target as Node
      if (ctx && !ctx.contains(target)) setMenu(null)
      if (mk && !mk.contains(target)) setMarkerMenu(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [menu, markerMenu])

  function openMenu(info: { lat: number; lng: number; x: number; y: number; zoom: number; candidates: ScreenGeoCandidate[] }) {
    const region = regionRef.current
    const w = region?.clientWidth ?? 0
    const h = region?.clientHeight ?? 0
    const x = Math.min(info.x, Math.max(0, w - 200))
    const y = Math.min(info.y, Math.max(0, h - 210))
    setMarkerMenu(null)
    setMenu({ x, y, lat: info.lat, lng: info.lng, zoom: info.zoom, candidates: info.candidates })
  }

  // ── Marker click → role-aware popover (remove stop / copy / clear) ─────────
  function openMarkerMenu(info: { id: string; kind: RouteMarker['kind']; x: number; y: number }) {
    const role: RoutePointRole = info.kind === 'origin' ? 'start' : info.kind === 'destination' ? 'destination' : 'stop'
    const region = regionRef.current
    const w = region?.clientWidth ?? 0
    const h = region?.clientHeight ?? 0
    const x = Math.min(Math.max(0, info.x + 12), Math.max(0, w - 190))
    const y = Math.min(Math.max(0, info.y), Math.max(0, h - 130))
    setMenu(null)
    setMarkerMenu({ id: info.id, role, x, y })
  }

  // Copy a point's (displayed) coordinate to the clipboard.
  async function copyPointCoord(id: string) {
    const p = points.find((x) => x.id === id)
    if (!p) return
    const c = displayCoord(p)
    try {
      await navigator.clipboard?.writeText(`${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`)
    } catch {
      /* clipboard unavailable — ignore */
    }
    setMarkerMenu(null)
  }

  // Remove a stop from the map popover, then recalc through the remaining points.
  function removeStopFromMap(id: string) {
    setMarkerMenu(null)
    removePoint(id)
  }

  // Clear start/destination from the popover (explicit action, never a stray
  // click). Removing an endpoint drops the drawn route via the endpoints effect.
  function clearEndpointFromMap(id: string) {
    setMarkerMenu(null)
    removePoint(id)
  }

  const menuActions: { action: MenuAction; label: string; icon: React.ReactNode }[] = (() => {
    if (!start) return [{ action: 'start', label: 'Set as start', icon: <Navigation {...MENU_GLYPH} /> }]
    if (!destination) return [{ action: 'destination', label: 'Set as destination', icon: <Flag {...MENU_GLYPH} /> }]
    const list: { action: MenuAction; label: string; icon: React.ReactNode }[] = []
    if (route && nearOnRoute !== null)
      list.push({ action: 'add-on-route', label: 'Add stop on route', icon: <MapPin {...MENU_GLYPH} /> })
    list.push({ action: 'add', label: 'Add stop', icon: <MapPin {...MENU_GLYPH} /> })
    return list
  })()

  // ── Truck profile / presets ────────────────────────────────────────────────
  function updateTruck(patch: Partial<TruckProfileForm>) {
    setTruck((t) => ({ ...t, ...patch }))
    setActivePresetId(null)
  }
  function applyPreset(id: string) {
    const preset = presets.find((p) => p.id === id)
    if (!preset) return
    setTruck(preset.values)
    setActivePresetId(preset.id)
  }
  function commitSavePreset() {
    const name = presetName.trim()
    if (!name) return
    const next = saveUserPreset(name, truck)
    setUserPresets(next)
    const saved = next.find((p) => p.name === name)
    setActivePresetId(saved?.id ?? null)
    setPresetName('')
    setSavingPreset(false)
  }
  function removePreset(id: string) {
    setUserPresets(deleteUserPreset(id))
    if (activePresetId === id) setActivePresetId(null)
  }

  const collapsedTruckLabel = activePreset ? `${activePreset.name} · ${truckSummary(truck)}` : truckSummary(truck)

  // Create/Update route button state.
  const hasEndpoints = Boolean(start && destination)
  const routeUpToDate = Boolean(route) && !dirty
  const routeButtonLabel = loading
    ? 'Calculating…'
    : !route
      ? 'Create route'
      : dirty
        ? 'Update route'
        : 'Route up to date'
  const routeButtonDisabled = !hasEndpoints || loading || routeUpToDate

  // Inline address editor shown in place of a committed row while editing. Seeds
  // the search box with the current address; picking a result replaces the point
  // (keeping its role/order), cancelling leaves the old address untouched.
  function editorRow(p: RoutePoint) {
    const stopIndex = p.role === 'stop' ? stops.findIndex((s) => s.id === p.id) + 1 : 0
    const badge =
      p.role === 'start' ? (
        <span className="h-5 w-5 rounded-full border border-done/30 bg-done/10 text-done flex items-center justify-center">
          <Navigation size="0.6875rem" strokeWidth={2.2} />
        </span>
      ) : p.role === 'destination' ? (
        <span className="h-5 w-5 rounded-full border border-alert/30 bg-alert/10 text-alert flex items-center justify-center">
          <Flag size="0.6875rem" strokeWidth={2.2} />
        </span>
      ) : (
        <span className="h-5 w-5 rounded-full border border-white/[0.22] bg-white/[0.06] text-[0.625rem] font-semibold flex items-center justify-center">
          {stopIndex}
        </span>
      )
    return (
      <div className="flex items-center gap-2.5">
        <div className="shrink-0">{badge}</div>
        <div className="flex-1 min-w-0">
          <PlaceSearchField
            value={null}
            initialQuery={p.label}
            autoFocus
            pill
            onChange={(place) => {
              if (place) {
                replacePoint(p.id, place)
                setEditingId(null)
              }
            }}
            placeholder="Search address or place…"
          />
        </div>
        <button
          onClick={() => setEditingId(null)}
          aria-label="Cancel edit"
          className="h-8 w-8 shrink-0 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.06] transition-colors"
        >
          <X size="0.9375rem" strokeWidth={2} />
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="h-[var(--header-height)] flex items-center gap-3 px-4 shrink-0">
        <button
          onClick={onBack}
          aria-label="Back to workspace"
          className={`${ICON_ACTION_BASE} ${ICON_ACTION_IDLE} -ml-1`}
        >
          <ArrowLeft size="1.25rem" strokeWidth={1.8} />
        </button>
        <div className="min-w-0 text-[0.9375rem] font-semibold tracking-[-0.2px] leading-tight truncate">
          Route planner
        </div>
      </header>

      {/* Map region — the panel floats over this and never resizes it. */}
      <div ref={regionRef} className="relative flex-1 min-h-[22.5rem] rounded-card overflow-hidden border border-white/[0.08]">
        <HereMap
          markers={markers}
          routePolylines={polylines}
          // Total route distance, mid-line badge — same value as the panel stat.
          routeDistanceLabel={route ? formatDistance(route.summary.length) : null}
          truckOverlay={truckOverlay}
          onTruckOverlayAvailabilityChange={setOverlayAvailable}
          onMapContextMenu={openMenu}
          onMapViewChange={() => {
            setMenu(null)
            setMarkerMenu(null)
          }}
          onMarkerDragEnd={handleMarkerDragEnd}
          onMarkerClick={openMarkerMenu}
          onRouteDragEnd={handleRouteDragEnd}
          panelInsetPx={panelCollapsed ? 0 : PANEL_INSET_PX}
          className="absolute inset-0"
        />

        {/* HGV / truck overlay toggle */}
        <button
          onClick={() => setTruckOverlay((v) => !v)}
          disabled={!overlayAvailable}
          title={
            overlayAvailable
              ? 'Toggle HERE truck/HGV restriction overlay'
              : 'Truck overlay not available on this HERE plan'
          }
          className={`absolute z-20 top-3 right-3 flex items-center gap-1.5 h-8 px-3 rounded-full border text-[0.75rem] font-medium shadow-[0_4px_14px_rgba(0,0,0,0.3)] transition-colors ${
            truckOverlay ? 'bg-active text-bg border-active' : 'bg-rail/90 text-text border-white/[0.08] hover:bg-rail'
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          <Truck size="0.875rem" strokeWidth={2} />
          HGV
        </button>

        {/* Reopen tab — visible only when the panel is collapsed. */}
        <button
          onClick={() => setPanelCollapsed(false)}
          aria-label="Open route panel"
          className={`absolute z-20 top-3 left-3 flex items-center gap-1.5 h-9 pl-2.5 pr-3 rounded-full border border-white/[0.08] bg-rail/90 text-text text-[0.75rem] font-medium shadow-[0_4px_14px_rgba(0,0,0,0.3)] transition-opacity hover:bg-rail ${
            panelCollapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <ChevronRight size="1rem" strokeWidth={2} />
          Route
        </button>

        {/* Floating route panel — compact; collapses horizontally to the left. */}
        <div
          className="absolute z-20 top-3 left-3 w-[18.75rem] max-w-[calc(100%-1.5rem)] max-h-[calc(100%-1.5rem)] flex flex-col gap-2 transition-transform duration-300 ease-out"
          style={{ transform: panelCollapsed ? 'translateX(calc(-100% - 1rem))' : 'translateX(0)' }}
          aria-hidden={panelCollapsed}
        >
          <div className="flex items-center justify-between pl-3.5 pr-2 h-11 rounded-[1.25rem] border border-white/[0.08] bg-rail shadow-[0_6px_20px_rgba(0,0,0,0.3)] shrink-0">
            <div className="min-w-0">
              <div className="text-[0.8125rem] font-semibold tracking-[-0.1px]">Route</div>
              <div className="text-[0.625rem] text-faint leading-tight">Plan your delivery path</div>
            </div>
            <div className="flex items-center gap-0.5">
              {points.length > 0 && (
                <button
                  onClick={clearRoute}
                  title="Clear route"
                  className="h-7 px-2 flex items-center gap-1 rounded-btn text-[0.6875rem] text-muted hover:text-text hover:bg-white/[0.06] transition-colors"
                >
                  <Trash2 size="0.8125rem" strokeWidth={1.8} /> Clear
                </button>
              )}
              <button
                onClick={() => setPanelCollapsed(true)}
                title="Collapse panel"
                aria-label="Collapse panel"
                className="h-7 w-7 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.06] transition-colors"
              >
                <ChevronLeft size="1rem" strokeWidth={2} />
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
            <section className="rounded-[1.25rem] border border-white/[0.08] bg-rail p-2 flex flex-col gap-1.5">
            {/* Start — draggable so it can be reordered into the route (drop it
                lower and the next point becomes the new start). */}
            {start ? (
              editingId === start.id ? (
                editorRow(start)
              ) : (
                <PointRow
                  role="start"
                  point={start}
                  coord={displayCoord(start)}
                  draggable={canReorder}
                  dragging={dragId === start.id}
                  onDragStartRow={() => setDragId(start.id)}
                  onDragEnterRow={() => {
                    if (dragId && dragId !== start.id) reorder(dragId, start.id)
                  }}
                  onDragEndRow={() => setDragId(null)}
                  onEdit={() => setEditingId(start.id)}
                  onClear={() => removePoint(start.id)}
                />
              )
            ) : (
              <div className="flex items-center gap-2.5">
                <span className="h-5 w-5 shrink-0 rounded-full border border-done/30 bg-done/10 text-done flex items-center justify-center">
                  <Navigation size="0.6875rem" strokeWidth={2.2} />
                </span>
                <div className="min-w-0 flex-1">
                  <PlaceSearchField pill value={null} onChange={(p) => p && setStart(fromSearch(p))} placeholder="Start address or place…" />
                </div>
              </div>
            )}

            {/* Stops — draggable to reorder anywhere in the route. */}
            {stops.map((s, i) =>
              editingId === s.id ? (
                <div key={s.id}>{editorRow(s)}</div>
              ) : (
                <PointRow
                  key={s.id}
                  role="stop"
                  index={i + 1}
                  point={s}
                  coord={displayCoord(s)}
                  draggable={canReorder}
                  dragging={dragId === s.id}
                  onDragStartRow={() => setDragId(s.id)}
                  onDragEnterRow={() => {
                    if (dragId && dragId !== s.id) reorder(dragId, s.id)
                  }}
                  onDragEndRow={() => setDragId(null)}
                  onEdit={() => setEditingId(s.id)}
                  onClear={() => removePoint(s.id)}
                />
              ),
            )}

            {/* Compact "add stop" — secondary action, not a permanent input. */}
            {stops.length < MAX_STOPS &&
              (addingStop ? (
                <div className="flex items-center gap-2.5">
                  <span className="h-5 w-5 shrink-0 rounded-full border border-white/[0.18] bg-white/[0.06] text-muted flex items-center justify-center">
                    <Plus size="0.6875rem" strokeWidth={2.2} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <PlaceSearchField
                      pill
                      value={null}
                      onChange={(p) => {
                        if (p) {
                          // Panel "Add stop" appends the new stop in the current
                          // destination slot (pushing the destination down so it
                          // stays last) and does NOT auto-sort — the user placed it
                          // here deliberately, Google-Maps-style. Only map/route
                          // adds slot into the nearest leg (addStop with an index).
                          addStop(fromSearch(p))
                          setAddingStop(false)
                        }
                      }}
                      placeholder="Stop address or place…"
                    />
                  </div>
                  <button
                    onClick={() => setAddingStop(false)}
                    aria-label="Cancel add stop"
                    className="h-8 w-8 shrink-0 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.06] transition-colors"
                  >
                    <X size="0.9375rem" strokeWidth={2} />
                  </button>
                </div>
              ) : (
                // Aligned with the point rows/fields: a quiet dashed "insert
                // here" slot, not floating text — clear but secondary.
                <button
                  onClick={() => setAddingStop(true)}
                  className="self-start ml-7 h-7 flex items-center gap-1.5 px-2.5 rounded-full bg-white/[0.04] text-[0.71875rem] text-muted hover:text-text hover:bg-white/[0.08] transition-colors"
                >
                  <Plus size="0.8125rem" strokeWidth={2} /> Add stop
                </button>
              ))}

            {/* Destination — draggable too; drop it higher and it becomes a stop
                while the last remaining point becomes the new finish. */}
            {destination ? (
              editingId === destination.id ? (
                editorRow(destination)
              ) : (
                <PointRow
                  role="destination"
                  point={destination}
                  coord={displayCoord(destination)}
                  draggable={canReorder}
                  dragging={dragId === destination.id}
                  onDragStartRow={() => setDragId(destination.id)}
                  onDragEnterRow={() => {
                    if (dragId && dragId !== destination.id) reorder(dragId, destination.id)
                  }}
                  onDragEndRow={() => setDragId(null)}
                  onEdit={() => setEditingId(destination.id)}
                  onClear={() => removePoint(destination.id)}
                />
              )
            ) : (
              <div className="flex items-center gap-2.5">
                <span className="h-5 w-5 shrink-0 rounded-full border border-alert/30 bg-alert/10 text-alert flex items-center justify-center">
                  <Flag size="0.6875rem" strokeWidth={2.2} />
                </span>
                <div className="min-w-0 flex-1">
                  <PlaceSearchField pill value={null} onChange={(p) => p && setDestinationPoint(fromSearch(p))} placeholder="End address or place…" />
                </div>
              </div>
            )}
            </section>

            {/* Truck profile (collapsible, with presets) — a circular pill that
                matches the Create route button while collapsed (no dark frame),
                morphing into a rounded card once opened to hold the field grid. */}
            <div className={`bg-rail ${truckOpen ? 'rounded-[1.25rem] p-1.5' : 'rounded-full'}`}>
              <button
                onClick={() => setTruckOpen((o) => !o)}
                aria-expanded={truckOpen}
                className={`w-full h-10 flex items-center justify-between gap-2 px-2 text-left hover:bg-white/[0.04] transition-colors ${
                  truckOpen ? 'rounded-[0.875rem]' : 'rounded-full'
                }`}
              >
                {/* Left section is fixed (icon + label never wrap or shrink);
                    the collapsed value takes the leftover width and truncates,
                    with the chevron pinned on the far right. */}
                <span className="flex items-center gap-2.5 text-[0.75rem] font-medium shrink-0 whitespace-nowrap">
                  <span className="h-7 w-7 rounded-full bg-white/[0.06] text-muted flex items-center justify-center shrink-0">
                    <Truck size="0.875rem" strokeWidth={1.8} />
                  </span>
                  Truck profile
                </span>
                <span className="flex-1 min-w-0 flex items-center justify-end gap-1.5 text-[0.6875rem] text-muted">
                  {!truckOpen && (
                    <span className="truncate" title={collapsedTruckLabel}>
                      {collapsedTruckLabel}
                    </span>
                  )}
                  {truckOpen ? <ChevronUp size="0.9375rem" strokeWidth={2} className="shrink-0" /> : <ChevronDown size="0.9375rem" strokeWidth={2} className="shrink-0" />}
                </span>
              </button>

              {truckOpen && (
                <div className="flex flex-col gap-2.5 px-1.5 pt-2 pb-1.5 border-t border-white/[0.05]">
                  {/* Presets */}
                  <div className="flex items-center gap-1.5">
                    <PresetSelect
                      builtIn={builtInPresets()}
                      saved={userPresets}
                      activeId={activePresetId}
                      onSelect={(id) => (id ? applyPreset(id) : setActivePresetId(null))}
                    />
                    <button
                      onClick={() => setSavingPreset((s) => !s)}
                      title="Save current profile as a preset"
                      aria-label="Save preset"
                      className="h-8 w-8 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.06] transition-colors"
                    >
                      <Bookmark size="0.875rem" strokeWidth={1.8} />
                    </button>
                    {activePreset && !activePreset.builtIn && (
                      <button
                        onClick={() => removePreset(activePreset.id)}
                        title="Delete this preset"
                        aria-label="Delete preset"
                        className="h-8 w-8 flex items-center justify-center rounded-full text-muted hover:text-alert hover:bg-white/[0.06] transition-colors"
                      >
                        <Trash2 size="0.875rem" strokeWidth={1.8} />
                      </button>
                    )}
                  </div>

                  {savingPreset && (
                    <div className="flex items-center gap-1.5">
                      <input
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && commitSavePreset()}
                        placeholder="Preset name"
                        autoFocus
                        className="h-8 flex-1 min-w-0 rounded-full border border-white/[0.06] bg-white/[0.04] px-2.5 text-[0.75rem] outline-none transition-colors focus:border-white/[0.16] focus:bg-white/[0.05] placeholder:text-faint"
                      />
                      <button
                        onClick={commitSavePreset}
                        disabled={!presetName.trim()}
                        className="h-8 px-2.5 flex items-center gap-1 rounded-btn bg-active text-bg text-[0.75rem] font-semibold hover:bg-active/90 disabled:opacity-40 transition-colors"
                      >
                        <Check size="0.8125rem" strokeWidth={2.4} /> Save
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <NumberField label="Height (cm)" value={truck.heightCm} onChange={(v) => updateTruck({ heightCm: v })} placeholder="400" />
                    <NumberField label="Width (cm)" value={truck.widthCm} onChange={(v) => updateTruck({ widthCm: v })} placeholder="255" />
                    <NumberField label="Length (cm)" value={truck.lengthCm} onChange={(v) => updateTruck({ lengthCm: v })} placeholder="1650" />
                    <NumberField label="Gross weight (kg)" value={truck.grossWeightKg} onChange={(v) => updateTruck({ grossWeightKg: v })} placeholder="40000" />
                    <NumberField label="Axle count" value={truck.axleCount} onChange={(v) => updateTruck({ axleCount: v })} placeholder="5" />
                    <NumberField label="Trailer count" value={truck.trailerCount} onChange={(v) => updateTruck({ trailerCount: v })} placeholder="1" />
                  </div>
                </div>
              )}
            </div>

            {/* Create / update route — the explicit action that draws it. A
                standalone pill, not wrapped in a card, so no dark frame rings it.
                Loud accent fill while there's something to do; a quiet solid
                neutral (matching the other cards' fill) when disabled / loading /
                up to date, so it always reads on its own over the map. */}
            <div className="flex flex-col gap-1">
              <button
                onClick={calculate}
                disabled={routeButtonDisabled}
                title={!hasEndpoints ? 'Set a start and destination first' : undefined}
                className={`w-full h-10 rounded-full font-semibold text-[0.8125rem] flex items-center justify-center gap-2 transition-colors ${
                  routeButtonDisabled
                    ? 'bg-rail text-muted cursor-default'
                    : 'bg-text text-bg hover:bg-white'
                }`}
              >
                {loading ? (
                  <Spinner size={14} />
                ) : routeUpToDate ? (
                  <Check size="1rem" strokeWidth={2.4} className="text-done" />
                ) : (
                  <RouteIcon size="1rem" strokeWidth={2} />
                )}
                {routeButtonLabel}
              </button>
              {route && dirty && !loading && (
                <div className="px-2 pt-0.5 text-[0.6875rem] text-amber-200/80">
                  Route is outdated — press “Update route”.
                </div>
              )}
            </div>

            {/* Status */}
            {error && (
              <div className="text-[0.71875rem] leading-snug text-alert bg-alert/10 border border-alert/20 rounded-card px-2.5 py-2">{error}</div>
            )}
            {snapNote && <div className="text-[0.6875rem] text-amber-200/80">{snapNote}</div>}

            {/* Summary + notices */}
            {route && !loading && (
              <div className="flex flex-col gap-2 rounded-[1.25rem] border border-white/[0.08] bg-rail p-2">
                <div className="grid grid-cols-3 divide-x divide-white/[0.06]">
                  <Stat label="Distance" value={formatDistance(route.summary.length)} />
                  <Stat label="Duration" value={formatDuration(route.summary.duration)} />
                  <Stat label="ETA" value={formatEta(route.summary.duration)} />
                </div>
                {notices.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <div className="text-[0.625rem] font-semibold text-faint uppercase tracking-badge">Notices</div>
                    {notices.map((n, i) => (
                      <div key={`${n.code}-${i}`} className="flex items-start gap-2 text-[0.71875rem] leading-snug text-amber-200/90">
                        <TriangleAlert size="0.8125rem" className="mt-0.5 shrink-0" strokeWidth={1.8} />
                        <span>{n.title || n.code || 'Route notice'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right-click context menu */}
        {menu && (
          <div
            id="route-context-menu"
            className={`absolute z-30 min-w-[11.25rem] ${MENU_CONTAINER}`}
            style={{ left: menu.x, top: menu.y }}
          >
            {/* Coordinate header — the copy button copies EXACTLY the displayed
                string. Clicking it keeps the menu open (it's inside the menu, so
                the outside-click closer ignores it). */}
            <div className="pl-3 pr-1.5 py-1 flex items-center justify-between gap-2 border-b border-white/[0.06] mb-1">
              <span className="text-[0.625rem] uppercase tracking-wide text-muted tabular-nums truncate">
                {fmtCoord({ lat: menu.lat, lng: menu.lng })}
              </span>
              <CopyCoordButton text={fmtCoord({ lat: menu.lat, lng: menu.lng })} />
            </div>
            {menuActions.map((opt) => (
              <button
                key={opt.action}
                onClick={() => applyMenuAction(opt.action)}
                className={menuItemClass()}
              >
                <span className={menuIconClass()}>{opt.icon}</span>
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* Marker popover — opened by clicking a waypoint marker. Role-aware:
            intermediate stops can be removed; start/destination only offer copy
            (+ an explicit clear), so a stray click never deletes an endpoint. */}
        {markerMenu && (() => {
          const point = points.find((p) => p.id === markerMenu.id)
          if (!point) return null
          const heading =
            markerMenu.role === 'start'
              ? 'Start'
              : markerMenu.role === 'destination'
                ? 'Destination'
                : `Stop ${stops.findIndex((s) => s.id === markerMenu.id) + 1}`
          return (
            <div
              id="route-marker-menu"
              className={`absolute z-30 min-w-[11.25rem] ${MENU_CONTAINER}`}
              style={{ left: markerMenu.x, top: markerMenu.y }}
            >
              <div className="px-3 py-1.5 border-b border-white/[0.06] mb-1">
                <div className="text-[0.625rem] uppercase tracking-wide text-muted">{heading}</div>
                <div className="text-[0.75rem] text-text truncate" title={point.label}>
                  {point.label}
                </div>
              </div>
              <button onClick={() => copyPointCoord(markerMenu.id)} className={menuItemClass()}>
                <span className={menuIconClass()}><Copy {...MENU_GLYPH} /></span>
                Copy coordinates
              </button>
              {markerMenu.role === 'stop' ? (
                <button
                  onClick={() => removeStopFromMap(markerMenu.id)}
                  className={menuItemClass('danger')}
                >
                  <span className={menuIconClass('danger')}><Trash2 {...MENU_GLYPH} /></span>
                  Remove stop
                </button>
              ) : (
                <button
                  onClick={() => clearEndpointFromMap(markerMenu.id)}
                  className={menuItemClass()}
                >
                  <span className={menuIconClass()}><X {...MENU_GLYPH} /></span>
                  {markerMenu.role === 'start' ? 'Clear start' : 'Clear destination'}
                </button>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
