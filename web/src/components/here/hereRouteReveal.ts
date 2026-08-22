import { haversineMeters } from '../../lib/here/geo'
import type { LatLng } from '../../lib/here/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Growing a drawn route from its origin ───────────────────────────────────
// A calculated route arrives as one blob of geometry, and drawing it that way —
// every section at once, onto a map still settling its tiles — reads as the line
// materialising somewhere in its own middle: nothing says which end the truck
// leaves from. Growing the line from the origin to the destination answers that
// before the user has read a single label.
//
// Strictly an ENTRANCE. HereMap plays it when a route first appears, never on the
// recalculations that follow an edit or a marker drag — there the line has to
// track the gesture, not re-perform.
//
// The route is one polyline TRIO per section (casing + spine + arrows, see
// HereMap.draw), so the walk is over the whole route's length and each section
// draws the slice of it that falls inside its own span: legs light up in travel
// order, and a section the walk has passed drops the simplified copy it grew for
// the exact geometry HERE returned.

export const ROUTE_REVEAL_MS = 900
// The growing line is rebuilt every frame, so the walk runs on a SIMPLIFIED copy
// of the route and each section is handed its exact geometry the moment the
// reveal clears it. At the zoom a whole route is framed at the two are
// indistinguishable, and this keeps an alpine route with tens of thousands of
// road-shape vertices at the same per-frame cost as a city hop.
export const ROUTE_REVEAL_VERTEX_BUDGET = 1200

export type RevealSection = {
  /** Simplified path the growing line is built from, in travel order. */
  path: LatLng[]
  /** Cumulative metres from this section's first vertex, index-aligned. */
  cum: number[]
  /** Metres from the ROUTE's origin to this section's first vertex. */
  offset: number
  /** Full-fidelity geometry, handed back once the reveal clears the section. */
  full: any
  casing: any
  main: any
  arrows: any
  /** Whether this zoom draws direction arrows at all (see routeStrokeWidths). */
  arrowsAllowed: boolean
  /** Vertex the walk last reached — it only ever moves forward. */
  cursor: number
  done: boolean
  shown: boolean
}

export type RouteReveal = { cancel: () => void }

/**
 * Does this SDK expose the pieces the walk rewrites? v3.2 has removed things its
 * own docs still list (H.map.ArrowStyle — see hereMapIcons), so this is checked
 * rather than assumed: HereMap must draw the route the plain way rather than
 * seed a line it then cannot grow. An entrance is worth nothing measured against
 * a route that never appears.
 */
export function canRevealRoute(H: any): boolean {
  return (
    typeof H?.map?.Polyline?.prototype?.setGeometry === 'function' &&
    typeof H?.geo?.LineString === 'function' &&
    typeof H.geo.LineString.prototype?.pushPoint === 'function' &&
    typeof H.geo.LineString.prototype?.getPointCount === 'function'
  )
}

/** Cumulative metres from the first vertex, index-aligned with `path`. */
function cumulativeMeters(path: LatLng[]): number[] {
  const cum = new Array<number>(path.length)
  cum[0] = 0
  for (let i = 1; i < path.length; i++) cum[i] = cum[i - 1] + haversineMeters(path[i - 1], path[i])
  return cum
}

/**
 * Collapse one freshly drawn section onto its own first vertex, ready to grow.
 * Called while HereMap builds the strokes, so a revealed route is never painted
 * whole and then rewound — the flash this exists to avoid.
 */
export function seedRevealSection(
  H: any,
  {
    path,
    offset,
    full,
    casing,
    main,
    arrows,
    arrowsAllowed,
  }: {
    /** Already simplified to the reveal's vertex budget by the caller. */
    path: LatLng[]
    offset: number
    full: any
    casing: any
    main: any
    arrows: any
    arrowsAllowed: boolean
  },
): RevealSection {
  const section: RevealSection = {
    path,
    cum: cumulativeMeters(path),
    offset,
    full,
    casing,
    main,
    arrows,
    arrowsAllowed,
    cursor: 0,
    done: false,
    shown: false,
  }
  // The geometry is seeded as well as the visibility because visibility is not
  // ours alone: a camera move restores every route decoration (see HereMap's
  // setRouteDecorationsVisible), and a section that came back carrying the
  // FINISHED line would undo the reveal. A dot under the waypoint's own marker
  // cannot.
  setSectionGeometry(section, seedLine(H, path[0]))
  casing.setVisibility?.(false)
  main.setVisibility?.(false)
  arrows?.setVisibility?.(false)
  // Geometry that changes every frame belongs on HERE's live render path;
  // completeSection hands each stroke back to the cache when it lands.
  setSectionVolatility(section, true)
  return section
}

/** Total length of a seeded route, metres. */
function revealLength(sections: RevealSection[]): number {
  return sections.reduce((sum, s) => sum + sectionLength(s), 0)
}

/**
 * Land every section: exact HERE geometry back, cached again, visible, and the
 * distance badge released. Also the bail-out — a seeded route that must not (or
 * can no longer) animate is restored by finishing it.
 */
export function finishRouteReveal(
  sections: RevealSection[],
  { badge, isViewChanging = () => false }: { badge?: any; isViewChanging?: () => boolean } = {},
): void {
  for (const s of sections) completeSection(s, isViewChanging)
  badge?.setVisibility?.(true)
}

export function startRouteReveal(
  H: any,
  sections: RevealSection[],
  {
    durationMs = ROUTE_REVEAL_MS,
    badge,
    isViewChanging = () => false,
  }: {
    durationMs?: number
    /** Distance pill at the route's MIDPOINT — it arrives with the route. */
    badge?: any
    /** The casing and arrows stay down while the camera is moving. */
    isViewChanging?: () => boolean
  } = {},
): RouteReveal {
  let raf = 0
  const finish = () => {
    raf = 0
    finishRouteReveal(sections, { badge, isViewChanging })
  }
  const total = revealLength(sections)
  // A zero-length route is a waypoint, not a line: nothing to walk along.
  if (!(total > 0)) {
    finish()
    return { cancel: () => {} }
  }

  const startedAt = performance.now()
  const step = (now: number) => {
    try {
      walk(now)
    } catch (err) {
      // A route half-drawn forever is the one outcome worse than no animation.
      // eslint-disable-next-line no-console
      console.error('HERE route reveal failed — showing the route directly', err)
      finish()
    }
  }
  const walk = (now: number) => {
    const p = Math.min(1, (now - startedAt) / durationMs)
    // Eased in AND out: the line leaves the origin slowly enough to be seen
    // starting there, then settles onto the destination instead of slamming into
    // it. Linear reads as a wipe; this reads as being drawn.
    const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
    const revealed = eased * total
    for (const s of sections) {
      if (s.done) continue
      const local = revealed - s.offset
      // Legs the walk hasn't reached stay collapsed, as they were seeded.
      if (local <= 0) continue
      if (local >= sectionLength(s)) {
        completeSection(s, isViewChanging)
        continue
      }
      setSectionGeometry(s, prefixLine(H, s, local))
      showSection(s, isViewChanging)
    }
    if (p < 1) {
      raf = requestAnimationFrame(step)
      return
    }
    finish()
  }
  raf = requestAnimationFrame(step)

  return {
    // Only ever called because the route is being redrawn or the map torn down,
    // so the half-grown strokes are about to be discarded — there is nothing to
    // restore, and restoring would paint a frame of a route that no longer exists.
    cancel: () => {
      if (!raf) return
      cancelAnimationFrame(raf)
      raf = 0
    },
  }
}

const sectionLength = (s: RevealSection) => s.cum[s.cum.length - 1]

/** The section's path up to `meters` along it, ending on an exact tip point. */
function prefixLine(H: any, s: RevealSection, meters: number) {
  // The walk only advances, so the cursor is picked up where the last frame left
  // it rather than re-searched from the start of the leg.
  while (s.cursor + 1 < s.path.length && s.cum[s.cursor + 1] <= meters) s.cursor++
  const line = new H.geo.LineString()
  for (let i = 0; i <= s.cursor; i++) line.pushPoint(s.path[i])
  const from = s.path[s.cursor]
  const to = s.path[s.cursor + 1]
  if (to) {
    // Interpolating the tip is what keeps the drawing speed constant: without it
    // the line would jump vertex to vertex, crawling through dense bends and
    // leaping down straight motorway stretches.
    const span = s.cum[s.cursor + 1] - s.cum[s.cursor]
    const t = span > 0 ? (meters - s.cum[s.cursor]) / span : 0
    line.pushPoint({
      lat: from.lat + (to.lat - from.lat) * t,
      lng: from.lng + (to.lng - from.lng) * t,
    })
  }
  // A LineString needs two points; before the walk clears the first vertex the
  // "line" is a dot sitting on the origin.
  if (line.getPointCount() < 2) line.pushPoint(from)
  return line
}

/** Two copies of one point — a valid LineString that draws as a dot. */
function seedLine(H: any, at: LatLng) {
  const line = new H.geo.LineString()
  line.pushPoint(at)
  line.pushPoint(at)
  return line
}

function setSectionGeometry(s: RevealSection, line: any) {
  s.casing.setGeometry?.(line)
  s.main.setGeometry?.(line)
  s.arrows?.setGeometry?.(line)
}

function setSectionVolatility(s: RevealSection, volatile: boolean) {
  s.casing.setVolatility?.(volatile)
  s.main.setVolatility?.(volatile)
  s.arrows?.setVolatility?.(volatile)
}

function showSection(s: RevealSection, isViewChanging: () => boolean) {
  if (s.shown) return
  s.shown = true
  // The same conditions HereMap.draw applies at creation: the casing and the
  // arrows are decorations that stay down while the camera is moving, and arrows
  // only exist at zooms where the glyph is legible.
  s.main.setVisibility?.(true)
  s.casing.setVisibility?.(!isViewChanging())
  s.arrows?.setVisibility?.(s.arrowsAllowed && !isViewChanging())
}

function completeSection(s: RevealSection, isViewChanging: () => boolean) {
  if (s.done) return
  s.done = true
  setSectionGeometry(s, s.full)
  setSectionVolatility(s, false)
  showSection(s, isViewChanging)
}
