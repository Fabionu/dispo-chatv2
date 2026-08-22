import { useEffect, useRef, useState } from 'react'
import { decode } from '@here/flexpolyline'
import { loadHere } from '../../lib/here/loadHere'
import {
  pathMidpoint,
  haversineMeters,
  nearestPointOnPath,
  simplifyPath,
} from '../../lib/here/geo'
import type {
  DriverMapMarker,
  DriverMapTrail,
  LatLng,
  RouteMarker,
  RouteMarkerKind,
  ScreenGeoCandidate,
} from '../../lib/here/types'
import type { WorkspacePlace } from '../../lib/types'
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  HOVER_THRESHOLD_PX,
  formatHoverDistance,
  sampleScreenCandidates,
  snapDebug,
} from './hereMapUtils'
import {
  ghostSvg,
  iconFor,
  routeArrowStyle,
  routeCasingStyle,
  routeSpineStyle,
  savedPlaceIconFor,
} from './hereMapIcons'
import {
  createHereMapStyleControl,
  type BaseMapMode,
  type HereMapStyleControlHandle,
} from './HereMapStyleControl'
import { createHereMapZoomControl, type HereMapZoomControlHandle } from './HereMapZoomControl'
import {
  ROUTE_REVEAL_VERTEX_BUDGET,
  canRevealRoute,
  finishRouteReveal,
  seedRevealSection,
  startRouteReveal,
  type RevealSection,
  type RouteReveal,
} from './hereRouteReveal'

/* eslint-disable @typescript-eslint/no-explicit-any */

// HERE route sections can contain tens of thousands of road-shape vertices.
// This helper is deliberately reserved for INVISIBLE interaction geometry
// (drag hit-targets and hover lookup). The visible route must use the complete
// ── Trail chevron budget ─────────────────────────────────────────────────────
// Every pan frame projects up to MAX_TRAIL_CANDIDATES × 2 points per trail, so
// the sampling cap is a frame-cost ceiling, not a cosmetic one. The chevron
// pool is far smaller: only what can fit on screen at the minimum gap ever gets
// placed, and the rest of the candidates exist purely so that whichever part of
// the trail is in view has segments to choose from.
const MAX_TRAIL_CANDIDATES = 240
const MAX_TRAIL_CHEVRONS = 60
/** Minimum on-screen spacing between chevrons, in px. */
const TRAIL_CHEVRON_GAP_PX = 52

// Route Planner overview zooms cover far more ground than the street-level
// editor. A fixed seven-pixel route dominates the basemap at that scale, so the
// planner can opt into a smooth zoom-dependent width while read-only trip maps
// retain their deliberately prominent route/trail comparison.
function routeStrokeWidths(zoom: number): {
  main: number
  casing: number
  arrow: number
  arrowsVisible: boolean
} {
  const main = Math.min(7, Math.max(2.75, 2.75 + (zoom - 8) * 0.7))
  return {
    // +4 rather than +2.5: the casing is a SOLID white halo now, not a 38%
    // black smudge, and it has to read as a deliberate outline on satellite
    // imagery. Half of the extra width is spent on each side, so this is 2px of
    // white per edge at every zoom.
    casing: main + 4,
    main,
    // The arrow glyphs are stencilled INSIDE the spine, so this must stay
    // meaningfully narrower than `main` or the arrows eat their own line.
    arrow: Math.max(2, main - 2.5),
    // Below roughly zoom 10 the spine is a thread crossing whole countries and
    // arrow glyphs on it are noise, not information — the screenshot that
    // prompted this rework is exactly that case. Direction only appears once
    // the line is wide enough to carry a legible glyph.
    arrowsVisible: main >= 4.25,
  }
}

/** Forward azimuth from `a` to `b`, degrees clockwise from north. */
function bearingBetween(a: LatLng, b: LatLng): number {
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

// decoded HERE polyline: even a small metre-based tolerance is noticeable at
// street-level zoom and can draw straight chords across curbs or tight bends.
function simplifyPathForMap(path: LatLng[], toleranceMeters: number, maxPoints: number): LatLng[] {
  if (path.length <= maxPoints) return path

  let tolerance = toleranceMeters
  let simplified = simplifyPath(path, tolerance)
  while (simplified.length > maxPoints && tolerance < 2048) {
    tolerance *= 2
    simplified = simplifyPath(path, tolerance)
  }
  if (simplified.length <= maxPoints) return simplified

  const sampled: LatLng[] = [simplified[0]]
  const step = (simplified.length - 1) / (maxPoints - 1)
  for (let i = 1; i < maxPoints - 1; i++) sampled.push(simplified[Math.round(i * step)])
  sampled.push(simplified[simplified.length - 1])
  return sampled
}

// Read at call time, not once at module load: the user can flip the OS setting
// while the app is open, and a stale answer would keep animating at them.
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

type Props = {
  // Waypoint markers in route order (origin → stops → destination).
  markers: RouteMarker[]
  // Live-driver positions (assigned drivers of the trip being shown). Rendered
  // as DOM markers so they carry a name pill + tooltip; visually distinct from
  // (and never replacing) the waypoint markers. Deliberately EXCLUDED from the
  // auto-fit, so a position update never re-centers the user's view.
  driverMarkers?: DriverMapMarker[]
  // The path each driver has actually driven this trip, drawn as a contrasting
  // dashed overlay above the planned route. Excluded from auto-fit because the
  // markers above — the trail grows every minute and must not pan the map.
  driverTrails?: DriverMapTrail[]
  // Shared workspace places. Static/cached and excluded from route auto-fit so
  // showing a depot or parking layer never moves the user's map.
  savedPlaces?: WorkspacePlace[]
  // Encoded HERE flexible polylines, one per route section. Empty = no route.
  routePolylines: string[]
  // Scale the visible route stroke down at overview zooms. Enabled by Route
  // Planner only; trip tracking keeps its stronger planned-vs-driven styling.
  scaleRouteWidthWithZoom?: boolean
  // Pre-formatted total route distance (e.g. "84 km"), shown as a small badge at
  // the route's midpoint. Null/undefined = no badge. Reuses the same value the
  // side panel displays so the two never disagree.
  routeDistanceLabel?: string | null
  // Whether the HERE logistics / HGV truck-restriction overlay is enabled.
  truckOverlay: boolean
  // Reports whether the logistics overlay is actually available on this HERE
  // plan/SDK, so the parent can disable the toggle when it isn't.
  onTruckOverlayAvailabilityChange?: (available: boolean) => void
  // Right-click on the map → the geo coordinate under the cursor, the cursor
  // position RELATIVE TO THE MAP CONTAINER (for placing a context menu), the
  // current map zoom, and screen-space snap candidates sampled around the cursor
  // (so an added stop can land on the road actually rendered under it).
  onMapContextMenu?: (info: {
    lat: number
    lng: number
    x: number
    y: number
    zoom: number
    candidates: ScreenGeoCandidate[]
  }) => void
  // The map view started changing (pan/zoom) — used to dismiss menus/popovers.
  onMapViewChange?: () => void
  // A waypoint marker finished being dragged → its id, the screen-space snap
  // candidates sampled around the drop, and the current zoom. The candidates
  // (first = the exact drop pixel) let the snap target the visible road.
  onMarkerDragEnd?: (id: string, candidates: ScreenGeoCandidate[], zoom: number) => void
  // A waypoint marker was clicked (not dragged) → its id, kind, and screen
  // position within the container, so the parent can open a marker popover.
  onMarkerClick?: (info: {
    id: string
    kind: RouteMarkerKind
    x: number
    y: number
  }) => void
  onSavedPlaceClick?: (info: { id: string; x: number; y: number }) => void
  // The route line was dragged (drag-to-add-stop) → the section index that was
  // grabbed + the screen-space snap candidates sampled around the release + zoom,
  // so the parent can insert a snapped stop into that segment and recalculate.
  onRouteDragEnd?: (sectionIndex: number, candidates: ScreenGeoCandidate[], zoom: number) => void
  // Width (px) of the floating panel overlapping the map's LEFT edge, so the
  // smart fit can keep the route clear of it. 0 when the panel is collapsed.
  panelInsetPx?: number
  // Optional external recenter request: whenever this changes to a coordinate,
  // the map pans/zooms to it. Independent of the route auto-fit (which only
  // frames structural route changes), so a single picked point can center the
  // map. Used by the stop-location picker; the route planner never sets it.
  center?: LatLng | null
  // Whether the waypoint markers + route line can be grabbed/dragged. Default
  // true (the Route Planner's always-editable behaviour). The read-only trip
  // route map sets it false, flipping to true only in its "Edit route" mode, so
  // markers can't be nudged when nobody's editing.
  objectsDraggable?: boolean
  className?: string
}

// Interactive HERE map (Maps JS v3.2 / HARP). Owns the map instance; redraws the
// ordered waypoint markers + the route line whenever those props change, and
// toggles the HERE logistics (HGV truck-restriction) overlay. The browser-
// rendered map is the one place a HERE key reaches the client — fetched via
// loadHere() from the auth-gated proxy, never bundled.
export default function HereMap({
  markers,
  driverMarkers,
  driverTrails,
  savedPlaces,
  routePolylines,
  scaleRouteWidthWithZoom = false,
  routeDistanceLabel,
  truckOverlay,
  onTruckOverlayAvailabilityChange,
  onMapContextMenu,
  onMapViewChange,
  onMarkerDragEnd,
  onMarkerClick,
  onSavedPlaceClick,
  onRouteDragEnd,
  panelInsetPx = 0,
  center,
  objectsDraggable = true,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const controlsHostRef = useRef<HTMLDivElement>(null)
  // Keep the latest event callbacks in refs so the once-only init effect's
  // listeners always call the current handlers without re-subscribing.
  const onContextMenuRef = useRef(onMapContextMenu)
  onContextMenuRef.current = onMapContextMenu
  const onViewChangeRef = useRef(onMapViewChange)
  onViewChangeRef.current = onMapViewChange
  const onMarkerDragEndRef = useRef(onMarkerDragEnd)
  onMarkerDragEndRef.current = onMarkerDragEnd
  const onMarkerClickRef = useRef(onMarkerClick)
  onMarkerClickRef.current = onMarkerClick
  const onSavedPlaceClickRef = useRef(onSavedPlaceClick)
  onSavedPlaceClickRef.current = onSavedPlaceClick
  const onRouteDragEndRef = useRef(onRouteDragEnd)
  onRouteDragEndRef.current = onRouteDragEnd
  // Set true on any real drag move so the trailing `tap` after a drag isn't
  // misread as a marker click (HERE fires a tap on press-release).
  const didDragRef = useRef(false)
  // Active route-line drag: which section was grabbed + the live ghost marker.
  const routeDragRef = useRef<{ active: boolean; section: number; ghost: any }>({
    active: false,
    section: -1,
    ghost: null,
  })
  const panelInsetRef = useRef(panelInsetPx)
  panelInsetRef.current = panelInsetPx
  const HRef = useRef<any>(null)
  const mapRef = useRef<any>(null)
  const behaviorRef = useRef<any>(null)
  const truckOverlayRef = useRef(truckOverlay)
  truckOverlayRef.current = truckOverlay
  // Objects that must be volatile while idle so HERE can start drag gestures.
  // During a camera pan/zoom we temporarily cache them, then restore volatility
  // when the view settles. This keeps editing intact without paying their
  // per-frame rendering cost throughout ordinary map navigation.
  const draggableObjectsRef = useRef<any[]>([])
  // Route drag targets are full-length, transparent copies of each route leg.
  // They are useful only while the camera is idle, so hide them completely
  // during pan/zoom instead of asking HARP to keep transforming invisible
  // geometry on every frame.
  const routeDragTargetsRef = useRef<any[]>([])
  // Visible casing/main pairs whose width can be updated after a zoom without
  // decoding or rebuilding the route geometry.
  const routeStrokePairsRef = useRef<Array<{ casing: any; main: any; arrows: any }>>([])
  // The casing improves contrast while idle, but duplicates the visible route
  // geometry. Hide only this decorative layer while the camera is moving; the
  // coral route itself remains visible throughout navigation.
  const routeDecorationsRef = useRef<any[]>([])
  const scaleRouteWidthRef = useRef(scaleRouteWidthWithZoom)
  scaleRouteWidthRef.current = scaleRouteWidthWithZoom
  // HERE recommends reusing marker icons. Route recalculation redraws every
  // marker, so retain the small set of icons across draw() calls rather than
  // rebuilding and reparsing identical SVGs each time.
  const markerIconCacheRef = useRef<Map<string, any>>(new Map())
  // Three stacked groups rather than one, because the paint order carries
  // meaning (see the addObject calls in init): planned route at the bottom, the
  // driven path over it, and every marker on top of both. A redraw is "clear the
  // group, add fresh objects" rather than tracking individual handles.
  const groupRef = useRef<any>(null)
  const trailGroupRef = useRef<any>(null)
  const markerGroupRef = useRef<any>(null)
  // The standard basemap + the logistics (HGV) basemap, captured at init so the
  // overlay toggle can swap between them without rebuilding the map.
  const baseLayerRef = useRef<any>(null)
  const baseMapLayersRef = useRef<Record<BaseMapMode, any>>({ map: null, satellite: null })
  const trafficLayerRef = useRef<any>(null)
  const mapStyleControlRef = useRef<HereMapStyleControlHandle | null>(null)
  const mapZoomControlRef = useRef<HereMapZoomControlHandle | null>(null)
  const logisticsLayerRef = useRef<any>(null)
  // Guards so we enable the (expensive) vehicle-restrictions feature only once.
  const overlayFeatureEnabledRef = useRef(false)
  // Last "fit signature" the map was framed for. We auto-fit ONLY on structural
  // route changes (the route first appearing, or an endpoint added/removed) — not
  // when an intermediate stop is added/removed/dragged or the route merely
  // recalculates. This keeps the user's zoom/pan stable while adding stops, which
  // otherwise reframed (and felt like a random zoom-in) on every change.
  const lastFitSigRef = useRef<string>('')
  // Whether the last draw() put a route on the map. The reveal fires on the
  // false → true edge only, so recalculating an existing route redraws it in
  // place instead of replaying its entrance.
  const hadRouteRef = useRef(false)
  const routeRevealRef = useRef<RouteReveal | null>(null)
  // Decoded route path (whole route, travel order) + per-vertex cumulative
  // distances (metres from the start), refreshed by draw(). Read by the
  // pointermove hover readout; null when there's no route so the readout stays
  // hidden. Kept in a ref so hovering never triggers a React re-render.
  const hoverGeomRef = useRef<{ path: LatLng[]; cum: number[] } | null>(null)
  // True while a marker/route/pan drag is in progress, and while the view is
  // animating — both suppress the hover readout so it doesn't flicker.
  const activeDragRef = useRef(false)
  // Unlike activeDragRef, this only tracks direct marker/route editing. A plain
  // camera pan should still switch draggable objects into cached mode.
  const interactiveDragRef = useRef(false)
  const viewChangingRef = useRef(false)
  // Flips true once the map exists; drives the effects so the first draw/toggle
  // always runs with the latest props (not whatever they were at mount).
  const [ready, setReady] = useState(false)

  // ── Init once ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    let resizeObserver: ResizeObserver | null = null
    let resizeRaf = 0
    let detachListeners: (() => void) | null = null
    let ui: any = null

    loadHere()
      .then(({ H, apiKey }) => {
        if (cancelled || !containerRef.current || !controlsHostRef.current || mapRef.current) return

        const platform = new H.service.Platform({ apikey: apiKey })
        // Raster Tile API v3 uses `ppi` to select the label/icon density. Keep
        // the lower-cost raster setup available for touch-first devices.
        const defaultLayers = platform.createDefaultLayers({ tileSize: 512, ppi: 100 })

        // Raster labels soften at fractional zoom levels and on Windows-scaled
        // desktop displays. Prefer vector for mouse/desktop layouts so labels
        // and roads remain crisp; retain raster on touch devices for its lower
        // rendering cost.
        const desktopPointer = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? true
        const baseLayer = desktopPointer
          ? defaultLayers.vector.normal.map
          : defaultLayers.raster?.normal?.map ?? defaultLayers.vector.normal.map
        const satelliteLayer = defaultLayers.raster?.satellite?.map ?? null
        const trafficLayer = defaultLayers.vector?.traffic?.map ?? null
        const logisticsLayer = defaultLayers.vector?.normal?.logistics ?? null
        baseLayerRef.current = baseLayer
        baseMapLayersRef.current = { map: baseLayer, satellite: satelliteLayer }
        trafficLayerRef.current = trafficLayer
        logisticsLayerRef.current = logisticsLayer

        // Allow the desktop vector canvas to reach the common Windows 150%
        // scale instead of letting the compositor enlarge a smaller canvas.
        // Touch layouts keep the lower cap because their raster layer benefits
        // more from the reduced render cost.
        const maxPixelRatio = desktopPointer ? 1.5 : 1.25
        const map = new H.Map(containerRef.current, baseLayer, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          pixelRatio: Math.min(window.devicePixelRatio || 1, maxPixelRatio),
          // Reuse nearby cached zoom levels behind newly requested tiles. This
          // avoids a blank/flash during wheel zoom without increasing the live
          // WebGL resolution of the map surface.
          renderBaseBackground: { lower: 2, higher: 1 },
        })

        const behavior = new H.mapevents.Behavior(new H.mapevents.MapEvents(map))
        behaviorRef.current = behavior
        ui = H.ui.UI.createDefault(map, defaultLayers)
        // Replace HERE's text-only map settings list with the visual thumbnail
        // selector below, while keeping its zoom and scale controls.
        // removeControl() already detaches and disposes HERE's control internals.
        // Calling dispose() again throws in Maps JS 3.2 and would abort before
        // our replacement controls are mounted.
        ui.removeControl('mapsettings')
        ui.removeControl('zoom')

        // Paint order, bottom to top. HERE draws groups in the order they were
        // added, so this IS the layering:
        //   1. the planned route — the intent, the widest line, the base layer;
        //   2. the driven path over it, so the teal dashes stay visible where the
        //      truck followed the plan (they'd be buried underneath otherwise);
        //   3. every marker above both, so a day's worth of breadcrumbs can never
        //      hide the stop it was driving to.
        // The live driver puck and the direction chevrons sit higher still — they
        // are DOM overlays on the container, above the whole canvas.
        const group = new H.map.Group()
        map.addObject(group)
        const trailGroup = new H.map.Group()
        map.addObject(trailGroup)
        const markerGroup = new H.map.Group()
        map.addObject(markerGroup)

        HRef.current = H
        mapRef.current = map
        groupRef.current = group
        trailGroupRef.current = trailGroup
        markerGroupRef.current = markerGroup

        mapStyleControlRef.current = createHereMapStyleControl({
          container: controlsHostRef.current,
          satelliteAvailable: Boolean(satelliteLayer),
          trafficAvailable: Boolean(trafficLayer),
          onBaseModeChange: (mode) => {
            const layer = baseMapLayersRef.current[mode]
            if (!layer) return
            baseLayerRef.current = layer
            if (!truckOverlayRef.current) map.setBaseLayer(layer)
          },
          onTrafficChange: (enabled) => {
            const layer = trafficLayerRef.current
            if (!layer) return
            if (enabled) map.addLayer(layer)
            else map.removeLayer(layer)
          },
        })
        mapStyleControlRef.current.setTruckMode(truckOverlayRef.current)
        mapZoomControlRef.current = createHereMapZoomControl({
          container: controlsHostRef.current,
          onZoomIn: () => map.setZoom(map.getZoom() + 1, true),
          onZoomOut: () => map.setZoom(map.getZoom() - 1, true),
        })

        // Tell the parent whether the HGV overlay can be offered at all.
        onTruckOverlayAvailabilityChange?.(Boolean(logisticsLayer))

        let lastWidth = containerRef.current.clientWidth
        let lastHeight = containerRef.current.clientHeight
        resizeObserver = new ResizeObserver(([entry]) => {
          const width = Math.round(entry.contentRect.width)
          const height = Math.round(entry.contentRect.height)
          if (width === lastWidth && height === lastHeight) return
          lastWidth = width
          lastHeight = height
          if (!resizeRaf) {
            resizeRaf = requestAnimationFrame(() => {
              resizeRaf = 0
              map.getViewPort().resize()
            })
          }
        })
        resizeObserver.observe(containerRef.current)

        const container = containerRef.current

        // ── Route hover distance readout ──────────────────────────────────
        // A compact floating pill that appears when the cursor is near the
        // drawn route line, showing how far along the route (from the start)
        // the hovered point is. All imperative: a plain DOM element positioned
        // from a single rAF-throttled pointermove, reading the cached route
        // geometry in hoverGeomRef. No React state and no map redraw, so moving
        // the mouse never re-renders the component or the map, and nothing calls
        // the routing API.
        const hoverLabel = document.createElement('div')
        hoverLabel.className = 'route-hover-label'
        hoverLabel.style.display = 'none'
        container.appendChild(hoverLabel)

        const hideHover = () => {
          if (hoverLabel.style.display !== 'none') hoverLabel.style.display = 'none'
          container.classList.remove('route-hover')
        }
        const showHover = (x: number, y: number, meters: number) => {
          hoverLabel.textContent = formatHoverDistance(meters)
          hoverLabel.style.display = 'block'
          container.classList.add('route-hover')
          // Flip the pill below the point near the top edge so it never clips;
          // the CSS tail points back at the line either way.
          hoverLabel.classList.toggle('route-hover-label--below', y < 48)
          // Keep the centre-anchored pill within the map horizontally.
          const half = hoverLabel.offsetWidth / 2
          const w = container.clientWidth
          const cx = Math.min(Math.max(x, half + 4), Math.max(half + 4, w - half - 4))
          hoverLabel.style.left = `${cx}px`
          hoverLabel.style.top = `${y}px`
        }

        // rAF-coalesced: the move handler only stashes the latest cursor pixel;
        // the nearest-point maths run at most 30 times/sec. A hover label does
        // not benefit from 60Hz geometry scans, leaving more main-thread budget
        // for HERE's own pointer and camera processing.
        let hoverRaf = 0
        let lastHoverAt = 0
        let hoverPx: { x: number; y: number } | null = null
        const processHover = (now: number) => {
          if (now - lastHoverAt < 32) {
            hoverRaf = requestAnimationFrame(processHover)
            return
          }
          hoverRaf = 0
          lastHoverAt = now
          const p = hoverPx
          const geom = hoverGeomRef.current
          if (!p || !geom || activeDragRef.current || viewChangingRef.current) {
            hideHover()
            return
          }
          const g0 = map.screenToGeo(p.x, p.y)
          if (!g0) {
            hideHover()
            return
          }
          const cursor = { lat: g0.lat, lng: g0.lng }
          // Convert the fixed pixel threshold into ground metres at this zoom by
          // measuring how far HOVER_THRESHOLD_PX spans, so the hit-test feels the
          // same when zoomed in or out.
          const g1 = map.screenToGeo(p.x + HOVER_THRESHOLD_PX, p.y)
          const threshMeters = g1 ? haversineMeters(cursor, { lat: g1.lat, lng: g1.lng }) : 0
          const near = nearestPointOnPath(cursor, geom.path, geom.cum)
          if (near && threshMeters > 0 && near.meters <= threshMeters) showHover(p.x, p.y, near.along)
          else hideHover()
        }
        const onPointerMove = (e: PointerEvent) => {
          // `dragstart` / `mapviewchangestart` can arrive just after the first
          // pressed pointermove. The buttons guard closes that small window so
          // the O(route vertices) hover hit-test never competes with a pan.
          if (e.buttons !== 0 || activeDragRef.current || viewChangingRef.current) {
            hoverPx = null
            hideHover()
            return
          }
          const rect = container.getBoundingClientRect()
          hoverPx = { x: e.clientX - rect.left, y: e.clientY - rect.top }
          if (!hoverRaf) hoverRaf = requestAnimationFrame(processHover)
        }
        const onPointerLeave = () => {
          hoverPx = null
          hideHover()
        }
        // There is no useful hover state on touch screens. Avoid installing a
        // high-frequency listener there while the same pointer pans the map.
        const supportsRouteHover =
          window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? true
        if (supportsRouteHover) {
          container.addEventListener('pointermove', onPointerMove)
          container.addEventListener('pointerleave', onPointerLeave)
        }

        // Right-click → report the geo coordinate under the cursor + the
        // cursor's position within the container (for menu placement).
        const onContextMenu = (e: MouseEvent) => {
          if (!onContextMenuRef.current) return
          e.preventDefault()
          const rect = container.getBoundingClientRect()
          const x = e.clientX - rect.left
          const y = e.clientY - rect.top
          const geo = map.screenToGeo(x, y)
          if (!geo) return
          const zoom = map.getZoom()
          const candidates = sampleScreenCandidates(map, x, y, zoom)
          if (snapDebug())
            // eslint-disable-next-line no-console
            console.log('[routeSnap] map right-click', {
              pixel: { x, y },
              rawGeo: { lat: geo.lat, lng: geo.lng },
              zoom,
              candidates: candidates.length,
            })
          onContextMenuRef.current({ lat: geo.lat, lng: geo.lng, x, y, zoom, candidates })
        }
        container.addEventListener('contextmenu', onContextMenu)

        // Pan/zoom dismisses any open menu and hides the hover readout; the flag
        // keeps it suppressed for the duration of the gesture.
        let resumeDraggableRaf = 0
        const setDraggableVolatility = (volatile: boolean) => {
          for (const object of draggableObjectsRef.current) object.setVolatility?.(volatile)
        }
        const setRouteDragTargetsVisible = (visible: boolean) => {
          for (const target of routeDragTargetsRef.current) target.setVisibility?.(visible)
        }
        const setRouteDecorationsVisible = (visible: boolean) => {
          for (const decoration of routeDecorationsRef.current) decoration.setVisibility?.(visible)
          // Arrows are decorations too — they hide during a camera move for the
          // same frame-cost reason — but they carry a SECOND condition: they
          // only exist above the zoom where a glyph is legible. They are driven
          // here rather than pushed into routeDecorationsRef, where `true` would
          // mean unconditionally visible and the resume after every pan would
          // put country-zoom arrows back on the line.
          const arrowsAllowed =
            !scaleRouteWidthRef.current ||
            routeStrokeWidths(map.getZoom?.() ?? DEFAULT_ZOOM).arrowsVisible
          for (const pair of routeStrokePairsRef.current) {
            pair.arrows?.setVisibility?.(visible && arrowsAllowed)
          }
        }
        const updateRouteWidths = () => {
          if (!scaleRouteWidthRef.current) return
          const widths = routeStrokeWidths(map.getZoom?.() ?? DEFAULT_ZOOM)
          for (const pair of routeStrokePairsRef.current) {
            pair.casing.setStyle?.(routeCasingStyle(widths.casing))
            pair.main.setStyle?.(routeSpineStyle(widths.main))
            // The arrow line exists for the whole life of the route and is
            // hidden rather than rebuilt when the zoom drops below the
            // legibility threshold — rebuilding it per zoom step would churn
            // map objects on every wheel tick.
            pair.arrows?.setStyle?.(routeArrowStyle(H, widths.arrow))
            pair.arrows?.setVisibility?.(widths.arrowsVisible && !viewChangingRef.current)
          }
        }
        const suspendEditObjectsForNavigation = () => {
          viewChangingRef.current = true
          hoverPx = null
          if (hoverRaf) {
            cancelAnimationFrame(hoverRaf)
            hoverRaf = 0
          }
          hideHover()
          if (!interactiveDragRef.current) {
            if (resumeDraggableRaf) {
              cancelAnimationFrame(resumeDraggableRaf)
              resumeDraggableRaf = 0
            }
            setRouteDragTargetsVisible(false)
            setRouteDecorationsVisible(false)
            setDraggableVolatility(false)
          }
        }
        const onViewChange = () => {
          suspendEditObjectsForNavigation()
          mapStyleControlRef.current?.close()
          onViewChangeRef.current?.()
        }
        const onViewChangeEnd = () => {
          viewChangingRef.current = false
          updateRouteWidths()
          // Let HERE finish the camera's final frame before returning interaction
          // objects to its live render path.
          if (!interactiveDragRef.current) {
            resumeDraggableRaf = requestAnimationFrame(() => {
              resumeDraggableRaf = 0
              setRouteDragTargetsVisible(true)
              setRouteDecorationsVisible(true)
              setDraggableVolatility(true)
            })
          }
        }
        map.addEventListener('mapviewchangestart', onViewChange)
        map.addEventListener('mapviewchangeend', onViewChangeEnd)

        // Wheel events reach the DOM before HERE begins its camera transition.
        // Suspend the large route hit targets immediately so they do not consume
        // the first (and most noticeable) zoom frame.
        const onWheel = () => suspendEditObjectsForNavigation()
        container.addEventListener('wheel', onWheel, { passive: true, capture: true })

        // ── Marker dragging ───────────────────────────────────────────────
        // Markers are made draggable + volatile in draw() (volatility is what
        // lets HERE re-render them per-frame and deliver drag gestures). While a
        // marker is dragged we disable map panning, move it live (preserving the
        // grab offset so it doesn't jump under the cursor), and on release report
        // its id + dropped coordinate so the parent can snap + recalc.
        const onDragStart = (ev: any) => {
          const t = ev.target
          const pointer = ev.currentPointer
          didDragRef.current = false
          interactiveDragRef.current = false
          // Any drag (marker, route line, or a plain pan) suppresses the hover
          // readout until dragend.
          activeDragRef.current = true
          hideHover()
          if (t instanceof H.map.Marker && pointer) {
            interactiveDragRef.current = true
            const screen = map.geoToScreen(t.getGeometry())
            t.__dragOffset = new H.math.Point(pointer.viewportX - screen.x, pointer.viewportY - screen.y)
            behavior.disable()
          } else if (t instanceof H.map.Polyline && pointer) {
            // Grabbed the route line — start a drag-to-add-stop segment drag.
            const data = t.getData?.()
            if (data && typeof data.section === 'number') {
              interactiveDragRef.current = true
              behavior.disable()
              const geo = map.screenToGeo(pointer.viewportX, pointer.viewportY)
              const ghost = new H.map.Marker(geo, {
                icon: new H.map.Icon(ghostSvg(), { anchor: new H.math.Point(6, 6) }),
                volatility: true,
              })
              map.addObject(ghost)
              routeDragRef.current = { active: true, section: data.section, ghost }
            } else {
              // A pan beginning over a visible (non-draggable) route stroke is
              // still ordinary camera navigation.
              suspendEditObjectsForNavigation()
            }
          } else {
            // A plain map pan: cache/hide edit-only objects before the camera's
            // first moving frame rather than waiting for mapviewchangestart.
            suspendEditObjectsForNavigation()
          }
        }
        const onDrag = (ev: any) => {
          const t = ev.target
          const pointer = ev.currentPointer
          didDragRef.current = true
          if (t instanceof H.map.Marker && pointer && t.__dragOffset) {
            const p = map.screenToGeo(pointer.viewportX - t.__dragOffset.x, pointer.viewportY - t.__dragOffset.y)
            if (p) t.setGeometry(p)
          } else if (routeDragRef.current.active && pointer && routeDragRef.current.ghost) {
            const geo = map.screenToGeo(pointer.viewportX, pointer.viewportY)
            if (geo) routeDragRef.current.ghost.setGeometry(geo)
          }
        }
        const onDragEnd = (ev: any) => {
          const t = ev.target
          // Resolve the FINAL release pixel from the dragend pointer itself, not
          // the last `drag` frame, so we never use a slightly stale position.
          const releasePointer = ev.currentPointer
          const zoom = map.getZoom()
          if (t instanceof H.map.Marker) {
            behavior.enable()
            const data = t.getData?.()
            let g = t.getGeometry?.()
            // The marker's ANCHOR pixel at release = cursor minus the grab offset,
            // so sampling centres on where the marker actually sits (not the spot
            // on its icon the user happened to grab).
            let relX = 0
            let relY = 0
            let havePixel = false
            if (didDragRef.current && releasePointer && t.__dragOffset) {
              relX = releasePointer.viewportX - t.__dragOffset.x
              relY = releasePointer.viewportY - t.__dragOffset.y
              havePixel = true
              const fresh = map.screenToGeo(relX, relY)
              if (fresh) g = fresh
            }
            if (didDragRef.current) {
              // A real drag → report screen-space candidates for snap + recalc.
              if (data?.id && g) {
                if (!havePixel) {
                  const s = map.geoToScreen(g)
                  relX = s?.x ?? 0
                  relY = s?.y ?? 0
                }
                const candidates = sampleScreenCandidates(map, relX, relY, zoom)
                if (snapDebug())
                  // eslint-disable-next-line no-console
                  console.log('[routeSnap] marker drag release', {
                    id: data.id,
                    pixel: { x: relX, y: relY },
                    rawGeo: { lat: g.lat, lng: g.lng },
                    zoom,
                    candidates: candidates.length,
                  })
                onMarkerDragEndRef.current?.(data.id, candidates, zoom)
              }
            } else if (data?.id && data?.kind && g) {
              // Press-release with no movement = a click. HERE may consume the
              // gesture on a draggable marker and not emit a separate `tap`, so
              // open the popover here too (idempotent with the tap listener).
              const screen = map.geoToScreen(g)
              if (screen) onMarkerClickRef.current?.({ id: data.id, kind: data.kind, x: screen.x, y: screen.y })
            }
          }
          // Route-line drag release — drop the ghost, sample around the release,
          // report the section + candidates.
          if (routeDragRef.current.active) {
            const { ghost, section } = routeDragRef.current
            behavior.enable()
            let g = ghost?.getGeometry?.()
            let relX = 0
            let relY = 0
            let havePixel = false
            if (releasePointer) {
              relX = releasePointer.viewportX
              relY = releasePointer.viewportY
              havePixel = true
              const fresh = map.screenToGeo(relX, relY)
              if (fresh) g = fresh
            }
            if (ghost) map.removeObject(ghost)
            routeDragRef.current = { active: false, section: -1, ghost: null }
            if (g) {
              if (!havePixel) {
                const s = map.geoToScreen(g)
                relX = s?.x ?? 0
                relY = s?.y ?? 0
              }
              const candidates = sampleScreenCandidates(map, relX, relY, zoom)
              if (snapDebug())
                // eslint-disable-next-line no-console
                console.log('[routeSnap] route drag release', {
                  section,
                  pixel: { x: relX, y: relY },
                  rawGeo: { lat: g.lat, lng: g.lng },
                  zoom,
                  candidates: candidates.length,
                })
              onRouteDragEndRef.current?.(section, candidates, zoom)
            }
          }
          activeDragRef.current = false
          interactiveDragRef.current = false
        }
        map.addEventListener('dragstart', onDragStart)
        map.addEventListener('drag', onDrag)
        map.addEventListener('dragend', onDragEnd)

        // ── Marker click → open the parent's marker popover ───────────────
        // A `tap` on a marker (press-release without dragging) opens a small
        // role-aware popover (remove stop / copy coords). We anchor it to the
        // marker's screen position so it sits beside the pin.
        const onTap = (ev: any) => {
          const t = ev.target
          if (didDragRef.current) return
          if (!(t instanceof H.map.Marker)) return
          const data = t.getData?.()
          const g = t.getGeometry?.()
          if (!g) return
          const screen = map.geoToScreen(g)
          if (!screen) return
          if (data?.placeId) {
            onSavedPlaceClickRef.current?.({ id: data.placeId, x: screen.x, y: screen.y })
            return
          }
          if (!data?.id || !data?.kind) return
          onMarkerClickRef.current?.({ id: data.id, kind: data.kind, x: screen.x, y: screen.y })
        }
        map.addEventListener('tap', onTap)

        // Reset the drag latch at the START of every pointer interaction so a
        // `tap` is judged purely by THIS gesture. `onDrag` sets the latch true
        // for ANY drag (including a plain map pan) and only `onDragStart` cleared
        // it — so after the first pan/zoom the latch stayed true and silently
        // swallowed every later marker tap, breaking "click a stop to remove it".
        // pointerdown fires before dragstart/tap, so it's the reliable reset.
        const onPointerDown = () => {
          didDragRef.current = false
        }
        map.addEventListener('pointerdown', onPointerDown)

        detachListeners = () => {
          container.removeEventListener('contextmenu', onContextMenu)
          container.removeEventListener('pointermove', onPointerMove)
          container.removeEventListener('pointerleave', onPointerLeave)
          container.removeEventListener('wheel', onWheel, true)
          if (hoverRaf) cancelAnimationFrame(hoverRaf)
          hoverLabel.remove()
          map.removeEventListener('mapviewchangestart', onViewChange)
          map.removeEventListener('mapviewchangeend', onViewChangeEnd)
          if (resumeDraggableRaf) cancelAnimationFrame(resumeDraggableRaf)
          map.removeEventListener('pointerdown', onPointerDown)
          map.removeEventListener('dragstart', onDragStart)
          map.removeEventListener('drag', onDrag)
          map.removeEventListener('dragend', onDragEnd)
          map.removeEventListener('tap', onTap)
        }

        setReady(true)
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('HERE map failed to load', err)
        onTruckOverlayAvailabilityChange?.(false)
      })

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      if (resizeRaf) cancelAnimationFrame(resizeRaf)
      routeRevealRef.current?.cancel()
      routeRevealRef.current = null
      detachListeners?.()
      mapStyleControlRef.current?.dispose()
      mapStyleControlRef.current = null
      mapZoomControlRef.current?.dispose()
      mapZoomControlRef.current = null
      ui?.dispose?.()
      if (mapRef.current) {
        mapRef.current.dispose()
        mapRef.current = null
        groupRef.current = null
        trailGroupRef.current = null
        markerGroupRef.current = null
        // Chevrons are container children, not map objects — disposing the map
        // does not take them with it.
        for (const el of trailChevronsRef.current) el.remove()
        trailChevronsRef.current = []
        baseMapLayersRef.current = { map: null, satellite: null }
        trafficLayerRef.current = null
        draggableObjectsRef.current = []
        routeDragTargetsRef.current = []
        routeStrokePairsRef.current = []
        routeDecorationsRef.current = []
        markerIconCacheRef.current.clear()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Redraw markers + route when the route/waypoints change ────────────────
  useEffect(() => {
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, markers, savedPlaces, routePolylines, routeDistanceLabel, objectsDraggable])

  // ── Live-driver DOM overlay ────────────────────────────────────────────────
  // Driver markers are plain DOM elements appended to the map container and
  // positioned imperatively via geoToScreen — NOT H.map.DomMarker, which the
  // v3.2 HARP engine simply doesn't render (its DOM overlay layer stays
  // empty). Same pattern as the route hover readout above: reposition on a
  // rAF-throttled `mapviewchange`, so panning/zooming keeps them glued to
  // their coordinate without ever re-rendering React. Deliberately excluded
  // from the auto-fit — a 60-second position update must never move the
  // viewport (follow mode can come later).
  const driverElsRef = useRef<Map<string, HTMLDivElement>>(new Map())
  useEffect(() => {
    const map = mapRef.current
    const container = containerRef.current
    if (!ready || !map || !container) return
    const els = driverElsRef.current
    const list = driverMarkers ?? []

    // Sync one element per driver: create missing, update existing (class for
    // the stale look, tooltip detail, name pill), remove departed.
    const seen = new Set<string>()
    for (const d of list) {
      seen.add(d.id)
      let el = els.get(d.id)
      if (!el) {
        el = document.createElement('div')
        // Arrow first so it paints UNDER the dot — the dot is the position, the
        // arrowhead only orbits it.
        const arrow = document.createElement('div')
        arrow.className = 'driver-marker-arrow'
        const dot = document.createElement('div')
        dot.className = 'driver-marker-dot'
        const name = document.createElement('div')
        name.className = 'driver-marker-name'
        el.appendChild(arrow)
        el.appendChild(dot)
        el.appendChild(name)
        container.appendChild(el)
        els.set(d.id, el)
      }
      el.className = d.stale ? 'driver-marker driver-marker--stale' : 'driver-marker'
      // Heading is optional: a stationary phone reports no bearing, and an arrow
      // pointing in an arbitrary direction would be a claim the data can't make.
      const arrow = el.children[0] as HTMLElement
      if (d.headingDeg === undefined) {
        arrow.style.display = 'none'
      } else {
        arrow.style.display = ''
        arrow.style.transform = `translate(-50%, -50%) rotate(${d.headingDeg}deg)`
      }
      ;(el.children[1] as HTMLElement).title = d.detail ? `${d.name} — ${d.detail}` : d.name
      ;(el.children[2] as HTMLElement).textContent = d.name
    }
    for (const [id, el] of els) {
      if (!seen.has(id)) {
        el.remove()
        els.delete(id)
      }
    }
    // Route Planner does not show live drivers. Avoid scheduling an empty
    // animation-frame callback throughout every pan/zoom in that case.
    if (list.length === 0) return

    const position = () => {
      for (const d of list) {
        const el = els.get(d.id)
        if (!el) continue
        const s = map.geoToScreen({ lat: d.position.lat, lng: d.position.lng })
        if (!s) {
          el.style.display = 'none'
          continue
        }
        el.style.display = ''
        el.style.left = `${s.x}px`
        el.style.top = `${s.y}px`
      }
    }
    position()

    let raf = 0
    const onView = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0
          position()
        })
    }
    // `mapviewchange` streams during a pan/zoom; `mapviewchangeend` settles the
    // final camera (the last `mapviewchange` can precede it by a few pixels).
    map.addEventListener('mapviewchange', onView)
    map.addEventListener('mapviewchangeend', onView)
    return () => {
      map.removeEventListener('mapviewchange', onView)
      map.removeEventListener('mapviewchangeend', onView)
      if (raf) cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, driverMarkers])

  // ── Driver breadcrumb trails ──────────────────────────────────────────────
  // The path the truck actually drove, drawn under the planned route so the two
  // read as "intended" vs "actual" rather than competing for the same line. Its
  // own group and effect: this redraws every time a point lands (once a minute)
  // and must not trigger the route/marker rebuild, which is far heavier.
  //
  // Never contributes to the viewport fit — like the driver marker, a position
  // update must not move the camera under the dispatcher.
  useEffect(() => {
    const H = HRef.current
    const group = trailGroupRef.current
    if (!ready || !H || !group) return
    group.removeAll()
    for (const trail of driverTrails ?? []) {
      // One polyline PER RUN. Concatenating them would draw a straight line
      // across every stretch where the signal was lost — the exact false claim
      // the segmentation exists to prevent.
      for (const segment of trail.segments) {
        if (segment.length < 2) continue
        const line = new H.geo.LineString()
        for (const p of segment) line.pushPoint(p)
        // Both strokes are dashed. The pale casing separates the travelled path
        // from the wider brown planned route; gaps still expose that route below.
        group.addObject(
          new H.map.Polyline(line, {
            style: {
              lineWidth: 7,
              strokeColor: trail.stale ? 'rgba(255,255,255,0.62)' : 'rgba(255,255,255,0.92)',
              lineJoin: 'round',
              lineCap: 'round',
              lineDash: [12, 8],
            },
          }),
        )
        group.addObject(
          new H.map.Polyline(line, {
            style: {
              lineWidth: 4.5,
              strokeColor: trail.stale ? 'rgba(13,148,136,0.72)' : 'rgba(0,184,169,1)',
              lineJoin: 'round',
              lineCap: 'round',
              lineDash: [12, 8],
            },
          }),
        )
      }
    }
    return () => {
      // The group can outlive this effect (the map disposes separately), so
      // clear it rather than leaving a stale path behind on the next render.
      trailGroupRef.current?.removeAll()
    }
  }, [ready, driverTrails])

  // ── Trail direction chevrons ──────────────────────────────────────────────
  // Which WAY the truck drove each leg, not just where it went. Drawn as DOM
  // overlays for the same two reasons the driver marker is: HARP renders no DOM
  // markers of its own, and a chevron built from map geometry would scale with
  // zoom — huge when zoomed out, invisible when zoomed in. As screen-space
  // elements they stay one size, and spacing is decided in screen space too, so
  // their density stays even at every zoom instead of bunching up.
  const trailChevronsRef = useRef<HTMLDivElement[]>([])
  useEffect(() => {
    const map = mapRef.current
    const container = containerRef.current
    if (!ready || !map || !container) return

    // One candidate per sampled trail segment. Direction is a GEO bearing
    // computed once here, not an angle measured between two projected points:
    // consecutive trail points land a pixel or two apart on screen, so a
    // screen-space vector is far too short to derive an angle from — and any
    // "segment long enough?" threshold would reject every candidate at low zoom
    // and draw no chevrons at all. A bearing is zoom-independent, and it costs
    // one projection per candidate at paint time instead of two.
    type Candidate = { at: LatLng; bearing: number; stale: boolean }
    const candidates: Candidate[] = []
    for (const trail of driverTrails ?? []) {
      // Per run, so a chevron never straddles a gap and claims a direction of
      // travel through a stretch that was never observed.
      const total = trail.segments.reduce((sum, s) => sum + s.length, 0)
      for (const segment of trail.segments) {
        // A day-long trail can hold 1500 points; projecting every segment on
        // every pan frame would cost more than it shows. Sample down — far more
        // candidates than can ever be placed is already plenty of choice. The
        // budget is shared across runs in proportion to their length.
        const budget = Math.max(2, Math.round((segment.length / Math.max(1, total)) * MAX_TRAIL_CANDIDATES))
        const step = Math.max(1, Math.ceil((segment.length - 1) / budget))
        for (let i = step; i < segment.length; i += step) {
          const from = segment[i - step]
          const to = segment[i]
          // A stationary pair has no direction to point in.
          if (from.lat === to.lat && from.lng === to.lng) continue
          candidates.push({ at: to, bearing: bearingBetween(from, to), stale: trail.stale })
        }
      }
    }

    const pool = trailChevronsRef.current
    const wanted = Math.min(candidates.length, MAX_TRAIL_CHEVRONS)
    while (pool.length < wanted) {
      const el = document.createElement('div')
      el.className = 'trail-chevron'
      container.appendChild(el)
      pool.push(el)
    }
    while (pool.length > wanted) pool.pop()?.remove()
    if (!pool.length) return

    const position = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      // A bearing is relative to north; if the camera is rotated, screen-up is
      // no longer north and the chevrons have to turn with it.
      const mapBearing = Number(map.getViewModel?.()?.getLookAtData?.()?.bearing) || 0
      let used = 0
      let lastX = 0
      let lastY = 0
      for (const c of candidates) {
        if (used >= pool.length) break
        const b = map.geoToScreen(c.at)
        if (!b) continue
        // Off-screen segments must not consume pool slots, or zooming into the
        // end of a long trail would spend every chevron on invisible legs.
        if (b.x < -40 || b.y < -40 || b.x > w + 40 || b.y > h + 40) continue
        if (used > 0 && Math.hypot(b.x - lastX, b.y - lastY) < TRAIL_CHEVRON_GAP_PX) continue
        const el = pool[used]
        el.className = c.stale ? 'trail-chevron trail-chevron--stale' : 'trail-chevron'
        el.style.display = ''
        el.style.left = `${b.x}px`
        el.style.top = `${b.y}px`
        // The CSS triangle points UP, i.e. at bearing 0 — so the bearing is the
        // rotation directly, with no offset to get wrong.
        el.style.transform = `translate(-50%, -50%) rotate(${c.bearing - mapBearing}deg)`
        lastX = b.x
        lastY = b.y
        used++
      }
      for (let i = used; i < pool.length; i++) pool[i].style.display = 'none'
    }
    position()

    let raf = 0
    const onView = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0
          position()
        })
    }
    map.addEventListener('mapviewchange', onView)
    map.addEventListener('mapviewchangeend', onView)
    return () => {
      map.removeEventListener('mapviewchange', onView)
      map.removeEventListener('mapviewchangeend', onView)
      if (raf) cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, driverTrails])

  // ── Toggle the HGV / logistics overlay (no route recalculation) ───────────
  useEffect(() => {
    const H = HRef.current
    const map = mapRef.current
    if (!ready || !H || !map) return
    const logistics = logisticsLayerRef.current
    const base = baseLayerRef.current

    if (truckOverlay && logistics) {
      map.setBaseLayer(logistics)
      enableVehicleRestrictions(H, logistics)
    } else if (base) {
      map.setBaseLayer(base)
    }
    mapStyleControlRef.current?.setTruckMode(truckOverlay && Boolean(logistics))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, truckOverlay])

  // ── External recenter (stop-location picker) ──────────────────────────────
  // Pan/zoom to `center` whenever it changes to a coordinate. Kept separate from
  // the route auto-fit so picking a single point reliably centers the map.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !center) return
    map.getViewModel().setLookAtData({ position: { lat: center.lat, lng: center.lng }, zoom: 14 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, center?.lat, center?.lng])

  // Enable the logistics style's "vehicle restrictions" feature once. The only
  // combo the v3.2 SDK accepts is feature 'vehicle restrictions' + mode
  // 'active & inactive' (space + ampersand); anything else is silently dropped.
  // Wrapped defensively so an unentitled plan degrades to a plain logistics map.
  function enableVehicleRestrictions(H: any, logistics: any) {
    if (overlayFeatureEnabledRef.current) return
    const provider = logistics.getProvider?.()
    const style = provider?.getStyle?.()
    if (!style?.setEnabledFeatures) return

    const apply = () => {
      try {
        const existing = style.getEnabledFeatures?.() ?? []
        style.setEnabledFeatures([
          ...existing,
          { feature: 'vehicle restrictions', mode: 'active & inactive' },
        ])
        overlayFeatureEnabledRef.current = true
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('HERE vehicle-restrictions overlay not available', err)
      }
    }

    const READY = H.map?.render?.Style?.State?.READY
    if (!style.getState || style.getState() === READY) {
      apply()
    } else {
      const onChange = () => {
        if (style.getState() === READY) {
          style.removeEventListener('change', onChange)
          apply()
        }
      }
      style.addEventListener('change', onChange)
    }
  }

  function draw() {
    const H = HRef.current
    const map = mapRef.current
    const group = groupRef.current
    const markerGroup = markerGroupRef.current
    if (!H || !map || !group || !markerGroup) return

    // A redraw supersedes any reveal still in flight — the objects it was growing
    // are about to be discarded with the group.
    routeRevealRef.current?.cancel()
    routeRevealRef.current = null

    group.removeAll()
    markerGroup.removeAll()
    draggableObjectsRef.current = []
    routeDragTargetsRef.current = []
    routeStrokePairsRef.current = []
    routeDecorationsRef.current = []

    // Accumulate every drawn point so we can frame them all at the end.
    const allPoints: LatLng[] = []
    // The route path in travel order (all sections concatenated) — used to anchor
    // the distance badge at the line's distance-weighted midpoint.
    const routePath: LatLng[] = []
    const sectionCount = Math.max(routePolylines.length, 1)
    // Share a bounded budget only across the invisible interaction lines. The
    // two visible strokes below retain every HERE vertex so zooming in always
    // follows the road geometry exactly.
    const interactionBudgetPerSection = Math.max(80, Math.floor(1200 / sectionCount))

    // Entrance only — see ROUTE_REVEAL_MS. Decided before the strokes are built
    // so each section can be seeded collapsed onto its own first vertex rather
    // than drawn whole and then rewound (which is the flash this exists to avoid).
    const hasRouteNow = routePolylines.length > 0
    let revealing =
      hasRouteNow && !hadRouteRef.current && canRevealRoute(H) && !prefersReducedMotion()
    hadRouteRef.current = hasRouteNow
    const revealSections: RevealSection[] = []
    const revealBudgetPerSection = Math.max(60, Math.floor(ROUTE_REVEAL_VERTEX_BUDGET / sectionCount))
    let revealOffset = 0

    // Route line: a near-black spine inside a solid white halo, with white
    // arrow glyphs stencilled along it for direction. Three stacked strokes,
    // drawn casing → spine → arrows, because HERE has no single style that
    // expresses an outlined line and `setArrows()` was removed in v3.2 (see
    // routeArrowStyle). The visible strokes remain static/cached. One wider
    // transparent volatile line above them handles route dragging without
    // forcing the visible strokes to redraw every frame.
    routePolylines.forEach((encoded, sectionIndex) => {
      let coords: number[][]
      try {
        coords = decode(encoded).polyline
      } catch {
        return
      }
      if (coords.length < 2) return
      const sectionPath: LatLng[] = []
      for (const [lat, lng] of coords) {
        const point = { lat, lng }
        sectionPath.push(point)
        allPoints.push(point)
        routePath.push(point)
      }
      const line = new H.geo.LineString()
      for (const point of sectionPath) line.pushPoint(point)
      const widths = scaleRouteWidthRef.current
        ? routeStrokeWidths(map.getZoom?.() ?? DEFAULT_ZOOM)
        // Read-only trip maps keep the deliberately prominent fixed route.
        : { main: 7, casing: 11, arrow: 4.5, arrowsVisible: true }
      const casing = new H.map.Polyline(line, { style: routeCasingStyle(widths.casing) })
      const main = new H.map.Polyline(line, { style: routeSpineStyle(widths.main) })
      const arrows = new H.map.Polyline(line, { style: routeArrowStyle(H, widths.arrow) })
      casing.setVisibility?.(!viewChangingRef.current)
      arrows.setVisibility?.(widths.arrowsVisible && !viewChangingRef.current)
      group.addObject(casing)
      group.addObject(main)
      group.addObject(arrows)
      routeStrokePairsRef.current.push({ casing, main, arrows })
      routeDecorationsRef.current.push(casing)
      if (revealing) {
        try {
          const section = seedRevealSection(H, {
            path: simplifyPathForMap(sectionPath, 8, revealBudgetPerSection),
            offset: revealOffset,
            full: line,
            casing,
            main,
            arrows,
            arrowsAllowed: widths.arrowsVisible,
          })
          revealOffset += section.cum[section.cum.length - 1]
          revealSections.push(section)
        } catch (err) {
          // Never let the entrance cost the route. Whatever this SDK objected
          // to, put back every section already collapsed and draw the rest of
          // this route — markers, badge and fit included — the plain way.
          // eslint-disable-next-line no-console
          console.error('HERE route reveal unavailable — drawing the route directly', err)
          revealing = false
          finishRouteReveal(revealSections, { isViewChanging: () => viewChangingRef.current })
          revealSections.length = 0
        }
      }
      if (objectsDraggable) {
        // HERE requires volatile objects for reliable drag delivery. Keeping that
        // cost on one interaction line leaves the two visible lines cached. The
        // tiny non-zero alpha keeps the wider stroke hit-testable but invisible.
        // This copy gets a tighter budget than the visible route; its wide
        // stroke keeps drag-to-add-stop comfortable despite simplification.
        const interactionLine = new H.geo.LineString()
        for (const point of simplifyPathForMap(sectionPath, 12, interactionBudgetPerSection)) {
          interactionLine.pushPoint(point)
        }
        const dragTarget = new H.map.Polyline(interactionLine, {
          style: {
            lineWidth: 14,
            strokeColor: 'rgba(255,255,255,0.001)',
            lineJoin: 'round',
            lineCap: 'round',
          },
        })
        dragTarget.draggable = true
        dragTarget.setVolatility(!viewChangingRef.current)
        dragTarget.setVisibility?.(!viewChangingRef.current)
        dragTarget.setData({ section: sectionIndex })
        group.addObject(dragTarget)
        draggableObjectsRef.current.push(dragTarget)
        routeDragTargetsRef.current.push(dragTarget)
      }
    })

    // Cache the decoded route path + per-vertex cumulative distances (metres from
    // the start) for the hover-distance readout (see the pointermove handler).
    // Rebuilt on every redraw so it always matches the drawn line; null when
    // there's no usable route, which keeps the readout hidden.
    if (routePath.length >= 2) {
      // Hover is a proximity affordance, not route geometry storage. A reduced
      // path keeps its cursor hit-test bounded on very long truck routes.
      const hoverPath = simplifyPathForMap(routePath, 10, 1200)
      const cum = new Array<number>(hoverPath.length)
      cum[0] = 0
      for (let i = 1; i < hoverPath.length; i++) {
        cum[i] = cum[i - 1] + haversineMeters(hoverPath[i - 1], hoverPath[i])
      }
      hoverGeomRef.current = { path: hoverPath, cum }
    } else {
      hoverGeomRef.current = null
    }

    // Ordered waypoint markers, each anchored precisely on its coordinate.
    // Draggable so the user can refine a point directly on the map; the id is
    // stashed on the marker so dragend can report which point moved.
    for (const marker of markers) {
      // `volatility: true` is REQUIRED for dragging — without it HERE keeps the
      // marker in its optimised render cache and never delivers drag gestures.
      // A read-only map (objectsDraggable=false) keeps markers static/cached.
      const iconKey = `${marker.kind}:${marker.label ?? ''}`
      let icon = markerIconCacheRef.current.get(iconKey)
      if (!icon) {
        icon = iconFor(H, marker)
        markerIconCacheRef.current.set(iconKey, icon)
      }
      const m = new H.map.Marker(marker.position, {
        icon,
        volatility: objectsDraggable && !viewChangingRef.current,
      })
      m.draggable = objectsDraggable
      m.setData({ id: marker.id, kind: marker.kind })
      // No hover cursor change — markers keep the default arrow cursor; they are
      // still draggable (the .here-map-surface CSS keeps the cursor as default,
      // never grab/pointer). Into the TOP group so a long breadcrumb trail can
      // never bury the stop it leads to.
      markerGroup.addObject(m)
      if (objectsDraggable) draggableObjectsRef.current.push(m)
      allPoints.push(marker.position)
    }

    // Saved workspace places are static, cached markers. They do not enter
    // allPoints: toggling this operational layer must never reframe the route.
    for (const place of savedPlaces ?? []) {
      const iconKey = `saved-place:${place.category}`
      let icon = markerIconCacheRef.current.get(iconKey)
      if (!icon) {
        icon = savedPlaceIconFor(H, place.category)
        markerIconCacheRef.current.set(iconKey, icon)
      }
      const marker = new H.map.Marker(
        { lat: place.latitude, lng: place.longitude },
        { icon, volatility: false },
      )
      marker.draggable = false
      marker.setData({ placeId: place.id })
      markerGroup.addObject(marker)
    }

    // Distance badge — a small Google-Maps-style pill near the route midpoint.
    // Rendered as a DOM overlay (H.map.DomMarker) so its CSS `pointer-events:
    // none` lets every press/drag fall through to the route line and markers
    // underneath; it never intercepts a gesture. Cleared with the group on each
    // redraw, so it follows the route as stops/legs change.
    let distanceBadge: any = null
    if (routeDistanceLabel && routePath.length >= 2) {
      const mid = pathMidpoint(routePath)
      if (mid) {
        const outer = document.createElement('div')
        const pill = document.createElement('div')
        pill.className = 'route-distance-badge'
        pill.textContent = routeDistanceLabel
        outer.appendChild(pill)
        const badge = new H.map.DomMarker(mid, { icon: new H.map.DomIcon(outer) })
        // The badge is anchored at the route's MIDPOINT, so while the line is
        // still growing toward it it would be a pill floating over empty map. It
        // arrives with the route.
        if (revealing) badge.setVisibility?.(false)
        markerGroup.addObject(badge)
        distanceBadge = badge
      }
    }

    // Reframe only when the route's STRUCTURE changes — it first gains an
    // endpoint, the start/destination is added or removed, or a drawn route first
    // appears. Adding/removing/dragging an intermediate stop, or a plain
    // recalculation, leaves this signature unchanged, so the viewport stays put
    // (no surprise zoom-in near the new stop). On a structural change we frame the
    // current points once; the user is then free to pan/zoom.
    const hasOrigin = markers.some((m) => m.kind === 'origin')
    const hasDestination = markers.some((m) => m.kind === 'destination')
    const hasRoute = routePolylines.length > 0
    const fitSig = `${hasOrigin ? 1 : 0}|${hasDestination ? 1 : 0}|${hasRoute ? 1 : 0}`
    if (fitSig !== lastFitSigRef.current) {
      lastFitSigRef.current = fitSig
      fitToPoints(H, map, allPoints)
    }

    // Last of all, so the line grows over a viewport the fit above has already
    // settled rather than racing the camera for the same frames.
    if (revealing && revealSections.length > 0) {
      routeRevealRef.current = startRouteReveal(H, revealSections, {
        badge: distanceBadge,
        isViewChanging: () => viewChangingRef.current,
      })
    }
  }

  // Frame the route + all points: full polyline bounds (not just endpoints),
  // padded, kept clear of the floating left panel, and zoom-clamped so short
  // routes don't slam to street level. Non-animated; called from draw() ONLY on a
  // structural route change (see the fit-signature guard there), never on every
  // stop add / drag / recalculation.
  function fitToPoints(H: any, map: any, points: LatLng[]) {
    if (points.length === 0) return
    if (points.length === 1) {
      map.getViewModel().setLookAtData({ position: points[0], zoom: 13 })
      return
    }

    let top = -90
    let bottom = 90
    let left = 180
    let right = -180
    for (const p of points) {
      top = Math.max(top, p.lat)
      bottom = Math.min(bottom, p.lat)
      left = Math.min(left, p.lng)
      right = Math.max(right, p.lng)
    }

    // Pad ~12% each side, with a floor so very short routes keep a sensible span.
    const MIN_SPAN = 0.01 // ~1.1 km
    const cLat = (top + bottom) / 2
    const cLng = (left + right) / 2
    const latSpan = Math.max(top - bottom, MIN_SPAN)
    const lngSpan = Math.max(right - left, MIN_SPAN)
    top = cLat + latSpan * 0.6
    bottom = cLat - latSpan * 0.6
    left = cLng - lngSpan * 0.6
    right = cLng + lngSpan * 0.6

    // Extend the WEST edge so the framed content sits to the right of the
    // floating panel (which overlaps the map's left edge) rather than under it.
    const W = containerRef.current?.clientWidth ?? 0
    const inset = panelInsetRef.current
    if (inset > 0 && inset < W) {
      left -= (right - left) * (inset / (W - inset))
    }

    map.getViewModel().setLookAtData({ bounds: new H.geo.Rect(top, left, bottom, right) })

    // Don't sit too close on short hops.
    const z = map.getZoom?.()
    if (typeof z === 'number' && z > 16) map.setZoom(16)
  }

  return (
    <div className={['here-map-root', className].filter(Boolean).join(' ')}>
      <div ref={containerRef} className="here-map-surface absolute inset-0" />
      <div ref={controlsHostRef} className="here-map-controls-host" aria-label="Map controls" />
    </div>
  )
}
