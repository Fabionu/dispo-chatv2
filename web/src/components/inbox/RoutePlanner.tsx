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
  GripVertical,
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
import type {
  HerePlace,
  LatLng,
  RouteMarker,
  RoutePoint,
  RoutePointRole,
  TruckProfile,
  TruckProfileForm,
  TruckRoute,
} from '../../lib/here/types'

type Props = {
  onBack: () => void
}

const EMPTY_TRUCK: TruckProfileForm = {
  heightCm: '',
  widthCm: '',
  lengthCm: '',
  grossWeightKg: '',
  axleCount: '',
  trailerCount: '',
}

const MAX_STOPS = 8
const ON_ROUTE_METERS = 200
// Width the expanded panel overlaps on the map's left edge (left-3 + w-[300px]
// + breathing room) — fed to the map so the route frames clear of it.
const PANEL_INSET_PX = 322

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

const fmtCoord = (c: LatLng) => `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`

// Opt-in drag/snap tracing (mirrors HereMap): `localStorage.routeSnapDebug = '1'`
// in the console logs the raw release coordinate, the snapped point, and how far
// the snap moved it. Silent + off by default.
function snapDebug(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('routeSnapDebug') === '1'
  } catch {
    return false
  }
}

function toTruckProfile(form: TruckProfileForm): TruckProfile {
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

function truckSummary(form: TruckProfileForm): string {
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
function formatDistance(metres: number): string {
  const km = metres / 1000
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  return h > 0 ? `${h} h ${m} min` : `${m} min`
}

function formatEta(seconds: number): string {
  const eta = new Date(Date.now() + seconds * 1000)
  return eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function errorMessage(code: string): string {
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

function snappedFromRoute(
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

type MenuState = { x: number; y: number; lat: number; lng: number; zoom: number }
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
        via: stops.map((s) => ({ ...s.coordinates, course: s.course })),
        truck: toTruckProfile(truck),
      })
      if (id === reqIdRef.current) {
        setRoute(res.route)
        setCalculatedSig(sig)
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
  useEffect(() => {
    if (recalcAfterDragRef.current && start && destination) {
      recalcAfterDragRef.current = false
      calculate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSig])

  // Route-line drag released → insert a snapped stop into the grabbed segment,
  // then recalc. `section` maps to the stops-array insertion index (section i
  // joins waypoint i and i+1, so the new stop becomes waypoint i+1).
  async function handleRouteDragEnd(section: number, lat: number, lng: number, zoom: number) {
    // Heading of the grabbed section at the release point → drives BOTH the
    // direction-aware snap (correct carriageway, not the oncoming road) and the
    // recalc waypoint course. Computed before the snap so the snap can use it.
    const seg = sectionCoords[section]
    const course = seg ? routeCourseNear({ lat, lng }, [seg]) ?? undefined : undefined
    const resolved = await resolveClicked(lat, lng, zoom, course)
    addStop({ ...resolved, source: 'drag' }, section)
    recalcAfterDragRef.current = true
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
  // before the destination. Callers pass an index for every deliberate case:
  //   • "Add stop" (panel/map) → bestStopIndexFor(): the most LOGICAL position,
  //     so a new stop slots into geographic order instead of just appending.
  //   • route-line drag → the exact leg that was grabbed.
  //   • "Add stop on route" → the nearest leg.
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
  function removePoint(id: string) {
    setPoints((prev) => prev.filter((p) => p.id !== id))
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

  // ── Central road-snap ──────────────────────────────────────────────────────
  // The ONE place every add/drag/release path snaps a raw map coordinate to a
  // road. Calls the server's /snap (prefers a nearby main road, else snaps onto
  // the nearest routable road via a HERE route preview), and is debug-safe: any
  // failure or empty result falls back to the raw coordinate so adding a stop is
  // never blocked. `zoom` biases the snap toward visible major roads when zoomed
  // out. The returned label stays consistent with the returned coordinate.
  // `course` (route travel heading here) makes the snap DIRECTION-AWARE so the
  // point lands on the correct carriageway of a divided road, not the contraflow
  // side. Undefined when there's no route direction to reference (e.g. the very
  // first points, or a click far from any route).
  async function snapCoordinate(
    lat: number,
    lng: number,
    zoom?: number,
    course?: number,
  ): Promise<{ label: string; coordinates: LatLng; snapped: boolean }> {
    try {
      const { place } = await api.here.snap(lat, lng, zoom, course)
      if (place?.position) {
        setSnapNote(null)
        if (snapDebug())
          // eslint-disable-next-line no-console
          console.log('[routeSnap] snapped', {
            raw: { lat, lng },
            snapped: place.position,
            movedMeters: Math.round(haversineMeters({ lat, lng }, place.position)),
            course,
            major: place.major,
            label: place.label,
            zoom,
          })
        return { label: place.label || fmtCoord(place.position), coordinates: place.position, snapped: true }
      }
    } catch {
      /* fall through to the raw coordinate below */
    }
    if (snapDebug())
      // eslint-disable-next-line no-console
      console.log('[routeSnap] snap failed — using raw coordinate', { lat, lng, zoom, course })
    setSnapNote('Could not snap the point to a road — using the exact location.')
    return { label: fmtCoord({ lat, lng }), coordinates: { lat, lng }, snapped: false }
  }

  // Resolve a clicked coordinate into a fresh route point (new id), road-snapped
  // and (when `course` is known) on the correct carriageway. The course is kept
  // on the point so the truck recalc routes through it in the same direction.
  async function resolveClicked(
    lat: number,
    lng: number,
    zoom?: number,
    course?: number,
  ): Promise<Omit<RoutePoint, 'role'>> {
    const s = await snapCoordinate(lat, lng, zoom, course)
    return { id: uid(), label: s.label, coordinates: s.coordinates, source: 'map', snapped: s.snapped, course }
  }

  // ── Marker drag → snap to road + recalc ───────────────────────────────────
  // Updates the dragged point in place (keeping its id, role + order) via the
  // SAME central snap, then recalcs immediately (like a route-line drag) so the
  // route redraws through the moved point.
  async function handleMarkerDragEnd(id: string, lat: number, lng: number, zoom: number) {
    // Travel direction of the route nearest the drop — computed BEFORE the snap
    // so the snap itself lands on the correct carriageway (not just the recalc).
    const course = sectionCoords.length ? routeCourseNear({ lat, lng }, sectionCoords) ?? undefined : undefined
    const s = await snapCoordinate(lat, lng, zoom, course)
    setPoints((prev) =>
      prev.map((p) =>
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
    const { lat, lng, zoom } = menu
    const insertIndex = nearOnRoute
    setMenu(null)
    // Direction-aware snap for intermediate stops added against an existing route
    // (use the route's travel heading near the click so it lands on the correct
    // carriageway). Endpoints have no inbound route direction yet → no course.
    const course =
      (action === 'add' || action === 'add-on-route') && sectionCoords.length
        ? routeCourseNear({ lat, lng }, sectionCoords) ?? undefined
        : undefined
    const point = await resolveClicked(lat, lng, zoom, course)
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

  function openMenu(info: { lat: number; lng: number; x: number; y: number; zoom: number }) {
    const region = regionRef.current
    const w = region?.clientWidth ?? 0
    const h = region?.clientHeight ?? 0
    const x = Math.min(info.x, Math.max(0, w - 200))
    const y = Math.min(info.y, Math.max(0, h - 210))
    setMarkerMenu(null)
    setMenu({ x, y, lat: info.lat, lng: info.lng, zoom: info.zoom })
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
    recalcAfterDragRef.current = true
  }

  // Clear start/destination from the popover (explicit action, never a stray
  // click). Removing an endpoint drops the drawn route via the endpoints effect.
  function clearEndpointFromMap(id: string) {
    setMarkerMenu(null)
    removePoint(id)
  }

  const menuActions: { action: MenuAction; label: string; icon: React.ReactNode }[] = (() => {
    if (!start) return [{ action: 'start', label: 'Set as start', icon: <Navigation size={14} /> }]
    if (!destination) return [{ action: 'destination', label: 'Set as destination', icon: <Flag size={14} /> }]
    const list: { action: MenuAction; label: string; icon: React.ReactNode }[] = []
    if (route && nearOnRoute !== null)
      list.push({ action: 'add-on-route', label: 'Add stop on route', icon: <MapPin size={14} /> })
    list.push({ action: 'add', label: 'Add stop', icon: <MapPin size={14} /> })
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

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="h-[var(--header-height)] flex items-center gap-3 px-4 shrink-0">
        <button
          onClick={onBack}
          aria-label="Back to workspace"
          className="h-9 w-9 -ml-1 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.05] transition-colors"
        >
          <ArrowLeft size={20} strokeWidth={1.8} />
        </button>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold tracking-[-0.2px] leading-tight">Route planner</div>
          <div className="text-[12px] text-muted leading-tight mt-0.5">
            Truck routing with HERE · right-click the map to add points
          </div>
        </div>
      </header>

      {/* Map region — the panel floats over this and never resizes it. */}
      <div ref={regionRef} className="relative flex-1 min-h-[360px] mt-3 rounded-card overflow-hidden border border-white/[0.08]">
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
          className={`absolute z-20 top-3 right-3 flex items-center gap-1.5 h-8 px-3 rounded-full border text-[12px] font-medium shadow-lg transition-colors ${
            truckOverlay ? 'bg-active text-bg border-active' : 'bg-rail/90 text-text border-white/[0.12] hover:bg-rail'
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          <Truck size={14} strokeWidth={2} />
          HGV
        </button>

        {/* Reopen tab — visible only when the panel is collapsed. */}
        <button
          onClick={() => setPanelCollapsed(false)}
          aria-label="Open route panel"
          className={`absolute z-20 top-3 left-3 flex items-center gap-1.5 h-9 pl-2.5 pr-3 rounded-full border border-white/[0.12] bg-rail/90 text-text text-[12px] font-medium shadow-lg transition-opacity hover:bg-rail ${
            panelCollapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <ChevronRight size={16} strokeWidth={2} />
          Route
        </button>

        {/* Floating route panel — compact; collapses horizontally to the left. */}
        <div
          className="absolute z-20 top-3 left-3 w-[300px] max-w-[calc(100%-1.5rem)] max-h-[calc(100%-1.5rem)] flex flex-col rounded-card border border-white/[0.12] bg-rail/95 backdrop-blur-sm shadow-2xl transition-transform duration-300 ease-out"
          style={{ transform: panelCollapsed ? 'translateX(calc(-100% - 1rem))' : 'translateX(0)' }}
          aria-hidden={panelCollapsed}
        >
          <div className="flex items-center justify-between pl-3.5 pr-2 h-10 border-b border-white/[0.08] shrink-0">
            <span className="text-[13px] font-semibold tracking-[-0.1px]">Route</span>
            <div className="flex items-center gap-0.5">
              {points.length > 0 && (
                <button
                  onClick={clearRoute}
                  title="Clear route"
                  className="h-7 px-2 flex items-center gap-1 rounded text-[11px] text-muted hover:text-text hover:bg-white/[0.06] transition-colors"
                >
                  <Trash2 size={13} strokeWidth={1.8} /> Clear
                </button>
              )}
              <button
                onClick={() => setPanelCollapsed(true)}
                title="Collapse panel"
                aria-label="Collapse panel"
                className="h-7 w-7 flex items-center justify-center rounded text-muted hover:text-text hover:bg-white/[0.06] transition-colors"
              >
                <ChevronLeft size={16} strokeWidth={2} />
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5 flex flex-col gap-2">
            {/* Start — draggable so it can be reordered into the route (drop it
                lower and the next point becomes the new start). */}
            {start ? (
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
                onClear={() => removePoint(start.id)}
              />
            ) : (
              <PlaceSearchField label="Start" value={null} onChange={(p) => p && setStart(fromSearch(p))} placeholder="Start address or place…" />
            )}

            {/* Stops — draggable to reorder anywhere in the route. */}
            {stops.map((s, i) => (
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
                onClear={() => removePoint(s.id)}
              />
            ))}

            {/* Compact "add stop" — secondary action, not a permanent input. */}
            {stops.length < MAX_STOPS &&
              (addingStop ? (
                <div className="flex items-start gap-1.5">
                  <div className="flex-1 min-w-0">
                    <PlaceSearchField
                      value={null}
                      onChange={(p) => {
                        if (p) {
                          const sp = fromSearch(p)
                          addStop(sp, bestStopIndexFor(sp.coordinates))
                          setAddingStop(false)
                        }
                      }}
                      placeholder="Stop address or place…"
                    />
                  </div>
                  <button
                    onClick={() => setAddingStop(false)}
                    aria-label="Cancel add stop"
                    className="h-10 w-8 flex items-center justify-center rounded text-muted hover:text-text hover:bg-white/[0.06] transition-colors"
                  >
                    <X size={15} strokeWidth={2} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setAddingStop(true)}
                  className="self-start flex items-center gap-1.5 text-[12px] text-muted hover:text-text transition-colors"
                >
                  <Plus size={14} strokeWidth={2} /> Add stop
                </button>
              ))}

            {/* Destination — draggable too; drop it higher and it becomes a stop
                while the last remaining point becomes the new finish. */}
            {destination ? (
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
                onClear={() => removePoint(destination.id)}
              />
            ) : (
              <PlaceSearchField label="Destination" value={null} onChange={(p) => p && setDestinationPoint(fromSearch(p))} placeholder="End address or place…" />
            )}

            {/* Truck profile (collapsible, with presets) */}
            <div className="border-t border-white/[0.08] pt-1.5">
              <button onClick={() => setTruckOpen((o) => !o)} className="w-full flex items-center justify-between py-1 text-left">
                <span className="flex items-center gap-2 text-[12px] font-semibold tracking-[-0.1px]">
                  <Truck size={14} strokeWidth={1.8} className="text-muted" /> Truck profile
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-muted min-w-0">
                  {!truckOpen && <span className="truncate max-w-[150px]">{collapsedTruckLabel}</span>}
                  {truckOpen ? <ChevronUp size={15} strokeWidth={2} /> : <ChevronDown size={15} strokeWidth={2} />}
                </span>
              </button>

              {truckOpen && (
                <div className="flex flex-col gap-2.5 pt-2">
                  {/* Presets */}
                  <div className="flex items-center gap-1.5">
                    <select
                      value={activePresetId ?? ''}
                      onChange={(e) => (e.target.value ? applyPreset(e.target.value) : setActivePresetId(null))}
                      className="h-8 flex-1 min-w-0 rounded-lg border border-white/[0.1] bg-rail px-2 text-[12px] text-text outline-none focus:border-white/[0.25]"
                    >
                      <option value="">Preset…</option>
                      <optgroup label="Built-in">
                        {builtInPresets().map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </optgroup>
                      {userPresets.length > 0 && (
                        <optgroup label="Saved">
                          {userPresets.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <button
                      onClick={() => setSavingPreset((s) => !s)}
                      title="Save current profile as a preset"
                      aria-label="Save preset"
                      className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/[0.1] text-muted hover:text-text hover:bg-white/[0.06] transition-colors"
                    >
                      <Bookmark size={14} strokeWidth={1.8} />
                    </button>
                    {activePreset && !activePreset.builtIn && (
                      <button
                        onClick={() => removePreset(activePreset.id)}
                        title="Delete this preset"
                        aria-label="Delete preset"
                        className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/[0.1] text-muted hover:text-red-300 hover:bg-white/[0.06] transition-colors"
                      >
                        <Trash2 size={14} strokeWidth={1.8} />
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
                        className="h-8 flex-1 min-w-0 rounded-lg border border-white/[0.1] bg-white/[0.03] px-2.5 text-[12px] outline-none focus:border-white/[0.25] placeholder:text-muted/60"
                      />
                      <button
                        onClick={commitSavePreset}
                        disabled={!presetName.trim()}
                        className="h-8 px-2.5 flex items-center gap-1 rounded-lg bg-active/90 text-bg text-[12px] font-semibold hover:bg-active disabled:opacity-40 transition-colors"
                      >
                        <Check size={13} strokeWidth={2.4} /> Save
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

            {/* Create / update route — the explicit action that draws it. */}
            <button
              onClick={calculate}
              disabled={routeButtonDisabled}
              title={!hasEndpoints ? 'Set a start and destination first' : undefined}
              className="h-10 rounded-lg bg-active/90 text-bg font-semibold text-[13px] flex items-center justify-center gap-2 transition-colors hover:bg-active disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {routeUpToDate ? <Check size={16} strokeWidth={2.4} /> : <RouteIcon size={16} strokeWidth={2} />}
              {routeButtonLabel}
            </button>
            {route && dirty && !loading && (
              <div className="text-[11px] text-amber-200/80">Route is outdated — press “Update route”.</div>
            )}

            {/* Status */}
            {loading && (
              <div className="flex items-center gap-2 text-[12px] text-muted">
                <Spinner size={14} /> Calculating route…
              </div>
            )}
            {error && (
              <div className="text-[12px] text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>
            )}
            {snapNote && <div className="text-[11px] text-amber-200/80">{snapNote}</div>}

            {/* Summary + notices */}
            {route && !loading && (
              <div className="flex flex-col gap-2.5 border-t border-white/[0.08] pt-2.5">
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Distance" value={formatDistance(route.summary.length)} />
                  <Stat label="Duration" value={formatDuration(route.summary.duration)} />
                  <Stat label="ETA" value={formatEta(route.summary.duration)} />
                </div>
                {notices.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <div className="text-[11px] font-semibold text-muted uppercase tracking-wide">Notices</div>
                    {notices.map((n, i) => (
                      <div key={`${n.code}-${i}`} className="flex items-start gap-2 text-[12px] text-amber-200/90">
                        <TriangleAlert size={13} className="mt-0.5 shrink-0" strokeWidth={1.8} />
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
            className="absolute z-30 min-w-[180px] rounded-lg border border-white/[0.12] bg-rail shadow-2xl py-1"
            style={{ left: menu.x, top: menu.y }}
          >
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted border-b border-white/[0.06] mb-1">
              {fmtCoord({ lat: menu.lat, lng: menu.lng })}
            </div>
            {menuActions.map((opt) => (
              <button
                key={opt.action}
                onClick={() => applyMenuAction(opt.action)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-white/[0.06] transition-colors"
              >
                <span className="text-muted">{opt.icon}</span>
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
              className="absolute z-30 min-w-[180px] rounded-lg border border-white/[0.12] bg-rail shadow-2xl py-1"
              style={{ left: markerMenu.x, top: markerMenu.y }}
            >
              <div className="px-3 py-1.5 border-b border-white/[0.06] mb-1">
                <div className="text-[10px] uppercase tracking-wide text-muted">{heading}</div>
                <div className="text-[12px] text-text truncate" title={point.label}>
                  {point.label}
                </div>
              </div>
              <button
                onClick={() => copyPointCoord(markerMenu.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-white/[0.06] transition-colors"
              >
                <span className="text-muted"><Copy size={14} /></span>
                Copy coordinates
              </button>
              {markerMenu.role === 'stop' ? (
                <button
                  onClick={() => removeStopFromMap(markerMenu.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] text-red-300 hover:bg-red-500/10 transition-colors"
                >
                  <span><Trash2 size={14} /></span>
                  Remove stop
                </button>
              ) : (
                <button
                  onClick={() => clearEndpointFromMap(markerMenu.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] text-muted hover:text-text hover:bg-white/[0.06] transition-colors"
                >
                  <span><X size={14} /></span>
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

// ── Compact row for a committed point (start / stop / destination) ──────────
// Every row is draggable (native DnD) once the route has ≥2 points, so the whole
// route — start and finish included — can be reordered. The reorder happens live
// as the dragged row enters another row; roles are re-derived from the resulting
// order by the parent.
function PointRow({
  role,
  index,
  point,
  coord,
  onClear,
  draggable = false,
  dragging = false,
  onDragStartRow,
  onDragEnterRow,
  onDragEndRow,
}: {
  role: RoutePointRole
  index?: number
  point: RoutePoint
  coord: LatLng
  onClear: () => void
  draggable?: boolean
  dragging?: boolean
  onDragStartRow?: () => void
  onDragEnterRow?: () => void
  onDragEndRow?: () => void
}) {
  const [copied, setCopied] = useState(false)

  async function copyCoord() {
    const text = `${coord.lat.toFixed(5)}, ${coord.lng.toFixed(5)}`
    try {
      await navigator.clipboard?.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  const badge =
    role === 'start' ? (
      <span className="h-5 w-5 shrink-0 rounded-full bg-[#7d8a78] flex items-center justify-center text-bg">
        <Navigation size={11} strokeWidth={2.4} />
      </span>
    ) : role === 'destination' ? (
      <span className="h-5 w-5 shrink-0 rounded-full bg-[#d97757] flex items-center justify-center text-bg">
        <Flag size={11} strokeWidth={2.4} />
      </span>
    ) : (
      <span className="h-5 w-5 shrink-0 rounded-full border-2 border-active text-[10px] font-bold flex items-center justify-center">
        {index}
      </span>
    )

  return (
    <div
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              // Required for Firefox to start a drag; also marks the payload.
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', point.id)
              onDragStartRow?.()
            }
          : undefined
      }
      onDragEnter={draggable ? () => onDragEnterRow?.() : undefined}
      // preventDefault marks this row as a valid drop target so the live reorder
      // (done on dragenter) sticks and the cursor reads as "movable".
      onDragOver={draggable ? (e) => e.preventDefault() : undefined}
      onDragEnd={draggable ? () => onDragEndRow?.() : undefined}
      className={`flex items-center gap-2 rounded-lg border bg-white/[0.02] px-2 py-1.5 transition-[opacity,border-color] ${
        dragging ? 'opacity-50 border-active/40' : 'border-white/[0.08]'
      }`}
    >
      {draggable && (
        <span
          aria-hidden
          title="Drag to reorder"
          className="shrink-0 -ml-0.5 -mr-0.5 text-muted/60 hover:text-text cursor-default"
        >
          <GripVertical size={14} strokeWidth={1.8} />
        </span>
      )}
      <div className="shrink-0">{badge}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] leading-tight truncate" title={point.label}>
          {point.label}
        </div>
        <button
          onClick={copyCoord}
          title="Copy coordinates"
          className="group flex items-center gap-1 text-[11px] text-muted hover:text-text transition-colors tabular-nums"
        >
          {coord.lat.toFixed(5)}, {coord.lng.toFixed(5)}
          {copied ? (
            <Check size={11} strokeWidth={2.4} className="text-done" />
          ) : (
            <Copy size={11} strokeWidth={1.8} className="opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
          {point.source === 'map' && <span className="text-faint">· map</span>}
        </button>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <IconBtn label="Remove" onClick={onClear}>
          <X size={14} strokeWidth={2} />
        </IconBtn>
      </div>
    </div>
  )
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="h-6 w-6 flex items-center justify-center rounded text-muted hover:text-text hover:bg-white/[0.06] transition-colors"
    >
      {children}
    </button>
  )
}

function NumberField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 rounded-lg border border-white/[0.1] bg-white/[0.03] px-2.5 text-[13px] outline-none focus:border-white/[0.25] placeholder:text-muted/60"
      />
    </label>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted">{label}</span>
      <span className="text-[14px] font-semibold tracking-[-0.2px]">{value}</span>
    </div>
  )
}
