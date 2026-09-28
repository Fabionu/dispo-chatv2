import { useEffect, useRef, useState } from 'react'
import { decode } from '@here/flexpolyline'
import { loadGoogle } from '../../lib/google/loadGoogle'
import { haversineMeters, nearestPointOnPath, simplifyPath, simplifyPathKeep } from '../../lib/here/geo'
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

// How far the real route steps back while a drag preview is drawn over it:
// still there to compare against, never competing with the line being pulled.
const ROUTE_DIM_OPACITY = 0.28

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

// ── Route level of detail ───────────────────────────────────────────────────
// Google re-projects every vertex of every polyline on every frame of a zoom
// animation. A HERE route is dense — a vertex every ~90 m, 11k of them on a
// 1000 km run — drawn three times (casing, spine, grab target), and that is
// what made zooming on a route stutter, worse the further in (user,
// 2026-09-17: "sacadeaza in frame-uri cu cat dau mai mult zoom in"); with the
// strokes hidden the same zoom ran at 60 fps. So the strokes are drawn from a
// path fitted to the zoom: Douglas–Peucker at LOD_NEAR_PX of a pixel — a
// deviation nobody can see — near the viewport, and at LOD_FAR_M away from
// it, where the line is off screen anyway. Rebuilt on `idle` when the zoom
// band changes or the view leaves the window the last build was made for;
// the window is the viewport plus a viewport on every side, so ordinary pans
// rebuild nothing and the coarse part is never in view before an idle.
const LOD_NEAR_PX = 0.35
const LOD_FAR_M = 300

// Ctrl + wheel zooms a whole level per tick (see onWheel in the mount
// effect), clamped to what the basemap can show.
const CTRL_WHEEL_ZOOM_STEP = 1
const CTRL_WHEEL_MIN_ZOOM = 2
const CTRL_WHEEL_MAX_ZOOM = 21
// Wheel delta that counts as one notch (Chrome reports 100 per notch).
const WHEEL_TICK = 100
type LodWindow = { s: number; n: number; w: number; e: number }
type LodState = { band: number; win: LodWindow }

function metersPerPixel(zoom: number, lat: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
}

/** The display path for one section: fine inside `win`, coarse outside, the
 *  two joined at the vertices where the path crosses the window's edge. */
function lodPath(full: LatLng[], win: LodWindow | null, nearM: number): LatLng[] {
  if (full.length <= 2) return full
  const fine = simplifyPathKeep(full, nearM)
  if (!win) return full.filter((_, i) => fine[i] === 1)
  const coarse = simplifyPathKeep(full, Math.max(nearM, LOD_FAR_M))
  const inside = (p: LatLng) => p.lat >= win.s && p.lat <= win.n && p.lng >= win.w && p.lng <= win.e
  const out: LatLng[] = []
  let prevIn = inside(full[0])
  for (let i = 0; i < full.length; i++) {
    const p = full[i]
    const nowIn = inside(p)
    const nextIn = i + 1 < full.length ? inside(full[i + 1]) : nowIn
    // Keep the vertex that touches a crossing on either side, so the fine and
    // coarse stretches meet on the route rather than on a chord across it.
    const keep = nowIn ? fine[i] === 1 : coarse[i] === 1 || prevIn !== nowIn || nextIn !== nowIn
    if (keep) out.push(p)
    prevIn = nowIn
  }
  return out
}

// The route as the badge placer sees it: Douglas–Peucker only, with the
// tolerance doubled until the path fits the budget. thinPath's every-Nth
// fallback is fine for a hover readout but not for a clearance test — the
// chords it draws between kept vertices cut a motorway's bends by several
// pixels at mid zooms, and the placer then called a spot clean that the
// drawn line ran through (2026-09-16). Shape-preserving at every budget.
function simplifyToBudget(path: LatLng[], maxPoints: number): LatLng[] {
  let tolerance = 30
  let out = simplifyPath(path, tolerance)
  while (out.length > maxPoints && tolerance < 5000) {
    tolerance *= 2
    out = simplifyPath(path, tolerance)
  }
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
type OverlayPlacer = (
  el: HTMLElement,
  anchor: LatLng,
  px: { x: number; y: number },
  proj: google.maps.MapCanvasProjection,
) => void
type OverlayCtor = new (content: HTMLElement | null) => google.maps.OverlayView & {
  setPosition(p: LatLng | null): void
  /** Runs after each draw, once the content sits on its anchor: the badge's
   *  chance to pick which side of the anchor to hang on (placeBadge). */
  placer: OverlayPlacer | null
}

function makeOverlayClass(g: typeof google): OverlayCtor {
  class DispoOverlay extends g.maps.OverlayView {
    private content: HTMLElement | null
    private position: LatLng | null = null
    placer: OverlayPlacer | null = null
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
      this.placer?.(this.content, this.position, px, proj)
    }
  }
  return DispoOverlay as unknown as OverlayCtor
}

// ── Badge placement ─────────────────────────────────────────────────────────
// The distance badge hangs off the route, and it used to hang ABOVE the
// midpoint, always — which put it squarely over the line wherever the route
// ran north–south or curved back under it (user, 2026-09-15: "sa nu se
// afiseze peste ruta"). Trying the four sides of the midpoint was not enough
// either: a midpoint in a bend has the route on every side of it, and the
// "least bad" side still covered the line (user, 2026-09-16: "I don't want
// the banner to block the route view"). So the badge may also SLIDE along the
// route: the candidates are a few anchors stepping outward from the middle
// (BADGE_ANCHOR_FRACTIONS), each with its four sides, and the first
// combination the route does not cross at all wins — the tail always on the
// line, the card never over it. And it may STAND OFF the line: at mid zooms
// a motorway undulates by more than the 9px gap within the card's width, so
// every hugging candidate is crossed somewhere; the search then repeats with
// the gap doubled and tripled (BADGE_GAP_STEPS), and a thin leader runs from
// the tail down to the anchor to keep the badge readable as the line's
// label. Only when no candidate at any gap is clean does it fall back to the
// fewest crossings.
//
// Decided in SCREEN space, because "beside the line" is a fact about pixels:
// a bend that clears the badge at country zoom runs straight through it two
// zoom levels in. Decided only on SETTLED state — the map's `idle`, and a
// route change — never inside a zoom animation: mid-animation Google's
// projection and getZoom() disagree for a frame, and a choice made on that
// frame (then trusted) is how a "clean" badge ended up on the line. Between
// decisions draw() only re-applies the last choice, so a pan costs one
// projection. A choice that is still clean is kept over an equally clean
// earlier candidate, so a zoom does not walk the badge up and down the
// route; and anchors on screen are tried before ones off it, because a
// label nobody can see has cleared nothing.
//
// Cost per decision: one projection of the badge path (≤2500 points, see
// simplifyToBudget) plus a bounding-box-gated Liang–Barsky per segment per
// candidate rectangle.
type BadgePlacement = 'above' | 'below' | 'right' | 'left'
const BADGE_PLACEMENTS: BadgePlacement[] = ['above', 'below', 'right', 'left']
// Where along the route the badge may sit, as fractions of its length: the
// middle first, then alternating outward. Tried in this order, so the badge
// stays as central as a clean spot allows.
const BADGE_ANCHOR_FRACTIONS = [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7, 0.25, 0.75]
// Multiples of the base gap the badge may stand off the line, tried in this
// order: hugging first (no leader), then further out with a leader.
const BADGE_GAP_STEPS = [1, 2, 3]
// The base gap between anchor and card — mirror index.css
// `.route-distance-badge` (--gap defaults to 0.625rem; placeBadge overrides
// it in px when it chooses a larger step).
const BADGE_GAP_REM = 0.625
// The route has to stay this clear of the card, in px, to count as "not over".
const BADGE_CLEARANCE_PX = 6

type Rect = { x0: number; y0: number; x1: number; y1: number }
type Px = { x: number; y: number }
/** The last decision, so a pan re-applies it and a zoom prefers it. */
type BadgeChoice = { anchor: number; placement: BadgePlacement; gap: number; zoom: number; sig: string }

function badgeRect(placement: BadgePlacement, ax: number, ay: number, w: number, h: number, gap: number): Rect {
  const m = BADGE_CLEARANCE_PX
  switch (placement) {
    case 'above':
      return { x0: ax - w / 2 - m, x1: ax + w / 2 + m, y0: ay - gap - h - m, y1: ay - gap + m }
    case 'below':
      return { x0: ax - w / 2 - m, x1: ax + w / 2 + m, y0: ay + gap - m, y1: ay + gap + h + m }
    case 'right':
      return { x0: ax + gap - m, x1: ax + gap + w + m, y0: ay - h / 2 - m, y1: ay + h / 2 + m }
    case 'left':
      return { x0: ax - gap - w - m, x1: ax - gap + m, y0: ay - h / 2 - m, y1: ay + h / 2 + m }
  }
}

// Liang–Barsky: does the segment a→b cross the rectangle at all (a segment
// with no vertex inside still counts — the thinned path has long straights).
function segmentHitsRect(ax: number, ay: number, bx: number, by: number, r: Rect): boolean {
  // Cheap reject first: a segment whose bounding box misses the rectangle
  // cannot cross it, and nearly every segment of a long route misses.
  if (Math.max(ax, bx) < r.x0 || Math.min(ax, bx) > r.x1 || Math.max(ay, by) < r.y0 || Math.min(ay, by) > r.y1) {
    return false
  }
  const dx = bx - ax
  const dy = by - ay
  let t0 = 0
  let t1 = 1
  const edges: Array<[number, number]> = [
    [-dx, ax - r.x0],
    [dx, r.x1 - ax],
    [-dy, ay - r.y0],
    [dy, r.y1 - ay],
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    const t = q / p
    if (p < 0) {
      if (t > t1) return false
      if (t > t0) t0 = t
    } else {
      if (t < t0) return false
      if (t < t1) t1 = t
    }
  }
  return true
}

function crossings(pts: Px[], r: Rect): number {
  let n = 0
  for (let i = 1; i < pts.length; i++) {
    if (segmentHitsRect(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, r)) n++
  }
  return n
}

/**
 * Place the badge: pick an anchor along the route and a side of it, then
 * put the element there. `anchors` are the candidate points in preference
 * order (`anchors[0]` is the overlay's own position, the midpoint); `path` is
 * the route (simplifyToBudget); `sig` identifies the route so a new one
 * starts the search afresh. A full decision runs only when `decide` is set
 * (the map went idle, or the route changed) — every other draw re-applies
 * the last choice. Writes `data-placement` (index.css turns it into the
 * transform and the tail), `--gap`, and the element's left/top, and
 * remembers the choice in `memo`.
 */
function placeBadge(
  g: typeof google,
  el: HTMLElement,
  map: google.maps.Map,
  proj: google.maps.MapCanvasProjection,
  anchors: LatLng[],
  path: LatLng[] | null,
  sig: string,
  memo: { current: BadgeChoice | null },
  decide: { current: boolean },
) {
  // The card's own box; the tail is a pointer and is meant to touch the
  // line, so it is not part of what must stay clear.
  const w = el.offsetWidth
  const h = el.offsetHeight
  if (!w || !h || anchors.length === 0) return
  const zoom = map.getZoom() ?? 0
  const toPx = (p: LatLng): Px | null => {
    const q = proj.fromLatLngToDivPixel(new g.maps.LatLng(p.lat, p.lng))
    return q ? { x: q.x, y: q.y } : null
  }
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const baseGap = BADGE_GAP_REM * rem
  const apply = (choice: BadgeChoice) => {
    const at = toPx(anchors[choice.anchor] ?? anchors[0])
    if (!at) return
    el.style.left = `${at.x}px`
    el.style.top = `${at.y}px`
    el.style.setProperty('--gap', `${baseGap * choice.gap}px`)
    if (el.dataset.placement !== choice.placement) el.dataset.placement = choice.placement
    memo.current = choice
  }

  // Not a decision point (a pan, a frame of a zoom animation): re-apply the
  // last choice for this route and go.
  const last = memo.current
  const mustDecide = decide.current
  decide.current = false
  if (!mustDecide && last && last.sig === sig && last.anchor < anchors.length) {
    apply(last)
    return
  }

  // Anchors on screen first, in their own (centre-out) order; the rest after.
  // The card must fit too, so the visible box is inset by its size.
  const div = map.getDiv()
  const vis = { w: div.clientWidth, h: div.clientHeight }
  const onScreen = (p: LatLng): boolean => {
    const q = proj.fromLatLngToContainerPixel(new g.maps.LatLng(p.lat, p.lng))
    return Boolean(q) && q!.x >= w / 2 && q!.x <= vis.w - w / 2 && q!.y >= h && q!.y <= vis.h - h
  }
  const order: number[] = []
  for (let a = 0; a < anchors.length; a++) if (onScreen(anchors[a])) order.push(a)
  for (let a = 0; a < anchors.length; a++) if (!onScreen(anchors[a])) order.push(a)

  const pts: Px[] = []
  if (path) {
    for (const p of path) {
      const q = toPx(p)
      if (q) pts.push(q)
    }
  }
  const hitsFor = (anchor: number, placement: BadgePlacement, gap: number): number => {
    const at = toPx(anchors[anchor])
    if (!at) return Number.POSITIVE_INFINITY
    return pts.length >= 2 ? crossings(pts, badgeRect(placement, at.x, at.y, w, h, baseGap * gap)) : 0
  }

  // The previous choice first, if it is still clean and still on screen: a
  // zoom step must not move a badge that was fine where it was.
  if (
    last &&
    last.sig === sig &&
    last.anchor < anchors.length &&
    onScreen(anchors[last.anchor]) &&
    hitsFor(last.anchor, last.placement, last.gap) === 0
  ) {
    apply({ ...last, zoom })
    return
  }

  // Gap-major: every anchor and side is tried hugging the line before any
  // stands off it — a badge a little off-centre on the line beats one dead
  // centre on a leader.
  let best: BadgeChoice | null = null
  let bestHits = Number.POSITIVE_INFINITY
  search: for (const gap of BADGE_GAP_STEPS) {
    for (const a of order) {
      for (const placement of BADGE_PLACEMENTS) {
        const n = hitsFor(a, placement, gap)
        if (n < bestHits) {
          bestHits = n
          best = { anchor: a, placement, gap, zoom, sig }
          if (n === 0) break search
        }
      }
    }
  }
  if (best) apply(best)
}

export default function GoogleMap({
  markers,
  driverMarkers,
  driverTrails,
  savedPlaces,
  routePolylines,
  scaleRouteWidthWithZoom = false,
  routeDistanceLabel,
  routeTimeLabel,
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
  // Where the badge may sit: candidate points along the route in preference
  // order (the midpoint first), and the placement last chosen — see placeBadge.
  const badgeAnchorsRef = useRef<LatLng[]>([])
  // The route the placer tests against — shape-preserving, see simplifyToBudget.
  const badgePathRef = useRef<LatLng[] | null>(null)
  // Route level of detail (see lodPath): the full decoded sections, and the
  // zoom band + window the drawn strokes were last built for.
  const routeFullRef = useRef<LatLng[][]>([])
  const routeLodRef = useRef<LodState | null>(null)
  const badgeChoiceRef = useRef<BadgeChoice | null>(null)
  // Set when the badge must be re-decided (map idle, route change); the next
  // draw runs the full search instead of re-applying the last choice.
  const badgeDecideRef = useRef(true)
  const routeDragRef = useRef<{
    active: boolean
    section: number
    // The handle under the cursor. It trails the cursor for the WHOLE
    // gesture — see the mousemove listener for why it no longer parks on the
    // router's matched point.
    ghost: google.maps.Marker | null
  }>({ active: false, section: -1, ghost: null })
  const previewObjsRef = useRef<google.maps.Polyline[]>([])
  const lastPreviewPointRef = useRef<LatLng | null>(null)
  // True while a drag preview is drawn: the real route steps back (dimmed,
  // arrows off) so the provisional line is the one being read. restyleRoute
  // consults it, because a wheel-zoom mid-drag re-styles the strokes.
  const routeDimmedRef = useRef(false)
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
            // The badge placer's inputs and last decision (placeBadge).
            badge: () => ({ choice: badgeChoiceRef.current, anchors: badgeAnchorsRef.current, path: badgePathRef.current }),
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
        // ── Ctrl + wheel: the fast zoom ──────────────────────────────────
        // A plain wheel tick is Google's fractional step (about a fifth of a
        // level). With Ctrl held it is a whole level per tick, in one jump,
        // around the point under the cursor (user, 2026-09-17: "sa dea mai
        // mult scroll cu CTRL+scroll"). Capture phase on the container, so
        // the event is taken before Google's own wheel handler on the inner
        // div sees it; preventDefault also keeps the browser from treating
        // Ctrl+wheel as page zoom. moveCamera, not setZoom: an instant move
        // is the point — this is the gesture for covering distance.
        //
        // "Ctrl held" is the PHYSICAL key, tracked from keydown/keyup on the
        // window, not the event's ctrlKey flag: a touchpad pinch arrives as
        // wheel events with ctrlKey set (that is how browsers page-zoom on
        // pinch), and reading the flag turned every pinch into a run of
        // whole-level jumps with no Ctrl anywhere near (user, 2026-09-17:
        // "imi face fara sa tin CTRL apasat"). And one level per WHEEL_TICK
        // of delta, accumulated, rather than per event: a free-spinning or
        // high-resolution wheel reports a notch as several small events.
        let ctrlHeld = false
        let wheelAccum = 0
        let wheelAccumAt = 0
        const onKey = (e: KeyboardEvent) => {
          if (e.key === 'Control') ctrlHeld = e.type === 'keydown'
        }
        const onBlur = () => {
          ctrlHeld = false
        }
        window.addEventListener('keydown', onKey)
        window.addEventListener('keyup', onKey)
        window.addEventListener('blur', onBlur)
        const onWheel = (e: WheelEvent) => {
          if (!ctrlHeld || !e.ctrlKey || e.deltaY === 0) return
          e.preventDefault()
          e.stopPropagation()
          // A notch is ~100 units in Chrome (deltaMode 0); line-mode deltas
          // (Firefox) are a few lines per notch.
          const unit = e.deltaMode === 0 ? e.deltaY : e.deltaY * (WHEEL_TICK / 3)
          const now = performance.now()
          if (now - wheelAccumAt > 300 || Math.sign(unit) !== Math.sign(wheelAccum)) wheelAccum = 0
          wheelAccumAt = now
          wheelAccum += unit
          if (Math.abs(wheelAccum) < WHEEL_TICK) return
          const steps = Math.trunc(wheelAccum / WHEEL_TICK)
          wheelAccum -= steps * WHEEL_TICK
          const zoom = map.getZoom() ?? DEFAULT_ZOOM
          const next = Math.max(CTRL_WHEEL_MIN_ZOOM, Math.min(CTRL_WHEEL_MAX_ZOOM, zoom - steps * CTRL_WHEEL_ZOOM_STEP))
          if (next === zoom) return
          const rect = el.getBoundingClientRect()
          const px = { x: e.clientX - rect.left, y: e.clientY - rect.top }
          const under = screenAdapter().screenToGeo(px.x, px.y)
          const world = map.getProjection()
          if (!under || !world) {
            map.setZoom(next)
            return
          }
          // Keep the point under the cursor where it is: at zoom z a screen
          // offset from the centre is a world offset × 2^z.
          const w = world.fromLatLngToPoint(new g.maps.LatLng(under.lat, under.lng))
          if (!w) {
            map.setZoom(next)
            return
          }
          const scale = 2 ** next
          const centre = world.fromPointToLatLng(
            new g.maps.Point(w.x - (px.x - rect.width / 2) / scale, w.y - (px.y - rect.height / 2) / scale),
          )
          if (!centre) {
            map.setZoom(next)
            return
          }
          map.moveCamera({ center: centre, zoom: next })
        }
        el.addEventListener('wheel', onWheel, { passive: false, capture: true })

        hoverCleanupRef.current = () => {
          if (hoverRaf) cancelAnimationFrame(hoverRaf)
          el.removeEventListener('pointermove', onPointerMove)
          el.removeEventListener('pointerleave', onPointerLeave)
          el.removeEventListener('wheel', onWheel, { capture: true })
          window.removeEventListener('keydown', onKey)
          window.removeEventListener('keyup', onKey)
          window.removeEventListener('blur', onBlur)
          hoverLabel.remove()
          hideHoverRef.current = () => {}
        }

        // The distance badge: DOM on the float pane, the same element (and CSS)
        // HereMap puts in its DomMarker, so the two engines' badges are one.
        const badgeEl = document.createElement('div')
        badgeEl.className = 'route-distance-badge'
        badgeElRef.current = badgeEl
        const badge = new Overlay(badgeEl)
        // Which side of its anchor the badge hangs on: the one the route
        // crosses least, re-decided on every draw (pan, zoom, new route).
        badge.placer = (el, _anchor, _px, proj) =>
          placeBadge(
            g,
            el,
            map,
            proj,
            badgeAnchorsRef.current,
            badgePathRef.current,
            drawnRouteSigRef.current ?? '',
            badgeChoiceRef,
            badgeDecideRef,
          )
        badge.setMap(map)
        // The badge decides where to sit only once the map has settled — see
        // placeBadge for why not during a zoom animation. One frame after
        // `idle`, not in it: at the instant idle fires the overlay's
        // projection can still answer for the previous zoom, and a decision
        // taken on that (then kept) put the card back on the line.
        map.addListener('idle', () => {
          requestAnimationFrame(() => {
            if (badgeRef.current !== badge) return
            // The strokes are re-fitted to the settled view first, then the
            // badge is placed beside them.
            rebuildRouteLod()
            badgeDecideRef.current = true
            badge.draw()
          })
        })
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
          scheduleRestyle()
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
        //
        // The handle stays under the cursor on every move. It used to park on
        // the router's matched point once the first preview answered, and from
        // then on it moved only when the NEXT answer did — once per round trip,
        // ~200 ms apart — so the one thing the hand was holding updated at
        // 4–5 Hz while the cursor moved at 60 (user, 2026-09-15: "scad
        // frameurile in preview"). The road the router chose is already shown
        // by the preview line bending through it; the handle's job is to be
        // where the hand is.
        map.addListener('mousemove', (e: google.maps.MapMouseEvent) => {
          const drag = routeDragRef.current
          if (!drag.active || !drag.ghost || !e.latLng) return
          drag.ghost.setPosition(e.latLng)
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
      window.clearTimeout(restyleTimerRef.current)
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
    routeDimmedRef.current = false
    markerObjsRef.current = []
    placeObjsRef.current = []
    driverObjsRef.current = []
    trailObjsRef.current = []
    routeObjsRef.current = []
    lastRouteStyleRef.current = ''
    routeFullRef.current = []
    routeLodRef.current = null
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
    routeDragRef.current = { active: true, section, ghost }
  }
  function finishRouteDrag(domEvent: Event | undefined) {
    const drag = routeDragRef.current
    const map = mapRef.current
    if (!drag.active || !map) return
    const { section, ghost } = drag
    routeDragRef.current = { active: false, section: -1, ghost: null }
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

  // ── Route level of detail ─────────────────────────────────────────────────
  // What the current view wants: the window (viewport + one viewport on every
  // side) and the near tolerance for this zoom. Null before the map has drawn.
  function lodTarget(): { band: number; win: LodWindow; nearM: number } | null {
    const map = mapRef.current
    const bounds = map?.getBounds()
    if (!map || !bounds) return null
    const zoom = map.getZoom() ?? DEFAULT_ZOOM
    const ne = bounds.getNorthEast()
    const sw = bounds.getSouthWest()
    const dLat = ne.lat() - sw.lat()
    const dLng = ne.lng() - sw.lng()
    return {
      // Half-level bands: a wheel tick is a fraction of a level, and the
      // tolerance is sub-pixel, so a band is safe to sit inside.
      band: Math.floor(zoom * 2) / 2,
      win: { s: sw.lat() - dLat, n: ne.lat() + dLat, w: sw.lng() - dLng, e: ne.lng() + dLng },
      nearM: LOD_NEAR_PX * metersPerPixel(zoom, (ne.lat() + sw.lat()) / 2),
    }
  }

  /** Re-fit the drawn strokes to the current view if it has left the band
   *  or window they were built for. `force` rebuilds regardless. */
  function rebuildRouteLod(force = false) {
    const sections = routeFullRef.current
    const objs = routeObjsRef.current
    if (sections.length === 0 || objs.length !== sections.length) return
    const target = lodTarget()
    if (!target) return
    const last = routeLodRef.current
    const map = mapRef.current
    const bounds = map?.getBounds()
    if (!force && last && bounds && last.band === target.band) {
      const ne = bounds.getNorthEast()
      const sw = bounds.getSouthWest()
      const inWindow =
        sw.lat() >= last.win.s && ne.lat() <= last.win.n && sw.lng() >= last.win.w && ne.lng() <= last.win.e
      if (inWindow) return
    }
    sections.forEach((full, i) => {
      const path = lodPath(full, target.win, target.nearM)
      objs[i].casing.setPath(path)
      objs[i].spine.setPath(path)
      objs[i].target.setPath(path)
    })
    routeLodRef.current = { band: target.band, win: target.win }
  }

  // The strokes are restyled ONCE per zoom gesture, not once per frame. With
  // fractional zoom, `zoom_changed` fires on every frame of the wheel
  // animation, and restyling on each of them meant setOptions — a new
  // `icons` sequence included — on every route polyline every frame: Google
  // then re-tessellated the 10k-vertex line and re-laid the arrows along all
  // of it, per frame, and the map stuttered harder the further in it went
  // (user, 2026-09-17: "sacadeaza cu cat dau mai mult zoom in"). During the
  // animation the overlay pane is scaled as a whole, so the width the line
  // had going in is what shows; the trailing timer restyles it for the zoom
  // it lands on.
  const restyleTimerRef = useRef(0)
  function scheduleRestyle() {
    window.clearTimeout(restyleTimerRef.current)
    restyleTimerRef.current = window.setTimeout(restyleRoute, 120)
  }

  // What the strokes were last set to, so a restyle that would change
  // nothing (a zoom that stayed inside one width step) touches nothing.
  const lastRouteStyleRef = useRef('')

  function restyleRoute() {
    const g = gRef.current
    if (!g) return
    const w = routeWidthsNow()
    const dimmed = routeDimmedRef.current
    const key = `${w.main.toFixed(2)}|${w.casing.toFixed(2)}|${w.arrow.toFixed(2)}|${w.arrowsVisible}|${dimmed}|${routeObjsRef.current.length}`
    if (key === lastRouteStyleRef.current && !revealRef.current) return
    lastRouteStyleRef.current = key
    for (const r of routeObjsRef.current) {
      r.casing.setOptions({ strokeWeight: w.casing, strokeOpacity: dimmed ? ROUTE_DIM_OPACITY : 1 })
      r.spine.setOptions({
        strokeWeight: w.main,
        strokeOpacity: dimmed ? ROUTE_DIM_OPACITY : 1,
        // The arrow glyphs carry their own opacity, so they would stay bright
        // on a dimmed line; they sit the preview out instead.
        icons: dimmed ? [] : arrowIcons(g, w),
      })
    }
    // A sweep in flight grows at the same weight the finished line will have.
    revealRef.current?.restyle(w)
  }

  // The real route steps back while a provisional one is drawn over it, and
  // comes forward again when the preview goes — the way a maps app shows the
  // route you are pulling beside the one you had.
  function setRouteDimmed(dimmed: boolean) {
    if (routeDimmedRef.current === dimmed) return
    routeDimmedRef.current = dimmed
    restyleRoute()
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
    // The strokes are drawn at the view's level of detail (lodPath); the full
    // geometry stays in routeFullRef for the rebuilds that pans and zooms ask
    // for on idle. Before the map has drawn there is no window: near-tolerance
    // everywhere, and the first idle fits it properly.
    routeFullRef.current = sections
    routeLodRef.current = null
    const lod = lodTarget()
    sections.forEach((full, sectionIndex) => {
      const path = lodPath(full, lod?.win ?? null, lod?.nearM ?? LOD_NEAR_PX * metersPerPixel(DEFAULT_ZOOM, full[0].lat))
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
    if (lod) routeLodRef.current = { band: lod.band, win: lod.win }
    // Fresh strokes carry no style yet: never let the change-check skip them.
    lastRouteStyleRef.current = ''
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
    // The badge's candidate anchors, the midpoint first (see placeBadge); a
    // changed route forgets the last placement so the search starts over.
    const anchors =
      all.length >= 2
        ? BADGE_ANCHOR_FRACTIONS.map((f) => pointAlong(all, f)).filter((p): p is LatLng => p !== null)
        : []
    badgeAnchorsRef.current = anchors
    badgePathRef.current = all.length >= 2 ? simplifyToBudget(all, 2500) : null
    if (routeChanged) badgeChoiceRef.current = null
    badgeDecideRef.current = true
    const badgeEl = badgeElRef.current
    if (badgeEl) {
      const show = anchors.length > 0 ? renderRouteBadge(badgeEl, routeDistanceLabel, routeTimeLabel) : false
      badgeRef.current?.setPosition(show ? anchors[0] : null)
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
  }, [liveMap, routePolylines, routeDistanceLabel, routeTimeLabel])

  // Re-read the width rule when the prop flips; the zoom listener does the rest.
  useEffect(() => {
    if (liveMap) restyleRoute()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMap, scaleRouteWidthWithZoom])

  // ── Drag preview ───────────────────────────────────────────────────────────
  // The provisional route during a drag: ONE plain solid stroke in the spine
  // colour, above the real line, which steps back (setRouteDimmed) for as
  // long as the preview is up — the way a maps app shows the route you are
  // pulling beside the one you had. It was dashed (a stroke symbol repeated
  // every 12px) until 2026-09-15; measured on a 900 km / 14k-vertex route at
  // zooms 11 and 15, the dashes cost nothing visible — Google only lays out
  // the symbols in view — so the change is for the look and to keep the
  // preview the cheapest object on the map, not a fix. The stutter the user
  // reported was the drag handle (see the map's mousemove listener).
  //
  // The objects are kept between answers — setPath on the ones that exist,
  // create only for extra sections, drop only the surplus — instead of a
  // teardown-and-rebuild per answer: adding or removing an overlay costs
  // Google a pane re-layout, setPath costs a redraw.
  useEffect(() => {
    const g = gRef.current
    const map = liveMap
    if (!g || !map) return
    const encodedList = previewPolylines ?? []
    const objs = previewObjsRef.current
    const w = routeWidthsNow()
    encodedList.forEach((encoded, i) => {
      const path = decodeSection(encoded)
      const existing = objs[i]
      if (existing) {
        existing.setPath(path)
        existing.setOptions({ strokeWeight: w.main })
        return
      }
      objs[i] = new g.maps.Polyline({
        map,
        path,
        strokeColor: ROUTE_SPINE,
        strokeOpacity: 1,
        strokeWeight: w.main,
        clickable: false,
        zIndex: 15,
      })
    })
    for (let i = encodedList.length; i < objs.length; i++) objs[i].setMap(null)
    objs.length = encodedList.length
    setRouteDimmed(encodedList.length > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMap, previewPolylines])

  // Where the router matched the dragged point. Kept for the dev handle and
  // the release fallback; it no longer moves the ghost (see the mousemove
  // listener above).
  useEffect(() => {
    lastPreviewPointRef.current = previewPoint ?? null
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
