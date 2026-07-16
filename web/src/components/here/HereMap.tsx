import { useEffect, useRef, useState } from 'react'
import { decode } from '@here/flexpolyline'
import { loadHere } from '../../lib/here/loadHere'
import { pathMidpoint, haversineMeters, nearestPointOnPath } from '../../lib/here/geo'
import type {
  DriverMapMarker,
  LatLng,
  RouteMarker,
  RouteMarkerKind,
  ScreenGeoCandidate,
} from '../../lib/here/types'
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  HOVER_THRESHOLD_PX,
  formatHoverDistance,
  sampleScreenCandidates,
  snapDebug,
} from './hereMapUtils'
import { ROUTE_COLOR, ghostSvg, iconFor } from './hereMapIcons'

/* eslint-disable @typescript-eslint/no-explicit-any */

type Props = {
  // Waypoint markers in route order (origin → stops → destination).
  markers: RouteMarker[]
  // Live-driver positions (assigned drivers of the trip being shown). Rendered
  // as DOM markers so they carry a name pill + tooltip; visually distinct from
  // (and never replacing) the waypoint markers. Deliberately EXCLUDED from the
  // auto-fit, so a position update never re-centers the user's view.
  driverMarkers?: DriverMapMarker[]
  // Encoded HERE flexible polylines, one per route section. Empty = no route.
  routePolylines: string[]
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
  routePolylines,
  routeDistanceLabel,
  truckOverlay,
  onTruckOverlayAvailabilityChange,
  onMapContextMenu,
  onMapViewChange,
  onMarkerDragEnd,
  onMarkerClick,
  onRouteDragEnd,
  panelInsetPx = 0,
  center,
  objectsDraggable = true,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
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
  // Objects that must be volatile while idle so HERE can start drag gestures.
  // During a camera pan/zoom we temporarily cache them, then restore volatility
  // when the view settles. This keeps editing intact without paying their
  // per-frame rendering cost throughout ordinary map navigation.
  const draggableObjectsRef = useRef<any[]>([])
  // A single group holding every marker + line, so a redraw is "clear group,
  // add fresh objects" rather than tracking individual handles.
  const groupRef = useRef<any>(null)
  // The standard basemap + the logistics (HGV) basemap, captured at init so the
  // overlay toggle can swap between them without rebuilding the map.
  const baseLayerRef = useRef<any>(null)
  const logisticsLayerRef = useRef<any>(null)
  // Guards so we enable the (expensive) vehicle-restrictions feature only once.
  const overlayFeatureEnabledRef = useRef(false)
  // Last "fit signature" the map was framed for. We auto-fit ONLY on structural
  // route changes (the route first appearing, or an endpoint added/removed) — not
  // when an intermediate stop is added/removed/dragged or the route merely
  // recalculates. This keeps the user's zoom/pan stable while adding stops, which
  // otherwise reframed (and felt like a random zoom-in) on every change.
  const lastFitSigRef = useRef<string>('')
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
    let detachListeners: (() => void) | null = null

    loadHere()
      .then(({ H, apiKey }) => {
        if (cancelled || !containerRef.current || mapRef.current) return

        const platform = new H.service.Platform({ apikey: apiKey })
        const defaultLayers = platform.createDefaultLayers()

        // v3.2 HARP: plain default layers, no engineType. `vector.normal.map`
        // is the standard basemap; `vector.normal.logistics` carries the
        // truck/HGV restriction overlay (present only on entitled plans).
        const baseLayer = defaultLayers.vector.normal.map
        const logisticsLayer = defaultLayers.vector?.normal?.logistics ?? null
        baseLayerRef.current = baseLayer
        logisticsLayerRef.current = logisticsLayer

        // High-density desktop displays commonly report DPR 2. Rendering the
        // WebGL basemap at full density multiplies the pixel workload during
        // every pan/zoom with little practical gain under labels and overlays.
        const maxPixelRatio = 1.25
        const map = new H.Map(containerRef.current, baseLayer, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          pixelRatio: Math.min(window.devicePixelRatio || 1, maxPixelRatio),
        })

        const behavior = new H.mapevents.Behavior(new H.mapevents.MapEvents(map))
        behaviorRef.current = behavior
        H.ui.UI.createDefault(map, defaultLayers)

        const group = new H.map.Group()
        map.addObject(group)

        HRef.current = H
        mapRef.current = map
        groupRef.current = group

        // Tell the parent whether the HGV overlay can be offered at all.
        onTruckOverlayAvailabilityChange?.(Boolean(logisticsLayer))

        resizeObserver = new ResizeObserver(() => map.getViewPort().resize())
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
        // the nearest-point maths run at most once per frame.
        let hoverRaf = 0
        let hoverPx: { x: number; y: number } | null = null
        const processHover = () => {
          hoverRaf = 0
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
          if (activeDragRef.current || viewChangingRef.current) {
            hoverPx = null
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
        const onViewChange = () => {
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
            setDraggableVolatility(false)
          }
          onViewChangeRef.current?.()
        }
        const onViewChangeEnd = () => {
          viewChangingRef.current = false
          // Let HERE finish the camera's final frame before returning interaction
          // objects to its live render path.
          if (!interactiveDragRef.current) {
            resumeDraggableRaf = requestAnimationFrame(() => {
              resumeDraggableRaf = 0
              setDraggableVolatility(true)
            })
          }
        }
        map.addEventListener('mapviewchangestart', onViewChange)
        map.addEventListener('mapviewchangeend', onViewChangeEnd)

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
            }
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
          if (!data?.id || !data?.kind || !g) return
          const screen = map.geoToScreen(g)
          if (!screen) return
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
      detachListeners?.()
      if (mapRef.current) {
        mapRef.current.dispose()
        mapRef.current = null
        groupRef.current = null
        draggableObjectsRef.current = []
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Redraw markers + route when the route/waypoints change ────────────────
  useEffect(() => {
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, markers, routePolylines, routeDistanceLabel, objectsDraggable])

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
        const dot = document.createElement('div')
        dot.className = 'driver-marker-dot'
        const name = document.createElement('div')
        name.className = 'driver-marker-name'
        el.appendChild(dot)
        el.appendChild(name)
        container.appendChild(el)
        els.set(d.id, el)
      }
      el.className = d.stale ? 'driver-marker driver-marker--stale' : 'driver-marker'
      ;(el.children[0] as HTMLElement).title = d.detail ? `${d.name} — ${d.detail}` : d.name
      ;(el.children[1] as HTMLElement).textContent = d.name
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
    if (!H || !map || !group) return

    group.removeAll()
    draggableObjectsRef.current = []

    // Accumulate every drawn point so we can frame them all at the end.
    const allPoints: LatLng[] = []
    // The route path in travel order (all sections concatenated) — used to anchor
    // the distance badge at the line's distance-weighted midpoint.
    const routePath: LatLng[] = []

    // Route line: a thin coral stroke over a subtle dark casing so it stays
    // readable on the basemap without dominating it. The visible strokes remain
    // static/cached. One wider transparent volatile line above them handles
    // route dragging without forcing both visible strokes to redraw every frame.
    routePolylines.forEach((encoded, sectionIndex) => {
      let coords: number[][]
      try {
        coords = decode(encoded).polyline
      } catch {
        return
      }
      if (coords.length < 2) return
      const line = new H.geo.LineString()
      for (const [lat, lng] of coords) {
        line.pushPoint({ lat, lng })
        allPoints.push({ lat, lng })
        routePath.push({ lat, lng })
      }
      const casing = new H.map.Polyline(line, {
        style: { lineWidth: 5, strokeColor: 'rgba(0,0,0,0.35)', lineJoin: 'round', lineCap: 'round' },
      })
      const main = new H.map.Polyline(line, {
        style: { lineWidth: 3.5, strokeColor: ROUTE_COLOR, lineJoin: 'round', lineCap: 'round' },
      })
      for (const poly of [casing, main]) {
        group.addObject(poly)
      }
      if (objectsDraggable) {
        // HERE requires volatile objects for reliable drag delivery. Keeping that
        // cost on one interaction line leaves the two visible lines cached. The
        // tiny non-zero alpha keeps the wider stroke hit-testable but invisible.
        const dragTarget = new H.map.Polyline(line, {
          style: {
            lineWidth: 14,
            strokeColor: 'rgba(255,255,255,0.001)',
            lineJoin: 'round',
            lineCap: 'round',
          },
        })
        dragTarget.draggable = true
        dragTarget.setVolatility(!viewChangingRef.current)
        dragTarget.setData({ section: sectionIndex })
        group.addObject(dragTarget)
        draggableObjectsRef.current.push(dragTarget)
      }
    })

    // Cache the decoded route path + per-vertex cumulative distances (metres from
    // the start) for the hover-distance readout (see the pointermove handler).
    // Rebuilt on every redraw so it always matches the drawn line; null when
    // there's no usable route, which keeps the readout hidden.
    if (routePath.length >= 2) {
      const cum = new Array<number>(routePath.length)
      cum[0] = 0
      for (let i = 1; i < routePath.length; i++) {
        cum[i] = cum[i - 1] + haversineMeters(routePath[i - 1], routePath[i])
      }
      hoverGeomRef.current = { path: routePath, cum }
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
      const m = new H.map.Marker(marker.position, {
        icon: iconFor(H, marker),
        volatility: objectsDraggable && !viewChangingRef.current,
      })
      m.draggable = objectsDraggable
      m.setData({ id: marker.id, kind: marker.kind })
      // No hover cursor change — markers keep the default arrow cursor; they are
      // still draggable (the .here-map-surface CSS keeps the cursor as default,
      // never grab/pointer).
      group.addObject(m)
      if (objectsDraggable) draggableObjectsRef.current.push(m)
      allPoints.push(marker.position)
    }

    // Distance badge — a small Google-Maps-style pill near the route midpoint.
    // Rendered as a DOM overlay (H.map.DomMarker) so its CSS `pointer-events:
    // none` lets every press/drag fall through to the route line and markers
    // underneath; it never intercepts a gesture. Cleared with the group on each
    // redraw, so it follows the route as stops/legs change.
    if (routeDistanceLabel && routePath.length >= 2) {
      const mid = pathMidpoint(routePath)
      if (mid) {
        const outer = document.createElement('div')
        const pill = document.createElement('div')
        pill.className = 'route-distance-badge'
        pill.textContent = routeDistanceLabel
        outer.appendChild(pill)
        const badge = new H.map.DomMarker(mid, { icon: new H.map.DomIcon(outer) })
        group.addObject(badge)
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

  return <div ref={containerRef} className={['here-map-surface', className].filter(Boolean).join(' ')} />
}
