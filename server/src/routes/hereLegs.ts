import { decode as decodePolyline, encode as encodePolyline } from '@here/flexpolyline'

// The part of a HERE Routing v8 section that leg-merging reads. `waypoint` is
// set only on a place that IS one of the request's vias (its index among
// them); a ferry terminal or other mid-leg boundary has none.
type LegPlace = { place?: { location?: { lat: number; lng: number }; waypoint?: number } }

export type LegSection = {
  id?: string
  polyline?: string
  summary?: { duration?: number; length?: number }
  notices?: Array<{ code?: string; title?: string; severity?: string }>
  departure?: LegPlace
  arrival?: LegPlace
}

// One section per LEG — origin → via → … → destination — whatever HERE split
// the legs into.
//
// Every client reads `route.sections` as legs: section i runs from waypoint i
// to waypoint i+1 (the planner's markers sit on section boundaries, a line
// drag inserts after the grabbed section, a dragged stop's road-matched
// position is read off sections[i-1].arrival). HERE breaks that the moment a
// leg takes a ferry: the crossing comes back as its own `transit` section, so
// Munich → Jönköping → Hamburg arrives as six sections, not two. That is what
// made a drag into Sweden or Norway "not stick" (user, 2026-09-23) — every
// truck route there from the south crosses the Baltic — the dragged point was
// matched to the Rostock ferry terminal instead of where it was dropped.
//
// A leg ends at a section whose arrival is one of the request's vias (HERE
// tags those places with `waypoint`) or at the last section. If that does not
// produce exactly `legCount` legs, HERE has answered in a shape this does not
// understand, and the sections pass through untouched.
//
// A merged leg's duration is the sum of its sections' — the crossing counted
// as HERE times it, as it was before the merge; boarding and deboarding
// (HERE's pre/postActions) stay out, as they always were.
export function legSections<S extends LegSection>(sections: S[], legCount: number): Array<S | LegSection> {
  if (sections.length === legCount) return sections
  const groups: S[][] = [[]]
  sections.forEach((section, i) => {
    groups[groups.length - 1].push(section)
    if (section.arrival?.place?.waypoint !== undefined && i < sections.length - 1) groups.push([])
  })
  if (groups.length !== legCount) return sections
  return groups.map((group): S | LegSection => {
    if (group.length === 1) return group[0]
    const first = group[0]
    const last = group[group.length - 1]
    return {
      id: first.id,
      polyline: joinPolylines(group.map((s) => s.polyline)),
      summary: {
        duration: group.reduce((acc, s) => acc + (s.summary?.duration ?? 0), 0),
        length: group.reduce((acc, s) => acc + (s.summary?.length ?? 0), 0),
      },
      notices: group.flatMap((s) => s.notices ?? []),
      departure: first.departure,
      arrival: last.arrival,
    }
  })
}

// Flexible polylines cannot be concatenated as strings (each one restarts its
// deltas from zero), so the leg's line is decoded, joined and re-encoded at
// the first part's precision. Consecutive sections share their boundary
// vertex; it is kept once. "Same vertex" is judged at that precision: decoding
// sums float deltas, so the end of one part and the start of the next come
// back a few ulps apart.
export function joinPolylines(parts: Array<string | undefined>): string | undefined {
  const decoded = parts.filter((p): p is string => Boolean(p)).map((p) => decodePolyline(p))
  if (!decoded.length) return undefined
  const { precision, thirdDim, thirdDimPrecision } = decoded[0]
  const scale = 10 ** precision
  const same = (a: number[], b: number[]) =>
    Math.round(a[0] * scale) === Math.round(b[0] * scale) && Math.round(a[1] * scale) === Math.round(b[1] * scale)
  const points: number[][] = []
  for (const { polyline } of decoded) {
    const prev = points[points.length - 1]
    const start = prev && polyline[0] && same(prev, polyline[0]) ? 1 : 0
    for (let i = start; i < polyline.length; i++) points.push(polyline[i])
  }
  return encodePolyline({ polyline: points, precision, thirdDim, thirdDimPrecision })
}
