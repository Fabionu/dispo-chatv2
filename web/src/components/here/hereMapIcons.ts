import type { RouteMarker } from '../../lib/here/types'
import type { WorkspacePlaceCategory } from '../../lib/types'
import { PLACE_CATEGORY_COLOR, PLACE_CATEGORY_GLYPH } from '../../lib/savedPlaces'

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
// The three are told apart by FILL — start is solid, a stop and the destination
// are frames — and the two ENDPOINTS additionally carry a pictogram, because
// fill alone never said WHICH end. Start was a solid square and the destination
// a square inside a square: two abstract blocks a few hundred pixels apart, told
// apart only by a detail you had to go and compare. Nothing on either one said
// "this is where the truck leaves from".
//
// The pictograms are not invented here. The route planner's own list already
// names them — an arrow for the start, a flag for the destination (see
// inbox/RoutePointCard RoleBadge) — so the map now speaks the list's vocabulary
// instead of a second private one, and the panel beside it reads as the legend.
//
// Each sits on a white plate — the keyline that keeps it readable on satellite
// imagery as well as on the pale vector map, the same job the route's halo does.
//
// ROUND since 2026-09-03 (user: "instead of the squares as the origin, stops and
// destination points, let's put back the circles but let's try to keep the
// design we have"). Only the outline changed: the same plate + core + glyph
// construction, the same sizes, the same inks, the same centre anchoring. The
// radii are derived from the geometry they replace rather than picked — a
// 2px-stroked core that used to span 1..17 of an 18 box becomes r=7 stroked 2,
// which spans the same 1px inside the plate — so the marks weigh exactly what
// they did before.
//
// The glyphs inside the two endpoints were scaled to ~0.9 about the centre. A
// square core clears its glyph on the diagonal for free; a circle does not, and
// at full size the arrow's and the flag's corners came within a fraction of a
// pixel of the ring.
// Kept deliberately small so the markers don't blanket the spot under them —
// precise clicking/placement needs the coordinate to stay visible.
//
// Both endpoints are 20×20, up from the start's old 16: they are a matched pair
// and neither outranks the other, and 20 against the stops' 18 is what makes the
// ends of the route read as the ends.
export function originSvg(): string {
  // Solid core, white arrow — the start keeps the "solid" identity it always
  // had, and the arrow is lucide's Navigation silhouette (the planner's own
  // start glyph) scaled into the core with ~3px of margin so it never crowds
  // the plate.
  return `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="10" fill="${ROUTE_HALO}"/><circle cx="10" cy="10" r="8" fill="${ROUTE_SPINE}"/><polygon points="5.32,9.73 14.68,5.32 10.27,14.68 9.28,10.72" fill="${ROUTE_HALO}"/></svg>`
}

export function stopSvg(label: string): string {
  return `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg"><circle cx="9" cy="9" r="9" fill="${ROUTE_HALO}"/><circle cx="9" cy="9" r="7" fill="${ROUTE_HALO}" stroke="${ROUTE_SPINE}" stroke-width="2"/><text x="9" y="9.2" text-anchor="middle" dominant-baseline="central" font-family="Inter, system-ui, sans-serif" font-size="9" font-weight="600" fill="${ROUTE_SPINE}">${label}</text></svg>`
}

export function destSvg(): string {
  // Framed, with a black flag on white — the inverse ink of the start, so the
  // two ends differ in FILL as well as in glyph and can't be confused at a
  // glance or at a distance. The flag is a staff plus a rectangular banner
  // rather than lucide's waving one: at 12px a wave is mud. (The flag itself is
  // still built from rectangles — it is a picture of a flag, not a piece of the
  // app's chrome, so the marks going round does not make a staff and a banner
  // want to be curved.)
  return `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="10" fill="${ROUTE_HALO}"/><circle cx="10" cy="10" r="8" fill="${ROUTE_HALO}" stroke="${ROUTE_SPINE}" stroke-width="2"/><rect x="6.23" y="5.22" width="1.56" height="9.57" fill="${ROUTE_SPINE}"/><rect x="7.79" y="5.22" width="6.07" height="5.52" fill="${ROUTE_SPINE}"/></svg>`
}

// Small translucent dot shown under the cursor while dragging the route line.
// Kept tiny so it marks the release point without covering the road beneath it.
export function ghostSvg(): string {
  return `<svg width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg"><circle cx="6" cy="6" r="5" fill="${ROUTE_SPINE}" fill-opacity="0.55" stroke="${ROUTE_HALO}" stroke-width="1.5"/></svg>`
}

// Build the H.map.Icon for a marker with the correct anchor for its kind.
export function iconFor(H: any, marker: RouteMarker): any {
  // Centre of the 20×20 box for both endpoints — the mark sits ON the
  // coordinate, like every other mark on this map. (The destination's old
  // teardrop was tip-anchored at (10, 26).)
  if (marker.kind === 'origin') {
    return new H.map.Icon(originSvg(), { anchor: new H.math.Point(10, 10) })
  }
  if (marker.kind === 'destination') {
    return new H.map.Icon(destSvg(), { anchor: new H.math.Point(10, 10) })
  }
  return new H.map.Icon(stopSvg(marker.label ?? ''), { anchor: new H.math.Point(9, 9) })
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
export function savedPlaceIconFor(H: any, category: WorkspacePlaceCategory): any {
  const color = PLACE_CATEGORY_COLOR[category]
  const glyph = PLACE_CATEGORY_GLYPH[category]
  const svg = `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg"><rect width="18" height="18" fill="${ROUTE_HALO}"/><rect x="2" y="2" width="14" height="14" fill="${color}"/><text x="9" y="9.2" text-anchor="middle" dominant-baseline="central" font-family="Inter, system-ui, sans-serif" font-size="9.5" font-weight="600" fill="${ROUTE_HALO}">${glyph}</text></svg>`
  // Centre-anchored: the mark sits ON the coordinate, like every route mark.
  return new H.map.Icon(svg, { anchor: new H.math.Point(9, 9) })
}
