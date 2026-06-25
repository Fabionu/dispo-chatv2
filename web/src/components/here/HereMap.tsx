import { useEffect, useRef, useState } from 'react'
import { decode } from '@here/flexpolyline'
import { loadHere } from '../../lib/here/loadHere'
import { pathMidpoint } from '../../lib/here/geo'
import type { LatLng, RouteMarker, RouteMarkerKind } from '../../lib/here/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

type Props = {
  // Waypoint markers in route order (origin → stops → destination).
  markers: RouteMarker[]
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
  // Right-click on the map → the geo coordinate under the cursor plus the
  // cursor position RELATIVE TO THE MAP CONTAINER (for placing a context menu)
  // and the current map zoom (for zoom-aware snapping).
  onMapContextMenu?: (info: { lat: number; lng: number; x: number; y: number; zoom: number }) => void
  // The map view started changing (pan/zoom) — used to dismiss menus/popovers.
  onMapViewChange?: () => void
  // A waypoint marker finished being dragged → its id + the dropped coordinate +
  // the current zoom (for zoom-aware snapping).
  onMarkerDragEnd?: (id: string, lat: number, lng: number, zoom: number) => void
  // A waypoint marker was clicked (not dragged) → its id, kind, and screen
  // position within the container, so the parent can open a marker popover.
  onMarkerClick?: (info: {
    id: string
    kind: RouteMarkerKind
    x: number
    y: number
  }) => void
  // The route line was dragged (drag-to-add-stop) → the section index that was
  // grabbed + the released coordinate + zoom, so the parent can insert a snapped
  // stop into that segment and recalculate.
  onRouteDragEnd?: (sectionIndex: number, lat: number, lng: number, zoom: number) => void
  // Width (px) of the floating panel overlapping the map's LEFT edge, so the
  // smart fit can keep the route clear of it. 0 when the panel is collapsed.
  panelInsetPx?: number
  className?: string
}

// Default view: central Europe, so an empty planner shows a sensible map.
const DEFAULT_CENTER = { lat: 50.11, lng: 8.68 }
const DEFAULT_ZOOM = 5

const ROUTE_COLOR = '#c89572'
const ORIGIN_COLOR = '#7d8a78'
const DEST_COLOR = '#d97757'

// Opt-in drag/snap tracing: run `localStorage.routeSnapDebug = '1'` in the
// console to log raw release pixels, the converted geo, and (in RoutePlanner)
// the snapped point + distance moved. Off (and silent) by default.
function snapDebug(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('routeSnapDebug') === '1'
  } catch {
    return false
  }
}

// ── Marker icons ───────────────────────────────────────────────────────────
// Built as SVG with an explicit anchor so the marker sits EXACTLY on the
// coordinate: centre for the round origin/stop dots, the tip for the
// destination pin. (HERE places the icon's anchor point on the coordinate.)
// Kept deliberately small so the markers don't blanket the spot under them —
// precise clicking/placement needs the coordinate to stay visible. Start (green
// dot) and finish (coral pin) stay visually distinct in shape + colour.
function originSvg(): string {
  return `<svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg"><circle cx="7" cy="7" r="5" fill="${ORIGIN_COLOR}" stroke="#ffffff" stroke-width="2"/></svg>`
}

function stopSvg(label: string): string {
  return `<svg width="17" height="17" viewBox="0 0 17 17" xmlns="http://www.w3.org/2000/svg"><circle cx="8.5" cy="8.5" r="6.5" fill="#ffffff" stroke="${ROUTE_COLOR}" stroke-width="2"/><text x="8.5" y="8.5" text-anchor="middle" dominant-baseline="central" font-family="Inter, system-ui, sans-serif" font-size="9.5" font-weight="700" fill="#1c1c1f">${label}</text></svg>`
}

function destSvg(): string {
  return `<svg width="20" height="26" viewBox="0 0 20 26" xmlns="http://www.w3.org/2000/svg"><path d="M10 1 C5 1 1 5 1 9.9 c0 6.6 9 15.1 9 15.1 s9-8.5 9-15.1 C19 5 15 1 10 1 z" fill="${DEST_COLOR}" stroke="#ffffff" stroke-width="1.8"/><circle cx="10" cy="10" r="3.4" fill="#ffffff"/></svg>`
}

// Small translucent dot shown under the cursor while dragging the route line.
// Kept tiny so it marks the release point without covering the road beneath it.
function ghostSvg(): string {
  return `<svg width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg"><circle cx="6" cy="6" r="4" fill="${ROUTE_COLOR}" fill-opacity="0.65" stroke="#ffffff" stroke-width="1.5"/></svg>`
}

// Build the H.map.Icon for a marker with the correct anchor for its kind.
function iconFor(H: any, marker: RouteMarker): any {
  if (marker.kind === 'origin') {
    return new H.map.Icon(originSvg(), { anchor: new H.math.Point(7, 7) })
  }
  if (marker.kind === 'destination') {
    // Anchor at the pin's tip (bottom centre of the 20×26 viewBox).
    return new H.map.Icon(destSvg(), { anchor: new H.math.Point(10, 26) })
  }
  return new H.map.Icon(stopSvg(marker.label ?? ''), { anchor: new H.math.Point(8.5, 8.5) })
}

// Interactive HERE map (Maps JS v3.2 / HARP). Owns the map instance; redraws the
// ordered waypoint markers + the route line whenever those props change, and
// toggles the HERE logistics (HGV truck-restriction) overlay. The browser-
// rendered map is the one place a HERE key reaches the client — fetched via
// loadHere() from the auth-gated proxy, never bundled.
export default function HereMap({
  markers,
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

        const map = new H.Map(containerRef.current, baseLayer, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
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

        // Right-click → report the geo coordinate under the cursor + the
        // cursor's position within the container (for menu placement).
        const container = containerRef.current
        const onContextMenu = (e: MouseEvent) => {
          if (!onContextMenuRef.current) return
          e.preventDefault()
          const rect = container.getBoundingClientRect()
          const x = e.clientX - rect.left
          const y = e.clientY - rect.top
          const geo = map.screenToGeo(x, y)
          if (!geo) return
          onContextMenuRef.current({ lat: geo.lat, lng: geo.lng, x, y, zoom: map.getZoom() })
        }
        container.addEventListener('contextmenu', onContextMenu)

        // Pan/zoom dismisses any open menu.
        const onViewChange = () => onViewChangeRef.current?.()
        map.addEventListener('mapviewchangestart', onViewChange)

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
          if (t instanceof H.map.Marker && pointer) {
            const screen = map.geoToScreen(t.getGeometry())
            t.__dragOffset = new H.math.Point(pointer.viewportX - screen.x, pointer.viewportY - screen.y)
            behavior.disable()
          } else if (t instanceof H.map.Polyline && pointer) {
            // Grabbed the route line — start a drag-to-add-stop segment drag.
            const data = t.getData?.()
            if (data && typeof data.section === 'number') {
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
          // Resolve the FINAL release coordinate from the dragend pointer itself
          // (HERE viewport coords → geo), not the last `drag` frame, so we never
          // use a slightly stale position. Falls back to the object geometry if
          // the event carries no pointer.
          const releasePointer = ev.currentPointer
          if (t instanceof H.map.Marker) {
            behavior.enable()
            const data = t.getData?.()
            let g = t.getGeometry?.()
            if (didDragRef.current && releasePointer && t.__dragOffset) {
              const fresh = map.screenToGeo(
                releasePointer.viewportX - t.__dragOffset.x,
                releasePointer.viewportY - t.__dragOffset.y,
              )
              if (fresh) g = fresh
            }
            if (didDragRef.current) {
              // A real drag → report the dropped coordinate for snap + recalc.
              if (data?.id && g) {
                if (snapDebug())
                  // eslint-disable-next-line no-console
                  console.log('[routeSnap] marker drag release', {
                    id: data.id,
                    viewport: releasePointer && { x: releasePointer.viewportX, y: releasePointer.viewportY },
                    releaseGeo: { lat: g.lat, lng: g.lng },
                    zoom: map.getZoom(),
                  })
                onMarkerDragEndRef.current?.(data.id, g.lat, g.lng, map.getZoom())
              }
            } else if (data?.id && data?.kind && g) {
              // Press-release with no movement = a click. HERE may consume the
              // gesture on a draggable marker and not emit a separate `tap`, so
              // open the popover here too (idempotent with the tap listener).
              const screen = map.geoToScreen(g)
              if (screen) onMarkerClickRef.current?.({ id: data.id, kind: data.kind, x: screen.x, y: screen.y })
            }
          }
          // Route-line drag release — drop the ghost, report the section + point.
          if (routeDragRef.current.active) {
            const { ghost, section } = routeDragRef.current
            behavior.enable()
            let g = ghost?.getGeometry?.()
            if (releasePointer) {
              const fresh = map.screenToGeo(releasePointer.viewportX, releasePointer.viewportY)
              if (fresh) g = fresh
            }
            if (ghost) map.removeObject(ghost)
            routeDragRef.current = { active: false, section: -1, ghost: null }
            if (g) {
              if (snapDebug())
                // eslint-disable-next-line no-console
                console.log('[routeSnap] route drag release', {
                  section,
                  viewport: releasePointer && { x: releasePointer.viewportX, y: releasePointer.viewportY },
                  releaseGeo: { lat: g.lat, lng: g.lng },
                  zoom: map.getZoom(),
                })
              onRouteDragEndRef.current?.(section, g.lat, g.lng, map.getZoom())
            }
          }
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
          map.removeEventListener('mapviewchangestart', onViewChange)
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
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Redraw markers + route when the route/waypoints change ────────────────
  useEffect(() => {
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, markers, routePolylines, routeDistanceLabel])

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

    // Accumulate every drawn point so we can frame them all at the end.
    const allPoints: LatLng[] = []
    // The route path in travel order (all sections concatenated) — used to anchor
    // the distance badge at the line's distance-weighted midpoint.
    const routePath: LatLng[] = []

    // Route line: a thin coral stroke over a subtle dark casing so it stays
    // readable on the basemap without dominating it. One casing+main pair per
    // section, each tagged with its section index and made draggable so the
    // existing visible line is itself the drag target (no second hidden line).
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
        poly.draggable = true
        // Volatile for the SAME reason as the markers below: HERE only delivers
        // drag gestures for objects it re-renders per frame. Without this the
        // line is drawn into the static cache and `dragstart/drag/dragend` never
        // fire for it, so the route line can't be grabbed. (This regressed when
        // the hover listeners that used to keep it interactive were removed for
        // the default-cursor change — volatility restores drag without any
        // cursor styling, keeping the normal arrow cursor.)
        poly.setVolatility(true)
        poly.setData({ section: sectionIndex })
        // No cursor change on hover — the map keeps the default arrow cursor
        // everywhere (enforced by the .here-map-surface CSS), so dragging the
        // route line never flips to a hand/grab cursor.
        group.addObject(poly)
      }
    })

    // Ordered waypoint markers, each anchored precisely on its coordinate.
    // Draggable so the user can refine a point directly on the map; the id is
    // stashed on the marker so dragend can report which point moved.
    for (const marker of markers) {
      // `volatility: true` is REQUIRED for dragging — without it HERE keeps the
      // marker in its optimised render cache and never delivers drag gestures.
      const m = new H.map.Marker(marker.position, { icon: iconFor(H, marker), volatility: true })
      m.draggable = true
      m.setData({ id: marker.id, kind: marker.kind })
      // No hover cursor change — markers keep the default arrow cursor; they are
      // still draggable (the .here-map-surface CSS keeps the cursor as default,
      // never grab/pointer).
      group.addObject(m)
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
