/// <reference types="vite/client" />

// Amazon Location Service (frontend Maps). The Maps API key is scoped to map
// reads only — it is NOT a tracker/write credential. All values are optional;
// when unset, the map UI shows a themed "not configured" state.
interface ImportMetaEnv {
  // HERE Maps API key — powers the route planner's HERE logistics map (with the
  // HGV/truck restriction overlay), HERE Routing v8 and HERE Geocoding & Search.
  // A read-scoped key; never hardcoded. When unset, the route planner shows a
  // themed "not configured" state.
  readonly VITE_HERE_API_KEY?: string
  // Amazon Location Service (still used by the vehicle-location modal's MapLibre
  // map only — NOT the route planner). Maps-scoped read key + region.
  readonly VITE_AWS_LOCATION_API_KEY?: string
  readonly VITE_AWS_LOCATION_REGION?: string
  // Legacy v0 HERE "Explore Truck" map resource (VectorHereExploreTruck) used for
  // the default road basemap. Optional — defaults to "TruckMapDispoChat".
  readonly VITE_AWS_LOCATION_TRUCK_MAP_NAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
