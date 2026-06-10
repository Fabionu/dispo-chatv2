// Lightweight types + helpers shared between the route planner workspace and the
// (lazily-loaded) HERE map component. Kept in its own module so the workspace can
// reference them WITHOUT statically importing the heavy HereMapView/HERE SDK —
// that would pull the SDK into the main bundle and defeat the lazy load.

export type LatLng = { lat: number; lng: number }

// A route waypoint with its role, so the map can draw a clear start dot, numbered
// stop dots, and a prominent destination pin. `stopIndex` ties a stop dot back to
// its position in the caller's stops[] array (for drag/remove).
export type RoutePoint = LatLng & {
  kind: 'start' | 'stop' | 'end'
  index?: number
  stopIndex?: number
}

// Light/Dark basemap appearance. The HERE logistics map ships day + night
// variants; switching swaps the base layer (and re-applies restrictions).
export type MapColorScheme = 'Dark' | 'Light'

// Which basemap to render:
//  - 'Standard'  the HERE *logistics* vector map (HGV/truck restriction overlay).
//  - 'Satellite' HERE satellite raster imagery (no labels).
//  - 'Hybrid'    HERE satellite raster imagery WITH road/place labels.
export type MapBaseStyle = 'Standard' | 'Satellite' | 'Hybrid'

// HERE traffic flow overlays the vector basemaps; satellite imagery has nothing
// to drape it over, so the toggle is offered on Standard/Hybrid only.
export function baseStyleSupportsTraffic(baseStyle: MapBaseStyle): boolean {
  return baseStyle !== 'Satellite'
}
