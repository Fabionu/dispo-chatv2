import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { LatLng, RouteWaypoint, TruckProfile, TruckRoute } from '../lib/here/types'

// Drag-and-route the way a maps app does it (user, 2026-09-11: "from any zoom
// you can hit any street").
//
// Two things make that feel:
//
// 1. THE ROUTE IS THE PREVIEW. While the line (or a marker) is being dragged,
//    the route through the point under the cursor is computed as fast as the
//    router answers and drawn over the real one. The user watches the road it
//    picked before letting go; a release then commits the last preview, with
//    nothing left to compute. Before this, a drag showed a ghost dot and the
//    answer arrived after release — a drag that felt like a guess.
//
// 2. THE SNAP IS THE ROUTER'S, SIZED BY THE ZOOM. The dragged waypoint carries
//    HERE's `snapRadius`: "match to the most significant road within R
//    metres". R is what a few screen pixels cover at the current zoom, so at
//    country zoom (a pixel is a kilometre) the motorway drawn under the cursor
//    wins over the lane the raw coordinate happens to touch, and at street
//    zoom R is a few metres and the nearest road wins. One router call replaces
//    the ring of reverse-geocodes and the detour tiebreak the release used to
//    run, and it is the same call that draws the preview.
//
// The hook is engine-agnostic: it takes waypoints in travel order and answers
// with a route, its polylines and where the dragged point landed. Both maps
// (Route planner, trip map) drive it from the shared map contract's
// `onRouteDrag` / `onMarkerDrag` and hand `preview` back as
// `previewPolylines` / `previewPoint`.

export type DragRequest = {
  /** Every waypoint in travel order, the dragged one included. */
  waypoints: RouteWaypoint[]
  /** Index in `waypoints` of the point being dragged (it carries the snapRadius). */
  dragged: number
  truck?: TruckProfile
}

export type DragPreview = {
  route: TruckRoute
  polylines: string[]
  /** Where HERE matched the dragged point — on the road it chose. */
  matched: LatLng
}

// How close to the line a release counts as "on it", in screen pixels. The snap
// radius is this many pixels' worth of ground at the current zoom.
const SNAP_PX = 8
const SNAP_MIN_M = 25
const SNAP_MAX_M = 30_000

/** Metres that SNAP_PX screen pixels cover at this zoom and latitude (Web Mercator). */
export function snapRadiusForZoom(zoom: number, lat: number): number {
  const metersPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
  return Math.round(Math.min(SNAP_MAX_M, Math.max(SNAP_MIN_M, metersPerPx * SNAP_PX)))
}

/** The dragged waypoint's road-matched position, read off the route's section boundaries. */
function matchedPoint(route: TruckRoute, dragged: number, fallback: LatLng): LatLng {
  const sections = route.sections
  const p = dragged === 0 ? sections[0]?.departure : sections[dragged - 1]?.arrival
  return p ?? fallback
}

function keyOf(req: DragRequest): string {
  return (
    req.waypoints
      .map((w) => `${w.lat.toFixed(6)},${w.lng.toFixed(6)},${w.course ?? ''},${w.snapRadius ?? ''}`)
      .join('|') + `#${req.dragged}`
  )
}

async function fetchPreview(req: DragRequest): Promise<DragPreview> {
  const { waypoints, dragged, truck } = req
  const { route } = await api.here.truckRoute({
    origin: waypoints[0],
    destination: waypoints[waypoints.length - 1],
    via: waypoints.slice(1, -1),
    ...(truck ? { truck } : {}),
  })
  const polylines = route.sections.map((s) => s.polyline).filter((p): p is string => Boolean(p))
  return { route, polylines, matched: matchedPoint(route, dragged, waypoints[dragged]) }
}

export function useRouteDragPreview() {
  const [preview, setPreview] = useState<DragPreview | null>(null)
  const st = useRef({
    // One request in flight at a time; the newest waiting request replaces any
    // older one, so a fast drag never queues up a backlog of stale routes.
    inflight: false,
    pending: null as DragRequest | null,
    // The last answer, keyed by its request, so a release at the same point
    // commits it without another round-trip.
    last: null as { key: string; result: DragPreview } | null,
    // Bumped on release/cancel; an answer from an older generation is dropped.
    gen: 0,
    mounted: true,
  })

  useEffect(() => {
    const s = st.current
    s.mounted = true
    return () => {
      s.mounted = false
    }
  }, [])

  const pump = useCallback(async () => {
    const s = st.current
    if (s.inflight) return
    while (s.pending) {
      const req = s.pending
      s.pending = null
      s.inflight = true
      const gen = s.gen
      try {
        const result = await fetchPreview(req)
        if (s.mounted && gen === s.gen) {
          s.last = { key: keyOf(req), result }
          setPreview(result)
        }
      } catch {
        // A preview that fails to compute simply does not draw; the release
        // asks again on its own.
      } finally {
        s.inflight = false
      }
    }
  }, [])

  /** Ask for a preview of this drag state; coalesces while one is in flight. */
  const update = useCallback(
    (req: DragRequest) => {
      st.current.pending = req
      void pump()
    },
    [pump],
  )

  /**
   * The drag was released here: the last preview if it is for this exact
   * state, otherwise one fresh computation. Clears the drawn preview either
   * way — the caller commits the result as the real route. Null = the router
   * could not answer, and the caller keeps whatever it had.
   */
  const resolve = useCallback(async (req: DragRequest): Promise<DragPreview | null> => {
    const s = st.current
    s.pending = null
    s.gen++
    setPreview(null)
    const key = keyOf(req)
    if (s.last?.key === key) return s.last.result
    try {
      return await fetchPreview(req)
    } catch {
      return null
    }
  }, [])

  /** Drop the preview (drag abandoned, engine swapped, component leaving). */
  const cancel = useCallback(() => {
    const s = st.current
    s.pending = null
    s.gen++
    s.last = null
    setPreview(null)
  }, [])

  return { preview, update, resolve, cancel }
}
