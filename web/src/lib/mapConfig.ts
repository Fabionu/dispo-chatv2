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

// Which v2 GeoMaps basemap to render:
//  - 'Standard'  the colourful road map (truck-restriction overlay, themeable).
//  - 'Satellite' aerial/satellite imagery only (no labels).
//  - 'Hybrid'    satellite imagery WITH road/place labels on top.
// Standard is the default; Satellite/Hybrid are imagery basemaps so the
// light/dark theme and the Truck overlay don't apply to them.
export type MapBaseStyle = 'Standard' | 'Satellite' | 'Hybrid'

// Satellite imagery has no labels/roads to drape traffic over, so the v2 GeoMaps
// `traffic` parameter is rejected on it (400). It IS supported on Standard and
// Hybrid (verified against the live API), so the traffic overlay is offered on
// those two only.
export function baseStyleSupportsTraffic(baseStyle: MapBaseStyle): boolean {
  return baseStyle !== 'Satellite'
}

// MapLibre style descriptor URL for Amazon Location v2 GeoMaps. Returns null when
// unconfigured so callers can show an empty state. The key is URL-encoded
// defensively (it's the key VALUE, never the ARN).
//
//  - Standard uses the familiar colourful road map with `travel-modes=Truck`
//    (truck road/bridge/tunnel layers + restriction/hazmat shields) and the
//    light/dark `color-scheme`.
//  - Satellite / Hybrid are imagery basemaps: no truck overlay and no colour
//    scheme (the imagery isn't themeable), so only the key is appended. Hybrid
//    additionally renders road/place labels over the imagery.
//  - `traffic` overlays Amazon Location's own real-time traffic (congestion,
//    construction, incidents) baked into the basemap via the `traffic=All`
//    descriptor parameter — same scoped key, no extra provider. Applied to
//    Standard/Hybrid only (Satellite rejects it).
//
// No globe / 3D — the projection is pinned flat by the caller.
export function mapStyleUrl(
  colorScheme: MapColorScheme = 'Dark',
  baseStyle: MapBaseStyle = 'Standard',
  traffic = false,
): string | null {
  if (!apiKey || !region) return null
  const key = encodeURIComponent(apiKey)
  const base = `https://maps.geo.${region}.amazonaws.com/v2/styles`
  const trafficParam = traffic && baseStyleSupportsTraffic(baseStyle) ? '&traffic=All' : ''
  if (baseStyle === 'Standard') {
    return `${base}/Standard/descriptor?travel-modes=Truck&color-scheme=${colorScheme}${trafficParam}&key=${key}`
  }
  // Satellite / Hybrid: imagery basemaps. Just the key — no theme/Truck params.
  return `${base}/${baseStyle}/descriptor?key=${key}${trafficParam}`
}
