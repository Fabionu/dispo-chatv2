import type { RouteMarker } from '../../lib/here/types'
import type { WorkspacePlaceCategory } from '../../lib/types'
import { PLACE_CATEGORY_COLOR } from '../../lib/savedPlaces'

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Route palette ──────────────────────────────────────────────────
// These are MAP colours, not app colours, and the distinction is load-bearing.
// They previously held #c89572 / #7d8a78 / #d97757 — which are byte-for-byte
// --color-active / --color-done / --color-alert. That looked like a palette and
// was actually a coincidence waiting to be "tidied up" into tokens, which would
// break the map: the basemap is ALWAYS a day map or satellite imagery (see
// BaseMapMode — there is no night layer), so the route has to hold on a pale or
// photographic field whichever theme the app itself is in. Tokens that flip with
// the theme would invert the route against a basemap that never inverts.
//
// So the route is drawn the way a route is legible on any basemap: a near-black
// spine inside a solid white halo. The halo carries it over satellite, the spine
// carries it over the pale vector map, and neither depends on the other being
// visible. Direction is a white ARROW dash stencilled INSIDE the spine (see
// routeArrowStyle).
//
// The old treatment was a mid-warm coral over `rgba(0,0,0,0.38)` — a dark halo
// under a mid-tone line on a light map, which has nothing to contrast against
// and reads as a soft smear rather than as a drawn line.
export const ROUTE_SPINE = '#171717'
export const ROUTE_HALO = '#ffffff'

// Retained name so an import of the old constant resolves rather than breaking
// silently; nothing in tree reads it any more.
export const ROUTE_COLOR = ROUTE_SPINE

// [glyph, gap] in line-width units. Sparse on purpose — arrows are a reminder of
// which way the truck runs, not a texture. Tune here; it is the one number in
// this file that really wants a live map in front of you.
export const ROUTE_ARROW_DASH = [1, 7]

// How much heavier the route is drawn while the cursor is on it. The line is
// draggable — grab it anywhere to add a stop — and a hairline at overview zoom
// gives no sign of that until something answers the cursor. Enough to read as
// "this one, and it is live"; not so much that the map jumps when the pointer
// crosses it.
export const ROUTE_HOVER_BOOST = 1.35

// Route Planner overview zooms cover far more ground than the street-level
// editor. A fixed seven-pixel route dominates the basemap at that scale, so the
// planner can opt into a smooth zoom-dependent width while read-only trip maps
// retain their deliberately prominent route/trail comparison.
export function routeStrokeWidths(zoom: number, hovered = false): {
  main: number
  casing: number
  arrow: number
  arrowsVisible: boolean
} {
  const base = Math.min(7, Math.max(2.75, 2.75 + (zoom - 8) * 0.7))
  const main = hovered ? base * ROUTE_HOVER_BOOST : base
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
    // the line is wide enough to carry a legible glyph. Read off the BASE
    // width: hovering thickens the line it is already drawing, it must not
    // conjure arrows onto a zoom that had none.
    arrowsVisible: base >= 4.25,
  }
}

// ── Route line styles ─────────────────────────────────────────────
// Both the initial draw and the zoom-driven restyle go through these. They used
// to be two hand-written copies of the same style object in HereMap, and only
// one of them got updated when the look changed.
//
// `lineJoin: 'bevel'` rather than 'miter': the angular join the square language
// wants, without miter's spikes at the hairpin bends road geometry is full of.
// `lineCap: 'square'` extends each section half a width past its last vertex, so
// consecutive sections overlap instead of leaving a notch at the seam.
export function routeCasingStyle(width: number) {
  return { lineWidth: width, strokeColor: ROUTE_HALO, lineJoin: 'bevel', lineCap: 'square' }
}

export function routeSpineStyle(width: number) {
  return { lineWidth: width, strokeColor: ROUTE_SPINE, lineJoin: 'bevel', lineCap: 'square' }
}

// Direction, as repeating arrow glyphs stencilled into a white line laid over
// the spine. `H.map.Polyline.setArrows()` / `H.map.ArrowStyle` — the v3.1 way of
// doing this — were REMOVED in v3.2. Verified against the loaded SDK rather than
// the docs: `typeof H.map.ArrowStyle === 'undefined'`, and `lineCap:
// 'arrow-head'` throws. `SpatialStyle.DashImage.ARROW` is the replacement and is
// accepted by the style constructor.
//
// DISCRETE scaling keeps whole glyphs rather than stretching a partial arrow
// into the gap at the end of a section.
export function routeArrowStyle(H: any, width: number) {
  return {
    lineWidth: width,
    strokeColor: ROUTE_HALO,
    lineJoin: 'bevel',
    lineCap: 'butt',
    lineDash: ROUTE_ARROW_DASH,
    lineDashImage: H.map.SpatialStyle.DashImage.ARROW,
    dashScaleMode: H.map.SpatialStyle.DashScaleMode.DISCRETE,
  }
}

// ── Marker icons ─────────────────────────────────────────────────
// Built as SVG with an explicit anchor so the marker sits EXACTLY on the
// coordinate. All three are CENTRE-anchored now, including the destination — it
// used to be a teardrop pin anchored at its tip, which made the end of a route
// the only waypoint whose mark did not sit on its own coordinate. (HERE places
// the icon's anchor point on the coordinate.) SVG rather than DomMarker
// deliberately: DomMarkers do not render under the v3.2 HARP engine.
//
// The three are told apart by FILL, not by colour: start is solid, a stop is a
// frame around its number, the destination is a frame around a solid core. Each
// sits on a white plate — the keyline that keeps it readable on satellite
// imagery as well as on the pale vector map, the same job the route's halo does.
// Kept deliberately small so the markers don't blanket the spot under them —
// precise clicking/placement needs the coordinate to stay visible.
export function originSvg(): string {
  return `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><rect width="16" height="16" fill="${ROUTE_HALO}"/><rect x="2" y="2" width="12" height="12" fill="${ROUTE_SPINE}"/></svg>`
}

export function stopSvg(label: string): string {
  return `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg"><rect width="18" height="18" fill="${ROUTE_HALO}"/><rect x="2" y="2" width="14" height="14" fill="${ROUTE_HALO}" stroke="${ROUTE_SPINE}" stroke-width="2"/><text x="9" y="9.2" text-anchor="middle" dominant-baseline="central" font-family="JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace" font-size="9" font-weight="600" fill="${ROUTE_SPINE}">${label}</text></svg>`
}

export function destSvg(): string {
  return `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20" fill="${ROUTE_HALO}"/><rect x="2" y="2" width="16" height="16" fill="${ROUTE_HALO}" stroke="${ROUTE_SPINE}" stroke-width="2"/><rect x="6" y="6" width="8" height="8" fill="${ROUTE_SPINE}"/></svg>`
}

// Small translucent dot shown under the cursor while dragging the route line.
// Kept tiny so it marks the release point without covering the road beneath it.
export function ghostSvg(): string {
  return `<svg width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="10" height="10" fill="${ROUTE_SPINE}" fill-opacity="0.55" stroke="${ROUTE_HALO}" stroke-width="1.5"/></svg>`
}

// Build the H.map.Icon for a marker with the correct anchor for its kind.
export function iconFor(H: any, marker: RouteMarker): any {
  if (marker.kind === 'origin') {
    return new H.map.Icon(originSvg(), { anchor: new H.math.Point(8, 8) })
  }
  if (marker.kind === 'destination') {
    // Centre of the 20×20 box — the mark sits ON the coordinate, like the other
    // two. The old teardrop was tip-anchored at (10, 26).
    return new H.map.Icon(destSvg(), { anchor: new H.math.Point(10, 10) })
  }
  return new H.map.Icon(stopSvg(marker.label ?? ''), { anchor: new H.math.Point(9, 9) })
}

const PLACE_GLYPH: Record<WorkspacePlaceCategory, string> = {
  parking: 'P',
  depot: 'D',
  fuel: 'F',
  customer: 'C',
  service: 'S',
  customs: 'B',
  other: '•',
}

// Saved places are deliberately a softer, smaller pin than route destinations:
// category colour + a single glyph make a dense workspace map easy to scan.
export function savedPlaceIconFor(H: any, category: WorkspacePlaceCategory): any {
  const color = PLACE_CATEGORY_COLOR[category]
  const glyph = PLACE_GLYPH[category]
  const svg = `<svg width="24" height="30" viewBox="0 0 24 30" xmlns="http://www.w3.org/2000/svg"><path d="M12 1.5c-5.65 0-10 4.2-10 9.55C2 18.1 12 28.5 12 28.5S22 18.1 22 11.05C22 5.7 17.65 1.5 12 1.5Z" fill="#202020" stroke="${color}" stroke-width="2"/><circle cx="12" cy="11" r="6.1" fill="${color}" fill-opacity=".2"/><text x="12" y="11.2" text-anchor="middle" dominant-baseline="central" font-family="Inter,system-ui,sans-serif" font-size="9.5" font-weight="750" fill="${color}">${glyph}</text></svg>`
  return new H.map.Icon(svg, { anchor: new H.math.Point(12, 30) })
}
