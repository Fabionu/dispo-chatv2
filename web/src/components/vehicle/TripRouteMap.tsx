import { useEffect, useMemo, useState } from 'react'
import Spinner from '../Spinner'
import HereMap from '../here/HereMap'
import { computeTripRoute, routablePoints, type TripRoute } from '../../lib/tripRoute'
import type { VehicleStop } from '../../lib/vehicleOps'
import type { RouteMarker } from '../../lib/here/types'

type Props = {
  // The active trip's stops — the route + markers derive from their coordinates.
  stops: VehicleStop[]
  // The trip's last-computed route (if any) — used to draw the line instantly
  // before a fresh recompute returns.
  route?: TripRoute
}

// Read-only map of the active trip's route, opened from the conversation header.
// Derives waypoints from the stop coordinates (origin → stops → destination),
// draws the saved route line immediately when available, and recomputes from the
// current stops in the background so distance/duration stay fresh. Planning data
// only — no live GPS/tracking. Reuses the shared HERE map component.
export default function TripRouteMap({ stops, route }: Props) {
  // Ordered points with valid coordinates (the route calculation's own reader),
  // and a stable signature so we only recompute when the coordinates change
  // (stops is a fresh array on each parent render).
  const points = useMemo(() => routablePoints(stops), [stops])
  const sig = useMemo(
    () => points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|'),
    [points],
  )

  const [data, setData] = useState<TripRoute | null>(route?.status === 'ok' ? route : null)
  const [loading, setLoading] = useState(false)

  // Recompute whenever the coordinate signature changes (and on first open).
  useEffect(() => {
    if (points.length < 2) {
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    computeTripRoute(stops).then((r) => {
      if (!cancelled) {
        setData(r)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
    // points/stops are captured via the coordinate signature; recompute on change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  const markers = useMemo<RouteMarker[]>(
    () =>
      points.map((p, i) => ({
        id: `stop-${i}`,
        kind: i === 0 ? 'origin' : i === points.length - 1 ? 'destination' : 'stop',
        position: { lat: p.lat, lng: p.lng },
        label: i > 0 && i < points.length - 1 ? String(i) : undefined,
      })),
    [points],
  )

  // Prefer freshly-computed geometry; fall back to the saved polylines so the
  // line shows instantly on open.
  const polylines = data?.polylines ?? route?.polylines ?? []
  // Center on the first stop only until a route line exists — once it does, the
  // map's own route auto-fit frames the whole route (so we don't fight it).
  const center = !polylines.length && points[0] ? { lat: points[0].lat, lng: points[0].lng } : null
  const ok = data?.status === 'ok'

  if (points.length < 2) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg px-6 text-center">
        <div className="text-[0.78125rem] text-muted leading-[1.5]">
          Add coordinates to at least two stops to see the trip route.
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg relative">
      <div className="flex-1 min-h-0 relative">
        <HereMap
          className="absolute inset-0"
          markers={markers}
          routePolylines={polylines}
          routeDistanceLabel={ok ? (data?.distanceText ?? null) : null}
          truckOverlay={false}
          center={center}
        />
        {/* Compact route summary overlay — distance + driving time, or a quiet
            calculating state. */}
        <div className="absolute top-2 left-2 rounded-full bg-bg/80 backdrop-blur-sm border border-white/[0.08] px-3 py-1.5 text-[0.71875rem] flex items-center gap-2 shadow-lg">
          {loading && !ok ? (
            <>
              <Spinner size={13} /> <span className="text-muted">Calculating route…</span>
            </>
          ) : ok ? (
            <span className="text-text tabular-nums">
              {data?.distanceText} · {data?.durationText}
            </span>
          ) : (
            <span className="text-muted">Route unavailable — showing stops only.</span>
          )}
        </div>
      </div>
    </div>
  )
}
