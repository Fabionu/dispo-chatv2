// Shared types for the HERE-only maps/routing feature. These mirror the shapes
// the server's `/api/here/*` proxy returns (see server/src/routes/here.ts) — the
// browser never talks to HERE's REST APIs directly, only to our proxy.

export type LatLng = { lat: number; lng: number }

// One result from HERE Geocoding & Search (Discover), surfaced by the proxy's
// /api/here/search. Used for origin/destination autocomplete.
export type HerePlace = {
  id: string
  title: string
  label: string
  position: LatLng
}

// Truck profile the user enters in the planner. All optional — an empty field is
// simply omitted from the HERE request. Units match the HERE Routing v8 API:
// dimensions in centimetres, gross weight in kilograms, counts are plain integers.
export type TruckProfile = {
  heightCm?: number
  widthCm?: number
  lengthCm?: number
  grossWeightKg?: number
  axleCount?: number
  trailerCount?: number
}

// The truck profile as raw form strings (what the inputs bind to and what a saved
// preset stores). Parsed into a `TruckProfile` only when a route is requested.
export type TruckProfileForm = {
  heightCm: string
  widthCm: string
  lengthCm: string
  grossWeightKg: string
  axleCount: string
  trailerCount: string
}

// A HERE route notice/warning (e.g. a violated truck restriction on the route).
export type RouteNotice = {
  code?: string
  title?: string
  severity?: string
}

// One section of a calculated route. `polyline` is a HERE flexible polyline
// (decoded client-side for drawing). `summary.duration` is seconds,
// `summary.length` is metres. `departure`/`arrival` are the ROAD-SNAPPED
// coordinates of the section's boundary waypoints (null when HERE omits them) —
// used to place markers on the road rather than the raw geocoded point.
export type RouteSection = {
  id?: string
  polyline?: string
  summary?: { duration?: number; length?: number; baseDuration?: number }
  notices: RouteNotice[]
  departure?: LatLng | null
  arrival?: LatLng | null
}

// A calculated truck route: its sections plus a rolled-up summary (total seconds
// and metres across all sections).
export type TruckRoute = {
  id?: string
  sections: RouteSection[]
  summary: { duration: number; length: number }
}

// A waypoint marker to render on the map, in route order. `position` is the
// coordinate the marker sits on (the snapped one once a route exists). `label`
// is the badge text for intermediate stops (e.g. "1", "2").
export type RouteMarkerKind = 'origin' | 'stop' | 'destination'
export type RouteMarker = {
  id: string
  kind: RouteMarkerKind
  position: LatLng
  label?: string
}

// The single shared structure for every route point — start, intermediate
// stops, and destination all use it. `coordinates` is the coordinate actually
// used for routing/markers/display. `source` records how it was added (HERE
// search vs map right-click); `snapped` is true once the coordinate has been
// snapped to a road/address (via reverse geocode on add, or the routing
// response's road-snapped boundary coords). Kept deliberately plain + reusable
// so a route can later be attached to / shared inside a vehicle room.
export type RoutePointRole = 'start' | 'stop' | 'destination'
export type RoutePoint = {
  id: string
  role: RoutePointRole
  label: string
  coordinates: LatLng
  source: 'search' | 'map' | 'drag'
  snapped?: boolean
  // Desired heading of travel (degrees, 0–359 clockwise from north) at this
  // point. Set when a point is dragged near an existing route so HERE matches
  // the correct carriageway/direction (sent as the waypoint `course`) instead of
  // snapping to the oncoming road. Undefined = let HERE pick freely.
  course?: number
}

// A routing waypoint sent to the proxy: a coordinate plus an optional `course`
// (desired travel heading) so HERE snaps to the correct direction/carriageway.
export type RouteWaypoint = LatLng & { course?: number }

// A screen-space snap candidate: a geographic point produced by converting ONE
// sampled screen pixel near the cursor back to lat/lng, tagged with `px` — its
// pixel distance from the release point. The candidate snap (api.here
// .snapCandidates) evaluates several of these so a dropped stop lands on the road
// actually rendered under the cursor, not just the nearest road to the single raw
// release coordinate (which, zoomed out, can be a different/parallel road). The
// first candidate is always the exact release pixel (px 0).
export type ScreenGeoCandidate = { lat: number; lng: number; px: number }
