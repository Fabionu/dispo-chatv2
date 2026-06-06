// Amazon Location Service Maps config (frontend). Reads the Vite env values and
// builds the MapLibre style URL. The API key is a Maps-scoped read key — never a
// tracker/write credential, and never hardcoded. Everything is optional: when
// any value is missing, `mapStyleUrl()` returns null and the map UI renders a
// themed "not configured" state instead of failing.

const apiKey = import.meta.env.VITE_AWS_LOCATION_API_KEY
const region = import.meta.env.VITE_AWS_LOCATION_REGION
// v2 GeoMaps built-in style name (Standard | Monochrome | Hybrid | Satellite).
const mapStyle = import.meta.env.VITE_AWS_LOCATION_MAP_STYLE
// Legacy v1 Maps: the name of a Map RESOURCE you created in Amazon Location
// (key must allow geo:GetMap*). When set, this takes precedence over mapStyle.
const mapName = import.meta.env.VITE_AWS_LOCATION_MAP_NAME

// HERE truck-restrictions visual style ("VectorHereExploreTruck" / "HERE Explore
// Truck") — shows truck attributes like width/height/weight limits and HAZMAT.
// It's only available as a LEGACY v1 Map RESOURCE (v2 GeoMaps has no truck style),
// so this is the name of a Map resource you created with that style. The legacy
// descriptor needs a geo:GetMap* key; if that key differs from the main (v2) key,
// set VITE_AWS_LOCATION_TRUCK_API_KEY — otherwise the main key is reused. Both
// optional: when unset, Truck mode shows a themed "not available" message.
//
// Accept a few aliases because the AWS console calls the capability a style
// ("VectorHereExploreTruck"), while the legacy descriptor URL needs the Map
// resource name that was created with that style.
const truckMapName =
  import.meta.env.VITE_AWS_LOCATION_MAP_TRUCK_NAME ||
  import.meta.env.VITE_AWS_LOCATION_TRUCK_MAP_NAME ||
  import.meta.env.VITE_AWS_LOCATION_TRUCK_MAP_STYLE
const truckApiKey = import.meta.env.VITE_AWS_LOCATION_TRUCK_API_KEY || apiKey

export const mapConfigured = Boolean(apiKey && region && (mapName || mapStyle))
// The HERE truck style is usable only when a truck Map resource + key + region
// are all present.
export const truckMapConfigured = Boolean(truckApiKey && region && truckMapName)

// Map appearance modes. Dark/Light switch the base style (v2 color-scheme); Truck
// switches to the HERE truck-restrictions style (legacy resource).
export type MapColorScheme = 'Dark' | 'Light' | 'Truck'

// Legacy v1 descriptor for the HERE truck-restrictions Map resource. Returns null
// when not configured so callers can show a themed "not available" message. The
// key is URL-encoded defensively (it's the key VALUE, never the ARN). Legacy
// vector styles are flat — no globe / 3D.
export function truckMapStyleUrl(): string | null {
  if (!truckApiKey || !region || !truckMapName) return null
  const key = encodeURIComponent(truckApiKey)
  return `https://maps.geo.${region}.amazonaws.com/maps/v0/maps/${truckMapName}/style-descriptor?key=${key}`
}

// MapLibre style descriptor URL for Amazon Location. Supports BOTH Maps APIs so
// either kind of key works — picked by which env var is set:
//   • VITE_AWS_LOCATION_MAP_NAME  → legacy v1 Maps (a Map resource you created):
//       /maps/v0/maps/{name}/style-descriptor?key=…   (key allows geo:GetMap*)
//   • VITE_AWS_LOCATION_MAP_STYLE → v2 GeoMaps (built-in styles, no resource):
//       /v2/styles/{style}/descriptor?key=…&color-scheme=Dark  (GetTile/GetStaticMap)
// `colorScheme` switches the v2 built-in style between Dark (default) and Light.
// Returns null when unconfigured so callers can show an empty state. The key is
// URL-encoded defensively (it's the key VALUE, never the ARN).
export function mapStyleUrl(colorScheme: MapColorScheme = 'Dark'): string | null {
  // Truck restrictions = the HERE VectorHereExploreTruck legacy style. v2 GeoMaps
  // has no built-in truck style, so this always routes to the legacy resource
  // (null when unconfigured → caller shows the "not available" message).
  if (colorScheme === 'Truck') return truckMapStyleUrl()
  if (!apiKey || !region) return null
  const key = encodeURIComponent(apiKey)
  if (mapName) {
    return `https://maps.geo.${region}.amazonaws.com/maps/v0/maps/${mapName}/style-descriptor?key=${key}`
  }
  if (mapStyle) {
    return `https://maps.geo.${region}.amazonaws.com/v2/styles/${mapStyle}/descriptor?key=${key}&color-scheme=${colorScheme}`
  }
  return null
}
