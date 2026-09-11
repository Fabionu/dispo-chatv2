import type { RouteMarker } from '../../lib/here/types'
import type { WorkspacePlaceCategory } from '../../lib/types'
import { PLACE_CATEGORY_COLOR, PLACE_CATEGORY_GLYPH } from '../../lib/savedPlaces'

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Route palette ──────────────────────────────────────────────────
// These are MAP colours, not app colours, and the distinction is load-bearing:
// the basemap is ALWAYS a day map or satellite imagery (there is no night
// layer), so the route has to hold on a pale or photographic field whichever
// theme the app itself is in. Tokens that flip with the theme would invert the
// route against a basemap that never inverts.
//
// REWORKED 2026-09-11 (user: "remake the UI of the route"), then RESTRAINED
// the same day (user: the first pass "looks like something for kids"). The
// route used to be a near-black spine in a white halo — legible anywhere, but
// on Google's basemap it read as one more road. The first blue pass answered
// that with a fat bright line, a heavy dark outline, a glow and big sticker
// marks with drop shadows — a crayon route. What is here now is the
// professional version of the same idea: a THIN cobalt line (deeper and a
// touch less saturated than Google's own), a hairline edge that only separates
// it from a blue motorway or a river, no glow, and small flat marks. The
// endpoints are still the only other colour on the route layer — green where
// it starts, red where it ends, which is what the planner's list uses
// (RoutePointCard RoleBadge: `done` / `alert`), so the panel reads as the
// map's legend — but as a thin ring and a small disc, not a badge.
export const ROUTE_SPINE = '#1d4fc4'
export const ROUTE_CASING = '#10307a'
// The white keyline every mark sits on, and the ink of the direction arrows.
export const ROUTE_HALO = '#ffffff'
// The marks' ink — near-black, NOT the route's blue. The marks kept the
// monochrome look the user liked (see the marker section below) when the line
// went cobalt, so they have their own constant rather than riding ROUTE_SPINE.
export const MARK_INK = '#171717'

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
export const ROUTE_HOVER_BOOST = 1.3

// Route Planner overview zooms cover far more ground than the street-level
// editor. A fixed route width dominates the basemap at that scale, so the
// planner can opt into a smooth zoom-dependent width while read-only trip maps
// retain their deliberately prominent route/trail comparison.
//
// 2.5px at overview, 4px at street level. The user asked for thinner twice on
// 2026-09-11 (4–8 → 3–6 → this); a line this weight sits IN the map the way a
// drawn route on a paper map does, instead of on top of it. Below 2.5 the edge
// stops registering and the line becomes a road again.
export function routeStrokeWidths(zoom: number, hovered = false): {
  main: number
  casing: number
  arrow: number
  arrowsVisible: boolean
} {
  const base = Math.min(4, Math.max(2.5, 2.5 + (zoom - 8) * 0.3))
  const main = hovered ? base * ROUTE_HOVER_BOOST : base
  return {
    main,
    // A hairline: 0.75px of edge per side, just enough to separate the blue
    // from a blue motorway or a river. Not an outline.
    casing: main + 1.5,
    // The arrow glyphs are stencilled INSIDE the spine, so this must stay
    // meaningfully narrower than `main` or the arrows eat their own line.
    arrow: Math.max(1.5, main - 1),
    // At overview zooms the spine is a thread crossing whole countries and
    // arrow glyphs on it are noise, not information. Direction only appears
    // once the line is wide enough to carry a legible glyph — and the reveal
    // animation has already shown it once. Read off the BASE width: hovering
    // thickens the line it is already drawing, it must not conjure arrows onto
    // a zoom that had none.
    arrowsVisible: base >= 3.25,
  }
}

// ── Route line styles ─────────────────────────────────────────────
// Both the initial draw and the zoom-driven restyle go through these. They used
// to be two hand-written copies of the same style object in HereMap, and only
// one of them got updated when the look changed.
//
// Round joins and caps: the line is a ribbon laid over the road, and road
// geometry is full of hairpins that a bevel turns into a saw edge at this
// width. Round caps also close the seam between consecutive sections.
export function routeCasingStyle(width: number) {
  return { lineWidth: width, strokeColor: ROUTE_CASING, lineJoin: 'round', lineCap: 'round' }
}

export function routeSpineStyle(width: number) {
  return { lineWidth: width, strokeColor: ROUTE_SPINE, lineJoin: 'round', lineCap: 'round' }
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
    lineJoin: 'round',
    lineCap: 'butt',
    lineDash: ROUTE_ARROW_DASH,
    lineDashImage: H.map.SpatialStyle.DashImage.ARROW,
    dashScaleMode: H.map.SpatialStyle.DashScaleMode.DISCRETE,
  }
}

// ── Marker icons ─────────────────────────────────────────────────
// Built as SVG with an explicit anchor so the marker sits EXACTLY on the
// coordinate. All three are CENTRE-anchored, including the destination — a
// tip-anchored teardrop would make the end of a route the only waypoint whose
// mark does not sit on its own coordinate. (Both engines place the icon's
// anchor point on the coordinate.) SVG rather than DomMarker deliberately:
// DomMarkers do not render under HERE's v3.2 HARP engine.
//
// ROUND (user, 2026-09-03), and THE ORIGINAL SET, RESTORED. The 2026-09-11
// route rework tried two other marker designs in one day — big green/red
// discs with drop shadows, then small hollow/solid ones — and the user asked
// for these back ("era fain cum arata inainte"): near-black ink on a white
// plate, whatever colour the line is. So the line is cobalt and the marks are
// monochrome, and that contrast is now the point: the marks are the ink, the
// line is the highlighter.
//
// The three are told apart by FILL — start is solid, a stop and the
// destination are frames — and the two ENDPOINTS additionally carry a
// pictogram, because fill alone never said WHICH end. The pictograms are the
// route planner's own — an arrow for the start, a flag for the destination
// (see inbox/RoutePointCard RoleBadge) — so the map speaks the list's
// vocabulary and the panel beside it reads as the legend.
//
// Each sits on a white plate — the keyline that keeps it readable on satellite
// imagery as well as on the pale vector map, the same job the route's edge
// does. Kept deliberately small so the markers don't blanket the spot under
// them — precise clicking/placement needs the coordinate to stay visible.
// Both endpoints are 20×20 and the stops 18: the ends are a matched pair and
// neither outranks the other, and 20 against 18 is what makes the ends of the
// route read as the ends. The radii are derived from the square marks these
// replaced (a 2px-stroked core spanning 1..17 of an 18 box → r=7 stroked 2),
// so the marks weigh exactly what they did.

// Endpoint canvas: 20×20, plate r=10, core r=8, centre (10,10).
export const ENDPOINT_ICON_SIZE = 20
export const ENDPOINT_ICON_ANCHOR = 10
// Stop canvas: 18×18, plate r=9, core r=7, centre (9,9).
export const STOP_ICON_SIZE = 18
export const STOP_ICON_ANCHOR = 9

export function originSvg(): string {
  // Solid core, white arrow — the start keeps the "solid" identity it always
  // had, and the arrow is lucide's Navigation silhouette (the planner's own
  // start glyph) scaled into the core with ~3px of margin so it never crowds
  // the plate.
  return `<svg width="${ENDPOINT_ICON_SIZE}" height="${ENDPOINT_ICON_SIZE}" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="10" fill="${ROUTE_HALO}"/><circle cx="10" cy="10" r="8" fill="${MARK_INK}"/><polygon points="5.32,9.73 14.68,5.32 10.27,14.68 9.28,10.72" fill="${ROUTE_HALO}"/></svg>`
}

export function stopSvg(label: string): string {
  return `<svg width="${STOP_ICON_SIZE}" height="${STOP_ICON_SIZE}" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg"><circle cx="9" cy="9" r="9" fill="${ROUTE_HALO}"/><circle cx="9" cy="9" r="7" fill="${ROUTE_HALO}" stroke="${MARK_INK}" stroke-width="2"/><text x="9" y="9.2" text-anchor="middle" dominant-baseline="central" font-family="Inter, system-ui, sans-serif" font-size="9" font-weight="600" fill="${MARK_INK}">${label}</text></svg>`
}

export function destSvg(): string {
  // Framed, with a black flag on white — the inverse ink of the start, so the
  // two ends differ in FILL as well as in glyph and can't be confused at a
  // glance or at a distance. The flag is a staff plus a rectangular banner
  // rather than lucide's waving one: at 12px a wave is mud.
  return `<svg width="${ENDPOINT_ICON_SIZE}" height="${ENDPOINT_ICON_SIZE}" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="10" fill="${ROUTE_HALO}"/><circle cx="10" cy="10" r="8" fill="${ROUTE_HALO}" stroke="${MARK_INK}" stroke-width="2"/><rect x="6.23" y="5.22" width="1.56" height="9.57" fill="${MARK_INK}"/><rect x="7.79" y="5.22" width="6.07" height="5.52" fill="${MARK_INK}"/></svg>`
}

// Small translucent dot shown under the cursor while dragging the route line.
// Kept tiny so it marks the release point without covering the road beneath it.
export function ghostSvg(): string {
  return `<svg width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg"><circle cx="6" cy="6" r="5" fill="${ROUTE_SPINE}" fill-opacity="0.55" stroke="${ROUTE_HALO}" stroke-width="1.5"/></svg>`
}

// The head of the route while it is being drawn on (the reveal animation): a
// white dot ringed in the route's blue, running just ahead of the line.
export function revealHeadSvg(): string {
  return `<svg width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg"><circle cx="6" cy="6" r="6" fill="${ROUTE_HALO}"/><circle cx="6" cy="6" r="4" fill="${ROUTE_HALO}" stroke="${ROUTE_SPINE}" stroke-width="2"/></svg>`
}

// Build the H.map.Icon for a marker with the correct anchor for its kind.
export function iconFor(H: any, marker: RouteMarker): any {
  // Centre of the canvas for every mark — it sits ON the coordinate.
  if (marker.kind === 'origin') {
    return new H.map.Icon(originSvg(), { anchor: new H.math.Point(ENDPOINT_ICON_ANCHOR, ENDPOINT_ICON_ANCHOR) })
  }
  if (marker.kind === 'destination') {
    return new H.map.Icon(destSvg(), { anchor: new H.math.Point(ENDPOINT_ICON_ANCHOR, ENDPOINT_ICON_ANCHOR) })
  }
  return new H.map.Icon(stopSvg(marker.label ?? ''), { anchor: new H.math.Point(STOP_ICON_ANCHOR, STOP_ICON_ANCHOR) })
}

// ── Saved-place pins ──────────────────────────────────────────────────────
// The workspace's operational layer: parking, depots, fuel, customers. These
// are drawn in the same language as the route marks above — a mark on a white
// plate, centre-anchored, with a single glyph — and told apart from them by ink
// and, since 2026-09-03, by SHAPE: the route went round and these stayed square,
// so the map now reads "round is your route, square is a place you saved". That
// was a side effect of the route change rather than a decision; it is a good one
// (it is the same convention paper maps use) but if the two layers should match
// again, this is the one function to change.
//
// What they replaced: a 24×30 teardrop, near-black, anchored at its tip. Three
// things were wrong with it, all of them the same thing.
//   · It was the roundest, largest object on a map whose route marks are 16–20px
//     squares, so the background layer outweighed the layer it is background to.
//   · Anchored at the tip, a place did not sit on its own coordinate. That is
//     exactly the bug the destination marker was fixed for (see destSvg) — a
//     pin whose mark is a body's height away from the point it names cannot be
//     placed or clicked precisely.
//   · Its glyph was the category colour on a near-black body, so the colour was
//     carrying both the identity AND the legibility. At pin size neither won.
//
// Geometry still MATCHES stopSvg in every dimension — an 18×18 box, a 2px plate,
// a 14×14 core, a 9.5px glyph — so a place and a numbered stop weigh the same on
// the map even though one is now a circle and the other a square. The core is
// solid category ink with a white glyph; a route stop is a white core with
// near-black ink. That inversion is what separates the two layers at a
// glance, and it survives the map being switched to satellite, where the white
// plate does the same job it does for the route.
// The SVG on its own, so the Google map draws the identical mark. The two map
// engines wrap it differently (an H.map.Icon here, a data URL there) but the
// picture is one function — a saved place must look the same whichever basemap
// is under it, or toggling HGV would appear to change what was saved.
export function savedPlaceSvg(category: WorkspacePlaceCategory): string {
  const color = PLACE_CATEGORY_COLOR[category]
  const glyph = PLACE_CATEGORY_GLYPH[category]
  return `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg"><rect width="18" height="18" fill="${ROUTE_HALO}"/><rect x="2" y="2" width="14" height="14" fill="${color}"/><text x="9" y="9.2" text-anchor="middle" dominant-baseline="central" font-family="Inter, system-ui, sans-serif" font-size="9.5" font-weight="600" fill="${ROUTE_HALO}">${glyph}</text></svg>`
}

export function savedPlaceIconFor(H: any, category: WorkspacePlaceCategory): any {
  // Centre-anchored: the mark sits ON the coordinate, like every route mark.
  return new H.map.Icon(savedPlaceSvg(category), { anchor: new H.math.Point(9, 9) })
}
