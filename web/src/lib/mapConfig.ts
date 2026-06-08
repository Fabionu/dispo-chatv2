// Amazon Location Service Maps config (frontend). Reads the Vite env values and
// builds the MapLibre style URL. The API key is a Maps-scoped read key — never a
// tracker/write credential, and never hardcoded. Everything is optional: when
// any value is missing, `mapStyleUrl()` returns null and the map UI renders a
// themed "not configured" state instead of failing.

const apiKey = import.meta.env.VITE_AWS_LOCATION_API_KEY
const region = import.meta.env.VITE_AWS_LOCATION_REGION

// The app uses a single basemap: the v2 GeoMaps Standard style in Truck travel
// mode (truck-restriction overlays). It needs only the scoped key + region — no
// style-name or legacy Map resource is required.
export const mapConfigured = Boolean(apiKey && region)

// Map appearance. The basemap is always the Truck travel-mode style; this only
// chooses the light or dark colour theme for it.
export type MapColorScheme = 'Dark' | 'Light'

// MapLibre style descriptor URL for Amazon Location v2 GeoMaps. Uses the
// Standard style with `travel-modes=Truck`: the familiar colourful road map
// (like Google's basic map — coloured roads, parks, water) plus the truck
// road/bridge/tunnel layers and restriction/hazmat shields. `colorScheme` only
// swaps the light/dark theme. No globe / 3D. Returns null when unconfigured so
// callers can show an empty state. The key is URL-encoded defensively (it's the
// key VALUE, never the ARN).
export function mapStyleUrl(colorScheme: MapColorScheme = 'Dark'): string | null {
  if (!apiKey || !region) return null
  const key = encodeURIComponent(apiKey)
  const base = `https://maps.geo.${region}.amazonaws.com/v2/styles`
  return `${base}/Standard/descriptor?travel-modes=Truck&color-scheme=${colorScheme}&key=${key}`
}
