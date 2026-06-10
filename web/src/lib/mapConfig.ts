// Amazon Location Service Maps config (frontend). Reads the Vite env values and
// builds the MapLibre style URL. The API key is a Maps-scoped read key — never a
// tracker/write credential, and never hardcoded. Everything is optional: when
// any value is missing, `mapStyleUrl()` returns null and the map UI renders a
// themed "not configured" state instead of failing.

const apiKey = import.meta.env.VITE_AWS_LOCATION_API_KEY
const region = import.meta.env.VITE_AWS_LOCATION_REGION

// Legacy v0 Map resource for the default road basemap: a HERE "Explore Truck"
// map (created from the VectorHereExploreTruck style) so the road view carries
// HGV/truck restriction visuals (height/weight/length/hazmat, restricted roads)
// baked into the tiles. Overridable via env; defaults to the resource created
// for this app. MUST live in VITE_AWS_LOCATION_REGION, and the API key's policy
// must allow the legacy geo:GetMapTile / GetMapStyleDescriptor / GetMapGlyphs /
// GetMapSprites actions on this map's ARN (the v0 endpoints authenticate
// per-request — see transformMapRequest below).
const truckMapName =
  import.meta.env.VITE_AWS_LOCATION_TRUCK_MAP_NAME?.trim() || 'TruckMapDispoChat'

// Only the key + region are required; the legacy truck map name has a default.
export const mapConfigured = Boolean(apiKey && region)

// Map appearance. Light/Dark only affects the v2 imagery-adjacent params; the
// legacy HERE Explore Truck road basemap is a single baked style and ignores it.
export type MapColorScheme = 'Dark' | 'Light'

// Which basemap to render:
//  - 'Standard'  the HERE Explore Truck road map (legacy v0 resource) with HGV
//                restriction visuals baked in.
//  - 'Satellite' v2 GeoMaps aerial/satellite imagery only (no labels).
//  - 'Hybrid'    v2 GeoMaps satellite imagery WITH road/place labels on top.
// Standard is the default; Satellite/Hybrid are v2 imagery basemaps.
export type MapBaseStyle = 'Standard' | 'Satellite' | 'Hybrid'

// Real-time traffic is a v2 GeoMaps overlay (`traffic=All`). The legacy HERE
// Standard basemap can't carry it, and Satellite has no roads to drape it over,
// so it's offered on the v2 Hybrid basemap only (verified against the live API).
export function baseStyleSupportsTraffic(baseStyle: MapBaseStyle): boolean {
  return baseStyle === 'Hybrid'
}

// MapLibre style descriptor URL. Returns null when unconfigured so callers can
// show an empty state.
//
//  - Standard → the legacy v0 HERE Explore Truck Map resource's style descriptor
//    (HGV restrictions baked in). It's one fixed style: color-scheme and traffic
//    don't apply, so those params are intentionally not appended here.
//  - Satellite / Hybrid → v2 GeoMaps imagery basemaps (the key is in the URL and
//    propagates to sub-resources; no transformRequest needed for these).
//  - `traffic` overlays Amazon Location's real-time traffic on Hybrid only.
//
// No globe / 3D — the projection is pinned flat by the caller.
export function mapStyleUrl(
  colorScheme: MapColorScheme = 'Dark',
  baseStyle: MapBaseStyle = 'Standard',
  traffic = false,
): string | null {
  if (!apiKey || !region) return null
  const key = encodeURIComponent(apiKey)

  if (baseStyle === 'Standard') {
    // Legacy v0 Maps endpoint. The key is appended here for the descriptor fetch;
    // transformMapRequest re-appends it to the tile/glyph/sprite sub-requests the
    // descriptor references (which don't carry it themselves).
    return (
      `https://maps.geo.${region}.amazonaws.com/maps/v0/maps/` +
      `${encodeURIComponent(truckMapName)}/style-descriptor?key=${key}`
    )
  }

  // Satellite / Hybrid: v2 GeoMaps imagery basemaps. Just the key (+ traffic on
  // Hybrid) — no theme/Truck params (the imagery isn't themeable).
  const base = `https://maps.geo.${region}.amazonaws.com/v2/styles`
  const trafficParam = traffic && baseStyleSupportsTraffic(baseStyle) ? '&traffic=All' : ''
  void colorScheme // imagery basemaps ignore color-scheme
  return `${base}/${baseStyle}/descriptor?key=${key}${trafficParam}`
}

// MapLibre `transformRequest`: the legacy v0 HERE Explore Truck basemap
// authenticates EVERY request (tiles, glyphs, sprites, the descriptor), and the
// descriptor's referenced URLs don't carry the key — so append it to any v0 Maps
// request that's missing it. v2 GeoMaps URLs already embed the key, and all other
// URLs (markers, app assets) are left untouched, so this is safe to set globally
// on the map instance.
export function transformMapRequest(url: string): { url: string } | undefined {
  if (!apiKey) return undefined
  if (url.includes('/maps/v0/maps/') && !/[?&]key=/.test(url)) {
    const sep = url.includes('?') ? '&' : '?'
    return { url: `${url}${sep}key=${encodeURIComponent(apiKey)}` }
  }
  return undefined
}
