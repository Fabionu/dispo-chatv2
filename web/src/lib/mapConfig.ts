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

export const mapConfigured = Boolean(apiKey && region && (mapName || mapStyle))

// MapLibre style descriptor URL for Amazon Location. Supports BOTH Maps APIs so
// either kind of key works — picked by which env var is set:
//   • VITE_AWS_LOCATION_MAP_NAME  → legacy v1 Maps (a Map resource you created):
//       /maps/v0/maps/{name}/style-descriptor?key=…   (key allows geo:GetMap*)
//   • VITE_AWS_LOCATION_MAP_STYLE → v2 GeoMaps (built-in styles, no resource):
//       /v2/styles/{style}/descriptor?key=…&color-scheme=Dark  (GetTile/GetStaticMap)
// Returns null when unconfigured so callers can show an empty state. The key is
// URL-encoded defensively (it's the key VALUE, never the ARN).
export function mapStyleUrl(): string | null {
  if (!apiKey || !region) return null
  const key = encodeURIComponent(apiKey)
  if (mapName) {
    return `https://maps.geo.${region}.amazonaws.com/maps/v0/maps/${mapName}/style-descriptor?key=${key}`
  }
  if (mapStyle) {
    return `https://maps.geo.${region}.amazonaws.com/v2/styles/${mapStyle}/descriptor?key=${key}&color-scheme=Dark`
  }
  return null
}
