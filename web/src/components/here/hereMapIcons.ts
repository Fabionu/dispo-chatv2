import type { RouteMarker } from '../../lib/here/types'
import type { WorkspacePlaceCategory } from '../../lib/types'
import { PLACE_CATEGORY_COLOR } from '../../lib/savedPlaces'

/* eslint-disable @typescript-eslint/no-explicit-any */

export const ROUTE_COLOR = '#c89572'
export const ORIGIN_COLOR = '#7d8a78'
export const DEST_COLOR = '#d97757'

// ── Marker icons ───────────────────────────────────────────────────────────
// Built as SVG with an explicit anchor so the marker sits EXACTLY on the
// coordinate: centre for the round origin/stop dots, the tip for the
// destination pin. (HERE places the icon's anchor point on the coordinate.)
// Kept deliberately small so the markers don't blanket the spot under them —
// precise clicking/placement needs the coordinate to stay visible. Start (green
// dot) and finish (coral pin) stay visually distinct in shape + colour.
export function originSvg(): string {
  return `<svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg"><circle cx="7" cy="7" r="5" fill="${ORIGIN_COLOR}" stroke="#ffffff" stroke-width="2"/></svg>`
}

export function stopSvg(label: string): string {
  return `<svg width="17" height="17" viewBox="0 0 17 17" xmlns="http://www.w3.org/2000/svg"><circle cx="8.5" cy="8.5" r="6.5" fill="#ffffff" stroke="${ROUTE_COLOR}" stroke-width="2"/><text x="8.5" y="8.5" text-anchor="middle" dominant-baseline="central" font-family="Inter, system-ui, sans-serif" font-size="9.5" font-weight="700" fill="#1c1c1f">${label}</text></svg>`
}

export function destSvg(): string {
  return `<svg width="20" height="26" viewBox="0 0 20 26" xmlns="http://www.w3.org/2000/svg"><path d="M10 1 C5 1 1 5 1 9.9 c0 6.6 9 15.1 9 15.1 s9-8.5 9-15.1 C19 5 15 1 10 1 z" fill="${DEST_COLOR}" stroke="#ffffff" stroke-width="1.8"/><circle cx="10" cy="10" r="3.4" fill="#ffffff"/></svg>`
}

// Small translucent dot shown under the cursor while dragging the route line.
// Kept tiny so it marks the release point without covering the road beneath it.
export function ghostSvg(): string {
  return `<svg width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg"><circle cx="6" cy="6" r="4" fill="${ROUTE_COLOR}" fill-opacity="0.65" stroke="#ffffff" stroke-width="1.5"/></svg>`
}

// Build the H.map.Icon for a marker with the correct anchor for its kind.
export function iconFor(H: any, marker: RouteMarker): any {
  if (marker.kind === 'origin') {
    return new H.map.Icon(originSvg(), { anchor: new H.math.Point(7, 7) })
  }
  if (marker.kind === 'destination') {
    // Anchor at the pin's tip (bottom centre of the 20×26 viewBox).
    return new H.map.Icon(destSvg(), { anchor: new H.math.Point(10, 26) })
  }
  return new H.map.Icon(stopSvg(marker.label ?? ''), { anchor: new H.math.Point(8.5, 8.5) })
}

const PLACE_GLYPH: Record<WorkspacePlaceCategory, string> = {
  parking: 'P',
  depot: 'D',
  fuel: 'F',
  customer: 'C',
  service: 'S',
  customs: 'B',
  other: '•',
}

// Saved places are deliberately a softer, smaller pin than route destinations:
// category colour + a single glyph make a dense workspace map easy to scan.
export function savedPlaceIconFor(H: any, category: WorkspacePlaceCategory): any {
  const color = PLACE_CATEGORY_COLOR[category]
  const glyph = PLACE_GLYPH[category]
  const svg = `<svg width="24" height="30" viewBox="0 0 24 30" xmlns="http://www.w3.org/2000/svg"><path d="M12 1.5c-5.65 0-10 4.2-10 9.55C2 18.1 12 28.5 12 28.5S22 18.1 22 11.05C22 5.7 17.65 1.5 12 1.5Z" fill="#202020" stroke="${color}" stroke-width="2"/><circle cx="12" cy="11" r="6.1" fill="${color}" fill-opacity=".2"/><text x="12" y="11.2" text-anchor="middle" dominant-baseline="central" font-family="Inter,system-ui,sans-serif" font-size="9.5" font-weight="750" fill="${color}">${glyph}</text></svg>`
  return new H.map.Icon(svg, { anchor: new H.math.Point(12, 30) })
}
