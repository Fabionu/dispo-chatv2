import { useEffect, useRef, useState } from 'react'
import { MapPinned, TriangleAlert } from 'lucide-react'
import { apiKey, hereConfigured, loadHere } from '../../lib/hereMaps'
import type { HereVehicleSpecs } from '../../lib/hereRouting'
import { snapToRoad } from '../../lib/hereSearch'
import {
  baseStyleSupportsTraffic,
  type LatLng,
  type MapBaseStyle,
  type MapColorScheme,
  type RoutePoint,
} from '../../lib/hereMapTypes'
import Spinner from '../Spinner'

/* eslint-disable @typescript-eslint/no-explicit-any */

type Props = {
  // Where to center the map. Null → a neutral central-Europe view.
  center: LatLng | null
  zoom?: number
  // A single marker to drop (e.g. a vehicle). Null → no marker.
  marker?: (LatLng & { label?: string }) | null
  // Optional route geometry as [lng, lat] points. When set it's drawn as a line
  // and the view fits its bounds.
  route?: [number, number][] | null
  // Optional route waypoints (From / stops / To) drawn with role-specific markers.
  points?: RoutePoint[] | null
  colorScheme?: MapColorScheme
  baseStyle?: MapBaseStyle
  traffic?: boolean
  // Truck dimensions/weight applied to the logistics layer so the restriction
  // overlay highlights limits that apply to THIS vehicle. Null → no constraints.
  vehicleSpecs?: HereVehicleSpecs | null
  // Route line dragged: reports the dropped [lng, lat] so the caller can insert a
  // via-waypoint and re-route.
  onRouteDrag?: (lngLat: [number, number]) => void
  // A From/Stop/To dot was dragged: reports the moved point + its new [lng, lat].
  onPointDragEnd?: (pt: RoutePoint, lngLat: [number, number]) => void
  // A stop dot was clicked: reports it so the caller can remove that stop.
  onPointRemove?: (pt: RoutePoint) => void
  // Right-click reports the clicked [lng, lat] and the viewport pixel.
  onContextMenu?: (lngLat: [number, number], page: { x: number; y: number }) => void
  className?: string
}

const ROUTE_COLOR = '#c89572'
const START_COLOR = '#7d8a78'
const END_COLOR = '#d97757'

const DEFAULT_CENTER = { lat: 50, lng: 10 } // central Europe
const DEFAULT_ZOOM = 4

// Build the DOM markup for a role-specific waypoint marker. The start and stop
// dots anchor at their centre (on the route); the destination is a teardrop pin
// anchored at its tip so the tip sits precisely on the route line. The three
// roles are deliberately distinct: sage origin dot, white numbered stop dots, and
// a coral end pin in the app's accent colour.
function pointMarkup(pt: RoutePoint): string {
  const base = 'box-sizing:border-box;border-radius:9999px;box-shadow:0 1px 5px rgba(0,0,0,0.55);'
  if (pt.kind === 'end') {
    // Themed SVG map pin (coral fill, white outline + inner dot), anchored at the
    // tip. drop-shadow gives it the same lift as the dots without a box-shadow
    // (which an SVG's transparent corners can't carry).
    return (
      `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg" ` +
      `style="display:block;transform:translate(-50%,-100%);` +
      `filter:drop-shadow(0 2px 3px rgba(0,0,0,0.5));">` +
      `<path d="M13 1C6.4 1 1 6.4 1 13c0 8.3 12 19.5 12 19.5S25 21.3 25 13C25 6.4 19.6 1 13 1z" ` +
      `fill="${END_COLOR}" stroke="#fff" stroke-width="2"/>` +
      `<circle cx="13" cy="13" r="4.5" fill="#fff"/>` +
      `</svg>`
    )
  }
  if (pt.kind === 'start') {
    return `<div style="transform:translate(-50%,-50%);width:16px;height:16px;${base}background:${START_COLOR};border:2.5px solid #fff;"></div>`
  }
  return (
    `<div style="transform:translate(-50%,-50%);width:19px;height:19px;${base}` +
    `background:#fff;border:2.5px solid ${ROUTE_COLOR};display:flex;align-items:center;` +
    `justify-content:center;color:#7a4f33;font:700 10px/1 Inter,system-ui,sans-serif;">` +
    `${pt.index ?? ''}</div>`
  )
}

// HERE logistics restrictions are vehicle-type specific, so tag the specs as a
// TRUCK (the HGV profile) whenever applying them — otherwise restrictions are
// evaluated against the default vehicle and HGV limits won't filter in. The enum
// lives at H.service.omv.Provider.IVehicleSpecs.VehicleType.TRUCK (= 0). Spread
// the dimensions/weights AFTER so they're never overwritten.
function truckVehicleSpecs(H: any, specs: HereVehicleSpecs | null | undefined) {
  const truck = H?.service?.omv?.Provider?.IVehicleSpecs?.VehicleType?.TRUCK
  return { ...(truck !== undefined ? { vehicleType: truck } : {}), ...(specs ?? {}) }
}

// Reusable HERE Maps (JS SDK) map for the route planner. Renders the logistics
// basemap with the HGV/truck-restriction overlay, draws the route line and
// waypoint markers, and surfaces themed loading / error / not-configured states.
export default function HereMapView({
  center,
  zoom = 12,
  marker,
  route,
  points,
  colorScheme = 'Dark',
  baseStyle = 'Standard',
  traffic = false,
  vehicleSpecs,
  onRouteDrag,
  onPointDragEnd,
  onPointRemove,
  onContextMenu,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const HRef = useRef<any>(null)
  const mapRef = useRef<any>(null)
  const platformRef = useRef<any>(null)
  const layersRef = useRef<any>(null)
  const behaviorRef = useRef<any>(null)
  const routeGroupRef = useRef<any>(null)
  const markerGroupRef = useRef<any>(null)
  const singleMarkerRef = useRef<any>(null)
  const trafficLayerRef = useRef<any>(null)
  const dragHandleRef = useRef<any>(null)
  const ctxHandlerRef = useRef<((e: MouseEvent) => void) | null>(null)

  // Latest route geometry, so the async init can draw it once the map is ready.
  const routeRef = useRef<[number, number][]>([])
  // Latest waypoints, so the single fit routine can frame them without depending
  // on render identity.
  const pointsRef = useRef<RoutePoint[]>([])
  // Content key of the last camera fit, so we animate the view ONLY when the thing
  // being framed actually changes — not on every effect re-run caused by an
  // unstable `points`/`route` array identity (which otherwise re-zooms forever).
  const fitKeyRef = useRef('')
  // Content key of the last marker draw, so we rebuild markers only when their
  // positions/roles (or the route they snap to) actually change.
  const markersKeyRef = useRef('')
  // Latest callbacks (init binds the map handlers once; they read these refs).
  const onRouteDragRef = useRef(onRouteDrag)
  onRouteDragRef.current = onRouteDrag
  const onPointDragEndRef = useRef(onPointDragEnd)
  onPointDragEndRef.current = onPointDragEnd
  const onPointRemoveRef = useRef(onPointRemove)
  onPointRemoveRef.current = onPointRemove
  const onContextMenuRef = useRef(onContextMenu)
  onContextMenuRef.current = onContextMenu
  // Latest applied props the init reads without being a dependency.
  const baseStyleRef = useRef(baseStyle)
  const schemeRef = useRef(colorScheme)
  const vehicleSpecsRef = useRef(vehicleSpecs)
  vehicleSpecsRef.current = vehicleSpecs

  // Route-line drag state (Google-Maps-style insert-a-via).
  const routeDraggingRef = useRef(false)
  const routeDropRef = useRef<any>(null)
  // Distinguish a marker drag from a click (so a post-drag click doesn't remove).
  const markerMovedRef = useRef(false)

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  // Pick the base layer for the current basemap + theme.
  function baseLayerFor(layers: any, style: MapBaseStyle, scheme: MapColorScheme): any {
    if (style === 'Satellite') return layers.raster?.satellite?.base ?? layers.raster?.satellite?.map
    if (style === 'Hybrid') return layers.raster?.satellite?.map
    // Standard → logistics vector, day or night.
    if (scheme === 'Dark') {
      return layers.vector?.normal?.logisticsnight ?? layers.vector?.normal?.logistics
    }
    return layers.vector?.normal?.logistics
  }

  // Enable the HGV/truck-restriction overlay on the (logistics) base layer and
  // apply the current vehicle specs. Restrictions only exist on the logistics
  // vector layer, so this is a no-op on satellite imagery. Waits for the HARP
  // style to reach READY before toggling (icons don't render otherwise). Note the
  // split: `setEnabledFeatures` lives on the style, but `setVehicleSpecs` lives on
  // the PROVIDER (the OMV tile provider that decodes the restriction data).
  function applyRestrictions() {
    const H = HRef.current
    const map = mapRef.current
    if (!H || !map) return
    const provider = map.getBaseLayer()?.getProvider?.()
    const style = provider?.getStyle?.()
    if (!style || !style.setEnabledFeatures) return

    const apply = () => {
      try {
        const features = style.getEnabledFeatures ? style.getEnabledFeatures() : []
        const others = (features || []).filter((f: any) => f.feature !== 'vehicle restrictions')
        // The HARP JS SDK feature name is `vehicle restrictions` (with a SPACE —
        // the `vehicle_restrictions` underscore form is the REST Image API, and the
        // SDK silently ignores it, so the overlay vanishes). The mode value is the
        // canonical `active_and_inactive` (show all restrictions); the older
        // `active & inactive` ampersand form is not a valid mode.
        style.setEnabledFeatures([
          ...others,
          { feature: 'vehicle restrictions', mode: 'active_and_inactive' },
        ])
        if (provider.setVehicleSpecs) {
          provider.setVehicleSpecs(truckVehicleSpecs(H, vehicleSpecsRef.current))
        }
      } catch {
        /* style not ready / unsupported on this layer — ignore */
      }
    }

    const ready = H.map.render?.Style?.State?.READY
    if (!style.getState || style.getState() === ready) {
      apply()
    } else {
      const onChange = () => {
        if (style.getState() === ready) {
          style.removeEventListener('change', onChange)
          apply()
        }
      }
      style.addEventListener('change', onChange)
    }
  }

  // Add/update the route line (drawing only — framing is handled once by
  // fitView). Casing (dark) under a tan line so it reads on light/satellite
  // basemaps too.
  function drawRoute(coords: [number, number][]) {
    const H = HRef.current
    const map = mapRef.current
    const group = routeGroupRef.current
    if (!H || !map || !group) return
    group.removeAll()
    if (coords.length < 2) return
    const ls = new H.geo.LineString()
    for (const [lng, lat] of coords) ls.pushPoint({ lat, lng })
    const casing = new H.map.Polyline(ls, {
      style: { lineWidth: 6, strokeColor: 'rgba(0,0,0,0.55)', lineJoin: 'round', lineCap: 'round' },
    })
    const line = new H.map.Polyline(ls, {
      style: { lineWidth: 4, strokeColor: ROUTE_COLOR, lineJoin: 'round', lineCap: 'round' },
    })
    group.addObjects([casing, line])
  }

  // Compact content key for the route geometry — enough to detect a real change
  // (length + endpoints) without hashing every vertex.
  function routeSig(geom: [number, number][]): string {
    if (geom.length < 2) return '0'
    const a = geom[0]
    const b = geom[geom.length - 1]
    return `${geom.length}:${a[0]},${a[1]}:${b[0]},${b[1]}`
  }

  // Sync the waypoint markers (From / stops / To). Drawing only — framing is
  // handled once by fitView. Skips the rebuild when nothing that affects the
  // markers (their coords/roles, the route they snap to, or draggability) changed,
  // so typing in a field doesn't churn the whole marker group every keystroke.
  function drawPoints(pts: RoutePoint[]) {
    const H = HRef.current
    const map = mapRef.current
    const group = markerGroupRef.current
    if (!H || !map || !group) return
    const draggable = Boolean(onPointDragEndRef.current)
    const geom = routeRef.current
    const key =
      pts.map((p) => `${p.kind}:${p.index ?? ''}:${p.lng},${p.lat}`).join('|') +
      `#${routeSig(geom)}#${draggable ? 1 : 0}`
    if (key === markersKeyRef.current) return
    markersKeyRef.current = key

    group.removeAll()
    // Align each marker to the calculated route so it sits ON the line rather than
    // beside it. HERE matches origin/destination/vias onto roads when routing, so
    // the returned geometry is authoritative: the start sits at its first vertex,
    // the end at its last, and stops at their nearest point on the polyline. With
    // no route yet (still picking points) markers stay at their raw coordinate.
    const hasRouteLine = geom.length >= 2
    for (const p of pts) {
      let lng = p.lng
      let lat = p.lat
      if (hasRouteLine) {
        if (p.kind === 'start') [lng, lat] = geom[0]
        else if (p.kind === 'end') [lng, lat] = geom[geom.length - 1]
        else {
          const snapped = snapToRoad([p.lng, p.lat], geom)
          if (snapped) [lng, lat] = snapped
        }
      }
      const icon = new H.map.DomIcon(pointMarkup(p))
      const m = new H.map.DomMarker({ lat, lng }, { icon, volatility: draggable })
      m.draggable = draggable
      m.setData(p)
      group.addObject(m)
    }
  }

  // Frame the view ONCE per meaningful change. The route's bounds own the camera
  // when a route is present; otherwise the selected waypoints are framed. A
  // content key gates the animation so re-runs from unstable array identities (or
  // repeated effects) never re-trigger the same fit — which is what caused the
  // "keeps slowly zooming toward the first point" loop.
  function fitView() {
    const map = mapRef.current
    if (!map) return
    const geom = routeRef.current
    const pts = pointsRef.current
    let key = ''
    let target: any = null
    if (geom.length >= 2) {
      key = `route:${routeSig(geom)}`
      const bbox = routeGroupRef.current?.getBoundingBox?.()
      if (bbox) target = { bounds: bbox }
    } else if (pts.length === 1) {
      key = `point:${pts[0].lng},${pts[0].lat}`
      target = { position: { lat: pts[0].lat, lng: pts[0].lng }, zoom: Math.max(zoom, 11) }
    } else if (pts.length > 1) {
      key = `points:${pts.map((p) => `${p.lng},${p.lat}`).join('|')}`
      const bbox = markerGroupRef.current?.getBoundingBox?.()
      if (bbox) target = { bounds: bbox }
    } else {
      return
    }
    if (!target || key === fitKeyRef.current) return
    fitKeyRef.current = key
    map.getViewModel().setLookAtData(target, true)
  }

  // Show/move the shared drag dot while dragging the route line.
  function moveRouteHandle(geo: any) {
    const H = HRef.current
    const map = mapRef.current
    if (!H || !map) return
    if (!dragHandleRef.current) {
      const icon = new H.map.DomIcon(
        `<div style="transform:translate(-50%,-50%);box-sizing:border-box;width:18px;height:18px;` +
          `border-radius:9999px;background:${ROUTE_COLOR};border:3px solid #fff;` +
          `box-shadow:0 0 0 1.5px rgba(0,0,0,0.6),0 1px 4px rgba(0,0,0,0.5);cursor:move;"></div>`,
      )
      dragHandleRef.current = new H.map.DomMarker(geo, { icon })
      map.addObject(dragHandleRef.current)
    } else {
      dragHandleRef.current.setGeometry(geo)
    }
  }
  function removeRouteHandle() {
    const map = mapRef.current
    if (map && dragHandleRef.current) {
      map.removeObject(dragHandleRef.current)
      dragHandleRef.current = null
    }
  }

  // Initialise the map exactly once (async SDK load). Theme/basemap/specs changes
  // are applied via the effects below rather than recreating the map.
  useEffect(() => {
    if (!hereConfigured) return
    let cancelled = false
    const container = containerRef.current
    if (!container) return

    loadHere()
      .then((H) => {
        if (cancelled || !containerRef.current) return
        HRef.current = H
        const platform = new H.service.Platform({ apikey: apiKey })
        platformRef.current = platform
        // v3.2: HARP is the default (and only) engine, bundled in core, so we do
        // NOT pass an `engineType` (it was removed — `H.Map.EngineType` no longer
        // exists and referencing it would throw). createDefaultLayers() returns
        // HARP layers, including `vector.normal.logistics` with the vehicle
        // restrictions overlay.
        const layers = platform.createDefaultLayers()
        layersRef.current = layers

        const map = new H.Map(
          container,
          baseLayerFor(layers, baseStyleRef.current, schemeRef.current),
          {
            center: center ? { lat: center.lat, lng: center.lng } : DEFAULT_CENTER,
            zoom: center ? zoom : DEFAULT_ZOOM,
            // Cap the render resolution at 2×. The HARP engine rasterises the
            // logistics vector tiles (+ restriction icons) on the GPU every frame;
            // on 3×/4K displays an uncapped devicePixelRatio makes pan/zoom crawl
            // for no visible gain. 2× stays crisp while keeping it smooth.
            pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
          },
        )
        mapRef.current = map
        behaviorRef.current = new H.mapevents.Behavior(new H.mapevents.MapEvents(map))
        H.ui.UI.createDefault(map, layers)

        routeGroupRef.current = new H.map.Group()
        markerGroupRef.current = new H.map.Group()
        map.addObject(routeGroupRef.current)
        map.addObject(markerGroupRef.current)

        applyRestrictions()
        setStatus('ready')
        drawRoute(routeRef.current)
        bindMapHandlers(H, map)
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    // Wire up drag, right-click and resize once the map exists.
    function bindMapHandlers(H: any, map: any) {
      const behavior = behaviorRef.current

      // ── Drag a From/Stop/To dot ─────────────────────────────────────────
      map.addEventListener('dragstart', (ev: any) => {
        const t = ev.target
        if (t instanceof H.map.DomMarker || t instanceof H.map.Marker) {
          behavior.disable()
          markerMovedRef.current = false
        }
      })
      map.addEventListener('drag', (ev: any) => {
        const t = ev.target
        if (t instanceof H.map.DomMarker || t instanceof H.map.Marker) {
          const p = ev.currentPointer
          t.setGeometry(map.screenToGeo(p.viewportX, p.viewportY))
          markerMovedRef.current = true
        }
      })
      map.addEventListener('dragend', (ev: any) => {
        const t = ev.target
        if (t instanceof H.map.DomMarker || t instanceof H.map.Marker) {
          behavior.enable()
          if (markerMovedRef.current) {
            const g = t.getGeometry()
            onPointDragEndRef.current?.(t.getData(), [g.lng, g.lat])
          }
        }
      })

      // Click a stop dot to remove it (From/To stay — they're required).
      map.addEventListener('tap', (ev: any) => {
        const t = ev.target
        if (markerMovedRef.current) return
        if (t instanceof H.map.DomMarker || t instanceof H.map.Marker) {
          const pt = t.getData?.() as RoutePoint | undefined
          if (pt && pt.kind === 'stop') onPointRemoveRef.current?.(pt)
        }
      })

      // ── Drag the route line to insert a via-waypoint ────────────────────
      map.addEventListener('pointerdown', (ev: any) => {
        if (!onRouteDragRef.current) return
        const t = ev.target
        if (t instanceof H.map.Polyline) {
          routeDraggingRef.current = true
          behavior.disable()
          const g = map.screenToGeo(ev.currentPointer.viewportX, ev.currentPointer.viewportY)
          routeDropRef.current = g
          moveRouteHandle(g)
        }
      })
      map.addEventListener('pointermove', (ev: any) => {
        if (!routeDraggingRef.current) return
        const g = map.screenToGeo(ev.currentPointer.viewportX, ev.currentPointer.viewportY)
        routeDropRef.current = g
        moveRouteHandle(g)
      })
      const endRouteDrag = () => {
        if (!routeDraggingRef.current) return
        routeDraggingRef.current = false
        behavior.enable()
        removeRouteHandle()
        const g = routeDropRef.current
        if (g) onRouteDragRef.current?.([g.lng, g.lat])
      }
      map.addEventListener('pointerup', endRouteDrag)

      // Right-click → report the point + pixel so the caller can open its menu.
      const onCtx = (e: MouseEvent) => {
        if (!onContextMenuRef.current) return
        e.preventDefault()
        const rect = container!.getBoundingClientRect()
        const g = map.screenToGeo(e.clientX - rect.left, e.clientY - rect.top)
        if (g) onContextMenuRef.current([g.lng, g.lat], { x: e.clientX, y: e.clientY })
      }
      container!.addEventListener('contextmenu', onCtx)
      ctxHandlerRef.current = onCtx
    }

    return () => {
      cancelled = true
      const map = mapRef.current
      const container = containerRef.current
      if (container && ctxHandlerRef.current) {
        container.removeEventListener('contextmenu', ctxHandlerRef.current)
      }
      if (map) {
        try {
          map.dispose()
        } catch {
          /* already torn down */
        }
      }
      mapRef.current = null
      routeGroupRef.current = null
      markerGroupRef.current = null
      singleMarkerRef.current = null
      dragHandleRef.current = null
    }
    // Init-only; later changes are handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Resize the map when the container changes (lazy mount inside a flex/Suspense
  // box can settle its size late), and on the app's explicit layout-resize nudge.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const resize = () => {
      try {
        mapRef.current?.getViewPort().resize()
      } catch {
        /* not ready */
      }
    }
    const ro = new ResizeObserver(resize)
    ro.observe(container)
    window.addEventListener('dispo:layout-resize', resize)
    return () => {
      ro.disconnect()
      window.removeEventListener('dispo:layout-resize', resize)
    }
  }, [])

  // Switch the basemap (Standard/Satellite/Hybrid) and theme (day/night) by
  // swapping the base layer, then re-apply the restriction overlay + specs.
  useEffect(() => {
    baseStyleRef.current = baseStyle
    schemeRef.current = colorScheme
    const map = mapRef.current
    const layers = layersRef.current
    if (!map || !layers || status !== 'ready') return
    const next = baseLayerFor(layers, baseStyle, colorScheme)
    if (next && next !== map.getBaseLayer()) {
      map.setBaseLayer(next)
      applyRestrictions()
    }
  }, [baseStyle, colorScheme, status])

  // Toggle the real-time traffic flow overlay.
  useEffect(() => {
    const H = HRef.current
    const map = mapRef.current
    const layers = layersRef.current
    if (!H || !map || !layers || status !== 'ready') return
    const want = traffic && baseStyleSupportsTraffic(baseStyle)
    const trafficLayer =
      layers.vector?.traffic?.logistics ?? layers.vector?.traffic?.map ?? null
    if (want && trafficLayer && !trafficLayerRef.current) {
      map.addLayer(trafficLayer)
      trafficLayerRef.current = trafficLayer
    } else if (!want && trafficLayerRef.current) {
      map.removeLayer(trafficLayerRef.current)
      trafficLayerRef.current = null
    }
  }, [traffic, baseStyle, status])

  // Apply truck specs to the logistics restriction overlay when they change.
  // setVehicleSpecs lives on the tile PROVIDER (not the style).
  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready') return
    const provider = map.getBaseLayer()?.getProvider?.()
    if (provider?.setVehicleSpecs) {
      try {
        provider.setVehicleSpecs(truckVehicleSpecs(HRef.current, vehicleSpecs))
      } catch {
        /* provider not ready — applyRestrictions covers the next READY */
      }
    }
  }, [vehicleSpecs, status])

  // Recenter when the explicit `center` target changes. Skipped while a route is
  // visible — the route's bounds own the camera, so centering must not fight the
  // fit. (The route planner passes center=null; this serves the single-marker use.)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !center || status !== 'ready') return
    if (routeRef.current.length >= 2) return
    map.getViewModel().setLookAtData({ position: { lat: center.lat, lng: center.lng }, zoom })
  }, [center, zoom, status])

  // Keep a single marker (e.g. a vehicle) in sync with the prop.
  useEffect(() => {
    const H = HRef.current
    const map = mapRef.current
    if (!H || !map || status !== 'ready') return
    if (marker) {
      const geo = { lat: marker.lat, lng: marker.lng }
      if (!singleMarkerRef.current) {
        singleMarkerRef.current = new H.map.Marker(geo)
        map.addObject(singleMarkerRef.current)
      } else {
        singleMarkerRef.current.setGeometry(geo)
      }
    } else if (singleMarkerRef.current) {
      map.removeObject(singleMarkerRef.current)
      singleMarkerRef.current = null
    }
  }, [marker, status])

  // Draw / update the route line, re-snap markers to the new geometry, then fit
  // the view (once per geometry change — fitView is content-keyed).
  useEffect(() => {
    routeRef.current = route ?? []
    if (status !== 'ready') return
    drawRoute(routeRef.current)
    drawPoints(pointsRef.current)
    fitView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, status])

  // Keep waypoint markers in sync and frame them (once per content change). Runs
  // on `points`/`route` change; both draw and fit are no-ops when their content
  // key is unchanged, so an unstable `points` identity (typing) can't re-zoom.
  useEffect(() => {
    pointsRef.current = points ?? []
    if (status !== 'ready') return
    drawPoints(pointsRef.current)
    fitView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, route, status])

  if (!hereConfigured) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 bg-rail text-center px-6 ${className ?? ''}`}
      >
        <MapPinned size={26} strokeWidth={1.5} className="text-faint" />
        <div className="text-[12.5px] text-muted">Map is not configured.</div>
        <div className="text-[11px] text-faint max-w-[260px]">
          Set VITE_HERE_API_KEY to enable the HERE logistics map.
        </div>
      </div>
    )
  }

  return (
    <div className={`relative bg-rail ${className ?? ''}`}>
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
