import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapPinned, TriangleAlert, Truck } from 'lucide-react'
import { mapConfigured, mapStyleUrl, type MapColorScheme } from '../../lib/mapConfig'
import Spinner from '../Spinner'

export type LatLng = { lat: number; lng: number }

type Props = {
  // Where to center the map. Null → a neutral world view (e.g. no data yet).
  center: LatLng | null
  zoom?: number
  // A single marker to drop (the vehicle). Null → no marker.
  marker?: (LatLng & { label?: string }) | null
  // Optional route geometry as [lng, lat] points. When set, it's drawn as a
  // line and the view fits to its bounds (overriding center/zoom).
  route?: [number, number][] | null
  // Optional waypoint markers (e.g. From / stops / To) drawn along the route.
  points?: LatLng[] | null
  // Light/Dark basemap appearance. Switching swaps the style at runtime without
  // recreating the map. Defaults to Dark to match the app theme.
  colorScheme?: MapColorScheme
  className?: string
}

const ROUTE_COLOR = '#c89572'

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
      map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': ROUTE_COLOR, 'line-width': 4, 'line-opacity': 0.9 },
      })
    }
    const bounds = coords.reduce(
      (b, c) => b.extend(c),
      new maplibregl.LngLatBounds(coords[0], coords[0]),
    )
    map.fitBounds(bounds, { padding: 48, duration: 600 })
  } else if (existing) {
    if (map.getLayer('route')) map.removeLayer('route')
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
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const pointMarkersRef = useRef<maplibregl.Marker[]>([])
  // Latest route geometry, so the style-reload handler can re-draw it without a
  // stale closure.
  const routeRef = useRef<[number, number][]>([])
  // Read the initial colour scheme without making the init effect depend on it
  // (scheme changes are handled by setStyle below, not a full re-init). Also acts
  // as the "currently applied" scheme so a re-render doesn't re-trigger setStyle.
  const initialSchemeRef = useRef(colorScheme)
  // Live mode, so the (once-registered) error handler knows whether a failure
  // happened in Truck mode (→ "not available") vs the base map (→ generic error).
  const modeRef = useRef(colorScheme)
  modeRef.current = colorScheme
  const pendingTruckStyleRef = useRef(false)
  const truckStyleTimeoutRef = useRef<number | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  // True when Truck mode is selected but the HERE truck style isn't configured or
  // fails to load — drives a themed message over the (untouched) base map.
  const [truckUnavailable, setTruckUnavailable] = useState(false)

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
    map.on('load', () => {
      forceFlatProjection(map)
      setStatus('ready')
      drawRoute(map, routeRef.current)
    })
    map.on('error', () => {
      // MapLibre can emit non-fatal errors for individual tiles/glyphs/sprites.
      // The HERE truck style may still be loaded and visible, so don't mark
      // Truck as unavailable from a generic map error. The Truck-specific
      // timeout in the style-switch effect below handles true style-load failure.
      if (modeRef.current === 'Truck') return
      if (!map.loaded()) setStatus('error')
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
      map.remove()
      if (truckStyleTimeoutRef.current !== null) window.clearTimeout(truckStyleTimeoutRef.current)
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
    // Truck mode with no configured HERE truck style: keep the current basemap
    // and show the themed "not available" message instead of a broken style.
    if (colorScheme === 'Truck' && !url) {
      setTruckUnavailable(true)
      initialSchemeRef.current = colorScheme
      return
    }
    if (!url) return
    // Leaving Truck (or a configured Truck load): clear any prior message.
    setTruckUnavailable(false)
    pendingTruckStyleRef.current = colorScheme === 'Truck'
    if (truckStyleTimeoutRef.current !== null) window.clearTimeout(truckStyleTimeoutRef.current)
    if (colorScheme === 'Truck') {
      truckStyleTimeoutRef.current = window.setTimeout(() => {
        if (pendingTruckStyleRef.current) setTruckUnavailable(true)
      }, 8000)
    }
    map.setStyle(url)
    const onStyleReady = () => {
      pendingTruckStyleRef.current = false
      if (truckStyleTimeoutRef.current !== null) {
        window.clearTimeout(truckStyleTimeoutRef.current)
        truckStyleTimeoutRef.current = null
      }
      setTruckUnavailable(false)
      forceFlatProjection(map)
      drawRoute(map, routeRef.current)
    }
    map.once('styledata', onStyleReady)
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
    for (const p of pts) {
      const m = new maplibregl.Marker({ color: ROUTE_COLOR }).setLngLat([p.lng, p.lat]).addTo(map)
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
      {/* Truck mode unavailable — a subtle themed notice over the base map (which
          stays visible/interactive), not a full takeover. */}
      {truckUnavailable && (
        <div className="absolute inset-x-0 bottom-4 flex justify-center px-6 pointer-events-none">
          <div className="flex items-center gap-2.5 rounded-card border border-white/[0.10] bg-rail/90 backdrop-blur px-3.5 py-2.5 max-w-[340px]">
            <Truck size={16} strokeWidth={1.6} className="text-faint shrink-0" />
            <div className="text-[12px] text-muted leading-snug">
              Truck restrictions are not available for this map style.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
