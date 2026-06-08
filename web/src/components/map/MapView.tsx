import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapPinned, TriangleAlert } from 'lucide-react'
import { mapConfigured, mapStyleUrl, type MapColorScheme } from '../../lib/mapConfig'
import Spinner from '../Spinner'

export type LatLng = { lat: number; lng: number }

// A route waypoint with its role, so the map can draw a clear start dot,
// numbered stop dots, and a prominent destination pin. `stopIndex` ties a stop
// dot back to its position in the caller's stops[] array (for drag/remove).
export type RoutePoint = LatLng & {
  kind: 'start' | 'stop' | 'end'
  index?: number
  stopIndex?: number
}

type Props = {
  // Where to center the map. Null → a neutral world view (e.g. no data yet).
  center: LatLng | null
  zoom?: number
  // A single marker to drop (the vehicle). Null → no marker.
  marker?: (LatLng & { label?: string }) | null
  // Optional route geometry as [lng, lat] points. When set, it's drawn as a
  // line and the view fits to its bounds (overriding center/zoom).
  route?: [number, number][] | null
  // Optional route waypoints (From / stops / To) drawn with role-specific
  // markers: a start dot, numbered stop dots, and a destination pin.
  points?: RoutePoint[] | null
  // Light/Dark basemap appearance. Switching swaps the style at runtime without
  // recreating the map. Defaults to Dark to match the app theme.
  colorScheme?: MapColorScheme
  // When set, the route line becomes draggable: grabbing it and releasing
  // reports the dropped [lng, lat] so the caller can insert a via-waypoint and
  // re-route (Google-Maps-style). Only active while a route is drawn.
  onRouteDrag?: (lngLat: [number, number]) => void
  // When set, the From/Stop/To dots become draggable; releasing reports the
  // moved point and its new [lng, lat] so the caller can update that waypoint.
  onPointDragEnd?: (pt: RoutePoint, lngLat: [number, number]) => void
  // When set, clicking a stop dot reports it so the caller can remove that stop.
  onPointRemove?: (pt: RoutePoint) => void
  className?: string
}

const ROUTE_COLOR = '#c89572'
const START_COLOR = '#7d8a78' // green-ish "go"
const END_COLOR = '#d97757' // orange-red destination

// Role-specific waypoint markers: a green start dot, white numbered stop dots,
// and a prominent teardrop pin for the destination — so it's immediately clear
// where the route begins and ends. Dots anchor centre; the pin anchors at its
// tip (MapLibre default for the built-in marker).
function createPointMarker(pt: RoutePoint, draggable: boolean): maplibregl.Marker {
  if (pt.kind === 'end') {
    return new maplibregl.Marker({ color: END_COLOR, draggable })
  }
  const el = document.createElement('div')
  const base =
    'box-sizing:border-box;border-radius:9999px;box-shadow:0 1px 5px rgba(0,0,0,0.55);'
  if (pt.kind === 'start') {
    el.style.cssText = `${base}width:16px;height:16px;background:${START_COLOR};border:2.5px solid #fff;`
    el.title = draggable ? 'Start — drag to move' : 'Start'
  } else {
    el.style.cssText =
      `${base}width:19px;height:19px;background:#fff;border:2.5px solid ${ROUTE_COLOR};` +
      'display:flex;align-items:center;justify-content:center;color:#7a4f33;' +
      "font:700 10px/1 Inter,system-ui,sans-serif;"
    el.textContent = String(pt.index ?? '')
    el.title = draggable ? `Stop ${pt.index ?? ''} — drag to move, click to remove` : `Stop ${pt.index ?? ''}`
  }
  return new maplibregl.Marker({ element: el, draggable })
}

// A high-contrast draggable dot for the route line (hover + drag). The white ring
// plus a dark outer halo keep it clearly visible on BOTH the light and dark
// basemaps. Uses the system `move` cursor (visible on Windows, unlike the white
// `grab` hand) to signal it can be pulled.
function createDragHandleEl(): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText =
    'box-sizing:border-box;width:18px;height:18px;border-radius:9999px;' +
    `background:${ROUTE_COLOR};border:3px solid #fff;` +
    'box-shadow:0 0 0 1.5px rgba(0,0,0,0.6),0 1px 4px rgba(0,0,0,0.5);cursor:move;'
  return el
}

// Force a flat (Mercator) projection. Amazon Location's newer built-in styles
// can ship a globe projection; this app is a practical dispatch/route planner,
// so we always pin the normal flat road map (no globe / 3D).
function forceFlatProjection(map: maplibregl.Map) {
  try {
    map.setProjection({ type: 'mercator' })
  } catch {
    /* older/newer maplibre without setProjection — default is already flat */
  }
}

// Add/update the route line + fit the view, or clear it when there's no route.
// Safe to call repeatedly and after a style reload (which wipes sources/layers).
function drawRoute(map: maplibregl.Map, coords: [number, number][]) {
  const existing = map.getSource('route') as maplibregl.GeoJSONSource | undefined
  const geojson: GeoJSON.Feature = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: coords },
  }

  if (coords.length >= 2) {
    if (existing) {
      existing.setData(geojson)
    } else {
      map.addSource('route', { type: 'geojson', data: geojson })
      // Casing first (drawn under): a dark outline so the tan route stays clearly
      // visible on LIGHT/Satellite basemaps too, not just dark.
      map.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': 'rgba(0,0,0,0.55)', 'line-width': 8 },
      })
      map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': ROUTE_COLOR, 'line-width': 4.5 },
      })
    }
    const bounds = coords.reduce(
      (b, c) => b.extend(c),
      new maplibregl.LngLatBounds(coords[0], coords[0]),
    )
    map.fitBounds(bounds, { padding: 48, duration: 600 })
  } else if (existing) {
    if (map.getLayer('route')) map.removeLayer('route')
    if (map.getLayer('route-casing')) map.removeLayer('route-casing')
    map.removeSource('route')
  }
}

// Reusable Amazon Location (MapLibre GL) map. Owns the GL instance lifecycle and
// surfaces themed loading / error / not-configured states. Keep it presentational
// — callers pass center/marker; data fetching lives elsewhere. Lazy-load this
// module (and its callers) so MapLibre stays out of the main bundle.
export default function MapView({
  center,
  zoom = 12,
  marker,
  route,
  points,
  colorScheme = 'Dark',
  onRouteDrag,
  onPointDragEnd,
  onPointRemove,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const pointMarkersRef = useRef<maplibregl.Marker[]>([])
  // Latest route geometry, so the style-reload handler can re-draw it without a
  // stale closure.
  const routeRef = useRef<[number, number][]>([])
  // Latest route-drag callback + an in-flight drag flag (so the cursor doesn't
  // reset mid-drag). Refs because the handlers are registered once.
  const onRouteDragRef = useRef(onRouteDrag)
  onRouteDragRef.current = onRouteDrag
  // Latest waypoint-marker callbacks (drag a dot to move it / click a stop to
  // remove it). Refs so the markers' handlers always call the current props.
  const onPointDragEndRef = useRef(onPointDragEnd)
  onPointDragEndRef.current = onPointDragEnd
  const onPointRemoveRef = useRef(onPointRemove)
  onPointRemoveRef.current = onPointRemove
  const draggingRef = useRef(false)
  // Shared dot shown when hovering the route and while dragging it.
  const dragHandleRef = useRef<maplibregl.Marker | null>(null)
  // Read the initial colour scheme without making the init effect depend on it
  // (scheme changes are handled by setStyle below, not a full re-init). Also acts
  // as the "currently applied" scheme so a re-render doesn't re-trigger setStyle.
  const initialSchemeRef = useRef(colorScheme)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  // Initialise the map exactly once. Colour-scheme changes are applied via
  // setStyle (below) rather than recreating the GL instance.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const url = mapStyleUrl(initialSchemeRef.current)
    if (!url) return
    const map = new maplibregl.Map({
      container,
      style: url,
      center: center ? [center.lng, center.lat] : [0, 20],
      zoom: center ? zoom : 1,
      attributionControl: false,
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    const onReady = () => {
      forceFlatProjection(map)
      setStatus('ready')
      drawRoute(map, routeRef.current)
    }
    map.on('load', onReady)
    // Fallback: the one-shot 'load' event can fail to fire in throttled/offscreen
    // tabs (no paint frame), which would leave the spinner up and the route
    // undrawn. The style is usable as soon as its data arrives, so also become
    // ready on the first 'styledata'. Idempotent with 'load'.
    map.once('styledata', onReady)
    map.on('error', () => {
      // Only treat a failure as fatal if the map hasn't loaded at all; ignore
      // non-fatal per-tile/glyph/sprite errors once it's up.
      if (!map.loaded()) setStatus('error')
    })

    // ── Drag the route line to insert a via-waypoint ───────────────────────
    // Hovering the route shows a grabbable dot that tracks the cursor along the
    // line; pressing and releasing reports the dropped point so the caller can
    // insert a stop and re-route (truck-aware). The dot (not a teardrop) stays
    // visible on both light and dark basemaps. Layer-scoped handlers are safe to
    // register before the 'route' layer exists — they fire once drawRoute adds it.
    const ensureHandle = () => {
      if (!dragHandleRef.current) {
        dragHandleRef.current = new maplibregl.Marker({ element: createDragHandleEl() })
      }
      return dragHandleRef.current
    }
    // Cursor is handled in CSS (a high-contrast custom cursor that's visible on
    // light/satellite basemaps too); here we only show/move the grab dot.
    map.on('mousemove', 'route', (e) => {
      if (!onRouteDragRef.current || draggingRef.current) return
      ensureHandle().setLngLat(e.lngLat).addTo(map)
    })
    map.on('mouseleave', 'route', () => {
      if (draggingRef.current) return
      dragHandleRef.current?.remove()
    })
    map.on('mousedown', 'route', (e) => {
      const cb = onRouteDragRef.current
      if (!cb) return
      e.preventDefault() // suppress the map's drag-pan while dragging the route
      draggingRef.current = true
      const handle = ensureHandle().setLngLat(e.lngLat).addTo(map)
      const onMove = (ev: maplibregl.MapMouseEvent) => handle.setLngLat(ev.lngLat)
      map.on('mousemove', onMove)
      map.once('mouseup', (ev: maplibregl.MapMouseEvent) => {
        map.off('mousemove', onMove)
        draggingRef.current = false
        handle.remove()
        cb([ev.lngLat.lng, ev.lngLat.lat])
      })
    })

    // The map often mounts (lazily, inside a flex/Suspense container) before the
    // container has settled its final size, so the GL canvas can come up at the
    // wrong dimensions and render blank. Watch the container and resize the map
    // whenever it changes so the canvas always matches its box.
    const ro = new ResizeObserver(() => map.resize())
    ro.observe(container)

    // Explicit nudge for layout changes the ResizeObserver can be slow to pick
    // up (e.g. the left rail collapsing/expanding, which reflows this pane). The
    // app dispatches `dispo:layout-resize` after such changes so the map fills
    // the new width immediately.
    const onLayoutResize = () => map.resize()
    window.addEventListener('dispo:layout-resize', onLayoutResize)

    return () => {
      ro.disconnect()
      window.removeEventListener('dispo:layout-resize', onLayoutResize)
      dragHandleRef.current?.remove()
      dragHandleRef.current = null
      map.remove()
      mapRef.current = null
      markerRef.current = null
      pointMarkersRef.current = []
    }
    // Init-only; center/marker/scheme are applied in the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Switch the basemap appearance (Light/Dark) without recreating the map.
  // setStyle wipes sources/layers (the route line) but NOT markers; re-draw the
  // route and re-pin the flat projection once the new style has loaded.
  useEffect(() => {
    const map = mapRef.current
    if (!map || colorScheme === initialSchemeRef.current) return
    const url = mapStyleUrl(colorScheme)
    if (!url) return
    map.setStyle(url)
    map.once('styledata', () => {
      forceFlatProjection(map)
      drawRoute(map, routeRef.current)
    })
    // Track the applied scheme so an unrelated re-render doesn't re-trigger.
    initialSchemeRef.current = colorScheme
  }, [colorScheme])

  // Recenter when the target changes (e.g. a fresh position arrives).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !center) return
    map.jumpTo({ center: [center.lng, center.lat], zoom })
  }, [center, zoom])

  // Keep a single marker in sync with the prop.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (marker) {
      if (!markerRef.current) markerRef.current = new maplibregl.Marker({ color: ROUTE_COLOR })
      markerRef.current.setLngLat([marker.lng, marker.lat]).addTo(map)
    } else if (markerRef.current) {
      markerRef.current.remove()
    }
  }, [marker])

  // Draw / update the route line and fit the view to it. Runs once the style is
  // loaded (status === 'ready'), since adding sources/layers requires the style.
  useEffect(() => {
    routeRef.current = route ?? []
    const map = mapRef.current
    if (!map || status !== 'ready') return
    drawRoute(map, routeRef.current)
  }, [route, status])

  // Keep waypoint markers (From / stops / To) in sync with the points prop, and
  // frame them. When a route exists, the route effect owns the bounds (it spans
  // the same points); otherwise fit to the points directly — one point centres,
  // several fit. This is what makes a marker appear and the view settle as soon
  // as From/To are selected, before any route is calculated.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    for (const m of pointMarkersRef.current) m.remove()
    pointMarkersRef.current = []
    const pts = points ?? []
    const draggable = Boolean(onPointDragEndRef.current)
    for (const p of pts) {
      const m = createPointMarker(p, draggable).setLngLat([p.lng, p.lat]).addTo(map)
      if (draggable) {
        const el = m.getElement()
        el.style.cursor = 'move'
        // A drag and a click both start with mousedown; track movement so a
        // post-drag click doesn't also fire the remove handler.
        let moved = false
        m.on('dragstart', () => {
          moved = true
        })
        m.on('dragend', () => {
          const ll = m.getLngLat()
          onPointDragEndRef.current?.(p, [ll.lng, ll.lat])
          // Reset after the trailing click (if any) has been swallowed below.
          setTimeout(() => {
            moved = false
          }, 0)
        })
        // Click a stop dot to remove it (From/To stay — they're required).
        if (p.kind === 'stop') {
          el.addEventListener('click', (ev) => {
            ev.stopPropagation()
            if (moved) return
            onPointRemoveRef.current?.(p)
          })
        }
      }
      pointMarkersRef.current.push(m)
    }
    const hasRoute = (route?.length ?? 0) >= 2
    if (!hasRoute && pts.length > 0 && status === 'ready') {
      if (pts.length === 1) {
        map.easeTo({ center: [pts[0].lng, pts[0].lat], zoom: Math.max(zoom, 11), duration: 600 })
      } else {
        const bounds = pts.reduce(
          (b, p) => b.extend([p.lng, p.lat]),
          new maplibregl.LngLatBounds([pts[0].lng, pts[0].lat], [pts[0].lng, pts[0].lat]),
        )
        map.fitBounds(bounds, { padding: 64, duration: 600, maxZoom: 14 })
      }
    }
  }, [points, route, status, zoom])

  // Base map not configured: themed message instead of a broken map. Keyed on
  // BASE config (Dark/Light) — Truck-mode availability is handled separately as
  // an overlay so selecting Truck never tears the whole map down.
  if (!mapConfigured) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 bg-rail text-center px-6 ${className ?? ''}`}
      >
        <MapPinned size={26} strokeWidth={1.5} className="text-faint" />
        <div className="text-[12.5px] text-muted">Map is not configured.</div>
        <div className="text-[11px] text-faint max-w-[260px]">
          Set the Amazon Location map env values to enable the map.
        </div>
      </div>
    )
  }

  return (
    <div className={`relative bg-rail ${className ?? ''}`}>
      {/* Fill the wrapper with width/height rather than `absolute inset-0`:
          maplibre-gl.css applies `.maplibregl-map { position: relative }` to this
          element, which overrides Tailwind's `absolute` and makes `inset-0`
          collapse the box to 0 height (blank map). h-full/w-full sizes it
          regardless of position. */}
      <div ref={containerRef} className="h-full w-full" />
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-rail/60 backdrop-blur-[1px]">
          <Spinner variant="lg" />
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-rail text-center px-6">
          <TriangleAlert size={24} strokeWidth={1.6} className="text-alert" />
          <div className="text-[12.5px] text-muted">Could not load the map.</div>
        </div>
      )}
    </div>
  )
}
