/// <reference types="vite/client" />

// Amazon Location Service (frontend Maps). The Maps API key is scoped to map
// reads only — it is NOT a tracker/write credential. All values are optional;
// when unset, the map UI shows a themed "not configured" state.
interface ImportMetaEnv {
  readonly VITE_AWS_LOCATION_API_KEY?: string
  readonly VITE_AWS_LOCATION_REGION?: string
  // v2 GeoMaps built-in style name (Standard | Monochrome | Hybrid | Satellite).
  readonly VITE_AWS_LOCATION_MAP_STYLE?: string
  // Legacy v1 Maps: a Map resource name you created (takes precedence if set).
  readonly VITE_AWS_LOCATION_MAP_NAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
