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

// NOTE: Truck restrictions are now shown via the v2 `travel-modes=Truck`
// parameter on the Standard style (see mapStyleUrl) — no legacy
// VectorHereExploreTruck Map resource or separate truck key is needed.

export const mapConfigured = Boolean(apiKey && region && (mapName || mapStyle))

// Map appearance modes. Dark/Light switch the base style (v2 color-scheme);
// Satellite uses the v2 Hybrid style (aerial imagery + roads/labels); Truck adds
// the v2 truck-restriction overlay (travel-modes=Truck) on the Standard style.
export type MapColorScheme = 'Dark' | 'Light' | 'Satellite' | 'Truck'

// MapLibre style descriptor URL for Amazon Location v2 GeoMaps. The active mode
// picks the style + parameters; everything uses the same scoped v2 key.
//   • Dark/Light  → Standard style with color-scheme (light/dark theme)
//   • Satellite   → Hybrid style (aerial imagery + roads/labels)
//   • Truck       → Standard + `travel-modes=Truck`: adds road/bridge/tunnel
//                   truck layers and restriction/hazmat shields, served from
//                   tiles that carry the Logistics (truck-restriction) data.
//                   This is the modern replacement for the legacy
//                   VectorHereExploreTruck Map resource (whose tiles had no
//                   restriction data). No globe / 3D.
// Returns null when unconfigured so callers can show an empty state. The key is
// URL-encoded defensively (it's the key VALUE, never the ARN).
export function mapStyleUrl(colorScheme: MapColorScheme = 'Dark'): string | null {
  if (!apiKey || !region) return null
  const key = encodeURIComponent(apiKey)
  const base = `https://maps.geo.${region}.amazonaws.com/v2/styles`
  if (colorScheme === 'Truck') {
    return `${base}/Standard/descriptor?travel-modes=Truck&color-scheme=Dark&key=${key}`
  }
  if (colorScheme === 'Satellite') {
    return `${base}/Hybrid/descriptor?key=${key}`
  }
  // Legacy v1 Map resource (only if VITE_AWS_LOCATION_MAP_NAME is set).
  if (mapName) {
    return `https://maps.geo.${region}.amazonaws.com/maps/v0/maps/${mapName}/style-descriptor?key=${key}`
  }
  if (mapStyle) {
    return `${base}/${mapStyle}/descriptor?key=${key}&color-scheme=${colorScheme}`
  }
  return null
}
