import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  GripVertical,
  Layers,
  Map as MapIcon,
  MapPin,
  Moon,
  Plus,
  Route as RouteIcon,
  Satellite,
  Sun,
  TrafficCone,
  Truck,
} from 'lucide-react'
import Spinner from '../Spinner'
import {
  baseStyleSupportsTraffic,
  type LatLng,
  type MapBaseStyle,
  type MapColorScheme,
  type RoutePoint,
} from '../../lib/hereMapTypes'
import {
  buildVehicleSpecs,
  calculateRoute,
  formatDistance,
  formatDuration,
  type HereVehicleSpecs,
  type TruckRouteOptions,
} from '../../lib/hereRouting'
import {
  DEFAULT_BIAS,
  formatCoords,
  geocode,
  geoConfigured,
  snapToRoad,
  type LngLat,
  type ResolvedPlace,
} from '../../lib/hereSearch'
import PlaceAutocompleteField from './PlaceAutocompleteField'
import {
  deleteTruckProfile,
  getTruckProfiles,
  saveTruckProfile,
  type TruckProfile,
} from '../../lib/truckProfiles'

// The HERE Maps SDK is heavy, so the map is pulled in lazily when this workspace
// opens. (The vehicle-location modal keeps using the Amazon Location MapView.)
const MapView = lazy(() => import('../map/HereMapView'))

type Props = {
  // Return to the Inbox tool grid.
  onBack: () => void
}

// One route field: the free text shown, plus the resolved place (with coords)
// once a suggestion is picked. `place` is null while the user is still typing.
type WaypointField = { text: string; place: ResolvedPlace | null }
const EMPTY_FIELD: WaypointField = { text: '', place: null }

type RouteState = {
  distance: string
  duration: string
  geometry: LngLat[]
  points: LatLng[]
  // Travel mode that produced this route, for truthful labelling.
  mode: 'Car' | 'Truck'
  // Whether truck size/weight restrictions were actually applied (vs a default
  // truck profile), so the label doesn't overclaim compliance.
  restricted: boolean
}

// Truck restrictions captured from the UI (strings). Converted to numbers and
// real HERE Routing truck options (and map vehicle specs) at route time.
type TruckOptions = {
  height: string
  width: string
  length: string
  grossWeight: string
  axleWeight: string
  hazardous: boolean
}

const EMPTY_TRUCK: TruckOptions = {
  height: '',
  width: '',
  length: '',
  grossWeight: '',
  axleWeight: '',
  hazardous: false,
}

// Parse the UI truck strings into numeric route options (metres / tonnes). Only
// positive values pass through.
function truckToOptions(t: TruckOptions): TruckRouteOptions {
  const num = (s: string) => {
    const n = Number.parseFloat(s)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return {
    heightM: num(t.height),
    widthM: num(t.width),
    lengthM: num(t.length),
    grossWeightT: num(t.grossWeight),
    axleWeightT: num(t.axleWeight),
    hazardous: t.hazardous,
  }
}

// Any usable truck restriction entered? Drives whether routing uses Truck mode.
function hasTruckParams(t: TruckOptions): boolean {
  const o = truckToOptions(t)
  return Boolean(o.heightM || o.widthM || o.lengthM || o.grossWeightT || o.axleWeightT)
}

// A ResolvedPlace for a raw coordinate (from dragging a point/route on the map).
// Labelled with its compact "lat, lng" so the field shows something meaningful.
function coordPlace(lng: number, lat: number): ResolvedPlace {
  return {
    placeId: 'coordinates',
    label: formatCoords(lng, lat),
    position: [lng, lat],
    postalCode: null,
    country: null,
    region: null,
    locality: null,
  }
}

// Great-circle distance in km between two [lng, lat] points (haversine). Used to
// score where a new stop fits with the least detour — planar lng/lat would
// distort badly over the long, north-south distances of a real route.
function distanceKm(a: LngLat, b: LngLat): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Extra distance added to the route by inserting point p into segment a→b:
//   detour = d(a,p) + d(p,b) − d(a,b)
// Zero when p already lies on the segment, large when it forces a backtrack.
function insertionDetourKm(p: LngLat, a: LngLat, b: LngLat): number {
  return distanceKm(a, p) + distanceKm(p, b) - distanceKm(a, b)
}

// Dedicated "Check route" workspace: a full-bleed HERE logistics map as the
// primary surface with a floating, translucent route panel over its top-left
// (Google-Maps-like, in the Dispo-chat dark theme). Fields use HERE Geocoding &
// Search autocomplete; picking From/To drops markers and auto-calculates the
// route (HERE Routing v8), truck-aware when truck restrictions are entered.
export default function CheckRouteWorkspace({ onBack }: Props) {
  const [from, setFrom] = useState<WaypointField>(EMPTY_FIELD)
  const [to, setTo] = useState<WaypointField>(EMPTY_FIELD)
  const [stops, setStops] = useState<WaypointField[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RouteState | null>(null)
  // Map theme (light/dark) for the truck basemap — local to this workspace; does
  // NOT change the app theme, only the map's colour scheme. The basemap is always
  // the truck travel-mode style. Defaults to Light for the familiar "basic" road
  // map look (clear roads/highways); the user can switch to Dark.
  const [mapMode, setMapMode] = useState<MapColorScheme>('Light')
  // Which basemap to show: the road map, satellite imagery, or satellite + labels.
  // Local to this workspace; toggled from the route panel.
  const [baseStyle, setBaseStyle] = useState<MapBaseStyle>('Standard')
  // Whether the real-time traffic overlay is on. Only meaningful when a traffic
  // tile provider is configured (otherwise the toggle is disabled).
  const [traffic, setTraffic] = useState(false)
  // The floating route panel can be collapsed to a slim header so it doesn't
  // cover the map while placing points. Open by default.
  const [panelOpen, setPanelOpen] = useState(true)
  // Advanced truck-restriction options, collapsed by default.
  const [truckOpen, setTruckOpen] = useState(false)
  const [truck, setTruck] = useState<TruckOptions>(EMPTY_TRUCK)
  // Saved truck presets (localStorage). Applying one fills the fields (and the
  // auto-recalc re-routes truck-aware).
  const [truckProfiles, setTruckProfiles] = useState<TruckProfile[]>(() => getTruckProfiles())
  // Right-click context menu on the map: its viewport pixel + the clicked coords,
  // or null when closed.
  const [menu, setMenu] = useState<{ x: number; y: number; lng: number; lat: number } | null>(null)
  // Transient confirmation toast (e.g. "Coordinates copied").
  const [toast, setToast] = useState<string | null>(null)
  // Drag-to-reorder: index of the waypoint being dragged, and the row it's over.
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  // Whether the cursor is in the bottom half of the hovered row (→ drop after it).
  const overAfterRef = useRef(false)

  const canCheck = from.text.trim().length > 0 && to.text.trim().length > 0 && geoConfigured && !busy

  // Auto-dismiss the toast.
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 1600)
    return () => clearTimeout(t)
  }, [toast])

  // Close the context menu on Escape or any scroll/resize that would move the map.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  function setStopText(i: number, text: string) {
    setStops((s) => s.map((x, idx) => (idx === i ? { text, place: null } : x)))
  }
  function setStopPlace(i: number, place: ResolvedPlace) {
    setStops((s) => s.map((x, idx) => (idx === i ? { text: place.label, place } : x)))
  }
  function removeStop(i: number) {
    setStops((s) => s.filter((_, idx) => idx !== i))
  }
  function setTruckField<K extends keyof TruckOptions>(key: K, value: TruckOptions[K]) {
    setTruck((t) => ({ ...t, [key]: value }))
  }
  function applyTruckProfile(p: TruckProfile) {
    setTruck({ ...p.values })
  }
  function saveCurrentTruckProfile(name: string) {
    setTruckProfiles(saveTruckProfile(name, truck))
  }
  function removeTruckProfile(id: string) {
    setTruckProfiles(deleteTruckProfile(id))
  }

  // Selected places (with coords + role), in order, for role-specific markers +
  // bounds. Reflects the map state immediately as each suggestion is picked —
  // before any route. Start = From, numbered stops in between, End = To.
  const selectedPoints = useMemo<RoutePoint[]>(() => {
    const pts: RoutePoint[] = []
    if (from.place) {
      pts.push({ lng: from.place.position[0], lat: from.place.position[1], kind: 'start' })
    }
    let n = 1
    stops.forEach((s, i) => {
      if (s.place) {
        pts.push({
          lng: s.place.position[0],
          lat: s.place.position[1],
          kind: 'stop',
          index: n++,
          stopIndex: i,
        })
      }
    })
    if (to.place) {
      pts.push({ lng: to.place.position[0], lat: to.place.position[1], kind: 'end' })
    }
    return pts
  }, [from, stops, to])

  // Bias for Places Suggest: the first selected waypoint, else a default. Lets
  // company/POI search rank results near the route.
  const bias = useMemo<LngLat>(() => {
    const sel = [from, ...stops, to].find((w) => w.place)
    return sel?.place?.position ?? DEFAULT_BIAS
  }, [from, stops, to])

  // Resolved waypoints for routing: requires both From and To selected; includes
  // only stops that have been resolved (half-typed stops are ignored here — the
  // manual "Check route" button geocodes free text instead).
  const resolvedWaypoints = useMemo<LngLat[] | null>(() => {
    if (!from.place || !to.place) return null
    return [
      from.place.position,
      ...stops.filter((s) => s.place).map((s) => s.place!.position),
      to.place.position,
    ]
  }, [from.place, to.place, stops])

  // Stable signatures so the auto-recalc effect fires on coordinate/truck changes
  // only — not on every keystroke.
  const routeKey = resolvedWaypoints ? resolvedWaypoints.map((p) => p.join(',')).join('|') : ''
  const truckParams = useMemo(() => truckToOptions(truck), [truck])
  // Vehicle specs for the HERE logistics restriction overlay (cm / kg). Updates
  // whenever the truck fields change, so the overlay highlights limits that apply
  // to the current vehicle. Null when nothing usable is entered.
  const vehicleSpecs = useMemo<HereVehicleSpecs | null>(
    () => buildVehicleSpecs(truckParams),
    [truckParams],
  )
  const truckActive = hasTruckParams(truck)
  const truckKey = truckActive ? JSON.stringify(truckParams) : ''

  // Latest values for the effect to read without re-subscribing on identity churn.
  const latest = useRef({ resolvedWaypoints, truckParams, truckActive })
  latest.current = { resolvedWaypoints, truckParams, truckActive }

  // Auto-(re)calculate whenever the resolved From/To/stops or truck params change.
  // Clears the route when From/To aren't both selected.
  useEffect(() => {
    const { resolvedWaypoints: wps, truckParams: tp, truckActive: ta } = latest.current
    if (!wps) {
      setResult(null)
      setError(null)
      return
    }
    let cancelled = false
    setBusy(true)
    setError(null)
    ;(async () => {
      try {
        // Always Truck mode so the duration is computed for a truck; pass entered
        // size/weight as restrictions when present.
        const route = await calculateRoute(wps, { truck: ta ? tp : undefined, mode: 'Truck' })
        if (cancelled) return
        if (!route) {
          setError('No route could be found between those locations.')
          setResult(null)
          return
        }
        setResult({
          distance: formatDistance(route.distanceMeters),
          duration: formatDuration(route.durationSeconds),
          geometry: route.geometry,
          points: wps.map(([lng, lat]) => ({ lng, lat })),
          mode: route.mode,
          restricted: ta,
        })
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Route calculation failed.')
        setResult(null)
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [routeKey, truckKey])

  // After a route is computed, refine any map-placed (raw coordinate) waypoints
  // onto the returned route polyline so their stored coordinate AND the value shown
  // in the field sit exactly on the route — not at the off-road point where they
  // were dropped/clicked. Named places (geocoded addresses/POIs) keep their label;
  // only coordinate-type fields are snapped. Start/end take the polyline's first/
  // last vertex (HERE's origin/destination road-snap); stops take the nearest point
  // on the polyline. Returning the SAME field object when nothing moved (epsilon
  // guard) lets React bail out, so this converges in one extra recalc rather than
  // looping (a point already on the route snaps to itself).
  useEffect(() => {
    if (!result) return
    const geom = result.geometry
    if (geom.length < 2) return
    const EPS = 1e-5 // ≈1 m — below this, treat the point as already on the route
    const refine = (f: WaypointField, anchor?: 'first' | 'last'): WaypointField => {
      if (!f.place || f.place.placeId !== 'coordinates') return f
      const [lng, lat] = f.place.position
      const snapped =
        anchor === 'first'
          ? geom[0]
          : anchor === 'last'
            ? geom[geom.length - 1]
            : snapToRoad([lng, lat], geom)
      if (!snapped) return f
      if (Math.abs(snapped[0] - lng) < EPS && Math.abs(snapped[1] - lat) < EPS) return f
      const place = coordPlace(snapped[0], snapped[1])
      return { text: place.label, place }
    }
    setFrom((f) => refine(f, 'first'))
    setTo((f) => refine(f, 'last'))
    setStops((ss) => {
      let changed = false
      const next = ss.map((s) => {
        const r = refine(s)
        if (r !== s) changed = true
        return r
      })
      return changed ? next : ss
    })
  }, [result])

  // Manual trigger: geocodes any free-text fields that weren't picked from the
  // dropdown, then routes. (Selected fields use their resolved coordinates.)
  async function handleCheck() {
    const fields = [from, ...stops.filter((s) => s.text.trim()), to]
    setBusy(true)
    setError(null)
    try {
      const waypoints: LngLat[] = []
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i]
        if (f.place) {
          waypoints.push(f.place.position)
          continue
        }
        const g = await geocode(f.text.trim())
        if (!g) {
          const which = i === 0 ? '“From”' : i === fields.length - 1 ? '“To”' : `stop ${i}`
          setError(`Couldn't find a location for ${which}.`)
          setResult(null)
          return
        }
        waypoints.push(g.position)
      }
      const route = await calculateRoute(waypoints, {
        truck: truckActive ? truckParams : undefined,
        mode: 'Truck',
      })
      if (!route) {
        setError('No route could be found between those locations.')
        setResult(null)
        return
      }
      setResult({
        distance: formatDistance(route.distanceMeters),
        duration: formatDuration(route.durationSeconds),
        geometry: route.geometry,
        points: waypoints.map(([lng, lat]) => ({ lng, lat })),
        mode: route.mode,
        restricted: truckActive,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Route calculation failed.')
      setResult(null)
    } finally {
      setBusy(false)
    }
  }

  // Find the stops[] index at which inserting point p keeps the route most
  // natural: the segment (start→…→finish) where p adds the least detour. Returns
  // the position in the stops[] array to splice the new stop into. Requires both
  // From and To to be resolved (the caller guarantees this).
  function bestStopInsertIndex(p: LngLat): number {
    // Ordered resolved waypoints, each tagged with its anchor in the stops array
    // (-1 = From; otherwise the stops[] index of that resolved stop; stops.length
    // = To, so a point closest to the last leg lands at the end).
    const ordered: Array<{ pos: LngLat; anchorStopIndex: number }> = [
      { pos: from.place!.position, anchorStopIndex: -1 },
    ]
    stops.forEach((s, i) => {
      if (s.place) ordered.push({ pos: s.place.position, anchorStopIndex: i })
    })
    ordered.push({ pos: to.place!.position, anchorStopIndex: stops.length })

    let bestK = 0
    let bestDetour = Infinity
    for (let k = 0; k < ordered.length - 1; k++) {
      const detour = insertionDetourKm(p, ordered[k].pos, ordered[k + 1].pos)
      if (detour < bestDetour) {
        bestDetour = detour
        bestK = k
      }
    }
    const anchor = ordered[bestK].anchorStopIndex
    return anchor === -1 ? 0 : anchor + 1
  }

  // Route line dragged: insert a via-waypoint at the dropped point, placed into
  // the least-detour segment so ordering stays sensible. The dropped coordinate is
  // stored as the user dropped it, then the auto-recalc effect re-routes through it
  // (truck-aware) — HERE matches the via onto a road, and the map snaps the marker
  // onto the resulting route line, so the point ends up aligned to the route.
  function handleRouteDrag([lng, lat]: LngLat) {
    if (!from.place || !to.place) return
    const insertAt = bestStopInsertIndex([lng, lat])
    const place = coordPlace(lng, lat)
    setStops((s) => [...s.slice(0, insertAt), { text: place.label, place }, ...s.slice(insertAt)])
  }

  // Map context menu → "Add stop": the first two points placed become From then
  // To; after that, a new point is inserted at the least-detour position in the
  // existing route (NOT blindly appended). The auto-recalc effect re-routes.
  function addStopFromMap(lng: number, lat: number) {
    const place = coordPlace(lng, lat)
    const field = { text: place.label, place }
    if (!from.place) {
      setFrom(field)
    } else if (!to.place) {
      setTo(field)
    } else {
      const insertAt = bestStopInsertIndex([lng, lat])
      setStops((s) => [...s.slice(0, insertAt), field, ...s.slice(insertAt)])
    }
  }

  // Map context menu → "Copy coordinates": copy "lat, lng" to the clipboard.
  async function copyCoords(lng: number, lat: number) {
    const text = `${lat.toFixed(6)}, ${lng.toFixed(6)}`
    try {
      await navigator.clipboard.writeText(text)
      setToast('Coordinates copied')
    } catch {
      setToast('Could not copy')
    }
  }

  // Open the context menu where the user right-clicked, clamped to the viewport.
  function handleMapContextMenu([lng, lat]: LngLat, page: { x: number; y: number }) {
    const x = Math.min(page.x, window.innerWidth - 200)
    const y = Math.min(page.y, window.innerHeight - 96)
    setMenu({ x, y, lng, lat })
  }

  // The full ordered route as one list: position 0 = start (From), last = finish
  // (To), middle = stops. Used so From/To are draggable in the same list as the
  // stops and the route order updates from a single reorder.
  const waypoints = [from, ...stops, to]

  // Edit a waypoint by its position in the combined list.
  function setWaypointText(pos: number, text: string) {
    if (pos === 0) setFrom({ text, place: null })
    else if (pos === waypoints.length - 1) setTo({ text, place: null })
    else setStopText(pos - 1, text)
  }
  function setWaypointPlace(pos: number, place: ResolvedPlace) {
    if (pos === 0) setFrom({ text: place.label, place })
    else if (pos === waypoints.length - 1) setTo({ text: place.label, place })
    else setStopPlace(pos - 1, place)
  }

  // Reorder the whole route. `insertAt` is the slot (0..len) in the original
  // combined list where the dragged item should land — derived from whether the
  // drop fell in the top/bottom half of the target row. From/To are simply
  // whatever ends up first/last after the move.
  function reorderWaypoints(fromPos: number, insertAt: number) {
    const arr = [from, ...stops, to]
    const [moved] = arr.splice(fromPos, 1)
    const dest = insertAt > fromPos ? insertAt - 1 : insertAt
    if (dest === fromPos) return
    arr.splice(dest, 0, moved)
    setFrom(arr[0])
    setTo(arr[arr.length - 1])
    setStops(arr.slice(1, -1))
  }

  // A From/Stop/To dot was dragged to a new spot: store the dropped coordinate as
  // that waypoint, so the auto-recalc effect re-routes through it. HERE matches the
  // waypoint onto a road and the map snaps the marker onto the recalculated route
  // line, so the dot ends up sitting on the route rather than where it was released.
  function handlePointDragEnd(pt: RoutePoint, [lng, lat]: LngLat) {
    const place = coordPlace(lng, lat)
    const field = { text: place.label, place }
    if (pt.kind === 'start') setFrom(field)
    else if (pt.kind === 'end') setTo(field)
    else if (pt.kind === 'stop' && pt.stopIndex != null) {
      setStops((s) => s.map((x, idx) => (idx === pt.stopIndex ? field : x)))
    }
  }

  // A stop dot was clicked: remove that stop (From/To are required, so ignored).
  function handlePointRemove(pt: RoutePoint) {
    if (pt.kind === 'stop' && pt.stopIndex != null) removeStop(pt.stopIndex)
  }

  return (
    <>
      {/* Header — back + title, with the subtle map light/dark control on the right. */}
      <header className="h-[var(--header-height)] flex items-center gap-1.5 px-3 rounded-[11px] border border-white/[0.08] bg-rail shrink-0 overflow-hidden">
        <button
          onClick={onBack}
          aria-label="Back to workspace tools"
          title="Back to tools"
          className="h-9 w-9 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.05] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          <ArrowLeft size={18} strokeWidth={1.8} />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <RouteIcon size={16} strokeWidth={1.8} className="text-active shrink-0" />
          <div className="text-[15px] font-semibold truncate leading-tight">Check route</div>
        </div>
        <div className="ml-auto">
          <MapModeToggle mode={mapMode} onChange={setMapMode} />
        </div>
      </header>

      {/* Map area — full-bleed surface that fills the rest of the workspace, with
          the route form floating over it. `relative` anchors the floating panel;
          `overflow-hidden` keeps the rounded corners clean. */}
      <div className="relative flex-1 min-h-0 mt-2 rounded-[11px] border border-white/[0.08] overflow-hidden bg-rail">
        <Suspense
          fallback={
            <div className="absolute inset-0 flex items-center justify-center bg-rail">
              <Spinner variant="lg" />
            </div>
          }
        >
          <MapView
            className="absolute inset-0 h-full w-full"
            center={null}
            colorScheme={mapMode}
            baseStyle={baseStyle}
            traffic={traffic}
            vehicleSpecs={vehicleSpecs}
            route={result?.geometry ?? null}
            points={selectedPoints}
            onRouteDrag={result ? handleRouteDrag : undefined}
            onPointDragEnd={handlePointDragEnd}
            onPointRemove={handlePointRemove}
            onContextMenu={handleMapContextMenu}
          />
        </Suspense>

        {/* Floating route panel — top-left on desktop, full-width across the top
            on narrow screens. Translucent dark, light border, small radius —
            deliberately not a heavy modal. Collapsible to a slim header so it
            doesn't cover the map; scrolls internally when stops pile up. */}
        <div className="absolute top-4 left-4 right-4 sm:right-auto sm:w-[360px] lg:w-[400px] max-h-[calc(100%-32px)] overflow-y-auto rounded-[11px] border border-white/[0.10] bg-rail/85 backdrop-blur-md shadow-2xl shadow-black/50 flex flex-col">
          {/* Header: title + collapse toggle. When collapsed it also shows a
              one-line distance · duration summary so the result stays visible. */}
          <div className="flex items-center gap-2 px-4 py-2.5">
            <RouteIcon size={14} strokeWidth={1.8} className="text-active shrink-0" />
            <span className="text-[12.5px] font-semibold shrink-0">Route</span>
            {!panelOpen && result && (
              <span className="text-[11px] text-faint tabular-nums truncate">
                {result.distance} · {result.duration}
              </span>
            )}
            <button
              type="button"
              onClick={() => setPanelOpen((v) => !v)}
              aria-expanded={panelOpen}
              aria-label={panelOpen ? 'Collapse route panel' : 'Expand route panel'}
              title={panelOpen ? 'Collapse' : 'Expand'}
              className="ml-auto shrink-0 h-7 w-7 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.06] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
            >
              <ChevronDown
                size={16}
                strokeWidth={1.8}
                className={`transition-transform ${panelOpen ? 'rotate-180' : ''}`}
              />
            </button>
          </div>

          {panelOpen && (
            <div className="px-4 pb-4 flex flex-col gap-2.5">
          {/* Ordered route: position 0 = start (From), last = finish (To), the
              rest are stops. Every row is reorderable by dragging its grip — drag
              From/To into the middle (or a stop to an end) and the order updates. */}
          {waypoints.map((wp, pos) => {
            const isFrom = pos === 0
            const isTo = pos === waypoints.length - 1
            const label = isFrom ? 'From' : isTo ? 'To' : `Stop ${pos}`
            return (
              <div
                key={pos}
                onDragOver={(e) => {
                  if (dragIndex === null) return
                  e.preventDefault()
                  const r = e.currentTarget.getBoundingClientRect()
                  overAfterRef.current = e.clientY > r.top + r.height / 2
                  if (overIndex !== pos) setOverIndex(pos)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragIndex !== null) {
                    reorderWaypoints(dragIndex, pos + (overAfterRef.current ? 1 : 0))
                  }
                  setDragIndex(null)
                  setOverIndex(null)
                }}
                className={`flex items-start gap-1 rounded-chip transition-colors ${
                  dragIndex === pos ? 'opacity-40' : ''
                } ${overIndex === pos && dragIndex !== pos ? 'ring-1 ring-active/60' : ''}`}
              >
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    setDragIndex(pos)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnd={() => {
                    setDragIndex(null)
                    setOverIndex(null)
                  }}
                  aria-label={`Reorder ${label}`}
                  title="Drag to reorder"
                  className="mt-[26px] shrink-0 cursor-grab active:cursor-grabbing text-faint hover:text-text transition-colors"
                >
                  <GripVertical size={15} strokeWidth={1.8} />
                </button>
                <div className="flex-1 min-w-0">
                  <PlaceAutocompleteField
                    label={label}
                    value={wp.text}
                    bias={bias}
                    selected={Boolean(wp.place)}
                    placeholder="Address, city, or company"
                    onTextChange={(text) => setWaypointText(pos, text)}
                    onSelect={(place) => setWaypointPlace(pos, place)}
                    onRemove={isFrom || isTo ? undefined : () => removeStop(pos - 1)}
                  />
                </div>
              </div>
            )
          })}

          <button
            onClick={() => setStops((s) => [...s, EMPTY_FIELD])}
            className="self-start flex items-center gap-1 text-[11.5px] text-muted hover:text-text transition-colors"
          >
            <Plus size={12} strokeWidth={1.8} />
            Add stop
          </button>

          {/* Map layers — basemap (road / satellite / labels) and a traffic
              overlay, integrated into the panel rather than floating controls. */}
          <MapLayersControl
            baseStyle={baseStyle}
            onBaseStyleChange={setBaseStyle}
            traffic={traffic}
            onTrafficChange={setTraffic}
          />

          {/* Truck restrictions — advanced, collapsed by default. When dimensions
              / weight are entered, the route is recalculated in real Truck travel
              mode (see calculateRoute), so it honours height/weight limits. */}
          <TruckRestrictions
            open={truckOpen}
            onToggle={() => setTruckOpen((v) => !v)}
            truck={truck}
            onChange={setTruckField}
            profiles={truckProfiles}
            onApplyProfile={applyTruckProfile}
            onSaveProfile={saveCurrentTruckProfile}
            onDeleteProfile={removeTruckProfile}
          />

          <button
            type="button"
            disabled={!canCheck}
            onClick={handleCheck}
            className="mt-0.5 flex items-center justify-center gap-2 bg-text text-bg font-semibold text-[12px] rounded-btn px-3 py-1.5 transition-colors enabled:hover:bg-text/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy && <Spinner variant="sm" />}
            {busy ? 'Calculating…' : 'Check route'}
          </button>

          {!geoConfigured && (
            <div className="text-[11px] text-faint">Routing is not configured.</div>
          )}
          {error && <div className="text-[11px] text-alert">{error}</div>}

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Stat label="Distance" value={result?.distance ?? '—'} />
            <Stat label="Duration" value={result?.duration ?? '—'} />
          </div>

          {/* Honest labelling — the route always runs in Truck mode, but only
              claim restriction compliance when size/weight were actually applied. */}
          {result && (
            <div
              className={`flex items-center gap-1.5 text-[11px] ${
                result.restricted ? 'text-active' : 'text-muted'
              }`}
            >
              <Truck size={12} strokeWidth={1.8} />
              {result.restricted ? 'Routed with truck restrictions' : 'Truck route (default profile)'}
            </div>
          )}
          <div className="text-[11px] text-faint">
            Truck restrictions overlaid on the map — zoom in to see height/weight/bridge and hazmat
            limits. Enter size/weight below for truck-safe routing.
          </div>
          <div className="text-[11px] text-faint">
            Tip: right-click the map to add a stop or copy coordinates. Drag a stop’s grip to
            reorder.
          </div>
            </div>
          )}
        </div>

        {/* Right-click context menu (Add stop / Copy coordinates). A full-screen
            backdrop catches outside clicks and any right-click to dismiss it. */}
        {menu && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu(null)
              }}
            />
            <div
              className="fixed z-50 min-w-[184px] rounded-card border border-white/[0.10] bg-surface shadow-2xl shadow-black/50 py-1"
              style={{ left: menu.x, top: menu.y }}
            >
              <ContextItem
                icon={<Plus size={13} strokeWidth={1.8} />}
                label="Add stop"
                onClick={() => {
                  addStopFromMap(menu.lng, menu.lat)
                  setMenu(null)
                }}
              />
              <ContextItem
                icon={<Copy size={13} strokeWidth={1.8} />}
                label="Copy coordinates"
                onClick={() => {
                  void copyCoords(menu.lng, menu.lat)
                  setMenu(null)
                }}
              />
            </div>
          </>
        )}

        {/* Transient confirmation toast (e.g. coordinates copied). */}
        {toast && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 rounded-chip border border-white/[0.10] bg-surface/95 backdrop-blur-md px-3 py-1.5 text-[12px] shadow-2xl shadow-black/50">
            <MapPin size={12} strokeWidth={1.8} className="text-active" />
            {toast}
          </div>
        )}
      </div>
    </>
  )
}

// One row in the map right-click context menu.
function ContextItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[12.5px] text-left text-text hover:bg-white/[0.06] transition-colors"
    >
      <span className="text-muted shrink-0">{icon}</span>
      {label}
    </button>
  )
}

// Subtle segmented Dark/Light control for the truck basemap's colour theme only
// (the basemap is always the truck travel-mode style).
function MapModeToggle({
  mode,
  onChange,
}: {
  mode: MapColorScheme
  onChange: (m: MapColorScheme) => void
}) {
  return (
    <div
      role="group"
      aria-label="Map theme"
      className="flex items-center gap-0.5 rounded-chip border border-white/[0.08] bg-white/[0.02] p-0.5"
    >
      <ModeButton
        active={mode === 'Dark'}
        onClick={() => onChange('Dark')}
        label="Dark map"
        icon={<Moon size={13} strokeWidth={1.8} />}
      />
      <ModeButton
        active={mode === 'Light'}
        onClick={() => onChange('Light')}
        label="Light map"
        icon={<Sun size={13} strokeWidth={1.8} />}
      />
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean
  onClick: () => void
  label: string
  icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`h-6 w-7 flex items-center justify-center rounded-[3px] transition-colors ${
        active ? 'bg-white/[0.10] text-text' : 'text-faint hover:text-text'
      }`}
    >
      {icon}
    </button>
  )
}

// Map-layer controls inside the route panel: a segmented basemap switch
// (road / satellite / satellite+labels) and a traffic-overlay toggle. Compact and
// styled like the rest of the panel — not a floating map control. The traffic
// toggle is disabled (with an explanatory tooltip) when no traffic tile provider
// is configured, so it never pretends to show data it doesn't have.
function MapLayersControl({
  baseStyle,
  onBaseStyleChange,
  traffic,
  onTrafficChange,
}: {
  baseStyle: MapBaseStyle
  onBaseStyleChange: (s: MapBaseStyle) => void
  traffic: boolean
  onTrafficChange: (v: boolean) => void
}) {
  // HERE's traffic flow overlay drapes over the road/labelled basemaps but not
  // plain satellite imagery, so the toggle is disabled there.
  const trafficSupported = baseStyleSupportsTraffic(baseStyle)
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div
        role="group"
        aria-label="Basemap"
        className="flex items-center gap-0.5 rounded-chip border border-white/[0.08] bg-white/[0.02] p-0.5"
      >
        <LayerButton
          active={baseStyle === 'Standard'}
          onClick={() => onBaseStyleChange('Standard')}
          label="Road map"
          icon={<MapIcon size={13} strokeWidth={1.8} />}
        />
        <LayerButton
          active={baseStyle === 'Satellite'}
          onClick={() => onBaseStyleChange('Satellite')}
          label="Satellite"
          icon={<Satellite size={13} strokeWidth={1.8} />}
        />
        <LayerButton
          active={baseStyle === 'Hybrid'}
          onClick={() => onBaseStyleChange('Hybrid')}
          label="Satellite with labels"
          icon={<Layers size={13} strokeWidth={1.8} />}
        />
      </div>

      <button
        type="button"
        disabled={!trafficSupported}
        aria-pressed={traffic}
        onClick={() => onTrafficChange(!traffic)}
        title={
          trafficSupported
            ? traffic
              ? 'Hide traffic'
              : 'Show real-time traffic'
            : 'Traffic isn’t available on satellite imagery'
        }
        className={`flex items-center gap-1.5 h-7 px-2.5 rounded-chip border text-[11.5px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          traffic && trafficSupported
            ? 'border-active/60 bg-active/15 text-active'
            : 'border-white/[0.08] bg-white/[0.02] text-muted enabled:hover:text-text enabled:hover:border-white/[0.16]'
        }`}
      >
        <TrafficCone size={13} strokeWidth={1.8} />
        Traffic
      </button>
    </div>
  )
}

// One icon button in the basemap segmented control (mirrors ModeButton's look,
// but wider to fit the basemap icons).
function LayerButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean
  onClick: () => void
  label: string
  icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`h-6 w-8 flex items-center justify-center rounded-[3px] transition-colors ${
        active ? 'bg-white/[0.10] text-text' : 'text-faint hover:text-text'
      }`}
    >
      {icon}
    </button>
  )
}

function TruckRestrictions({
  open,
  onToggle,
  truck,
  onChange,
  profiles,
  onApplyProfile,
  onSaveProfile,
  onDeleteProfile,
}: {
  open: boolean
  onToggle: () => void
  truck: TruckOptions
  onChange: <K extends keyof TruckOptions>(key: K, value: TruckOptions[K]) => void
  profiles: TruckProfile[]
  onApplyProfile: (p: TruckProfile) => void
  onSaveProfile: (name: string) => void
  onDeleteProfile: (id: string) => void
}) {
  const [presetName, setPresetName] = useState('')
  return (
    <div className="rounded-card border border-white/[0.06] bg-white/[0.015]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left"
      >
        <Truck size={13} strokeWidth={1.7} className="text-muted shrink-0" />
        <span className="text-[12px] font-medium flex-1">Truck restrictions</span>
        <ChevronDown
          size={14}
          strokeWidth={1.8}
          className={`text-faint transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-2.5 pb-2.5 pt-0.5 flex flex-col gap-2">
          {/* Saved presets — click to apply, × to delete. */}
          {profiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {profiles.map((p) => (
                <span
                  key={p.id}
                  className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-chip border border-white/[0.10] bg-white/[0.03] text-[11px]"
                >
                  <button
                    type="button"
                    onClick={() => onApplyProfile(p)}
                    className="text-muted hover:text-text transition-colors"
                    title={`Apply preset “${p.name}”`}
                  >
                    {p.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteProfile(p.id)}
                    aria-label={`Delete preset ${p.name}`}
                    className="text-faint hover:text-alert transition-colors leading-none px-0.5"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Height"
              unit="m"
              value={truck.height}
              onChange={(v) => onChange('height', v)}
            />
            <NumberField
              label="Width"
              unit="m"
              value={truck.width}
              onChange={(v) => onChange('width', v)}
            />
            <NumberField
              label="Length"
              unit="m"
              value={truck.length}
              onChange={(v) => onChange('length', v)}
            />
            <NumberField
              label="Gross weight"
              unit="t"
              value={truck.grossWeight}
              onChange={(v) => onChange('grossWeight', v)}
            />
            <NumberField
              label="Axle weight"
              unit="t"
              value={truck.axleWeight}
              onChange={(v) => onChange('axleWeight', v)}
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none pt-0.5">
            <input
              type="checkbox"
              className="checkbox"
              checked={truck.hazardous}
              onChange={(e) => onChange('hazardous', e.target.checked)}
            />
            <span className="text-[12px] text-muted">Hazardous goods</span>
          </label>

          {/* Save the current values as a reusable preset. */}
          <div className="flex items-center gap-1.5 pt-0.5">
            <input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && presetName.trim()) {
                  onSaveProfile(presetName.trim())
                  setPresetName('')
                }
              }}
              placeholder="Preset name (e.g. 40t semi)"
              className="flex-1 min-w-0 bg-white/[0.02] border border-white/[0.06] focus:border-white/[0.16] rounded-chip px-2.5 h-8 text-[12px] outline-none placeholder:text-faint transition-colors"
            />
            <button
              type="button"
              disabled={!presetName.trim()}
              onClick={() => {
                onSaveProfile(presetName.trim())
                setPresetName('')
              }}
              className="shrink-0 text-[11.5px] font-medium rounded-btn px-2.5 h-8 border border-white/[0.10] text-muted enabled:hover:text-text enabled:hover:border-white/[0.16] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Save preset
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function NumberField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string
  unit: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="block">
      <span className="block text-[10.5px] text-muted mb-1">{label}</span>
      <span className="flex items-center gap-1 px-2 h-8 rounded-chip border border-white/[0.06] bg-white/[0.02] focus-within:border-white/[0.16] hover:border-white/[0.10] transition-colors">
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="—"
          className="bg-transparent flex-1 outline-none text-[12px] tabular-nums placeholder:text-faint min-w-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-[10.5px] text-faint shrink-0">{unit}</span>
      </span>
    </label>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <div className="text-[10.5px] uppercase tracking-wide text-faint">{label}</div>
      <div className="text-[14px] font-semibold tabular-nums">{value}</div>
    </div>
  )
}
