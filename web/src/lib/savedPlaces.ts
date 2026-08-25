import type { WorkspacePlaceCategory } from './types'

export const PLACE_CATEGORIES: WorkspacePlaceCategory[] = [
  'parking',
  'depot',
  'fuel',
  'customer',
  'service',
  'customs',
  'other',
]

export const PLACE_CATEGORY_LABEL: Record<WorkspacePlaceCategory, string> = {
  parking: 'Parking',
  depot: 'Depot',
  fuel: 'Fuel station',
  customer: 'Customer',
  service: 'Service',
  customs: 'Customs',
  other: 'Other',
}

// ── Category inks ──────────────────────────────────────────────────────────
// MAP colours, not app colours — the same distinction the route palette makes
// in components/here/hereMapIcons.ts, and for the same reason: the basemap is
// always a day map or satellite imagery, so a pin drawn in theme tokens would
// invert against a field that never inverts. These are fixed values in both
// themes and must not be turned into `--color-*` tokens.
//
// Every one is pitched for a WHITE glyph sitting on it (5.9:1–7.1:1 against
// white), and they are held inside that one band on purpose — the same
// discipline as the author hues in index.css, so no category shouts louder than
// another on a map covered in them. The previous set was pitched the other way
// round (mid-tone pastels carrying a coloured glyph on a near-black teardrop),
// which is why it could not survive the pin being redrawn on a white plate.
export const PLACE_CATEGORY_COLOR: Record<WorkspacePlaceCategory, string> = {
  parking: '#1f6091',
  depot: '#8a5a20',
  fuel: '#2b6b46',
  customer: '#6b4794',
  service: '#9c3f5f',
  customs: '#17635f',
  other: '#5c626a',
}

// The single character stencilled into a pin. One glyph, mono, uppercase — the
// same voice the route's numbered stops speak in, so a place and a waypoint
// read as members of one family.
//
// Customs is B, for border: C is spoken for by customer, and a border crossing
// is what a customs point is on a truck route.
export const PLACE_CATEGORY_GLYPH: Record<WorkspacePlaceCategory, string> = {
  parking: 'P',
  depot: 'D',
  fuel: 'F',
  customer: 'C',
  service: 'S',
  customs: 'B',
  other: '•',
}
