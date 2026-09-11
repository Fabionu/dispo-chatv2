import type { WorkspacePlace } from '../../lib/types'
import type {
  DriverMapMarker,
  DriverMapTrail,
  LatLng,
  RouteMarker,
  RouteMarkerKind,
  ScreenGeoCandidate,
} from '../../lib/here/types'

// ONE contract, two map engines.
//
// The planner and the trip map talk to "the map" through these props and
// nothing else — markers in, gestures out. That was already true of HereMap;
// naming the contract is what lets a second engine stand in for it. GoogleMap
// implements every field below. HereMap implements the same fields (its own
// Props type is structurally identical) and is what MapView switches to when
// the HGV overlay is on, because that overlay is a HERE basemap and exists
// nowhere else.
//
// Everything a caller passes is in geo or container-pixel terms. Neither engine
// leaks a native type across this boundary — no google.maps.LatLng, no H.geo
// anything — so the caller cannot come to depend on one of them by accident.
export type MapViewport = { center: LatLng; zoom: number }

export type MapSurfaceProps = {
  /** Waypoint markers in route order (origin → stops → destination). */
  markers: RouteMarker[]
  /** Live-driver positions. Excluded from auto-fit. */
  driverMarkers?: DriverMapMarker[]
  /** The path each driver has actually driven. Excluded from auto-fit. */
  driverTrails?: DriverMapTrail[]
  /** Shared workspace places. Static; excluded from auto-fit. */
  savedPlaces?: WorkspacePlace[]
  /** Encoded HERE flexible polylines, one per route section. Empty = no route. */
  routePolylines: string[]
  /** Scale the route stroke down at overview zooms. */
  scaleRouteWidthWithZoom?: boolean
  /** Pre-formatted total distance for the mid-route badge. Distance only —
   *  the time is on the panel's cards (user, 2026-09-11), and a badge that
   *  repeated it made the map say the same thing twice. */
  routeDistanceLabel?: string | null
  /** Whether the HGV truck-restriction overlay is on. */
  truckOverlay: boolean
  onTruckOverlayAvailabilityChange?: (available: boolean) => void
  onMapContextMenu?: (info: {
    lat: number
    lng: number
    x: number
    y: number
    zoom: number
    candidates: ScreenGeoCandidate[]
  }) => void
  onMapViewChange?: () => void
  onMarkerDragEnd?: (id: string, candidates: ScreenGeoCandidate[], zoom: number) => void
  onMarkerClick?: (info: { id: string; kind: RouteMarkerKind; x: number; y: number }) => void
  onSavedPlaceClick?: (info: { id: string; x: number; y: number }) => void
  onRouteDragEnd?: (sectionIndex: number, candidates: ScreenGeoCandidate[], zoom: number) => void
  /**
   * The cursor, while the route line is being dragged — once per pointer move.
   * The consumer answers with `previewPolylines`/`previewPoint` so the drag
   * shows where the route would go BEFORE it is released. Keep it cheap: the
   * consumer throttles the network, the engine does not.
   */
  onRouteDrag?: (sectionIndex: number, point: LatLng, zoom: number) => void
  /** Same, for a waypoint marker being dragged. */
  onMarkerDrag?: (id: string, point: LatLng, zoom: number) => void
  /**
   * A provisional route (HERE flexible polylines) drawn dashed above the real
   * one while a drag is in progress. Null/empty = nothing drawn.
   */
  previewPolylines?: string[] | null
  /**
   * Where the dragged point matched a road. The route-drag ghost dot sits here,
   * on the road, rather than under the cursor, so the user sees what they will
   * get. Null = ghost under the cursor.
   */
  previewPoint?: LatLng | null
  /** Width (px) of the panel overlapping the map's left edge. */
  panelInsetPx?: number
  /** External recenter request. */
  center?: LatLng | null
  objectsDraggable?: boolean
  className?: string
  /**
   * Where to open. Used by MapView to hand the viewport from one engine to the
   * other when the HGV toggle swaps them, so the map does not re-fit or jump
   * back to the default view every time the overlay is switched.
   */
  initialView?: MapViewport | null
  /** The engine's own view, reported as it changes (hot during a pan — keep
   *  the handler cheap), for that handoff. */
  onViewportChange?: (view: MapViewport) => void
  /**
   * Street View opened (true) or closed (false) over the map. Google engine
   * only — HERE has no panoramas. The planner uses it to clear its own cards
   * off the panorama.
   */
  onStreetViewChange?: (open: boolean) => void
}
