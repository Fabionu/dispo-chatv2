import { useEffect, useRef, useState } from 'react'
import { decode } from '@here/flexpolyline'
import { loadGoogle } from '../../lib/google/loadGoogle'
import { haversineMeters, nearestPointOnPath, simplifyPath } from '../../lib/here/geo'
import type { LatLng, RouteMarker, ScreenGeoCandidate } from '../../lib/here/types'
import {
  ENDPOINT_ICON_ANCHOR,
  ENDPOINT_ICON_SIZE,
  ROUTE_CASING,
  ROUTE_HALO,
  ROUTE_HOVER_BOOST,
  ROUTE_SPINE,
  STOP_ICON_ANCHOR,
  STOP_ICON_SIZE,
  destSvg,
  ghostSvg,
  originSvg,
  revealHeadSvg,
  routeStrokeWidths,
  savedPlaceSvg,
  stopSvg,
} from '../here/hereMapIcons'
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  HOVER_THRESHOLD_PX,
  formatHoverDistance,
  sampleScreenCandidates,
  snapDebug,
} from '../here/hereMapUtils'
import type { MapSurfaceProps } from './mapProps'
import { renderRouteBadge, routeMotionAllowed } from './routeDecor'
import { createHereMapStyleControl, type HereMapStyleControlHandle } from '../here/HereMapStyleControl'
import { createHereMapZoomControl, type HereMapZoomControlHandle } from '../here/HereMapZoomControl'
import { createMapStreetViewControl, type MapStreetViewControlHandle } from './MapStreetViewControl'
import { createHgvOverlay } from './hgvOverlay'

// The Google basemap, wearing the same contract as HereMap (see mapProps.ts).
//
// WHY A SECOND ENGINE. The user asked for Google's map — familiar, with its
// business POIs, satellite and Street View — while keeping HERE for what Google
// cannot do: truck-legal routing on a vehicle profile, and the HGV restriction
// overlay. So the ROUTE still comes from /api/here/route and is only DRAWN
// here, the snap still goes through /api/here/snap, and the one thing this
// engine cannot show — the HGV overlay, which is a HERE basemap, not a layer —
// is what MapView switches back to HereMap for.
//
// Nothing here calls Google for data: this engine only draws. The one Google
// data source the app does use — Places autocomplete, in the search fields
// (lib/google/places.ts, 2026-09-11) — lives beside the map, not in it, and its
// results are shown next to a Google map by default. Directions and Geocoding
// stay HERE's, because the route has to be truck-legal on the vehicle profile.
//
// The route line, the numbered marks, the saved-place squares and the ghost
// dot are the SAME SVGs HereMap draws (hereMapIcons.ts). Toggling the basemap
// must not appear to change what was planned.

function svgUrl(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

function markerIcon(g: typeof google, marker: RouteMarker): google.maps.Icon {
  const endpoint = {
    anchor: new g.maps.Point(ENDPOINT_ICON_ANCHOR, ENDPOINT_ICON_ANCHOR),
    scaledSize: new g.maps.Size(ENDPOINT_ICON_SIZE, ENDPOINT_ICON_SIZE),
  }
  if (marker.kind === 'origin') return { url: svgUrl(originSvg()), ...endpoint }
  if (marker.kind === 'destination') return { url: svgUrl(destSvg()), ...endpoint }
  return {
    url: svgUrl(stopSvg(marker.label ?? '')),
    anchor: new g.maps.Point(STOP_ICON_ANCHOR, STOP_ICON_ANCHOR),
    scaledSize: new g.maps.Size(STOP_ICON_SIZE, STOP_ICON_SIZE),
  }
}

// ── Route reveal (parameters) ──────────────────────────────────────────────
// The sweep rebuilds three polylines every frame, so it runs on a thinned copy
// of the route; the full-fidelity strokes take over the moment it lands.
const REVEAL_MAX_POINTS = 700

/**
 * How long the sweep takes, in ms, for a route of `meters`. Deliberately
 * sub-linear and hard-capped (HereMap's curve): time proportional to distance
 * would make a Bucharest→Rotterdam route crawl for half a minute — the longer
 * the route, the LESS patience there is for watching it draw. A 5 km delivery
 * sweeps in ~0.65 s, 100 km in ~1.35 s, anything past ~300 km hits the cap.
 */
function revealDurationMs(meters: number): number {
  const km = Math.max(0, meters) / 1000
  return Math.min(1600, Math.max(500, 450 + Math.sqrt(km) * 90))
}

/** Ease-out cubic: the line leaves the origin fast and settles onto the
 *  destination, rather than arriving at full speed and stopping dead. */
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

// Douglas-Peucker to drop sub-pixel wobble, then a uniform cap so a 4000-point
// international route cannot make the per-frame rebuild drop frames. Endpoints
// are always kept.
function thinPath(path: LatLng[], maxPoints: number): LatLng[] {
  const simplified = simplifyPath(path, 8)
  if (simplified.length <= maxPoints) return simplified
  const out: LatLng[] = [simplified[0]]
  const step = (simplified.length - 1) / (maxPoints - 1)
  for (let i = 1; i < maxPoints - 1; i++) out.push(simplified[Math.round(i * step)])
  out.push(simplified[simplified.length - 1])
  return out
}

/** A live driver: a teal dot, pointed when a heading is known, muted when stale. */
function driverSvg(headingDeg: number | undefined, stale: boolean): string {
  const fill = stale ? '#7f8c8b' : '#00b8a9'
  const arrow =
    typeof headingDeg === 'number'
      ? `<g transform="rotate(${headingDeg.toFixed(1)} 12 12)"><polygon points="12,3 16.5,13.5 12,11 7.5,13.5" fill="${ROUTE_HALO}"/></g>`
      : `<circle cx="12" cy="12" r="3.5" fill="${ROUTE_HALO}"/>`
  return `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="12" fill="${ROUTE_HALO}"/><circle cx="12" cy="12" r="10" fill="${fill}"/>${arrow}</svg>`
}

function decodeSection(encoded: string): LatLng[] {
  try {
    return decode(encoded).polyline.map(([lat, lng]) => ({ lat, lng }))
  } catch {
    return []
  }
}

function routeSignature(polylines: string[]): string {
  let hash = 0
  for (const encoded of polylines) {
    for (let i = 0; i < encoded.length; i++) hash = (hash * 31 + encoded.charCodeAt(i)) | 0
  }
  return `${polylines.length}:${hash}`
}

/** Point along a path at a fraction of its total length — for the distance badge. */
function pointAlong(path: LatLng[], fraction: number): LatLng | null {
  if (path.length === 0) return null
  if (path.length === 1) return path[0]
  const seg: number[] = [0]
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    seg.push(seg[i - 1] + Math.hypot(b.lat - a.lat, (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180)))
  }
  const target = seg[seg.length - 1] * fraction
  for (let i = 1; i < path.length; i++) {
    if (seg[i] >= target) {
      const t = seg[i] === seg[i - 1] ? 0 : (target - seg[i - 1]) / (seg[i] - seg[i - 1])
      const a = path[i - 1]
      const b = path[i]
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }
    }
  }
  return path[path.length - 1]
}

// Google's OverlayView is the only way to get a container-pixel projection out
// of the Maps API, and the only way to put an arbitrary DOM element on the map
// at a coordinate. One subclass does both jobs: with no `content` it is a pure
// projection source; with one, it is the distance badge.
type OverlayCtor = new (content: HTMLElement | null) => google.maps.OverlayView & {
  setPosition(p: LatLng | null): void
}

function makeOverlayClass(g: typeof google): OverlayCtor {
  class DispoOverlay extends g.maps.OverlayView {
    private content: HTMLElement | null
    private position: LatLng | null = null
    constructor(content: HTMLElement | null) {
      super()
      this.content = content
    }
    onAdd() {
      if (this.content) this.getPanes()?.floatPane.appendChild(this.content)
    }
    onRemove() {
      this.content?.parentNode?.removeChild(this.content)
    }
    setPosition(p: LatLng | null) {
      this.position = p
      this.draw()
    }
    draw() {
      if (!this.content) return
      const proj = this.getProjection()
      if (!proj || !this.position) {
        this.content.style.display = 'none'
        return
      }
      const px = proj.fromLatLngToDivPixel(new g.maps.LatLng(this.position.lat, this.position.lng))
      if (!px) return
      this.content.style.display = ''
      this.content.style.left = `${px.x}px`
      this.content.style.top = `${px.y}px`
    }
  }
  return DispoOverlay as unknown as OverlayCtor
}

export default function GoogleMap({
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
  onRouteDrag,
  onMarkerDrag,
  previewPolylines,
  previewPoint,
  panelInsetPx = 0,
  center,
  objectsDraggable = true,
  className,
  initialView,
  onViewportChange,
  onStreetViewChange,
}: MapSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // The wrapper around the map surface. Google owns the surface's children, so
  // DOM of ours that must sit over the map (the hover readout) goes here.
  const rootRef = useRef<HTMLDivElement>(null)
  // The app's own map controls (map view picker, zoom), in place of Google's.
  // Google's stock controls — the "Map ▾" dropdown, the camera pad, Pegman,
  // the zoom pair — are white Material widgets that read as a second product
  // sitting on top of this one (user, 2026-09-11: "sa fie la fel ca cel al
  // proiectului"). They are switched off in the map options and the SAME
  // controls the HERE engine draws are mounted here, so toggling HGV does not
  // change the chrome either. Street View and the camera pad have no
  // equivalent and are simply gone.
  const controlsHostRef = useRef<HTMLDivElement>(null)
  const styleControlRef = useRef<HereMapStyleControlHandle | null>(null)
  const zoomControlRef = useRef<HereMapZoomControlHandle | null>(null)
  const trafficLayerRef = useRef<google.maps.TrafficLayer | null>(null)
  // Street View, as a two-step gesture of our own in place of Pegman: press
  // the button, click a road. `streetViewPickRef` is the mode; the button and
  // hint are MapStreetViewControl's, the coverage lookup and the panorama are
  // handled here. The panorama itself is Google's (it replaces the map inside
  // the same surface, with its own close button) — the one piece of Google
  // chrome that stays, because it IS the product being shown.
  const streetViewControlRef = useRef<MapStreetViewControlHandle | null>(null)
  const streetViewPickRef = useRef(false)
  const streetViewServiceRef = useRef<google.maps.StreetViewService | null>(null)
  // The blue "where Street View exists" lines, shown only while picking — the
  // same paint Pegman gives you while you hold him.
  const coverageLayerRef = useRef<google.maps.StreetViewCoverageLayer | null>(null)
  // The HGV restriction layer (hgvOverlay.ts), on `map.overlayMapTypes` while
  // the planner's HGV toggle is on. It used to swap the whole map for HERE's
  // logistics basemap; now it is a layer over Google's, which is what the
  // toggle looked like it should do.
  const hgvOverlayRef = useRef<google.maps.MapType | null>(null)
  // The set of marker ids drawn last time — a NEW address (an id not seen
  // before) is what the map frames; a moved or re-created one is not.
  const drawnMarkerIdsRef = useRef<string>('')
  const streetViewCleanupRef = useRef<() => void>(() => {})
  const mapRef = useRef<google.maps.Map | null>(null)
  const gRef = useRef<typeof google | null>(null)
  const projectionRef = useRef<google.maps.OverlayView | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  // The map the draw effects below key on. State, not the ref: a map can be
  // torn down and rebuilt under a still-'ready' status (Fast Refresh re-runs
  // the init effect), and everything drawn on the old instance must be redrawn
  // on the new one — an identity the effects can only follow through state.
  const [liveMap, setLiveMap] = useState<google.maps.Map | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)

  // Latest callbacks in refs, so the once-only listeners below never go stale
  // and never need re-subscribing.
  const cb = useRef({
    onMapContextMenu,
    onMapViewChange,
    onMarkerDragEnd,
    onMarkerClick,
    onSavedPlaceClick,
    onRouteDragEnd,
    onRouteDrag,
    onMarkerDrag,
    onViewportChange,
    onStreetViewChange,
  })
  cb.current = {
    onMapContextMenu,
    onMapViewChange,
    onMarkerDragEnd,
    onMarkerClick,
    onSavedPlaceClick,
    onRouteDragEnd,
    onRouteDrag,
    onMarkerDrag,
    onViewportChange,
    onStreetViewChange,
  }
  const panelInsetRef = useRef(panelInsetPx)
  panelInsetRef.current = panelInsetPx
  const draggableRef = useRef(objectsDraggable)
  draggableRef.current = objectsDraggable
  const scaleWidthRef = useRef(scaleRouteWidthWithZoom)
  scaleWidthRef.current = scaleRouteWidthWithZoom

  // Objects owned by the map, replaced wholesale when their props change.
  const markerObjsRef = useRef<google.maps.Marker[]>([])
  const placeObjsRef = useRef<google.maps.Marker[]>([])
  const driverObjsRef = useRef<google.maps.Marker[]>([])
  const trailObjsRef = useRef<google.maps.Polyline[]>([])
  const routeObjsRef = useRef<
    { casing: google.maps.Polyline; spine: google.maps.Polyline; target: google.maps.Polyline }[]
  >([])
  // True while the cursor is on the route line — decided by the hover readout's
  // hit-test below, which is also what thickens the line (HereMap's rule: one
  // reach, both answers).
  const routeHoveredRef = useRef(false)
  // Decoded route path (whole route, travel order) + per-vertex cumulative
  // distances (metres from the start), refreshed by the route effect. Read by
  // the pointermove hover readout; null when there's no route so the readout
  // stays hidden.
  const hoverGeomRef = useRef<{ path: LatLng[]; cum: number[] } | null>(null)
  // Hides the readout; set by the init effect so the map's own gesture
  // listeners can call it.
  const hideHoverRef = useRef<() => void>(() => {})
  const hoverCleanupRef = useRef<() => void>(() => {})
  // The sweep in flight, if any: its rAF handle, the growing strokes and the
  // head dot, and a hook for the zoom restyle to keep its weights in step.
  const revealRef = useRef<{
    raf: number
    temps: google.maps.Polyline[]
    head: google.maps.Marker
    restyle: (w: ReturnType<typeof routeStrokeWidths>) => void
  } | null>(null)
  // Fingerprint of the route currently drawn. The route effect also runs for a
  // label change, so this is what separates "the route changed" (re-fit and
  // sweep) from "something else did" (leave the camera and the line alone).
  const drawnRouteSigRef = useRef<string | null>(null)
  const badgeRef = useRef<(google.maps.OverlayView & { setPosition(p: LatLng | null): void }) | null>(null)
  const badgeElRef = useRef<HTMLDivElement | null>(null)
  const routeDragRef = useRef<{
    active: boolean
    section: number
    ghost: google.maps.Marker | null
    // Once the consumer has answered with a matched point, the ghost sits on
    // the road it picked and stops trailing the cursor.
    snapped: boolean
  }>({ active: false, section: -1, ghost: null, snapped: false })
  const previewObjsRef = useRef<google.maps.Polyline[]>([])
  const lastPreviewPointRef = useRef<LatLng | null>(null)
  // When the user last moved a marker or the line itself. The route that
  // arrives moments later is that edit's result, and the camera holds still
  // for it (HereMap's rule): they are looking at the junction they just
  // chose, and a re-fit would take it away.
  const lastInteractiveDragAtRef = useRef(0)
  // A view handed across an engine swap (MapView) wins over the first fit:
  // the route on screen is the one the user was already looking at.
  const handoffPendingRef = useRef(initialView != null)

  // ── Container-pixel helpers ────────────────────────────────────────────────
  // `sampleScreenCandidates` was written against HERE's `map.screenToGeo`; a
  // two-method adapter over Google's projection lets the SAME sampler serve both
  // engines, so a right-click or a drag release probes the ring of pixels around
  // the cursor identically whichever map is under it.
  function screenAdapter() {
    const g = gRef.current
    const proj = projectionRef.current?.getProjection()
    return {
      screenToGeo(x: number, y: number): LatLng | null {
        if (!g || !proj) return null
        const ll = proj.fromContainerPixelToLatLng(new g.maps.Point(x, y))
        return ll ? { lat: ll.lat(), lng: ll.lng() } : null
      },
      geoToScreen(p: LatLng): { x: number; y: number } | null {
        if (!g || !proj) return null
        const px = proj.fromLatLngToContainerPixel(new g.maps.LatLng(p.lat, p.lng))
        return px ? { x: px.x, y: px.y } : null
      },
    }
  }
  // The right-click menu, in one place for the map and for the route line.
  // A ref so the route-drawing effect (which re-runs per route) can attach it
  // without re-subscribing the map.
  const openContextMenuRef = useRef<(e: google.maps.MapMouseEvent) => void>(() => {})
  openContextMenuRef.current = (e) => {
    const map = mapRef.current
    const px = containerPx(e.domEvent)
    const ll = e.latLng
    if (!map || !px || !ll) return
    e.domEvent?.preventDefault?.()
    cb.current.onMapContextMenu?.({
      lat: ll.lat(),
      lng: ll.lng(),
      x: px.x,
      y: px.y,
      zoom: map.getZoom() ?? DEFAULT_ZOOM,
      candidates: candidatesAt(px.x, px.y),
    })
  }

  function containerPx(domEvent: Event | undefined): { x: number; y: number } | null {
    const el = containerRef.current
    const me = domEvent as MouseEvent | undefined
    if (!el || !me || typeof me.clientX !== 'number') return null
    const r = el.getBoundingClientRect()
    return { x: me.clientX - r.left, y: me.clientY - r.top }
  }
  function candidatesAt(x: number, y: number): ScreenGeoCandidate[] {
    const map = mapRef.current
    const zoom = map?.getZoom() ?? DEFAULT_ZOOM
    return sampleScreenCandidates(screenAdapter(), x, y, zoom)
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const el = containerRef.current
    if (!el) return
    loadGoogle()
      .then((g) => {
        if (cancelled || !containerRef.current) return
        gRef.current = g
        const view = initialView ?? { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }
        const map = new g.maps.Map(containerRef.current, {
          center: view.center,
          zoom: view.zoom,
          // None of Google's chrome: the app draws its own controls (see
          // controlsHostRef). Only the logo and the attribution row stay,
          // which the terms require.
          mapTypeControl: false,
          zoomControl: false,
          streetViewControl: false,
          cameraControl: false,
          fullscreenControl: false,
          // Scroll zooms without a modifier, as HERE's map does and as a
          // full-pane map should; the ctrl-to-zoom nag is for embeds.
          gestureHandling: 'greedy',
          // Without a mapId this is a RASTER map, where Google's default is
          // integer zoom: one wheel notch = one whole level = the map doubling
          // under the cursor, which is what read as "too much or too little
          // per scroll, never gradual" (user, 2026-09-14). Fractional zoom
          // is what makes the wheel proportional — small deltas move the
          // zoom by fractions and a flick still gets somewhere.
          isFractionalZoomEnabled: true,
          clickableIcons: true,
        })
        mapRef.current = map
        // Dev-only console handle for poking the live map while verifying —
        // the pane cannot hold a drag mid-gesture, so this is how a preview
        // gets inspected.
        if (import.meta.env.DEV) {
          ;(window as unknown as { __dispoGoogleMap?: unknown }).__dispoGoogleMap = {
            map,
            previewCount: () => previewObjsRef.current.length,
            previewPoint: () => lastPreviewPointRef.current,
            drag: () => routeDragRef.current,
            // The route's strokes, for probing hover and weights.
            route: () => routeObjsRef.current,
            // Container pixel of a coordinate, for aiming synthetic pointer
            // events at the line.
            toPixel: (p: LatLng) => screenAdapter().geoToScreen(p),
            // Whether the Street View coverage lines are on the map.
            coverage: () => coverageLayerRef.current?.getMap() != null,
            // The sweep in flight: how far its head has got, in vertices.
            reveal: () => {
              const r = revealRef.current
              return r ? { drawn: r.temps[0].getPath().getLength(), head: r.head.getPosition()?.toJSON() } : null
            },
          }
        }

        const Overlay = makeOverlayClass(g)
        const projection = new Overlay(null)
        projection.setMap(map)
        projectionRef.current = projection

        // ── Route hover distance readout ──────────────────────────────────
        // A compact floating pill that appears when the cursor is near the
        // drawn route line, showing how far along the route (from the start)
        // the hovered point is. HereMap's, ported (user, 2026-09-11: "la hover
        // pe orice bucata a rutei, sa iti arate km pana in pozitia
        // respectiva"). All imperative: a plain DOM element positioned from a
        // single rAF-throttled pointermove, reading the cached route geometry in
        // hoverGeomRef. No React state and no map redraw, so moving the mouse
        // never re-renders the component or the map, and nothing calls the
        // routing API.
        const hoverLabel = document.createElement('div')
        hoverLabel.className = 'route-hover-label'
        hoverLabel.style.display = 'none'
        rootRef.current?.appendChild(hoverLabel)

        const hideHover = () => {
          if (hoverLabel.style.display !== 'none') hoverLabel.style.display = 'none'
          setRouteHovered(false)
        }
        hideHoverRef.current = hideHover
        const showHover = (x: number, y: number, meters: number) => {
          hoverLabel.textContent = formatHoverDistance(meters)
          hoverLabel.style.display = 'block'
          // The readout says WHERE on the route the cursor is; the weight says
          // the line itself is live under it.
          setRouteHovered(true)
          // Flip the pill below the point near the top edge so it never clips;
          // the CSS tail points back at the line either way.
          hoverLabel.classList.toggle('route-hover-label--below', y < 48)
          // Keep the centre-anchored pill within the map horizontally.
          const half = hoverLabel.offsetWidth / 2
          const w = el.clientWidth
          const cx = Math.min(Math.max(x, half + 4), Math.max(half + 4, w - half - 4))
          hoverLabel.style.left = `${cx}px`
          hoverLabel.style.top = `${y}px`
        }

        // rAF-coalesced: the move handler only stashes the latest cursor pixel;
        // the nearest-point maths run at most 30 times/sec.
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
          if (!p || !geom || routeDragRef.current.active || map.getStreetView().getVisible()) {
            hideHover()
            return
          }
          const screen = screenAdapter()
          const cursor = screen.screenToGeo(p.x, p.y)
          if (!cursor) {
            hideHover()
            return
          }
          // Convert the fixed pixel threshold into ground metres at this zoom
          // by measuring how far HOVER_THRESHOLD_PX spans, so the hit-test feels
          // the same when zoomed in or out.
          const edge = screen.screenToGeo(p.x + HOVER_THRESHOLD_PX, p.y)
          const threshMeters = edge ? haversineMeters(cursor, edge) : 0
          const near = nearestPointOnPath(cursor, geom.path, geom.cum)
          if (near && threshMeters > 0 && near.meters <= threshMeters) showHover(p.x, p.y, near.along)
          else hideHover()
        }
        const onPointerMove = (e: PointerEvent) => {
          // A pressed pointer is a pan or a drag: the hit-test must not compete
          // with it, and a readout that follows a pan is noise.
          if (e.buttons !== 0 || routeDragRef.current.active) {
            hoverPx = null
            hideHover()
            return
          }
          const rect = el.getBoundingClientRect()
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
          el.addEventListener('pointermove', onPointerMove)
          el.addEventListener('pointerleave', onPointerLeave)
        }
        hoverCleanupRef.current = () => {
          if (hoverRaf) cancelAnimationFrame(hoverRaf)
          el.removeEventListener('pointermove', onPointerMove)
          el.removeEventListener('pointerleave', onPointerLeave)
          hoverLabel.remove()
          hideHoverRef.current = () => {}
        }

        // The distance badge: DOM on the float pane, the same element (and CSS)
        // HereMap puts in its DomMarker, so the two engines' badges are one.
        const badgeEl = document.createElement('div')
        badgeEl.className = 'route-distance-badge'
        badgeElRef.current = badgeEl
        const badge = new Overlay(badgeEl)
        badge.setMap(map)
        badgeRef.current = badge

        // ── Map-level gestures ──────────────────────────────────────────────
        // The route's grab polyline is `clickable`, so a right-click ON the
        // line is delivered to it and never reaches this listener — the same
        // handler is attached to each route target where it is drawn (see
        // openContextMenuRef), so the options open over the route as well.
        map.addListener('contextmenu', (e: google.maps.MapMouseEvent) => {
          openContextMenuRef.current(e)
        })
        map.addListener('dragstart', () => {
          cb.current.onMapViewChange?.()
          hideHoverRef.current()
          styleControlRef.current?.close()
        })
        map.addListener('zoom_changed', () => {
          cb.current.onMapViewChange?.()
          // The line moved under a resting cursor; the next pointermove
          // re-measures. Leaving the pill where it was would label empty map.
          hideHoverRef.current()
          restyleRoute()
        })
        // Reported from the model events, not from `idle` or `bounds_changed`:
        // both of those wait for a rendered frame, and a tab in the background
        // (rAF paused) never gets one, so an engine swap made from there would
        // hand across a stale view. center/zoom are set synchronously.
        const reportViewport = () => {
          const c = map.getCenter()
          const z = map.getZoom()
          if (c && typeof z === 'number') {
            cb.current.onViewportChange?.({ center: { lat: c.lat(), lng: c.lng() }, zoom: z })
          }
        }
        map.addListener('center_changed', reportViewport)
        map.addListener('zoom_changed', reportViewport)

        // Route-line drag, continued on the MAP: Google's Polyline only emits
        // mousedown; the move and the release arrive on the map itself.
        map.addListener('mousemove', (e: google.maps.MapMouseEvent) => {
          const drag = routeDragRef.current
          if (!drag.active || !drag.ghost || !e.latLng) return
          if (!drag.snapped) drag.ghost.setPosition(e.latLng)
          cb.current.onRouteDrag?.(
            drag.section,
            { lat: e.latLng.lat(), lng: e.latLng.lng() },
            map.getZoom() ?? DEFAULT_ZOOM,
          )
        })
        map.addListener('mouseup', (e: google.maps.MapMouseEvent) => finishRouteDrag(e.domEvent))

        // ── Street View pick mode ──────────────────────────────────────────
        const setStreetViewPick = (picking: boolean) => {
          if (streetViewPickRef.current === picking) return
          streetViewPickRef.current = picking
          streetViewControlRef.current?.setActive(picking)
          streetViewControlRef.current?.setHint(picking ? 'Click a road to open Street View' : '')
          // The crosshair is the mode made visible on the map itself; the grab
          // hand comes back the moment the mode ends.
          map.setOptions({ draggableCursor: picking ? 'crosshair' : undefined })
          if (picking) styleControlRef.current?.close()
          // Coverage: the roads that HAVE a panorama, in Google's blue, so the
          // click lands on one instead of guessing.
          if (picking) {
            coverageLayerRef.current ??= g.maps.StreetViewCoverageLayer ? new g.maps.StreetViewCoverageLayer() : null
            coverageLayerRef.current?.setMap(map)
          } else {
            coverageLayerRef.current?.setMap(null)
          }
        }
        const openStreetViewAt = (at: google.maps.LatLng) => {
          streetViewServiceRef.current ??= new g.maps.StreetViewService()
          streetViewServiceRef.current
            .getPanorama({ location: at, radius: 60, source: g.maps.StreetViewSource.OUTDOOR })
            .then(({ data }) => {
              const panoId = data.location?.pano
              const panoAt = data.location?.latLng
              if (!panoId || !panoAt) throw new Error('no panorama')
              const pano = map.getStreetView()
              // Google's close button is off: it sits top-left, under the
              // planner card. Our "Back to map" (MapStreetViewControl) is the
              // exit, and so is Escape.
              pano.setOptions({
                addressControl: true,
                // Top-right: top-left is our "Back to map", and the planner's
                // own toggles that live top-right leave while the panorama
                // is up (onStreetViewChange).
                addressControlOptions: { position: g.maps.ControlPosition.TOP_RIGHT },
                enableCloseButton: false,
                fullscreenControl: false,
              })
              pano.setPano(panoId)
              // Face the spot that was clicked, not whichever way the car was
              // driving when the picture was taken.
              pano.setPov({ heading: g.maps.geometry.spherical.computeHeading(panoAt, at), pitch: 0 })
              pano.setVisible(true)
              setStreetViewPick(false)
            })
            .catch(() => {
              // Stay in the mode — the next click may land on a covered road.
              streetViewControlRef.current?.setHint('No Street View here — try a nearby road', true)
              window.setTimeout(() => {
                if (streetViewPickRef.current) {
                  streetViewControlRef.current?.setHint('Click a road to open Street View')
                }
              }, 1900)
            })
        }
        map.addListener('click', (e: google.maps.MapMouseEvent) => {
          if (!streetViewPickRef.current || !e.latLng) return
          e.stop?.()
          openStreetViewAt(e.latLng)
        })
        // While the panorama is up it owns the surface: the column of controls,
        // the hint and the hover readout make no sense over it, and the only
        // thing of ours left showing is the way back (`is-streetview` swaps the
        // two sets — see index.css).
        map.getStreetView().addListener('visible_changed', () => {
          const up = map.getStreetView().getVisible()
          controlsHostRef.current?.classList.toggle('is-streetview', up)
          if (up) hideHoverRef.current()
          cb.current.onStreetViewChange?.(up)
        })
        const onKeyDown = (e: KeyboardEvent) => {
          if (e.key !== 'Escape') return
          if (streetViewPickRef.current) setStreetViewPick(false)
          else if (map.getStreetView().getVisible()) map.getStreetView().setVisible(false)
        }
        document.addEventListener('keydown', onKeyDown)
        streetViewCleanupRef.current = () => document.removeEventListener('keydown', onKeyDown)

        // ── The app's controls ─────────────────────────────────────────────
        if (controlsHostRef.current) {
          streetViewControlRef.current = createMapStreetViewControl({
            container: controlsHostRef.current,
            onToggle: setStreetViewPick,
            onExit: () => map.getStreetView().setVisible(false),
          })
          styleControlRef.current = createHereMapStyleControl({
            container: controlsHostRef.current,
            satelliteAvailable: true,
            trafficAvailable: true,
            // "Satellite" is Google's hybrid: imagery WITH the road and place
            // labels a dispatcher steers by. Bare satellite is unreadable at
            // the zooms a route is planned at.
            onBaseModeChange: (mode) => map.setMapTypeId(mode === 'satellite' ? 'hybrid' : 'roadmap'),
            onTrafficChange: (enabled) => {
              if (enabled) {
                trafficLayerRef.current ??= new g.maps.TrafficLayer()
                trafficLayerRef.current.setMap(map)
              } else {
                trafficLayerRef.current?.setMap(null)
              }
            },
          })
          zoomControlRef.current = createHereMapZoomControl({
            container: controlsHostRef.current,
            // From a fractional wheel zoom, the buttons step to the next
            // WHOLE level (12.4 → 13), the way a zoom control reads.
            onZoomIn: () => map.setZoom(Math.floor(map.getZoom() ?? DEFAULT_ZOOM) + 1),
            onZoomOut: () => map.setZoom(Math.ceil(map.getZoom() ?? DEFAULT_ZOOM) - 1),
          })
        }

        // The HGV layer needs only the server's HERE key, which every other
        // HERE call needs too; the toggle is always offered here.
        onTruckOverlayAvailabilityChange?.(true)
        setLiveMap(map)
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setErrorText(err instanceof Error ? err.message : 'The Google map could not be loaded.')
        setStatus('error')
      })

    // A release outside the map (the cursor left the pane mid-drag) must still
    // end the drag, or the ghost dot and the frozen pan would be stuck.
    const onDocUp = (e: MouseEvent) => {
      if (routeDragRef.current.active) finishRouteDrag(e)
    }
    document.addEventListener('mouseup', onDocUp, true)

    return () => {
      cancelled = true
      document.removeEventListener('mouseup', onDocUp, true)
      hoverCleanupRef.current()
      hoverCleanupRef.current = () => {}
      styleControlRef.current?.dispose()
      styleControlRef.current = null
      zoomControlRef.current?.dispose()
      zoomControlRef.current = null
      streetViewCleanupRef.current()
      streetViewCleanupRef.current = () => {}
      streetViewControlRef.current?.dispose()
      streetViewControlRef.current = null
      streetViewPickRef.current = false
      coverageLayerRef.current?.setMap(null)
      coverageLayerRef.current = null
      // A map torn down with the panorama up (an engine swap, a remount) never
      // fires `visible_changed` for it: say "closed" ourselves, or the parent
      // keeps its cards hidden over a map that is no longer there.
      if (mapRef.current?.getStreetView().getVisible()) cb.current.onStreetViewChange?.(false)
      controlsHostRef.current?.classList.remove('is-streetview')
      trafficLayerRef.current?.setMap(null)
      trafficLayerRef.current = null
      cancelReveal()
      clearAll()
      projectionRef.current?.setMap(null)
      badgeRef.current?.setMap(null)
      mapRef.current = null
      gRef.current = null
      setLiveMap(null)
    }
    // Mount-only. Every later change flows through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function clearAll() {
    cancelReveal()
    for (const m of markerObjsRef.current) m.setMap(null)
    for (const m of placeObjsRef.current) m.setMap(null)
    for (const m of driverObjsRef.current) m.setMap(null)
    for (const t of trailObjsRef.current) t.setMap(null)
    for (const r of routeObjsRef.current) {
      r.casing.setMap(null)
      r.spine.setMap(null)
      r.target.setMap(null)
    }
    for (const p of previewObjsRef.current) p.setMap(null)
    previewObjsRef.current = []
    markerObjsRef.current = []
    placeObjsRef.current = []
    driverObjsRef.current = []
    trailObjsRef.current = []
    routeObjsRef.current = []
    // A fresh map has to fit (and sweep) the route again, whatever the last
    // one showed.
    drawnRouteSigRef.current = null
    drawnMarkerIdsRef.current = ''
  }

  // ── Route drag ─────────────────────────────────────────────────────────────
  function beginRouteDrag(section: number, at: google.maps.LatLng) {
    const g = gRef.current
    const map = mapRef.current
    if (!g || !map || !draggableRef.current) return
    if (routeDragRef.current.active) return
    // The map must not pan under the drag: it is the LINE being pulled.
    map.setOptions({ draggable: false })
    const ghost = new g.maps.Marker({
      map,
      position: at,
      clickable: false,
      icon: { url: svgUrl(ghostSvg()), anchor: new g.maps.Point(6, 6), scaledSize: new g.maps.Size(12, 12) },
      zIndex: 1000,
    })
    routeDragRef.current = { active: true, section, ghost, snapped: false }
  }
  function finishRouteDrag(domEvent: Event | undefined) {
    const drag = routeDragRef.current
    const map = mapRef.current
    if (!drag.active || !map) return
    const { section, ghost } = drag
    routeDragRef.current = { active: false, section: -1, ghost: null, snapped: false }
    map.setOptions({ draggable: true })
    // Release pixel from the pointer itself when we have it; the ghost's last
    // position is the fallback, and both go through the same sampler.
    let px = containerPx(domEvent)
    if (!px) {
      const p = ghost?.getPosition()
      if (p) px = screenAdapter().geoToScreen({ lat: p.lat(), lng: p.lng() })
    }
    ghost?.setMap(null)
    if (!px) return
    const zoom = map.getZoom() ?? DEFAULT_ZOOM
    const candidates = candidatesAt(px.x, px.y)
    if (snapDebug())
      // eslint-disable-next-line no-console
      console.log('[routeSnap] google route drag release', { section, pixel: px, zoom, candidates: candidates.length })
    lastInteractiveDragAtRef.current = Date.now()
    if (candidates.length) cb.current.onRouteDragEnd?.(section, candidates, zoom)
  }

  // ── Route line ─────────────────────────────────────────────────────────────
  // Two visible strokes per section, drawn casing → spine (the same pair
  // HereMap draws), plus the invisible grab target above them. A glow stroke
  // under them lasted one iteration: it was part of what made the route look
  // like a crayon line (user, 2026-09-11), and a thin line does not need
  // lifting off the tiles.

  // The widths every stroke is drawn at RIGHT NOW (HereMap's routeWidthsNow):
  // the zoom-scaled ramp when the planner asked for it, the fixed trip-map
  // weights otherwise, thickened either way while the cursor is on the line.
  // Everything that draws or restyles the route asks here, so a zoom that
  // lands while the line is hovered keeps its weight, and so does a redraw.
  function routeWidthsNow() {
    const hovered = routeHoveredRef.current
    if (scaleWidthRef.current) {
      return routeStrokeWidths(mapRef.current?.getZoom() ?? DEFAULT_ZOOM, hovered)
    }
    const main = hovered ? 4 * ROUTE_HOVER_BOOST : 4
    return { main, casing: main + 1.5, arrow: 3, arrowsVisible: true }
  }

  // Direction, as repeated open arrows stencilled along the spine — the native
  // equivalent of HERE's dash-image arrows. Hidden at overview zooms for the
  // same reason HERE hides them: on a thread crossing countries they are noise,
  // and the reveal has already shown which way the route runs.
  function arrowIcons(g: typeof google, w: ReturnType<typeof routeWidthsNow>): google.maps.IconSequence[] {
    if (!w.arrowsVisible) return []
    return [
      {
        icon: {
          path: g.maps.SymbolPath.FORWARD_OPEN_ARROW,
          scale: Math.max(1.6, w.arrow * 0.5),
          strokeColor: ROUTE_HALO,
          strokeWeight: 1.6,
          strokeOpacity: 0.95,
        },
        offset: '30px',
        repeat: '72px',
      },
    ]
  }

  function restyleRoute() {
    const g = gRef.current
    if (!g) return
    const w = routeWidthsNow()
    for (const r of routeObjsRef.current) {
      r.casing.setOptions({ strokeWeight: w.casing })
      r.spine.setOptions({ strokeWeight: w.main, icons: arrowIcons(g, w) })
    }
    // A sweep in flight grows at the same weight the finished line will have.
    revealRef.current?.restyle(w)
  }

  // The cursor arrived on the route line, or left it. Only the transitions cost
  // anything — Google fires mouseover once per entry, not per move.
  function setRouteHovered(hovered: boolean) {
    if (routeHoveredRef.current === hovered) return
    routeHoveredRef.current = hovered
    restyleRoute()
  }

  function showRouteStrokes(visible: boolean) {
    for (const r of routeObjsRef.current) {
      r.casing.setVisible(visible)
      r.spine.setVisible(visible)
    }
  }

  // ── Route reveal ───────────────────────────────────────────────────────────
  // A freshly calculated route draws itself on from the origin to the
  // destination instead of appearing all at once. It answers "which way does
  // this go?" — the question a static line makes you trace with your eyes — in
  // the moment the route arrives, and it gives adding a stop a visible result.
  // HereMap has had this since 2026-08-22; this is the same sweep on the Google
  // engine, which had none (user, 2026-09-11: "bring back the animation").
  //
  // The real strokes are hidden and ONE temporary pair grows in their place —
  // a route is a chain of sections and only the head one is ever partially
  // drawn, so a single growing line over the concatenated path is both simpler
  // and cheaper than re-cutting each section every frame. A ringed dot runs at
  // the head. The arrow glyphs sit the animation out: the sweep is already
  // showing direction far more directly.

  /** Stop any in-flight sweep and drop its temporary objects. Safe to call at
   *  any time; leaves the real strokes as they are. */
  function cancelReveal() {
    const reveal = revealRef.current
    if (!reveal) return
    revealRef.current = null
    cancelAnimationFrame(reveal.raf)
    for (const t of reveal.temps) t.setMap(null)
    reveal.head.setMap(null)
  }

  /** The sweep has landed (or must land now): the full-fidelity strokes and
   *  the badge take over. */
  function finishReveal() {
    cancelReveal()
    showRouteStrokes(true)
    badgeElRef.current?.classList.remove('is-waiting')
  }

  function startReveal(path: LatLng[]): boolean {
    const g = gRef.current
    const map = mapRef.current
    if (!g || !map || path.length < 2) return false

    const anim = thinPath(path, REVEAL_MAX_POINTS)
    // Cumulative distance drives the sweep, so it advances at a constant ground
    // speed. Stepping one VERTEX per frame instead would race through motorways
    // (few, far-apart points) and crawl through town centres (many, close ones).
    const cum = new Array<number>(anim.length)
    cum[0] = 0
    for (let i = 1; i < anim.length; i++) cum[i] = cum[i - 1] + haversineMeters(anim[i - 1], anim[i])
    const total = cum[cum.length - 1]
    if (!(total > 0)) return false

    const w = routeWidthsNow()
    showRouteStrokes(false)
    badgeElRef.current?.classList.add('is-waiting')

    const seed = [anim[0], anim[0]]
    const common = { map, clickable: false, strokeOpacity: 1 }
    const casing = new g.maps.Polyline({ ...common, path: seed, strokeColor: ROUTE_CASING, strokeWeight: w.casing, zIndex: 10 })
    const spine = new g.maps.Polyline({ ...common, path: seed, strokeColor: ROUTE_SPINE, strokeWeight: w.main, zIndex: 11 })
    const head = new g.maps.Marker({
      map,
      position: anim[0],
      clickable: false,
      optimized: false,
      icon: { url: svgUrl(revealHeadSvg()), anchor: new g.maps.Point(6, 6), scaledSize: new g.maps.Size(12, 12) },
      zIndex: 25,
    })

    const duration = revealDurationMs(total)
    const startedAt = performance.now()
    // The sweep only moves forward, so the vertex cursor is carried between
    // frames — the whole animation walks the path once, not once per frame.
    let cursor = 1

    const reveal = {
      raf: 0,
      temps: [casing, spine],
      head,
      restyle: (next: ReturnType<typeof routeWidthsNow>) => {
        casing.setOptions({ strokeWeight: next.casing })
        spine.setOptions({ strokeWeight: next.main })
      },
    }

    const frame = (now: number) => {
      if (revealRef.current !== reveal) return
      const linear = Math.min(1, (now - startedAt) / duration)
      const reached = easeOutCubic(linear) * total
      while (cursor < anim.length - 1 && cum[cursor] < reached) cursor++
      const drawn: LatLng[] = anim.slice(0, cursor)
      // Interpolate the head inside the current segment so the line grows
      // smoothly instead of jumping from vertex to vertex.
      const spanStart = cum[cursor - 1]
      const spanLength = cum[cursor] - spanStart
      const t = spanLength > 0 ? Math.min(1, Math.max(0, (reached - spanStart) / spanLength)) : 1
      const from = anim[cursor - 1]
      const to = anim[cursor]
      const tip = { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t }
      drawn.push(tip)
      casing.setPath(drawn)
      spine.setPath(drawn)
      head.setPosition(tip)
      if (linear < 1) {
        reveal.raf = requestAnimationFrame(frame)
        return
      }
      finishReveal()
    }

    revealRef.current = reveal
    reveal.raf = requestAnimationFrame(frame)
    return true
  }

  useEffect(() => {
    const g = gRef.current
    const map = liveMap
    if (!g || !map) return

    const sig = routeSignature(routePolylines)
    const routeChanged = sig !== drawnRouteSigRef.current
    drawnRouteSigRef.current = sig
    // This redraw is not for a new route — a label landed, a marker moved back —
    // while a sweep of THIS route is still in flight. Let it finish over the
    // rebuilt strokes rather than stopping it half-drawn; it shows them when
    // it lands.
    const revealInFlight = !routeChanged && revealRef.current !== null
    if (routeChanged) cancelReveal()

    for (const r of routeObjsRef.current) {
      r.casing.setMap(null)
      r.spine.setMap(null)
      r.target.setMap(null)
    }
    routeObjsRef.current = []
    // A rebuilt line starts at rest; the next pointermove re-measures it.
    routeHoveredRef.current = false

    const sections = routePolylines.map(decodeSection).filter((s) => s.length >= 2)
    sections.forEach((path, sectionIndex) => {
      const casing = new g.maps.Polyline({
        map,
        path,
        strokeColor: ROUTE_CASING,
        strokeOpacity: 1,
        strokeWeight: 5.5,
        clickable: false,
        zIndex: 10,
      })
      const spine = new g.maps.Polyline({
        map,
        path,
        strokeColor: ROUTE_SPINE,
        strokeOpacity: 1,
        strokeWeight: 4,
        clickable: false,
        zIndex: 11,
      })
      // The grab handle: a wide, invisible copy of the section. Wide so the
      // line is comfortable to catch; invisible so it adds nothing to the
      // drawing. Its mousedown is the whole drag-to-add-stop gesture's start.
      // (Hover is NOT read from it: the pointer hit-test that drives the
      // distance readout also thickens the line, so the two can never
      // disagree about whether the cursor is on the route.)
      const target = new g.maps.Polyline({
        map,
        path,
        strokeColor: '#ffffff',
        strokeOpacity: 0.001,
        strokeWeight: 18,
        clickable: true,
        zIndex: 12,
      })
      target.addListener('mousedown', (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return
        // Primary button only. This used to start on ANY mousedown, so a
        // right-click on the line was a press-and-release drag of zero
        // length: it inserted a stop under the cursor instead of opening the
        // options (user, 2026-09-14).
        if ((e.domEvent as MouseEvent | undefined)?.button !== 0) return
        e.domEvent?.preventDefault?.()
        beginRouteDrag(sectionIndex, e.latLng)
      })
      target.addListener('contextmenu', (e: google.maps.MapMouseEvent) => {
        openContextMenuRef.current(e)
      })
      routeObjsRef.current.push({ casing, spine, target })
    })
    restyleRoute()

    // The badge rides the first section past the route's midpoint, which on a
    // one-section route is simply the middle of the line.
    const all = sections.flat()

    // Cache the decoded route path + per-vertex cumulative distances (metres
    // from the start) for the hover-distance readout. Rebuilt on every redraw
    // so it always matches the drawn line; null when there's no usable route,
    // which keeps the readout hidden. Hover is a proximity affordance, not
    // geometry storage: a thinned path keeps the per-move scan bounded on long
    // routes.
    if (all.length >= 2) {
      const hoverPath = thinPath(all, 1200)
      const cum = new Array<number>(hoverPath.length)
      cum[0] = 0
      for (let i = 1; i < hoverPath.length; i++) {
        cum[i] = cum[i - 1] + haversineMeters(hoverPath[i - 1], hoverPath[i])
      }
      hoverGeomRef.current = { path: hoverPath, cum }
    } else {
      hoverGeomRef.current = null
    }
    const mid = pointAlong(all, 0.5)
    const badgeEl = badgeElRef.current
    if (badgeEl) {
      const show = mid ? renderRouteBadge(badgeEl, routeDistanceLabel) : false
      badgeRef.current?.setPosition(show ? mid : null)
    }

    // A hand edit — dragging a waypoint or the line itself — is the one case
    // where neither the camera nor the sweep may run: the driver of that
    // gesture is looking at a specific junction, a re-fit would take it away,
    // and the preview already drew them the line they are about to get.
    const isHandEdit = Date.now() - lastInteractiveDragAtRef.current < 1_500
    // A view handed across an engine swap wins over the first fit: the route
    // on screen is the one the user was already looking at.
    const keepHandedOffView = handoffPendingRef.current && routeChanged
    if (keepHandedOffView) handoffPendingRef.current = false

    // Auto-fit on a STRUCTURAL route change only, as HereMap does: a redraw of
    // the same geometry (a hover, a marker moved back) must not yank the view.
    if (routeChanged && !keepHandedOffView && all.length >= 2 && !isHandEdit) {
      const bounds = new g.maps.LatLngBounds()
      for (const p of all) bounds.extend(p)
      const fit = () => {
        const W = containerRef.current?.clientWidth ?? 0
        const inset = panelInsetRef.current
        map.fitBounds(bounds, {
          top: 48,
          bottom: 48,
          right: 48,
          // Keep the route clear of the panel that overlaps the left edge.
          left: inset > 0 && inset < W ? inset + 32 : 48,
        })
        // Don't sit too close on short hops.
        g.maps.event.addListenerOnce(map, 'idle', () => {
          const z = map.getZoom()
          if (typeof z === 'number' && z > 16) map.setZoom(16)
        })
      }
      // A map that has not drawn yet (a background tab, a pane hidden while
      // the route arrived) has no projection, and fitBounds on it is a
      // silent no-op. Its first idle is the earliest it can be fitted.
      if (map.getBounds()) fit()
      else g.maps.event.addListenerOnce(map, 'idle', fit)
    }

    // Sweep the line on, after the camera has been sent to its frame so the
    // stroke widths are chosen for the zoom the user will actually see. Fires
    // for a CHANGED route as well as a new one — editing stops is exactly when
    // you want to watch where the route now goes — but never after a drag.
    const revealing =
      routeChanged && all.length >= 2 && !isHandEdit && !keepHandedOffView && routeMotionAllowed()
    if (revealing && startReveal(all)) return
    if (revealInFlight) {
      showRouteStrokes(false)
      return
    }
    showRouteStrokes(true)
    badgeEl?.classList.remove('is-waiting')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMap, routePolylines, routeDistanceLabel])

  // Re-read the width rule when the prop flips; the zoom listener does the rest.
  useEffect(() => {
    if (liveMap) restyleRoute()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMap, scaleRouteWidthWithZoom])

  // ── Drag preview ───────────────────────────────────────────────────────────
  // The provisional route during a drag: dashed, in the spine colour, above
  // the real line. Google draws dashes as a repeated stroke symbol over an
  // invisible polyline.
  useEffect(() => {
    const g = gRef.current
    const map = liveMap
    if (!g || !map) return
    for (const p of previewObjsRef.current) p.setMap(null)
    previewObjsRef.current = []
    if (!previewPolylines?.length) return
    previewObjsRef.current = previewPolylines.map(
      (encoded) =>
        new g.maps.Polyline({
          map,
          path: decodeSection(encoded),
          strokeOpacity: 0,
          icons: [
            {
              icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, strokeColor: ROUTE_SPINE, scale: 3 },
              offset: '0',
              repeat: '12px',
            },
          ],
          clickable: false,
          zIndex: 15,
        }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMap, previewPolylines])

  // The matched point moves the ghost onto the road the router chose.
  useEffect(() => {
    lastPreviewPointRef.current = previewPoint ?? null
    const drag = routeDragRef.current
    if (!drag.active || !drag.ghost) return
    if (previewPoint) {
      drag.snapped = true
      drag.ghost.setPosition(previewPoint)
    } else {
      drag.snapped = false
    }
  }, [previewPoint])

  // ── Waypoint markers ───────────────────────────────────────────────────────
  useEffect(() => {
    const g = gRef.current
    const map = liveMap
    if (!g || !map) return
    for (const m of markerObjsRef.current) m.setMap(null)
    // No entrance on the marks (user, 2026-09-11): a stop simply IS where it
    // was put. The route's own reveal is the one animation on this layer.
    markerObjsRef.current = markers.map((marker) => {
      const m = new g.maps.Marker({
        map,
        position: marker.position,
        icon: markerIcon(g, marker),
        draggable: objectsDraggable,
        optimized: false,
        zIndex: marker.kind === 'stop' ? 20 : 21,
        title: marker.label,
      })
      m.addListener('click', () => {
        const p = m.getPosition()
        if (!p) return
        const px = screenAdapter().geoToScreen({ lat: p.lat(), lng: p.lng() })
        if (px) cb.current.onMarkerClick?.({ id: marker.id, kind: marker.kind, x: px.x, y: px.y })
      })
      m.addListener('dragstart', () => cb.current.onMapViewChange?.())
      m.addListener('drag', () => {
        const p = m.getPosition()
        if (!p) return
        cb.current.onMarkerDrag?.(marker.id, { lat: p.lat(), lng: p.lng() }, map.getZoom() ?? DEFAULT_ZOOM)
      })
      m.addListener('dragend', () => {
        const p = m.getPosition()
        if (!p) return
        // Sample around where the MARKER now sits, which is what the user
        // aimed at, not around the pointer's offset grab point.
        const px = screenAdapter().geoToScreen({ lat: p.lat(), lng: p.lng() })
        if (!px) return
        const zoom = map.getZoom() ?? DEFAULT_ZOOM
        const candidates = candidatesAt(px.x, px.y)
        if (snapDebug())
          // eslint-disable-next-line no-console
          console.log('[routeSnap] google marker drag release', { id: marker.id, pixel: px, zoom })
        lastInteractiveDragAtRef.current = Date.now()
        if (candidates.length) cb.current.onMarkerDragEnd?.(marker.id, candidates, zoom)
      })
      return m
    })

    // ── Frame a new address ──────────────────────────────────────────────
    // With a route on the map the route decides the frame (the route effect).
    // Without one, an address that was just entered is the only thing to look
    // at, and the map goes to it (user, 2026-09-11: "sa iti faca zoom direct
    // in zona unde se afla adresa"): a single mark is framed by the place's
    // own extent — the block for a building, the length of a street, the
    // outline of a town — and several marks by the box round all of them.
    // Only when the SET of marks changes (an id added or removed): a mark
    // moving, or being re-created by a snap, must not move the camera, and
    // neither must anything within 1.5 s of a hand edit.
    const ids = markers.map((m) => m.id).join('|')
    const setChanged = ids !== drawnMarkerIdsRef.current
    drawnMarkerIdsRef.current = ids
    const isHandEdit = Date.now() - lastInteractiveDragAtRef.current < 1_500
    if (setChanged && markers.length > 0 && routePolylines.length === 0 && !isHandEdit) {
      if (handoffPendingRef.current) {
        // The other engine's view wins over this first frame too.
        handoffPendingRef.current = false
      } else {
        const W = containerRef.current?.clientWidth ?? 0
        const inset = panelInsetRef.current
        const padding = { top: 64, bottom: 64, right: 64, left: inset > 0 && inset < W ? inset + 48 : 64 }
        const frame = () => {
          if (markers.length === 1) {
            const only = markers[0]
            if (only.viewport) {
              map.fitBounds(only.viewport, padding)
              // A building's viewport is a few metres across and fitBounds
              // would run to the last zoom level; a street needs its number
              // readable, not its rooftop.
              g.maps.event.addListenerOnce(map, 'idle', () => {
                const z = map.getZoom()
                if (typeof z === 'number' && z > 17) map.setZoom(17)
              })
            } else {
              // A coordinate or a map-placed point: no extent to frame, so a
              // street-level look at it.
              map.panTo(only.position)
              if ((map.getZoom() ?? 0) < 15) map.setZoom(15)
            }
          } else {
            const bounds = new g.maps.LatLngBounds()
            for (const m of markers) bounds.extend(m.position)
            map.fitBounds(bounds, padding)
            g.maps.event.addListenerOnce(map, 'idle', () => {
              const z = map.getZoom()
              if (typeof z === 'number' && z > 16) map.setZoom(16)
            })
          }
        }
        // No projection yet (a tab that has not drawn) → fitBounds is a
        // silent no-op; the first idle is the earliest it can be done.
        if (map.getBounds()) frame()
        else g.maps.event.addListenerOnce(map, 'idle', frame)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMap, markers, objectsDraggable])

  // ── Saved places ───────────────────────────────────────────────────────────
  useEffect(() => {
    const g = gRef.current
    const map = liveMap
    if (!g || !map) return
    for (const m of placeObjsRef.current) m.setMap(null)
    placeObjsRef.current = (savedPlaces ?? []).map((place) => {
      const m = new g.maps.Marker({
        map,
        position: { lat: place.latitude, lng: place.longitude },
        icon: {
          url: svgUrl(savedPlaceSvg(place.category)),
          anchor: new g.maps.Point(9, 9),
          scaledSize: new g.maps.Size(18, 18),
        },
        optimized: false,
        zIndex: 15,
        title: place.name,
      })
      m.addListener('click', () => {
        const px = screenAdapter().geoToScreen({ lat: place.latitude, lng: place.longitude })
        if (px) cb.current.onSavedPlaceClick?.({ id: place.id, x: px.x, y: px.y })
      })
      return m
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMap, savedPlaces])

  // ── Live drivers ───────────────────────────────────────────────────────────
  useEffect(() => {
    const g = gRef.current
    const map = liveMap
    if (!g || !map) return
    for (const m of driverObjsRef.current) m.setMap(null)
    driverObjsRef.current = (driverMarkers ?? []).map(
      (d) =>
        new g.maps.Marker({
          map,
          position: d.position,
          icon: {
            url: svgUrl(driverSvg(d.headingDeg, d.stale)),
            anchor: new g.maps.Point(12, 12),
            scaledSize: new g.maps.Size(24, 24),
          },
          optimized: false,
          zIndex: 30,
          title: d.detail ? `${d.name} · ${d.detail}` : d.name,
        }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMap, driverMarkers])

  useEffect(() => {
    const g = gRef.current
    const map = liveMap
    if (!g || !map) return
    for (const t of trailObjsRef.current) t.setMap(null)
    trailObjsRef.current = []
    for (const trail of driverTrails ?? []) {
      for (const segment of trail.segments) {
        if (segment.length < 2) continue
        trailObjsRef.current.push(
          new g.maps.Polyline({
            map,
            path: segment,
            strokeOpacity: 0,
            clickable: false,
            zIndex: 13,
            // Dashed: a contrasting stroke that reads as "driven" over the
            // planned spine rather than as a second route.
            icons: [
              {
                icon: {
                  path: 'M 0,-1 0,1',
                  strokeOpacity: trail.stale ? 0.45 : 0.95,
                  strokeColor: '#00b8a9',
                  strokeWeight: 4,
                  scale: 1,
                },
                offset: '0',
                repeat: '10px',
              },
            ],
          }),
        )
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMap, driverTrails])

  // ── HGV restriction layer ──────────────────────────────────────────────────
  useEffect(() => {
    const g = gRef.current
    const map = liveMap
    if (!g || !map) return
    if (truckOverlay) {
      hgvOverlayRef.current ??= createHgvOverlay(g)
      map.overlayMapTypes.push(hgvOverlayRef.current)
    }
    return () => {
      const overlay = hgvOverlayRef.current
      if (!overlay) return
      const types = map.overlayMapTypes
      for (let i = types.getLength() - 1; i >= 0; i--) {
        if (types.getAt(i) === overlay) types.removeAt(i)
      }
    }
  }, [liveMap, truckOverlay])

  // ── External recenter ──────────────────────────────────────────────────────
  useEffect(() => {
    const map = liveMap
    if (!map || !center) return
    map.panTo(center)
    const z = map.getZoom() ?? DEFAULT_ZOOM
    if (z < 14) map.setZoom(14)
  }, [liveMap, center])

  return (
    <div ref={rootRef} className={['google-map-root', className].filter(Boolean).join(' ')}>
      <div ref={containerRef} className="google-map-surface absolute inset-0" />
      <div ref={controlsHostRef} className="here-map-controls-host" aria-label="Map controls" />
      {status !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg text-sm text-muted">
          {status === 'error' ? (
            <div className="max-w-[24rem] px-6 text-center">
              <div className="font-medium text-text">The Google map could not be loaded.</div>
              <div className="mt-1 text-xs text-faint">
                {errorText?.includes('VITE_GOOGLE_MAPS_KEY')
                  ? 'Add VITE_GOOGLE_MAPS_KEY to web/.env.local and restart the dev server.'
                  : errorText}
              </div>
            </div>
          ) : (
            'Loading map…'
          )}
        </div>
      )}
    </div>
  )
}
