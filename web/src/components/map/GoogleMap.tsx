import { useEffect, useRef, useState } from 'react'
import { decode } from '@here/flexpolyline'
import { loadGoogle } from '../../lib/google/loadGoogle'
import type { LatLng, RouteMarker, ScreenGeoCandidate } from '../../lib/here/types'
import {
  ROUTE_HALO,
  ROUTE_SPINE,
  destSvg,
  ghostSvg,
  originSvg,
  routeStrokeWidths,
  savedPlaceSvg,
  stopSvg,
} from '../here/hereMapIcons'
import { DEFAULT_CENTER, DEFAULT_ZOOM, sampleScreenCandidates, snapDebug } from '../here/hereMapUtils'
import type { MapSurfaceProps } from './mapProps'

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
// Nothing here calls Google for data. Google's terms forbid showing THEIR data
// (Places, Directions, Geocoding) on a non-Google map; the reverse — a third
// party's route on their map — is ordinary use. Keeping this engine draw-only
// is what keeps that line clean.
//
// The route line, the numbered marks, the saved-place squares and the ghost
// dot are the SAME SVGs HereMap draws (hereMapIcons.ts). Toggling the basemap
// must not appear to change what was planned.

const LIGHT_LABEL_STYLE = 'font-family: Inter, system-ui, sans-serif'

function svgUrl(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

function markerIcon(g: typeof google, marker: RouteMarker): google.maps.Icon {
  if (marker.kind === 'origin') {
    return { url: svgUrl(originSvg()), anchor: new g.maps.Point(10, 10), scaledSize: new g.maps.Size(20, 20) }
  }
  if (marker.kind === 'destination') {
    return { url: svgUrl(destSvg()), anchor: new g.maps.Point(10, 10), scaledSize: new g.maps.Size(20, 20) }
  }
  return {
    url: svgUrl(stopSvg(marker.label ?? '')),
    anchor: new g.maps.Point(9, 9),
    scaledSize: new g.maps.Size(18, 18),
  }
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
}: MapSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null)
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
  const routeObjsRef = useRef<{ casing: google.maps.Polyline; spine: google.maps.Polyline; target: google.maps.Polyline }[]>([])
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
  const lastFitSigRef = useRef<string>('')
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
          // The planner's own overlay controls sit top-right; Google's live
          // bottom-right where HERE's style/zoom controls were, so the two
          // engines keep their chrome in the same corner.
          mapTypeControl: true,
          mapTypeControlOptions: {
            position: g.maps.ControlPosition.RIGHT_BOTTOM,
            style: g.maps.MapTypeControlStyle.DROPDOWN_MENU,
          },
          zoomControl: true,
          zoomControlOptions: { position: g.maps.ControlPosition.RIGHT_BOTTOM },
          streetViewControl: true,
          streetViewControlOptions: { position: g.maps.ControlPosition.RIGHT_BOTTOM },
          fullscreenControl: false,
          // Scroll zooms without a modifier, as HERE's map does and as a
          // full-pane map should; the ctrl-to-zoom nag is for embeds.
          gestureHandling: 'greedy',
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
          }
        }

        const Overlay = makeOverlayClass(g)
        const projection = new Overlay(null)
        projection.setMap(map)
        projectionRef.current = projection

        // The distance badge: DOM on the float pane, same look as HERE's.
        const badgeEl = document.createElement('div')
        badgeEl.className = 'google-map-badge'
        badgeEl.style.cssText = `position:absolute;transform:translate(-50%,-50%);pointer-events:none;${LIGHT_LABEL_STYLE}`
        badgeElRef.current = badgeEl
        const badge = new Overlay(badgeEl)
        badge.setMap(map)
        badgeRef.current = badge

        // ── Map-level gestures ──────────────────────────────────────────────
        map.addListener('contextmenu', (e: google.maps.MapMouseEvent) => {
          const px = containerPx(e.domEvent)
          const ll = e.latLng
          if (!px || !ll) return
          e.domEvent?.preventDefault?.()
          cb.current.onMapContextMenu?.({
            lat: ll.lat(),
            lng: ll.lng(),
            x: px.x,
            y: px.y,
            zoom: map.getZoom() ?? DEFAULT_ZOOM,
            candidates: candidatesAt(px.x, px.y),
          })
        })
        map.addListener('dragstart', () => cb.current.onMapViewChange?.())
        map.addListener('zoom_changed', () => {
          cb.current.onMapViewChange?.()
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

        // The HGV toggle stays enabled on this engine: pressing it is what
        // switches to the map that can draw the overlay (MapView).
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
    // A fresh map has to fit the route again, whatever the last one showed.
    lastFitSigRef.current = ''
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
  function restyleRoute() {
    const g = gRef.current
    const map = mapRef.current
    if (!g || !map) return
    const zoom = map.getZoom() ?? DEFAULT_ZOOM
    const w = scaleWidthRef.current ? routeStrokeWidths(zoom) : { main: 7, casing: 11, arrow: 4.5, arrowsVisible: true }
    for (const r of routeObjsRef.current) {
      r.casing.setOptions({ strokeWeight: w.casing })
      r.spine.setOptions({
        strokeWeight: w.main,
        // Direction, as repeated open arrows stencilled along the spine — the
        // native equivalent of HERE's dash-image arrows. Hidden at overview
        // zooms for the same reason HERE hides them: on a thread crossing
        // countries they are noise.
        icons: w.arrowsVisible
          ? [
              {
                icon: {
                  path: g.maps.SymbolPath.FORWARD_OPEN_ARROW,
                  scale: Math.max(1.6, w.arrow * 0.55),
                  strokeColor: ROUTE_HALO,
                  strokeWeight: 1.6,
                  strokeOpacity: 0.95,
                },
                offset: '30px',
                repeat: '64px',
              },
            ]
          : [],
      })
    }
  }

  useEffect(() => {
    const g = gRef.current
    const map = liveMap
    if (!g || !map) return
    for (const r of routeObjsRef.current) {
      r.casing.setMap(null)
      r.spine.setMap(null)
      r.target.setMap(null)
    }
    routeObjsRef.current = []

    const sections = routePolylines.map(decodeSection).filter((s) => s.length >= 2)
    sections.forEach((path, sectionIndex) => {
      const casing = new g.maps.Polyline({
        map,
        path,
        strokeColor: ROUTE_HALO,
        strokeOpacity: 1,
        strokeWeight: 11,
        clickable: false,
        zIndex: 10,
      })
      const spine = new g.maps.Polyline({
        map,
        path,
        strokeColor: ROUTE_SPINE,
        strokeOpacity: 1,
        strokeWeight: 7,
        clickable: false,
        zIndex: 11,
      })
      // The grab handle: a wide, invisible copy of the section. Wide so the
      // line is comfortable to catch; invisible so it adds nothing to the
      // drawing. Its mousedown is the whole drag-to-add-stop gesture's start.
      const target = new g.maps.Polyline({
        map,
        path,
        strokeColor: '#ffffff',
        strokeOpacity: 0.001,
        strokeWeight: 16,
        clickable: true,
        zIndex: 12,
      })
      target.addListener('mousedown', (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return
        e.domEvent?.preventDefault?.()
        beginRouteDrag(sectionIndex, e.latLng)
      })
      routeObjsRef.current.push({ casing, spine, target })
    })
    restyleRoute()

    // The badge rides the first section past the route's midpoint, which on a
    // one-section route is simply the middle of the line.
    const all = sections.flat()
    const mid = pointAlong(all, 0.5)
    const badgeEl = badgeElRef.current
    if (badgeEl) {
      if (routeDistanceLabel && mid) {
        badgeEl.innerHTML = `<span style="display:inline-block;padding:3px 8px;border-radius:6px;background:${ROUTE_SPINE};color:${ROUTE_HALO};font-size:12px;font-weight:600;letter-spacing:0;box-shadow:0 1px 4px rgba(0,0,0,.35);white-space:nowrap">${routeDistanceLabel}</span>`
        badgeRef.current?.setPosition(mid)
      } else {
        badgeRef.current?.setPosition(null)
      }
    }

    // Auto-fit on a STRUCTURAL route change only, as HereMap does: a redraw of
    // the same geometry (a hover, a marker moved back) must not yank the view.
    const sig = routeSignature(routePolylines)
    if (sig !== lastFitSigRef.current) {
      lastFitSigRef.current = sig
      const isHandEdit = Date.now() - lastInteractiveDragAtRef.current < 1_500
      if (handoffPendingRef.current) {
        handoffPendingRef.current = false
      } else if (all.length >= 2 && !isHandEdit) {
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
    }
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

  // ── External recenter ──────────────────────────────────────────────────────
  useEffect(() => {
    const map = liveMap
    if (!map || !center) return
    map.panTo(center)
    const z = map.getZoom() ?? DEFAULT_ZOOM
    if (z < 14) map.setZoom(14)
  }, [liveMap, center])

  return (
    <div className={['google-map-root', className].filter(Boolean).join(' ')}>
      <div ref={containerRef} className="google-map-surface absolute inset-0" />
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
